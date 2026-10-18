// Environment-lit PBR test spheres (roughness x metalness grid) under the atmosphere + clouds sky, with
// sun shadows, at real resolution. usage: node test/sky-env.mjs [outDir] [W] [H] [case]
import { GPU, G, E, setFrameCamera, RenderTarget, tonemapPass, savePNG, setTimeOfDay, applyReadback, wait } from './sky-harness.mjs';
import { Atmosphere, SUN_ILLUMINANCE } from '../src/sky/Atmosphere.js';
import { Sky, sunDirectionFromTime } from '../src/sky/Sky.js';
import { Clouds } from '../src/sky/Clouds.js';
import { Environment } from '../src/sky/Environment.js';
import { Material } from '../src/engine/render/Material.js';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';
import { SceneRenderer } from '../src/engine/render/SceneRenderer.js';
import { SunShadows } from '../src/engine/render/Shadows.js';
import { AirMotes } from '../src/fx/AirMotes.js';
import { ShaderModule } from '../src/engine/gpu/Shader.js';

await GPU.init( { headless: true } );
const out = process.argv[ 2 ] || '/tmp';
const W = Number( process.argv[ 3 ] || 2560 ), H = Number( process.argv[ 4 ] || 1267 );
const only = process.argv[ 5 ] || null;
const atmosphere = new Atmosphere();
const sky = new Sky( atmosphere );
const clouds = new Clouds( null, atmosphere );
clouds.outputSize = { x: W, y: H };
sky.clouds = clouds;
const scene = new E.Scene();
const env = new Environment( null, scene, sky );

const ground = new E.Mesh( new E.PlaneGeometry( 80, 80 ).rotateX( - Math.PI / 2 ), new Material( { name: 'ground', color: 0x8a7a62, roughness: 0.9 } ) );
scene.add( ground );
const sphereGeo = new E.SphereGeometry( 0.8, 64, 32 );
for ( let row = 0; row < 3; row ++ ) for ( let i = 0; i < 6; i ++ ) {

	const metal = row === 0 ? 1 : 0;
	const color = row === 0 ? 0xe0c080 : row === 1 ? 0xdddddd : 0xb03020;
	const m = new E.Mesh( sphereGeo, new Material( { name: `s${ row }${ i }`, color, metalness: metal, roughness: Math.max( 0.02, i / 5 ) } ) );
	m.position.set( ( i - 2.5 ) * 2, 0.8, ( row - 1 ) * 2.2 );
	m.castShadow = true;
	scene.add( m );

}

const box = new E.Mesh( new E.BoxGeometry( 1.5, 3, 1.5 ), new Material( { name: 'box', color: 0x556070, roughness: 0.6 } ) );
box.position.set( 7, 1.5, - 1 );
box.castShadow = true;
scene.add( box );
ground.castShadow = true;

// terrain stub (other stream): flat land 1.5 m above the sea
const terrainStub = { module: new ShaderModule( { name: 'terrainStub', code: 'fn terrainHeightAt( xz: vec2f ) -> f32 { return 1.5; }\nfn terrainSunShadowAt( P: vec3f ) -> f32 { return 1.0; }' } ) };
const motes = new AirMotes( { terrain: terrainStub, clouds, count: Number( process.env.MOTES || 3000 ) } );
motes.intensity.value = Number( process.env.MOTE_INTENSITY || 1 );
scene.add( motes.mesh );
const camera = new E.PerspectiveCamera( 50, W / H, 0.1, 60000 );
const mr = new MeshRenderer();
const shadows = new SunShadows();
const sr = new SceneRenderer( mr, scene, camera );
sr.setSize( W, H );
sr.background = sky.background;
const ldr = new RenderTarget( W, H, { colors: [ 'rgba8unorm' ], label: 'ldr' } );
const app = { atmosphere, sky };

for ( const [ name, hours, exposure ] of [ [ 'noon', 12.5, 1 ], [ 'morning', 8.0, 1.1 ], [ 'sunset', 18.1, 1.6 ], [ 'night', 22.5, 5 ] ] ) {

	if ( only && name !== only ) continue;
	setTimeOfDay( app, hours, sunDirectionFromTime, SUN_ILLUMINANCE );
	camera.position.set( 0, 4.5, 13 );
	camera.lookAt( 0, 1.5, 0 );
	if ( process.env.TOWARD_SUN ) {

		// look toward the sun (backlit motes)
		const sd = atmosphere.sunDir.value;
		camera.position.set( 0, 2, 0 );
		camera.lookAt( sd.x * 10, 2 + Math.max( sd.y, 0.05 ) * 10, sd.z * 10 );

	}
	G.exposure.value = exposure;
	clouds.invalidate();
	for ( let f = 0; f < Number( process.env.FRAMES || 24 ); f ++ ) {

		GPU.beginFrame();
		atmosphere._irrTimer = 0;
		atmosphere.update( 1 / 60, camera.position.y );
		clouds.update( 1 / 60, camera );
		env.update( 1 / 60, f === 4 || f === 12 );
		G.time.value += 1 / 60;
		motes.update( 1 / 60, camera, 0 );
		setFrameCamera( camera, W, H );
		shadows.render( scene, mr, shadows.update( camera, G.sunDir.value ) );
		sr.render();
		tonemapPass( sr.sceneRT.texture ).render( { colorViews: [ ldr.texture ] } );
		GPU.submit();
		await wait( 5 );
		applyReadback( app );
		// IBL only (compare with the three.js PMREM: no key light)
		if ( process.env.ENVONLY ) G.sunColor.value.setRGB( 0, 0, 0 );

	}

	if ( process.env.NANCHECK ) {

		const { readTexture } = await import( '../src/engine/gpu/Readback.js' );
		for ( const [ n, t ] of [ [ 'view', clouds.viewTex ], [ 'trace', clouds.traceTex ], [ 'high', clouds.highTrace ], [ 'motion', clouds.motionTex ], [ 'pano', clouds.panorama ] ] ) {

			const img = await readTexture( t );
			const h = new Uint16Array( img.data );
			let nan = 0, inf = 0, neg = 0, big = 0;
			for ( let i = 0; i < h.length; i ++ ) { const e = ( h[ i ] >> 10 ) & 31, m = h[ i ] & 1023; if ( e === 31 ) { if ( m ) nan ++; else inf ++; } else if ( h[ i ] & 0x8000 && ( h[ i ] & 0x7fff ) ) neg ++; }
			console.log( n, t.width, t.height, 'nan', nan, 'inf', inf, 'neg', neg );
			if ( n === 'view' ) {

				// alpha of the view clouds around a pixel (x0, y0) as text
				const [ x0, y0 ] = ( process.env.NANCHECK_AT || '682,53' ).split( ',' ).map( Number );
				const f16 = ( u ) => { const e = ( u >> 10 ) & 31, m = u & 1023; return ( e ? ( 1 + m / 1024 ) * 2 ** ( e - 15 ) : m / 1024 * 2 ** - 14 ) * ( u & 0x8000 ? - 1 : 1 ); };
				for ( let y = y0 - 6; y <= y0 + 6; y ++ ) {

					let row = '';
					for ( let x = x0 - 12; x <= x0 + 12; x ++ ) row += Math.round( Math.min( Math.max( f16( h[ ( y * t.width + x ) * 4 + 3 ] ), 0 ), 1 ) * 9 );
					console.log( row );

				}

			}

		}

	}

	await savePNG( ldr.texture, `${ out }/env-${ name }.png`, [ { x: 1600, y: 0, w: 640, h: 300, name: "clouds" }, { x: 500, y: 560, w: 900, h: 380, name: "spheres" } ] );

}

console.log( 'stats', mr.stats );
await wait( 200 );
process.exit( 0 );
