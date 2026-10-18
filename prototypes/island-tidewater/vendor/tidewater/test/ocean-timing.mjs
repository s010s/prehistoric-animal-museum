// GPU cost of the ocean at 2560x1267: whole frame with / without the water, FFT, caustics.
import { makeOceanScene } from './ocean-scene.mjs';
import { GPU } from '../src/engine/gpu/GPU.js';

const s = await makeOceanScene();
s.camera.position.set( 0, 6, 40 ); s.camera.lookAt( 60, 0, - 60 );
for ( let i = 0; i < 5; i ++ ) s.frame();
const t = async ( label, n = 40 ) => { const ms = await s.time( n ); console.log( label.padEnd( 34 ), ms.toFixed( 2 ), 'ms' ); return ms; };
const all = await t( 'frame (all)' );
s.waterMaterial.visible = false;
const noWater = await t( 'frame without water' );
s.waterMaterial.visible = true;
console.log( 'water pass ~', ( all - noWater ).toFixed( 2 ), 'ms' );
const run = async ( label, fn, n = 100 ) => {

	await GPU.queue.onSubmittedWorkDone();
	const t0 = performance.now();
	for ( let i = 0; i < n; i ++ ) { GPU.beginFrame(); fn(); GPU.submit(); }
	await GPU.queue.onSubmittedWorkDone();
	console.log( label.padEnd( 34 ), ( ( performance.now() - t0 ) / n ).toFixed( 3 ), 'ms' );

};
await run( 'fft update', () => s.fft.update( 1 / 60 ) );
await run( 'caustics update', () => s.caustics.update() );
await run( 'empty submit', () => {} );
process.exit( 0 );
