// Post chain test (headless): a small scene through SceneRenderer + the whole PostFX chain (GTAO,
// AirHaze, Underwater, TAAU, motion blur, bloom, lens flare, droplets, grading, ACES) at the real
// output resolution, with stubbed modules of the other streams.
//   node test/post-chain.mjs [mode] [out.png]     mode: air | under | motion | noao | flare | lens | waterline
import { writePNG } from './headless.mjs';
import './smaa-shim.mjs';
import { GPU } from '../src/engine/gpu/GPU.js';
import { ShaderModule, UniformBlock } from '../src/engine/gpu/Shader.js';
import { Texture } from '../src/engine/gpu/Texture.js';
import { readTexture } from '../src/engine/gpu/Readback.js';
import { FrameUniforms, G } from '../src/engine/render/Frame.js';
import { Material } from '../src/engine/render/Material.js';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';
import { SunShadows } from '../src/engine/render/Shadows.js';
import { FullscreenPass } from '../src/engine/render/FullscreenPass.js';
import { SceneRenderer, SCENE_FORMATS, DEPTH_FORMAT } from '../src/engine/render/SceneRenderer.js';
import * as E from '../src/engine/index.js';
import { PostFX } from '../src/post/PostFX.js';
import { Underwater } from '../src/post/Underwater.js';
import { AirHaze } from '../src/post/AirHaze.js';
import { Profiler } from '../src/core/Profiler.js';

const mode = process.argv[ 2 ] || 'air';
const outPath = process.argv[ 3 ] || `/tmp/post-${ mode }.png`;
await GPU.init( { headless: true } );
const W = Number( process.env.W || 2560 ), H = Number( process.env.H || 1267 );

// ---------------------------------------------------------------- stubs of the other streams
const stubU = new UniformBlock( 'StubParams', { waterH: [ 'f32', mode === 'under' ? 3 : mode === 'waterline' ? 1.62 : - 100 ], sunE: [ 'vec3f', new E.Vector3( 1, 1, 1 ) ] } );
const query = { module: new ShaderModule( { name: 'waterQuery', uniforms: stubU, uniformName: 'stubParams', code: /* wgsl */`
fn waterQueryCameraState() -> vec4f { return vec4f( stubParams.waterH, 0.0, 0.0, 0.0 ); }
fn waterQueryHeightAtXZ( xz: vec2f ) -> f32 { return stubParams.waterH + 0.02 * sin( xz.x * 3.0 ); }
` } ) };
const caustics = { module: new ShaderModule( { name: 'caustics', code: /* wgsl */`
fn causticsDetailK( xz: vec2f ) -> f32 { return 1.0; }
fn causticsSampleShaft( P: vec3f, depth: f32, level: f32, detailK: f32 ) -> vec3f { return vec3f( 1.0 ); }
fn causticsSampleLevel( p: vec3f, z: f32, k: f32 ) -> vec3f { let a = sin( p.x * 2.1 + p.z * 0.7 ) * sin( p.z * 2.3 - p.x * 0.4 ); return vec3f( 1.0 + 1.5 * a * a * a * a - 0.3 ); }
` } ) };
let atmosphere = { module: new ShaderModule( { name: 'atmosphere', code: /* wgsl */`
fn atmosphereSkyLuminance( dir: vec3f ) -> vec3f {
	let t = pow( 1.0 - max( dir.y, 0.0 ), 3.0 );
	let sunGlow = pow( max( dot( dir, frame.sunDir ), 0.0 ), 16.0 ) * vec3f( 1.2, 0.8, 0.5 );
	return mix( vec3f( 0.18, 0.32, 0.7 ), vec3f( 0.7, 0.75, 0.8 ), t ) * 1.2 + sunGlow;
}
` } ) };
let sky = { module: new ShaderModule( { name: 'sky', code: 'fn skyMoonSky( dir: vec3f ) -> vec3f { return vec3f( 0.0 ); }' } ) };
let clouds = { module: new ShaderModule( { name: 'clouds', code: /* wgsl */`
fn cloudsShadow( xz: vec2f ) -> f32 { return 1.0; }
fn cloudsSampleView( dir: vec3f ) -> vec4f { return vec4f( 0.0, 0.0, 0.0, 1.0 ); }
fn cloudsSunTransmittance( T: f32 ) -> f32 { return T * smoothstep( 0.004, 0.04, T ); }
fn cloudsSample( dir: vec3f ) -> vec4f { return vec4f( 0.0, 0.0, 0.0, 1.0 ); }
` } ), sampleView: true };

// REAL_SKY=hours: the sky stream's Atmosphere / Sky / Clouds instead of the stubs
const REAL = process.env.REAL_SKY ? Number( process.env.REAL_SKY ) : null;
let realApp = null, H_ = null;
if ( REAL !== null ) {

	const { Atmosphere, SUN_ILLUMINANCE } = await import( '../src/sky/Atmosphere.js' );
	const { Sky, sunDirectionFromTime } = await import( '../src/sky/Sky.js' );
	const { Clouds } = await import( '../src/sky/Clouds.js' );
	H_ = await import( './sky-harness.mjs' );
	atmosphere = new Atmosphere();
	sky = new Sky( atmosphere );
	clouds = new Clouds( null, atmosphere );
	clouds.outputSize = { x: W, y: H };
	sky.clouds = clouds;
	realApp = { atmosphere, sky, clouds };
	H_.setTimeOfDay( realApp, REAL, sunDirectionFromTime, SUN_ILLUMINANCE );
	// the sky stream's image based lighting (installs the envSpecular / envDiffuse hooks)
	const { Environment } = await import( '../src/sky/Environment.js' );
	realApp.environment = new Environment( null, null, sky );

}

// ---------------------------------------------------------------- scene
const scene = new E.Scene();
const std = ( o ) => new Material( o );
const ground = new E.Mesh( new E.PlaneGeometry( 20000, 20000, 1, 1 ).rotateX( - Math.PI / 2 ), std( { name: 'ground', color: 0x9a8a70, roughness: 0.9,
	surface: 's.albedo = s.albedo * ( 0.8 + 0.2 * step( 0.5, fract( in.P.x * 0.5 ) + fract( in.P.z * 0.5 ) - floor( fract( in.P.x * 0.5 ) + fract( in.P.z * 0.5 ) ) ) );' } ) );
ground.castShadow = true;
scene.add( ground );
const box = new E.Mesh( new E.BoxGeometry( 2, 2, 2 ), std( { name: 'box', color: 0xcc4422, roughness: 0.4 } ) );
box.position.set( 0, 1, 0 ); box.castShadow = true; scene.add( box );
const metals = [];
for ( let i = 0; i < 5; i ++ ) {

	const m = new E.Mesh( new E.SphereGeometry( 0.8, 48, 24 ), std( { name: 'ball' + i, color: 0xdddddd, metalness: i % 2, roughness: 0.1 + i * 0.2 } ) );
	m.position.set( - 6 + i * 3, 0.8, 3 ); m.castShadow = true; scene.add( m ); metals.push( m );

}

for ( let i = 0; i < 12; i ++ ) {

	const p = new E.Mesh( new E.CylinderGeometry( 0.25, 0.3, 8, 16 ), std( { name: 'pillar', color: 0x777066, roughness: 0.8 } ) );
	p.position.set( - 20 + i * 3.5, 4, - 10 - ( i % 3 ) * 4 ); p.castShadow = true; scene.add( p );

}

// a thin mast (TAAU thin-feature lock) and a moving object (motion blur)
const mast = new E.Mesh( new E.BoxGeometry( 0.03, 10, 0.03 ), std( { name: 'mast', color: 0x222222 } ) );
mast.position.set( 4, 5, - 2 ); scene.add( mast );
const mover = new E.Mesh( new E.BoxGeometry( 1.5, 1.5, 1.5 ), std( { name: 'mover', color: 0x2266dd, roughness: 0.3 } ) );
mover.position.set( 6, 1.5, 0 ); mover.castShadow = true; scene.add( mover );
// emissive glint for bloom
const lamp = new E.Mesh( new E.SphereGeometry( 0.2, 16, 8 ), std( { name: 'lamp', color: 0, emissive: new E.Color( 60, 40, 20 ) } ) );
lamp.position.set( - 2, 2.5, 1 ); scene.add( lamp );

const camera = new E.PerspectiveCamera( 62, W / H, 0.06, 60000 );
const sunLow = mode === 'flare';
if ( ! realApp ) G.sunDir.value.set( 0.5, sunLow ? 0.12 : 0.55, sunLow ? - 0.86 : 0.3 ).normalize();
if ( ! realApp ) {

	G.sunColor.value.setRGB( 3.2, 2.9, 2.5 ).multiplyScalar( sunLow ? 0.8 : 1 );
	G.skyIrradiance.value.setRGB( 0.25, 0.32, 0.45 );
	G.horizonColor.value.setRGB( 0.6, 0.7, 0.8 );

}
G.exposure.value = 1;

const mr = new MeshRenderer();
const shadows = new SunShadows();
const sceneRenderer = new SceneRenderer( mr, scene, camera );

// sky background: gradient + sun disc, camera-only velocity, zero water mask (depth 0 pixels only)
const bg = new FullscreenPass( {
	label: 'test sky', colorFormats: SCENE_FORMATS, depthFormat: DEPTH_FORMAT, depthCompare: 'equal', depth: 0, modules: [ atmosphere.module ],
	code: /* wgsl */`
struct BgOut { @location( 0 ) color: vec4f, @location( 1 ) velocity: vec4f, @location( 2 ) mask: vec4f };
@fragment fn fs( in: FSIn ) -> BgOut {
	let dir = viewRay( in.pos.xy * frame.invResolution );
	var L = atmosphereSkyLuminance( dir );
	L += smoothstep( 0.9996, 0.9998, dot( dir, frame.sunDir ) ) * vec3f( 2000.0, 1800.0, 1500.0 ) * select( 1.0, 0.0, dir.y < 0.0 );
	let far = frame.cameraPos + dir * 1e4;
	let c = frame.viewProjNoJitter * vec4f( far, 1.0 );
	let p = frame.prevViewProjNoJitter * vec4f( far, 1.0 );
	var o: BgOut;
	o.color = vec4f( L, 1.0 );
	o.velocity = vec4f( ( c.xy / c.w - p.xy / p.w ) * vec2f( 0.5, -0.5 ), 0.0, 1.0 );
	o.mask = vec4f( 0.0 );
	return o;
}
`,
} );
sceneRenderer.background = realApp ? sky.background : { draw: ( rp ) => bg.draw( rp ) };

const underwater = new Underwater( { depthTexture: sceneRenderer.sceneRT.depthTexture, maskTexture: sceneRenderer.waterMaskTexture, query, caustics } );
const haze = new AirHaze( { depthTexture: sceneRenderer.sceneRT.depthTexture, underwater, atmosphere, sky, clouds } );
const engine = { width: W, height: H };
const sunDirU = realApp ? atmosphere.sunDir : { value: G.sunDir.value.clone() };
const post = new PostFX( engine, { sceneRenderer, camera, underwater, clouds, sunDir: sunDirU, haze } );
// AA=none|taa|smaataa|smaa|fxaa: the anti-aliasing mode (SMAA's lookup textures are read from public/)
if ( process.env.AA ) post.aaMode = process.env.AA;
post.outputTexture = new Texture( { label: 'out', width: W, height: H, format: 'rgba8unorm', usage: [ 'render', 'copySrc', 'sample' ] } );
if ( process.env.SCALE ) post.setScale( Number( process.env.SCALE ) );
if ( process.env.AO_SAMPLES ) post.aoPass.samples.value = Number( process.env.AO_SAMPLES );
if ( mode === 'noao' ) post.params.aoStrength.value = 0;
if ( mode !== 'motion' ) post.motionBlur.shutter.value = 0.5;
const profiler = new Profiler( engine, { enabled: true } );
profiler.debugRaw = !! process.env.RAW;

const FRAMES = Number( process.env.FRAMES || ( REAL !== null ? 40 : 24 ) );
let t = 0;
let first = true;
for ( let f = 0; f < FRAMES; f ++ ) {

	const dt = 1 / 60;
	t += dt;
	GPU.beginFrame();
	FrameUniforms.fields.frameIndex.value = GPU.frame;
	G.time.value = t;
	G.dt.value = dt;
	// camera: slow drift (TAAU), a fast pan in motion mode
	const yaw = mode === 'motion' ? 0.25 + f * 0.012 : 0.25 + f * 0.0006;
	const camY = mode === 'under' ? 1.6 : mode === 'waterline' ? 1.6 : 3.2;
	camera.position.set( 14 * Math.sin( yaw ), camY, 14 * Math.cos( yaw ) );
	if ( mode === 'flare' && realApp ) {

		// the real sun a little off the view centre
		const sd = atmosphere.sunDir.value;
		camera.lookAt( camera.position.clone().add( new E.Vector3( sd.x + 0.15, sd.y * 0.6, sd.z + 0.1 ) ) );

	} else if ( mode === 'flare' ) camera.lookAt( camera.position.clone().add( new E.Vector3( 0.2, 0.02, - 0.98 ) ) );
	else camera.lookAt( 0, 1.2, 0 );
	mover.position.set( 9, 1.5, - 3 + ( f % 60 ) * 0.25 );
	G.cameraUnderwater.value = mode === 'under' ? 1 : 0;
	if ( mode === 'lens' ) { post.lens._wasUnder = f === 2; }
	post.lens.update( dt, false );
	if ( post.flare ) {

		if ( ! realApp ) sunDirU.value.copy( G.sunDir.value );
		post.flare.update( camera, dt );

	}

	if ( realApp ) {

		atmosphere._irrTimer = f % 4 === 0 ? 0 : atmosphere._irrTimer;
		atmosphere.update( dt, camera.position.y );
		clouds.update( dt, camera );
		realApp.environment.update( dt, f === 3 );

	}

	post.beginFrame();
	if ( first ) {

		for ( const [ n, p ] of post.passes() ) profiler.track( n, p );
		profiler.track( 'shadows', null );
		first = false;

	}

	underwater.updateCamera( camera );
	shadows.render( scene, mr, shadows.update( camera, G.sunDir.value ) );
	sceneRenderer.render();
	if ( post.flare ) post.flare.kernel.dispatch( 1 );
	post.render();
	post.endFrame();
	if ( f === FRAMES - 3 ) profiler._record();
	GPU.submit();
	if ( f % 4 === 3 ) await GPU.queue.onSubmittedWorkDone();
	if ( realApp ) {

		await new Promise( ( r ) => setTimeout( r, 5 ) );
		H_.applyReadback( realApp );

	}

}

await GPU.queue.onSubmittedWorkDone();
await new Promise( ( r ) => setTimeout( r, 300 ) );
if ( process.env.BENCH ) {

	// wall-clock GPU cost per pass: each recorded 20x in one submit (other agents share the GPU: noisy)
	const time = async ( name, fn, n = 20 ) => {

		await GPU.queue.onSubmittedWorkDone();
		const t0 = performance.now();
		for ( let i = 0; i < n; i ++ ) fn();
		GPU.submit();
		await GPU.queue.onSubmittedWorkDone();
		console.log( '  bench', name.padEnd( 22 ), ( ( performance.now() - t0 ) / n ).toFixed( 3 ), 'ms' );

	};

	const P = post;
	await time( 'empty', () => {} );
	await time( 'scene (opaque+water)', () => sceneRenderer.render(), 10 );
	await time( 'GTAO', () => P.aoPass.render() );
	await time( 'AO blur x+y', () => { P._aoBlurXPass.render( { colorViews: [ P.aoBlurX.texture ] } ); P._aoBlurYPass.render( { colorViews: [ P.aoBlurY.texture ] } ); } );
	await time( 'medium', () => P._mediumPass.render( { colorViews: [ P.medium.texture ] } ) );
	await time( 'haze march', () => haze._passes.march.render( { colorViews: [ haze.low.texture ] } ) );
	await time( 'haze god rays (4)', () => { haze._passes.mask.render( { colorViews: [ haze.ssTargets[ 0 ].texture ] } ); for ( let i = 0; i < 3; i ++ ) haze._passes.blur[ i ].render( { colorViews: [ haze.ssTargets[ i + 1 ].texture ] } ); } );
	await time( 'beauty', () => P._beautyPass.render( { colorViews: [ P.beauty.texture ] } ) );
	await time( 'TAAU resolve', () => P.taau._resolve[ 0 ].render( { colorViews: P.taau.history[ 1 ].textures } ) );
	await time( 'bloom (9)', () => { for ( const [ p, rt ] of P._bloomPasses ) p.render( { colorViews: [ rt.texture ] } ); } );
	await time( 'motion blur tiles', () => P.motionBlur.compute( W, H ) );
	await time( 'final', () => P._finalPass.render( { colorViews: [ P.outputTexture ] } ) );
	await time( 'auto exposure', () => P.meterKernel.dispatch( [ 1, 1, 1 ] ) );
	await time( 'whole post.render', () => P.render(), 10 );

}

const img = await readTexture( post.outputTexture );
writePNG( outPath, W, H, new Uint8Array( img.data ) );
console.log( 'wrote', outPath );
if ( process.env.CROP ) {

	// CROP=x,y,w,h[,zoom]: an enlarged crop next to the image
	const [ cx, cy, cw, ch, z = 2 ] = process.env.CROP.split( ',' ).map( Number );
	const src = new Uint8Array( img.data ), out = new Uint8Array( cw * z * ch * z * 4 );
	for ( let y = 0; y < ch * z; y ++ ) for ( let x = 0; x < cw * z; x ++ ) {

		const si = ( ( cy + Math.floor( y / z ) ) * W + cx + Math.floor( x / z ) ) * 4, di = ( y * cw * z + x ) * 4;
		for ( let k = 0; k < 4; k ++ ) out[ di + k ] = src[ si + k ];

	}

	writePNG( outPath.replace( '.png', '-crop.png' ), cw * z, ch * z, out );

}
console.log( 'GPU ms (render %s, compute %s):', profiler.result.render.toFixed( 2 ), profiler.result.compute.toFixed( 2 ) );
for ( const i of profiler.result.items ) console.log( '  ', i.name.padEnd( 26 ), i.ms.toFixed( 3 ) );
if ( process.env.DUMP ) {

	for ( const [ name, tex ] of [ [ 'ao', post.aoBlurY.texture ], [ 'beauty', post.beauty.texture ], [ 'haze', haze.low.texture ], [ 'medium', post.medium.texture ] ] ) {

		const r = await readTexture( tex );
		console.log( name, tex.format, tex.width, tex.height, r.data.byteLength );

	}

}

process.exit( 0 );
