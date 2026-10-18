// TAA stability test on the pier deck (headless): the village and pier with sun shadows, the main pass
// (colour, velocity, water mask) jittered as PostFX does, the temporal upscaler, a simple tone map.
// Renders a still sequence and a walking sequence (1.4 m/s along the deck) and writes raw frames
// (BGRA-free RGBA8 with an 8-byte width / height header) for inspection, plus a flicker number: the
// mean absolute difference between consecutive frames over the deck, in 8-bit units.
//   node test/taa-pier.mjs [outDir=/tmp/taa-pier] [mode=taa|smaataa|smaa|none|ref]   (ref: 16x supersampled ground truth;
//   smaataa: SMAA on each jittered frame, then the TAA)
import './headless.mjs';
import './smaa-shim.mjs';
import fs from 'node:fs';
import { worldHarness } from './world-harness.mjs';
import { TerrainData } from '../src/world/TerrainData.js';
import { Colliders } from '../src/world/Colliders.js';
import { Village } from '../src/world/Village.js';
import { Material } from '../src/engine/render/Material.js';
import { FullscreenPass } from '../src/engine/render/FullscreenPass.js';
import { RenderTarget, StorageBuffer } from '../src/engine/gpu/Texture.js';
import { readTexture } from '../src/engine/gpu/Readback.js';
import { setFrameCamera, FrameUniforms } from '../src/engine/render/Frame.js';
import { TemporalUpscale } from '../src/post/TemporalUpscale.js';
import { AntiAlias } from '../src/post/AntiAlias.js';
import { WORLD } from '../src/world/WorldLayout.js';

const OUT = process.argv[ 2 ] || '/tmp/taa-pier';
const MODE = process.argv[ 3 ] || 'taa';
fs.mkdirSync( OUT, { recursive: true } );
const W = Number( process.env.W || 1280 ), H = Number( process.env.H || 634 );
const Hs = await worldHarness( { width: W, height: H, sun: [ - 0.55, 0.45, 0.5 ] } );
const { E, GPU, scene, camera, mr, shadows, rt } = Hs;

const terrain = new TerrainData();
const village = new Village( { scene, terrain, colliders: new Colliders() } );
{

	// water below the pier (flat), so the plank gaps show it
	const sea = new E.Mesh( new E.PlaneGeometry( 400, 400 ).rotateX( - Math.PI / 2 ), new Material( { name: 'sea', roughness: 0.2,
		surface: 's.albedo = vec3f( 0.02, 0.08, 0.12 );' } ) );
	scene.add( sea );

}

camera.fov = 62; camera.near = 0.1; camera.updateProjectionMatrix();
// exposure 0.6: the tone map below
const exposure = new StorageBuffer( { label: 'exposure', count: 1, type: 'f32', data: new Float32Array( [ 0.6 ] ) } );
const TEMPORAL = MODE === 'taa' || MODE === 'smaataa';
const aa = new AntiAlias( { src: () => rt.texture, exposure } );
const smaaOut = new RenderTarget( W, H, { colors: [ 'rgba16float' ], label: 'smaaOut' } );
const taau = new TemporalUpscale( () => ( MODE === 'smaataa' ? smaaOut.texture : rt.texture ), rt.depthTexture, rt.textures[ 1 ], camera, rt.textures[ 2 ], exposure );
taau.setSize( W, H );
// diagnostics: NODEPTH=1 (no depth-based history rejection), NOJIT=1
// (no jitter: with a moving camera the output should match the current frame, any blur is the history's)
if ( process.env.DBGV ) taau.debugView = Number( process.env.DBGV ); // debug view (TemporalUpscale.DEBUG_VIEWS)
if ( process.env.JS ) taau.jitterScale = Number( process.env.JS ); // jitter amount
if ( process.env.JM ) taau.jitterMoving = Number( process.env.JM ); // jitter while moving
// SET=name=value,... : TemporalUpscale.settings; PH: jitter phases
for ( const kv of ( process.env.SET || '' ).split( ',' ).filter( Boolean ) ) { const [ k, v ] = kv.split( '=' ); taau.settings[ k ].value = Number( v ); }
if ( process.env.PH ) taau.jitterPhaseOverride = Number( process.env.PH );
if ( process.env.NODEPTH ) taau.uniforms.fields.depthThreshold.value = 1e9;
const ldr = new RenderTarget( W, H, { colors: [ 'rgba8unorm' ], label: 'ldr' } );
const tonemap = new FullscreenPass( { label: 'tonemap', colorFormats: [ 'rgba8unorm' ], bindings: { hdr: { texture: () => ( TEMPORAL ? taau.output : MODE === 'smaa' ? smaaOut.texture : rt.texture ) } },
	code: `fn fragment( in: FSIn ) -> vec4f {
		let c = textureSampleLevel( hdr, smpLinearClamp, in.uv, 0.0 ).rgb;
		let a = c * 0.6; let t = ( a * ( 2.51 * a + 0.03 ) ) / ( a * ( 2.43 * a + 0.59 ) + 0.14 );
		return vec4f( linearToSrgb( sat3( t ) ), 1.0 ); }` } );

// ref: the ground truth, 16 jittered renders of each frame averaged (no temporal filter)
let refJitter = [ 0, 0 ];
const prevVP = new E.Matrix4();
const prevCam = new E.Vector3();
let hasPrev = false;
function frame() {

	GPU.beginFrame();
	FrameUniforms.fields.frameIndex.value = ( FrameUniforms.fields.frameIndex.value + 1 ) >>> 0;
	camera.updateMatrixWorld();
	taau.advance();
	const [ jx, jy ] = TEMPORAL ? ( process.env.NOJIT ? [ 0, 0 ] : taau.jitter() ) : MODE === 'ref' ? refJitter : [ 0, 0 ];
	const fl = process.env.FLIP ? - 1 : 1;
	setFrameCamera( camera, W, H, { jitterX: - jx * fl, jitterY: jy * fl, prevViewProj: hasPrev ? prevVP : null, prevCameraPos: hasPrev ? prevCam : null } );
	FrameUniforms.fields.outputResolution.value.set( W, H );
	prevVP.copy( FrameUniforms.fields.viewProjNoJitter.value );
	prevCam.copy( FrameUniforms.fields.cameraPos.value );
	hasPrev = true;
	shadows.render( scene, mr, shadows.update( camera, Hs.G.sunDir.value ) );
	mr.render( scene, { camera, kind: 'main', colorViews: rt.textures.map( ( t ) => t.view() ), colorFormats: rt.formats,
		clearColors: [ [ 0.5, 0.62, 0.8, 1 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ] ], depthView: rt.depthTexture.view(), depthFormat: 'depth32float', clearDepth: 0 } );
	if ( MODE === 'smaa' || MODE === 'smaataa' ) aa.render( 'smaa', smaaOut.texture );
	if ( TEMPORAL ) taau.render();
	tonemap.render( { colorViews: [ ldr.texture ] } );
	taau.clearViewOffset();
	taau.endFrame();
	GPU.submit();

}

const P = WORLD.pier;
const eye = ( z ) => [ P.x + 0.3, P.deckHeight + 1.62, z ];
async function run( name, n, speed ) {

	let z = P.zStart + 20;
	const frames = [];
	for ( let i = 0; i < n; i ++ ) {

		camera.position.set( ...eye( z ) );
		camera.lookAt( P.x + 0.1, P.deckHeight + 0.3, z + 25 );
		if ( MODE === 'ref' && i >= n - 12 ) {

			const acc = new Float32Array( W * H * 4 );
			for ( let k = 0; k < 16; k ++ ) {

				refJitter = [ ( ( k % 4 ) + 0.5 ) / 4 - 0.5, ( Math.floor( k / 4 ) + 0.5 ) / 4 - 0.5 ];
				frame();
				const img = new Uint8Array( ( await readTexture( ldr.texture ) ).data );
				for ( let j = 0; j < acc.length; j ++ ) acc[ j ] += img[ j ] / 16;

			}

			frames.push( Uint8Array.from( acc, ( v ) => Math.round( v ) ) );
			z += speed / 60;
			continue;

		}

		frame();
		z += speed / 60;
		if ( i >= n - 12 ) {

			const img = await readTexture( ldr.texture );
			frames.push( new Uint8Array( img.data ) );

		} else await GPU.queue.onSubmittedWorkDone();

	}

	// flicker over the lower half of the image (the deck): mean |frame - previous frame|
	let sum = 0, cnt = 0;
	for ( let f = 1; f < frames.length; f ++ ) {

		const a = frames[ f ], b = frames[ f - 1 ];
		for ( let y = Math.floor( H * 0.55 ); y < H; y ++ ) for ( let x = 0; x < W; x ++ ) {

			const o = ( y * W + x ) * 4;
			sum += Math.abs( a[ o ] - b[ o ] ) + Math.abs( a[ o + 1 ] - b[ o + 1 ] ) + Math.abs( a[ o + 2 ] - b[ o + 2 ] );
			cnt += 3;

		}

	}

	frames.forEach( ( d, i ) => {

		const buf = Buffer.alloc( 8 + d.length );
		buf.writeUInt32LE( W, 0 ); buf.writeUInt32LE( H, 4 );
		Buffer.from( d.buffer, d.byteOffset, d.byteLength ).copy( buf, 8 );
		fs.writeFileSync( `${ OUT }/${ MODE }-${ name }-${ i }.rgba`, buf );

	} );
	console.log( `${ MODE } ${ name }: deck flicker ${ ( sum / cnt ).toFixed( 3 ) }` );

}

if ( process.env.VELCHECK ) {

	// velocity at a few deck pixels vs the CPU reprojection of their depth
	const { readTexture: rt2 } = await import( '../src/engine/gpu/Readback.js' );
	let z = P.zStart + 20;
	for ( let i = 0; i < 6; i ++ ) {

		camera.position.set( ...eye( z ) ); camera.lookAt( P.x + 0.1, P.deckHeight + 0.3, z + 25 ); frame(); z += 1.4 / 60;

	}

	const F = FrameUniforms.fields;
	const vel = new Uint16Array( ( await rt2( rt.textures[ 1 ] ) ).data );
	const dep = new Float32Array( ( await rt2( rt.depthTexture ) ).data );
	const half = ( h ) => { const s = h >> 15, e = ( h >> 10 ) & 31, m = h & 1023; return ( s ? - 1 : 1 ) * ( e ? Math.pow( 2, e - 15 ) * ( 1 + m / 1024 ) : Math.pow( 2, - 14 ) * m / 1024 ); };
	const inv = F.invViewProj.value, cur = F.viewProjNoJitter.value, prev = F.prevViewProjNoJitter.value;
	for ( const [ px, py ] of [ [ 640, 450 ], [ 640, 380 ], [ 500, 550 ], [ 800, 600 ] ] ) {

		const d = dep[ py * W + px ];
		const nx = ( px + 0.5 ) / W * 2 - 1, ny = 1 - ( py + 0.5 ) / H * 2;
		const wp = new E.Vector4( nx, ny, d, 1 ).applyMatrix4( inv ); wp.divideScalar( wp.w );
		const c = new E.Vector4( wp.x, wp.y, wp.z, 1 ).applyMatrix4( cur ), pr = new E.Vector4( wp.x, wp.y, wp.z, 1 ).applyMatrix4( prev );
		const ex = ( c.x / c.w - pr.x / pr.w ) * 0.5, ey = ( c.y / c.w - pr.y / pr.w ) * - 0.5;
		const o = ( py * W + px ) * 4;
		console.log( px, py, 'gpu', half( vel[ o ] ).toExponential( 3 ), half( vel[ o + 1 ] ).toExponential( 3 ), 'cpu', ex.toExponential( 3 ), ey.toExponential( 3 ) );

	}

	process.exit( 0 );

}

while ( ( MODE === 'smaa' || MODE === 'smaataa' ) && ! aa.area ) await new Promise( ( r ) => setTimeout( r, 10 ) );
await run( 'still', 60, 0 );
await run( 'walk', 60, 1.4 );
process.exit( 0 );
