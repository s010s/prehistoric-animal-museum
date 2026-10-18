// Atmosphere + sky (no clouds) at several times of day, rendered as the scene background.
// usage: node test/sky-atmosphere.mjs [outDir]
import { GPU, G, E, setFrameCamera, RenderTarget, tonemapPass, savePNG, setTimeOfDay, applyReadback, wait } from './sky-harness.mjs';
import { Atmosphere, SUN_ILLUMINANCE } from '../src/sky/Atmosphere.js';
import { Sky, sunDirectionFromTime } from '../src/sky/Sky.js';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';
import { SceneRenderer } from '../src/engine/render/SceneRenderer.js';

await GPU.init( { headless: true } );
const out = process.argv[ 2 ] || '/tmp';
const W = 1280, H = 634;
const atmosphere = new Atmosphere();
const sky = new Sky( atmosphere );
const scene = new E.Scene();
const camera = new E.PerspectiveCamera( 60, W / H, 0.1, 60000 );
const mr = new MeshRenderer();
const sr = new SceneRenderer( mr, scene, camera );
sr.setSize( W, H );
sr.background = sky.background;
const ldr = new RenderTarget( W, H, { colors: [ 'rgba8unorm' ], label: 'ldr' } );

for ( const [ name, hours, yaw, pitch, exposure ] of [ [ 'noon', 12, 0, 0.35, 1 ], [ 'morning', 8, 1.2, 0.15, 1 ], [ 'sunset', 18.3, - 1.57, 0.1, 1.5 ], [ 'dusk', 18.9, - 1.57, 0.2, 3 ], [ 'night', 23, 3.14, 0.5, 6 ] ] ) {

	setTimeOfDay( { atmosphere, sky }, hours, sunDirectionFromTime, SUN_ILLUMINANCE );
	// face the sun azimuth + yaw
	const s = atmosphere.sunDir.value;
	const az = Math.atan2( s.z, s.x ) + yaw;
	camera.position.set( 0, 2, 0 );
	camera.lookAt( Math.cos( az ), 2 + Math.tan( pitch ), Math.sin( az ) );
	G.exposure.value = exposure;
	atmosphere.invalidate();
	for ( let f = 0; f < 4; f ++ ) {

		GPU.beginFrame();
		atmosphere.update( 1 / 60, camera.position.y );
		setFrameCamera( camera, W, H );
		sr.render();
		tonemapPass( sr.sceneRT.texture ).render( { colorViews: [ ldr.texture ] } );
		GPU.submit();
		await wait( 30 );
		applyReadback( { atmosphere } );

	}

	console.log( name, 'sunDir', s.toArray().map( ( x ) => x.toFixed( 3 ) ).join( ',' ), 'irr', atmosphere.skyIrradiance?.map( ( x ) => x.toFixed( 3 ) ), 'Tsun', atmosphere.sunTransmittance?.map( ( x ) => x.toFixed( 3 ) ) );
	await savePNG( ldr.texture, `${ out }/sky-${ name }.png` );

}

await wait( 200 );
process.exit( 0 );
