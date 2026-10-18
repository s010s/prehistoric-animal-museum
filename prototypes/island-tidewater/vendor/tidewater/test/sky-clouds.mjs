// Atmosphere + volumetric clouds + cirrus as the scene background at real resolution, several times of day.
// usage: node test/sky-clouds.mjs [outDir] [W] [H]
import { GPU, G, E, setFrameCamera, RenderTarget, tonemapPass, savePNG, setTimeOfDay, applyReadback, wait } from './sky-harness.mjs';
import { Atmosphere, SUN_ILLUMINANCE } from '../src/sky/Atmosphere.js';
import { Sky, sunDirectionFromTime } from '../src/sky/Sky.js';
import { Clouds } from '../src/sky/Clouds.js';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';
import { SceneRenderer } from '../src/engine/render/SceneRenderer.js';

await GPU.init( { headless: true } );
const out = process.argv[ 2 ] || '/tmp';
const W = Number( process.argv[ 3 ] || 2560 ), H = Number( process.argv[ 4 ] || 1267 );
const only = process.argv[ 5 ] || null;
const atmosphere = new Atmosphere();
const sky = new Sky( atmosphere );
const clouds = new Clouds( null, atmosphere );
clouds.outputSize = { x: W, y: H };
if ( ! process.env.NOCLOUDS ) sky.clouds = clouds;
if ( process.env.DENS ) clouds.densityScale.value = Number( process.env.DENS );
if ( process.env.CIRRUS ) clouds.cirrus.value = Number( process.env.CIRRUS );
const scene = new E.Scene();
const camera = new E.PerspectiveCamera( 55, W / H, 0.1, 60000 );
const mr = new MeshRenderer();
const sr = new SceneRenderer( mr, scene, camera );
sr.setSize( W, H );
sr.background = sky.background;
const ldr = new RenderTarget( W, H, { colors: [ 'rgba8unorm' ], label: 'ldr' } );
const app = { atmosphere, sky };

const cases = [ [ 'noon', 12.5, 0.9, 0.12, 1 ], [ 'afternoon', 15.5, 0.4, 0.1, 1 ], [ 'sunset', 18.2, 0.35, 0.06, 1.6 ], [ 'dusk', 18.7, 0.0, 0.1, 3 ], [ 'night', 22.5, 2.6, 0.35, 5 ], [ 'moon', 20.5, Math.PI, 0.75, 5 ] ];
for ( const [ name, hours, yaw, pitch, exposure ] of cases ) {

	if ( only && name !== only ) continue;
	setTimeOfDay( app, hours, sunDirectionFromTime, SUN_ILLUMINANCE );
	const s = atmosphere.sunDir.value;
	const az = Math.atan2( s.z, s.x ) + yaw;
	camera.position.set( 0, 3, 0 );
	camera.lookAt( Math.cos( az ), 3 + Math.tan( pitch ), Math.sin( az ) );
	camera.updateMatrixWorld();
	G.exposure.value = exposure;
	clouds.invalidate();
	let t0 = 0;
	const N = Number( process.env.FRAMES || 40 );
	for ( let f = 0; f < N; f ++ ) {

		if ( f === N - 1 ) t0 = performance.now();
		GPU.beginFrame();
		atmosphere._irrTimer = f % 4 === 0 ? 0 : atmosphere._irrTimer;
		atmosphere.update( 1 / 60, camera.position.y );
		if ( process.env.SUNC ) G.sunColor.value.setScalar( Number( process.env.SUNC ) );
		if ( process.env.SKYI ) G.skyIrradiance.value.setScalar( Number( process.env.SKYI ) );
		clouds.update( 1 / 60, camera );
		setFrameCamera( camera, W, H );
		sr.render();
		tonemapPass( sr.sceneRT.texture ).render( { colorViews: [ ldr.texture ] } );
		GPU.submit();
		if ( f === N - 1 ) {

			await GPU.queue.onSubmittedWorkDone();
			console.log( name, 'last frame ms (cpu+gpu, shared GPU)', ( performance.now() - t0 ).toFixed( 1 ) );

		}

		await wait( 5 );
		applyReadback( app );
		if ( process.env.DEBUG ) console.log( f, 'rebuild', clouds._rebuild, 'since', clouds._since, 'hv', clouds.historyValid.value, 'turned', clouds._turned?.toFixed( 4 ) );

	}

	if ( process.env.DEBUG ) console.log( 'sunColor', G.sunColor.value.toArray(), 'irr', G.skyIrradiance.value.toArray(), 'night', G.night.value, 'sunDir', G.sunDir.value.toArray() );
	await savePNG( ldr.texture, `${ out }/clouds-${ name }.png`, [ { x: Math.floor( W * 0.72 ), y: 0, w: Math.floor( W * 0.25 ), h: Math.floor( H * 0.35 ), name: 'crop' }, { x: Math.floor( W * 0.5 ) - 150, y: H - 200, w: 300, h: 200, name: 'bottom' } ] );

}

await wait( 200 );
process.exit( 0 );
