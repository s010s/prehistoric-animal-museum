// Headless test of WakeSim: a boat runs a curve over deep water toward a sloping beach, then the
// wake height / foam / aeration are rendered top-down through the WGSL readers (wake.module).
// usage: node test/ocean-wake-sim.mjs [out-prefix]
import { writePNG } from './headless.mjs';
import { GPU } from '../src/engine/gpu/GPU.js';
import { RenderTarget } from '../src/engine/gpu/Texture.js';
import { ShaderModule } from '../src/engine/gpu/Shader.js';
import { readTexture } from '../src/engine/gpu/Readback.js';
import { FullscreenPass } from '../src/engine/render/FullscreenPass.js';
import { G } from '../src/engine/render/Frame.js';
import { Vector3 } from '../src/engine/index.js';
import { WakeSim } from '../src/ocean/WakeSim.js';

await GPU.init( { headless: true } );
const out = process.argv[ 2 ] || '/tmp/ocean-wake';

// stub terrain: deep sea, a beach rising toward +x beyond x = 60
const terrainGPU = { module: new ShaderModule( { name: 'terrainStub', code: /* wgsl */`
fn terrainHeightAt( xz: vec2f ) -> f32 { return max( -30.0, -8.0 + ( xz.x - 60.0 ) * 0.08 ); }
` } ) };

// stub boat: 7.2 m hull, 1.1 m half beam
const lines = {
	zAft: - 3.4, wlEnd: 3.6,
	bottomAt( x, z ) {

		if ( z < this.zAft || z > this.wlEnd ) return NaN;
		const t = ( z - this.zAft ) / ( this.wlEnd - this.zAft );
		const hb = 1.1 * Math.sqrt( Math.max( 0, 1 - Math.pow( Math.max( 0, t - 0.55 ) / 0.45, 2 ) ) );
		if ( Math.abs( x ) > hb ) return NaN;
		return - 0.45 * ( 1 - ( x / Math.max( hb, 1e-3 ) ) ** 2 ) * ( 0.6 + 0.4 * ( 1 - t ) );

	},
};
let yaw = Math.PI / 2; // heading +x
const boat = {
	model: { lines }, position: new Vector3( - 40, 0, 0 ), velocity: new Vector3(), driven: true, throttle: 0.8, rpm: 1,
	forward: ( v ) => v.set( Math.sin( yaw ), 0, Math.cos( yaw ) ),
};

const wake = new WakeSim( null, { terrainGPU, boat } );
const dt = 1 / 60;
const speed = Number( process.env.SPEED || 7 );
const frames = Number( process.env.FRAMES || 900 );
let t0 = 0;
for ( let i = 0; i < frames; i ++ ) {

	yaw += dt * 0.12; // gentle turn
	boat.velocity.set( Math.sin( yaw ) * speed, 0, Math.cos( yaw ) * speed );
	boat.position.addScaledVector( boat.velocity, dt );
	G.time.value += dt;
	G.dt.value = dt;
	GPU.beginFrame();
	if ( i === frames - 60 ) {

		await GPU.queue.onSubmittedWorkDone();
		t0 = performance.now();

	}

	wake.update( dt );
	GPU.submit();
	if ( i % 30 === 0 ) await GPU.queue.onSubmittedWorkDone();

}

await GPU.queue.onSubmittedWorkDone();
console.log( `wake step: ${ ( ( performance.now() - t0 ) / 60 ).toFixed( 3 ) } ms/frame (incl. submit, 60 frames)` );
console.log( 'boat at', boat.position.x.toFixed( 1 ), boat.position.z.toFixed( 1 ), 'steps', wake.stepCount );

// top-down views: 120 m around the boat. r: height, g: foam, b: aeration; second image: shaded slopes
const W = 1024, H = 1024;
const rt = new RenderTarget( W, H, { colors: [ 'rgba8unorm' ], label: 'wakeView' } );
const view = ( code ) => new FullscreenPass( { label: 'wake view', modules: [ wake.module ], colorFormats: [ 'rgba8unorm' ], code } );
const center = `vec2f( ${ boat.position.x.toFixed( 2 ) }, ${ boat.position.z.toFixed( 2 ) } )`;
const passes = {
	height: view( /* wgsl */`fn fragment( in: FSIn ) -> vec4f {
		let xz = ${ center } + ( in.uv - 0.5 ) * 120.0;
		let h = wakeDisplacement( xz ).y;
		let fr = wakeFragment( xz );
		let n = normalize( vec3f( - fr.slopes.x, 1.0, - fr.slopes.y ) );
		let shade = sat( dot( n, normalize( vec3f( 0.5, 0.8, 0.3 ) ) ) );
		let base = vec3f( 0.5 + h * 2.0, 0.5 + h * 2.0, 0.55 + h * 2.0 ) * ( 0.4 + 0.6 * shade );
		let col = mix( base, vec3f( 1.0 ), sat( fr.foam ) );
		return vec4f( mix( col, vec3f( 0.2, 0.9, 0.8 ), fr.aeration ), 1.0 );
	}` ),
	fields: view( /* wgsl */`fn fragment( in: FSIn ) -> vec4f {
		let xz = ${ center } + ( in.uv - 0.5 ) * 120.0;
		let fr = wakeFragment( xz );
		return vec4f( 0.5 + wakeHeight( xz ) * 3.0, sat( fr.foam ), fr.aeration / 0.3, 1.0 );
	}` ),
};
for ( const k in passes ) {

	GPU.beginFrame();
	passes[ k ].render( { colorViews: [ rt.texture ], clear: [ 0, 0, 0, 1 ] } );
	GPU.submit();
	const img = await readTexture( rt.texture );
	writePNG( `${ out }-${ k }.png`, W, H, new Uint8Array( img.data ) );
	console.log( 'wrote', `${ out }-${ k }.png` );

}

await new Promise( ( r ) => setTimeout( r, 300 ) );
process.exit( 0 );
