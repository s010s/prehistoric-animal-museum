// OceanFFT: displacement / derivative maps + timing.  node test/ocean-fft.mjs [outDir]
import './headless.mjs';
import { GPU } from '../src/engine/gpu/GPU.js';
import { G } from '../src/engine/render/Frame.js';
import { OceanFFT } from '../src/ocean/OceanFFT.js';
import { readFloatTexture, writeFloatPNG, stats } from './ocean-util.mjs';

const out = process.argv[ 2 ] || '/tmp';
await GPU.init( { headless: true } );
const fft = new OceanFFT( null );
G.dt.value = 1 / 60;
for ( let f = 0; f < 120; f ++ ) {

	GPU.beginFrame();
	fft.update( 1 / 60 );
	GPU.submit();

}

await GPU.queue.onSubmittedWorkDone();
for ( let c = 0; c < 4; c ++ ) {

	const d = await readFloatTexture( fft.displacementTexture, { layer: c } );
	const dv = await readFloatTexture( fft.derivativeTexture, { layer: c } );
	console.log( `cascade ${ c } L=${ fft.sizes[ c ] }: Dx`, stats( d, 0 ), '\n  Dy', stats( d, 1 ), '\n  foam', stats( d, 3 ), '\n  dDy/dx', stats( dv, 0 ), '\n  Dxx', stats( dv, 2 ) );
	const s = stats( d, 1 );
	const r = Math.max( Math.abs( s.min ), Math.abs( s.max ) );
	writeFloatPNG( `${ out }/ocean-fft-disp${ c }.png`, d, { channels: [ 0, 1, 2 ], lo: - r, hi: r } );
	writeFloatPNG( `${ out }/ocean-fft-deriv${ c }.png`, dv, { channels: [ 0, 1, 3 ], lo: - 1, hi: 1 } );
	writeFloatPNG( `${ out }/ocean-fft-foam${ c }.png`, d, { channels: [ 3 ], lo: 0, hi: 1 } );

}

const m5 = await readFloatTexture( fft.displacementTexture, { layer: 0, mip: 5 } );
const m8 = await readFloatTexture( fft.displacementTexture, { layer: 0, mip: 8 } );
console.log( 'mip5 Dy', stats( m5, 1 ), 'mip8', Array.from( m8.data ) );

// timing
const T = 200;
await GPU.queue.onSubmittedWorkDone();
const t0 = performance.now();
for ( let f = 0; f < T; f ++ ) {

	GPU.beginFrame();
	fft.update( 1 / 60 );
	GPU.submit();

}

await GPU.queue.onSubmittedWorkDone();
console.log( `FFT update: ${ ( ( performance.now() - t0 ) / T ).toFixed( 3 ) } ms/frame (incl. submit overhead)` );
process.exit( 0 );
