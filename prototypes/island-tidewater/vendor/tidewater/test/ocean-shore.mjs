// Shore stream test: ShoreWaves / ShoreSim / SurfFoam / SeaDetail / Breakers on an analytic beach.
// node test/ocean-shore.mjs [outDir]
import { writePNG } from './headless.mjs';
import { SunShadows, GPU, RenderTarget, FullscreenPass, readTexture, readBuffer, MeshRenderer, FrameUniforms, G, setFrameCamera, commonModule } from '../src/engine/webgpu.js';
import { PerspectiveCamera, Scene, Vector2 } from '../src/engine/index.js';
import { ComputeKernel, StorageBuffer } from '../src/engine/webgpu.js';
import { ShoreWaves } from '../src/ocean/ShoreWaves.js';
import { ShoreSim } from '../src/ocean/ShoreSim.js';
import { SurfFoam } from '../src/ocean/SurfFoam.js';
import { SeaDetail } from '../src/ocean/SeaDetail.js';
import { Breakers } from '../src/ocean/Breakers.js';
import { makeTerrain, makeSky, makeClouds, makeFFT, makeSpray, heightAt } from './ocean-shore-stubs.mjs';

const OUT = process.argv[ 2 ] || '/tmp';
await GPU.init( { headless: true } );
let errors = 0;
GPU.device.addEventListener( 'uncapturederror', () => errors ++ );
const origErr = console.error;
console.error = ( ...a ) => { errors ++; origErr( ...a ); };

const terrain = makeTerrain();
const shore = new ShoreWaves( terrain );
const t0 = performance.now();
const sim = new ShoreSim( null, { terrainGPU: terrain, shore, center: new Vector2( 0, 20 ), size: 160, res: 768 } );
console.log( 'ShoreSim + lace setup', ( performance.now() - t0 ).toFixed( 0 ), 'ms' );
const foam = new SurfFoam( { shoreSim: sim } );
const detail = new SeaDetail();
const spray = makeSpray();
const surface = { fft: makeFFT(), terrain, shoreSim: sim, amplitude: { value: 1 } };
const t1 = performance.now();
const breakers = new Breakers( null, { surface, shore, terrainData: { heightAt }, sky: makeSky(), spray, clouds: makeClouds() } );
console.log( 'Breakers stations', breakers.NS, 'setup', ( performance.now() - t1 ).toFixed( 0 ), 'ms' );

G.windSpeed.value = 9;
FrameUniforms.fields.frameIndex.value = 0;
const dt = 1 / 30;
G.dt.value = dt;
const camera = new PerspectiveCamera( 50, 16 / 9, 0.1, 2000 );
camera.position.set( - 8, 3.0, - 6 ); camera.lookAt( 10, 0, 40 );

// run the simulation for 25 s of time
const tSim = performance.now();
for ( let f = 0; f < 750; f ++ ) {

	G.time.value = 30 + f * dt;
	FrameUniforms.fields.frameIndex.value = f;
	GPU.beginFrame();
	setFrameCamera( camera, 1280, 720 );
	sim.update();
	breakers.update( camera );
	GPU.submit();
	if ( f % 100 === 0 ) await GPU.queue.onSubmittedWorkDone();

}

await GPU.queue.onSubmittedWorkDone();
console.log( 'sim 750 frames', ( performance.now() - tSim ).toFixed( 0 ), 'ms' );

// GPU cost: ShoreSim + Breakers kernel alone
async function timeIt( label, fn, n = 60 ) {

	await GPU.queue.onSubmittedWorkDone();
	const a = performance.now();
	for ( let i = 0; i < n; i ++ ) {

		GPU.beginFrame(); fn(); GPU.submit();

	}

	await GPU.queue.onSubmittedWorkDone();
	console.log( label, ( ( performance.now() - a ) / n ).toFixed( 3 ), 'ms/frame' );

}

await timeIt( 'ShoreSim.update', () => sim.update() );
await timeIt( 'Breakers.update', () => breakers.update( camera ) );

// ---- top-down views of the fields (x -60..60, z -20..100)
const W = 960, H = 960;
const view = ( label, body, modules ) => {

	const rt = new RenderTarget( W, H, { colors: [ 'rgba8unorm' ], label } );
	const pass = new FullscreenPass( { label, colorFormats: [ 'rgba8unorm' ], modules: [ commonModule, ...modules ], code: /* wgsl */`
fn fragment( in: FSIn ) -> vec4f {
	let xz = vec2f( -60.0 + in.uv.x * 120.0, 100.0 - in.uv.y * 120.0 );
	let ground = terrainHeightAt( xz );
	let depth = frame.seaLevel - ground;
	var c = vec3f( 0.0 );
${ body }
	return vec4f( sat3( c ), 1.0 );
}` } );
	return { rt, pass, label };

};

const views = [
	view( 'shore-evaluate', /* wgsl */`
	let sw = shoreEvaluate( xz, depth, ground );
	let land = depth < 0.0 && sw.swashCovered < 0.5;
	c = vec3f( sw.face, sw.disp.y * 0.6 + 0.4, 0.35 + sw.foam * 0.65 );
	c = mix( c, vec3f( sw.foam ), sw.foam * 0.8 );
	if ( sw.swashCovered > 0.5 && depth < 0.0 ) { c = vec3f( 0.2, 0.8, 0.9 ) * ( 0.5 + sw.thick * 5.0 ) + sw.swashFoam; }
	if ( land ) { c = vec3f( 0.55, 0.45, 0.3 ) + ground * 0.05; }
	// lines every 10 m
	if ( fract( xz.y / 10.0 ) < 0.012 ) { c *= 0.6; }`, [ shore.module, terrain.module ] ),
	view( 'shore-sim', /* wgsl */`
	let s = shoreSimSample( xz );
	c = vec3f( s.x, s.y * 0.5, s.z ) + vec3f( 0.0, 0.0, 0.15 ) * select( 0.0, 1.0, depth > 0.0 );
	c += vec3f( 0.3 * sat( s.w * 0.3 ), 0.0, 0.0 );`, [ sim.module, terrain.module ] ),
	view( 'surf-foam', /* wgsl */`
	let s = shoreSimSample( xz );
	let sw = shoreEvaluate( xz, depth, ground );
	var a: SurfFoamArgs;
	a.coverage = sat( s.x + sw.foam ); a.foam = sat( s.x + sw.foam ) * 0.8; a.footprint = 0.02; a.depth = depth; a.bubbles = 0.5;
	a.lagXZ = xz; a.normal = normalize( sw.nShore ); a.baseNormal = normalize( sw.nShore ); a.fresh = sw.foam; a.sim = s.x;
	a.simState = s; a.roller = sw.roller; a.P = vec3f( xz.x, sw.disp.y, xz.y );
	let info = surfFoamShading( a );
	let lit = surfFoamLight( info, a.normal, normalize( vec3f( 0.3, 0.6, 0.5 ) ), vec3f( 0.0, 1.0, 0.0 ), vec3f( 3.0 ), a.P );
	c = mix( vec3f( 0.02, 0.12, 0.16 ), lit * 0.6, sat( info.foam ) );
	if ( depth < 0.0 && sw.swashCovered < 0.5 ) { c = vec3f( 0.55, 0.45, 0.3 ) + shoreSimSandFoam( xz, s, ground ) * 0.4; }`, [ foam.module, terrain.module ] ),
	view( 'sea-detail', /* wgsl */`
	let d = seaDetailSample( xz * 20.0 );
	c = vec3f( d.gust, d.slick, d.streak * 3.0 ) * 0.8 + vec3f( d.rough * 0.15 );`, [ detail.module, terrain.module ] ),
];

GPU.beginFrame();
setFrameCamera( camera, W, H );
for ( const v of views ) v.pass.render( { colorViews: [ v.rt.texture ], clear: [ 0, 0, 0, 1 ] } );
GPU.submit();
for ( const v of views ) {

	const img = await readTexture( v.rt.texture );
	writePNG( `${ OUT }/${ v.label }.png`, W, H, new Uint8Array( img.data ) );

}

// ---- the breaker lips from the beach (MeshRenderer, transparent)
const RW = 1280, RH = 720;
const scene = new Scene();
scene.add( breakers.mesh );
breakers.mesh.layers.enableAll && breakers.mesh.layers.enableAll();
const mr = new MeshRenderer();
new SunShadows(); // the lighting module binds its (disabled) cascade map
const rt = new RenderTarget( RW, RH, { colors: [ 'rgba16float', 'rgba16float', 'rgba8unorm' ], depth: 'depth32float', label: 'lipRT' } );
const ldr = new RenderTarget( RW, RH, { colors: [ 'rgba8unorm' ], label: 'lipLDR' } );
const tonemap = new FullscreenPass( { label: 'tonemap', colorFormats: [ 'rgba8unorm' ], bindings: { hdr: { texture: () => rt.texture } },
	code: `fn fragment( in: FSIn ) -> vec4f { let c = textureLoad( hdr, vec2i( in.pos.xy ), 0 ).rgb; return vec4f( linearToSrgb( sat3( c / ( 1.0 + c ) ) ), 1.0 ); }` } );
G.sunDir.value.set( 0.2, 0.35, 0.9 ).normalize(); // behind the waves (backlit lips)
G.sunColor.value.setRGB( 3, 2.8, 2.5 );
G.skyIrradiance.value.setRGB( 0.3, 0.38, 0.5 );
camera.aspect = RW / RH; camera.updateProjectionMatrix();
// look at a plunging lip (b ~ 0.6) from the beach side
{

	await GPU.queue.onSubmittedWorkDone();
	const c = new Float32Array( await readBuffer( breakers.crest.getGPU(), breakers.NS * 6 * 16 ) );
	let best = - 1, bd = 9;
	for ( let i = 0; i < breakers.NS * 2; i ++ ) if ( c[ i * 12 + 11 ] > 0.5 && Math.abs( c[ i * 12 + 3 ] - 0.65 ) < bd ) {

		bd = Math.abs( c[ i * 12 + 3 ] - 0.65 ); best = i;

	}

	if ( best >= 0 ) {

		const x = c[ best * 12 ], y = c[ best * 12 + 1 ], z = c[ best * 12 + 2 ];
		console.log( 'looking at lip', best, 'b', c[ best * 12 + 3 ].toFixed( 2 ), 'root', x.toFixed( 1 ), y.toFixed( 2 ), z.toFixed( 1 ) );
		camera.position.set( x - 6, y + 0.4, z - 9 ); camera.lookAt( x, y - 0.3, z );

	}

}

for ( let f = 0; f < 1; f ++ ) {

	G.time.value += 0;
	GPU.beginFrame();
	setFrameCamera( camera, RW, RH );
	breakers.update( camera );
	mr.render( scene, { camera, kind: 'main', late: true, colorViews: rt.textures.map( ( t ) => t.view() ), colorFormats: rt.formats,
		clearColors: [ [ 0.05, 0.12, 0.16, 1 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ] ], depthView: rt.depthTexture.view(), depthFormat: 'depth32float', clearDepth: 0 } );
	tonemap.render( { colorViews: [ ldr.texture ] } );
	GPU.submit();

}

const img = await readTexture( ldr.texture );
writePNG( `${ OUT }/breaker-lips.png`, RW, RH, new Uint8Array( img.data ) );

// the modules other streams consume: spray wave shadow (Breakers) and foam deposit (ShoreSim)
{

	const ob = new StorageBuffer( { count: 64, type: 'vec4f' } );
	const k = new ComputeKernel( { label: 'consumer check', modules: [ breakers.sprayShadowModule, sim.depositModule ], bindings: { ob: { storage: ob, access: 'read_write' } }, workgroupSize: [ 64, 1, 1 ], code: `
@compute @workgroup_size( WG_X ) fn main( @builtin( global_invocation_id ) gid: vec3u ) {
	let p = vec3f( -20.0 + f32( gid.x ) * 0.7, 0.3, 12.0 );
	shoreSimDepositAt( p.xz, 3u );
	ob[ gid.x ] = vec4f( breakersSprayShadow( p, f32( gid.x * 2u + 1u ) + 0.5 ), 0.0, 0.0, 0.0 );
}` } );
	GPU.beginFrame(); k.dispatch( 1 ); GPU.submit();
	const r = new Float32Array( await readBuffer( ob.getGPU(), 64 * 16 ) );
	console.log( 'sprayShadow samples', Array.from( r.filter( ( _, i ) => i % 4 === 0 ) ).slice( 0, 12 ).map( ( v ) => v.toFixed( 2 ) ).join( ' ' ) );

}

// crest + spray statistics
const crest = new Float32Array( await readBuffer( breakers.crest.getGPU(), breakers.NS * 6 * 16 ) );
let nCrest = 0, bMax = - 9, hMax = 0;
for ( let i = 0; i < breakers.NS * 2; i ++ ) if ( crest[ i * 12 + 11 ] > 0.5 ) {

	nCrest ++; bMax = Math.max( bMax, crest[ i * 12 + 3 ] ); hMax = Math.max( hMax, crest[ i * 12 + 7 ] );

}

const head = new Uint32Array( await readBuffer( spray.head.getGPU(), 16 ) );
console.log( 'crests', nCrest, 'max b', bMax.toFixed( 2 ), 'max H', hMax.toFixed( 2 ), 'spray emitted', head[ 0 ] );
console.log( 'errors', errors );
await new Promise( ( r ) => setTimeout( r, 300 ) );
process.exit( errors ? 1 : 0 );
