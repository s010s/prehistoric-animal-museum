// GPU cost of the sky stream per pass (timestamp queries), steady state at 2560x1267.
// usage: node test/sky-perf.mjs [W] [H]   (the GPU is shared with other agents: numbers are noisy)
import { GPU, G, E, setFrameCamera, setTimeOfDay, applyReadback, wait } from './sky-harness.mjs';
import { Atmosphere, SUN_ILLUMINANCE } from '../src/sky/Atmosphere.js';
import { Sky, sunDirectionFromTime } from '../src/sky/Sky.js';
import { Clouds } from '../src/sky/Clouds.js';
import { Environment } from '../src/sky/Environment.js';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';
import { SceneRenderer } from '../src/engine/render/SceneRenderer.js';

await GPU.init( { headless: true } );
if ( ! GPU.hasTimestamp ) {

	console.log( 'no timestamp-query' );
	process.exit( 0 );

}

const W = Number( process.argv[ 2 ] || 2560 ), H = Number( process.argv[ 3 ] || 1267 );
const atmosphere = new Atmosphere();
const sky = new Sky( atmosphere );
const clouds = new Clouds( null, atmosphere );
clouds.outputSize = { x: W, y: H };
sky.clouds = clouds;
const scene = new E.Scene();
const env = new Environment( null, scene, sky );
if ( process.env.ENV_CONT ) env.interval = 0;
const camera = new E.PerspectiveCamera( 55, W / H, 0.1, 60000 );
const mr = new MeshRenderer();
const sr = new SceneRenderer( mr, scene, camera );
sr.setSize( W, H );
sr.background = process.env.NOBG ? null : sky.background;
const app = { atmosphere, sky };
setTimeOfDay( app, 15.5, sunDirectionFromTime, SUN_ILLUMINANCE );
camera.position.set( 0, 3, 0 );

// timestamp slots per labelled pass
const MAXQ = 256;
const qs = GPU.device.createQuerySet( { type: 'timestamp', count: MAXQ } );
const resolveBuf = GPU.device.createBuffer( { size: MAXQ * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC } );
const readBuf = GPU.device.createBuffer( { size: MAXQ * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST } );
let slots = [];
const tw = ( label ) => {

	const i = slots.length;
	slots.push( label );
	return { querySet: qs, beginningOfPassWriteIndex: i * 2, endOfPassWriteIndex: i * 2 + 1 };

};

// wrap every ComputeKernel.dispatch and the background pass
const kernels = [ ...Object.values( atmosphere ).filter( ( k ) => k && k.pipeline && k.dispatch ), ...Object.values( clouds ).filter( ( k ) => k && k.pipeline && k.dispatch ),
	...env.faceKernels, ...env.filterKernels.flat(), ...env.shKernels ];
const wrap = ( k ) => {

	if ( k._wrapped ) return;
	k._wrapped = true;
	const d = k.dispatch.bind( k );
	k.dispatch = ( c, o = {} ) => {

		k.timestampWrites = tw( k.label );
		d( c, o );
		k.timestampWrites = null;

	};

};

kernels.forEach( wrap );
const origRender = mr.render.bind( mr );
mr.render = ( s, p ) => origRender( s, { ...p, timestampWrites: tw( 'scene pass (sky background)' ) } );

const acc = {};
const FR = 90;
for ( let f = 0; f < FR; f ++ ) {

	slots = [];
	const a = f * 0.004;
	camera.lookAt( Math.cos( a ), 3.3, Math.sin( a ) );
	GPU.beginFrame();
	atmosphere.update( 1 / 60, camera.position.y );
	clouds.update( 1 / 60, camera );
	for ( const s of clouds._traceSets ) if ( s ) [ s.trace, s.high, s.box, ...s.resolve ].forEach( wrap );
	env.update( 1 / 60 );
	setFrameCamera( camera, W, H );
	sr.render();
	const enc = GPU.getEncoder();
	enc.resolveQuerySet( qs, 0, slots.length * 2, resolveBuf, 0 );
	enc.copyBufferToBuffer( resolveBuf, 0, readBuf, 0, slots.length * 16 );
	GPU.submit();
	await readBuf.mapAsync( GPUMapMode.READ );
	const t = new BigUint64Array( readBuf.getMappedRange().slice( 0 ) );
	readBuf.unmap();
	if ( f >= 30 ) {

		let lo = null, hi = null;
		for ( let i = 0; i < slots.length * 2; i ++ ) { if ( lo === null || t[ i ] < lo ) lo = t[ i ]; if ( hi === null || t[ i ] > hi ) hi = t[ i ]; }
		( acc[ 'FRAME SPAN (first begin .. last end)' ] = acc[ 'FRAME SPAN (first begin .. last end)' ] || [] ).push( Number( hi - lo ) / 1e6 );

	}

	if ( f >= 30 ) slots.forEach( ( l, i ) => {

		const ms = Number( t[ i * 2 + 1 ] - t[ i * 2 ] ) / 1e6;
		( acc[ l ] = acc[ l ] || [] ).push( ms );

	} );
	applyReadback( app );

}

let total = 0;
for ( const l in acc ) {

	const v = acc[ l ].slice().sort( ( x, y ) => x - y );
	const med = v[ v.length >> 1 ];
	const perFrame = v.reduce( ( s, x ) => s + x, 0 ) / ( FR - 30 );
	total += perFrame;
	console.log( `${ l.padEnd( 34 ) } median ${ med.toFixed( 3 ) } ms  x${ ( v.length / ( FR - 30 ) ).toFixed( 2 ) }/frame  avg/frame ${ perFrame.toFixed( 3 ) } ms` );

}

console.log( 'total per frame (avg)', total.toFixed( 3 ), 'ms' );
await wait( 100 );
process.exit( 0 );
