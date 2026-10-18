// Headless test of Spray: CPU-emitted drops, ligaments, dense spray, mist and a clear sheet over a
// ground plane, simulated for a second and drawn through the SceneRenderer's late pass (soft
// particles against the opaque depth copy). Stubs: water query, terrain, clouds.
// usage: node test/ocean-spray.mjs [out.png]
import { writePNG } from './headless.mjs';
import { GPU } from '../src/engine/gpu/GPU.js';
import { RenderTarget } from '../src/engine/gpu/Texture.js';
import { ShaderModule } from '../src/engine/gpu/Shader.js';
import { readTexture } from '../src/engine/gpu/Readback.js';
import { G, setFrameCamera } from '../src/engine/render/Frame.js';
import { Material } from '../src/engine/render/Material.js';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';
import { SceneRenderer } from '../src/engine/render/SceneRenderer.js';
import { FullscreenPass } from '../src/engine/render/FullscreenPass.js';
import { SunShadows } from '../src/engine/render/Shadows.js';
import * as E from '../src/engine/index.js';
import { Spray, SPRAY } from '../src/fx/Spray.js';
import { ComputeKernel } from '../src/engine/gpu/Compute.js';
import { StorageBuffer, readBuffer } from '../src/engine/webgpu.js';

await GPU.init( { headless: true } );
const W = Number( process.env.W || 1280 ), H = Number( process.env.H || 720 );
const out = process.argv[ 2 ] || '/tmp/ocean-spray.png';

const query = { module: new ShaderModule( { name: 'queryStub', code: /* wgsl */`
fn waterQueryHeightAtXZ( xz: vec2f ) -> f32 { return 0.15 * sin( xz.x * 0.4 + frame.time * 1.3 ); }
fn waterQueryCameraState() -> vec4f { return vec4f( 0.0 ); }
` } ) };
const terrain = { module: new ShaderModule( { name: 'terrainStub', code: 'fn terrainHeightAt( xz: vec2f ) -> f32 { return -6.0 + max( xz.x - 8.0, 0.0 ) * 0.5; }' } ) };
const clouds = { module: new ShaderModule( { name: 'cloudsStub', code: 'fn cloudsShadow( xz: vec2f ) -> f32 { return 1.0; }' } ) };

const scene = new E.Scene();
// dark water-ish floor at y = 0 and a beach block on the right
const floor = new E.Mesh( new E.PlaneGeometry( 200, 200 ).rotateX( - Math.PI / 2 ), new Material( { name: 'floor', color: 0x0a2a3a, roughness: 0.3 } ) );
const block = new E.Mesh( new E.BoxGeometry( 4, 3, 4 ), new Material( { name: 'block', color: 0x8a7a60, roughness: 0.9 } ) );
block.position.set( 5, 1.5, - 3 );
scene.add( floor, block );

const camera = new E.PerspectiveCamera( 50, W / H, 0.1, 2000 );
camera.position.set( 0, 2.2, 9 ); camera.lookAt( 0, 1.5, 0 );
// sun low and in front: backlit spray (forward lobe)
G.sunDir.value.set( 0.2, 0.25, - 1 ).normalize();
G.sunColor.value.setRGB( 6, 5.5, 4.8 );
G.skyIrradiance.value.setRGB( 0.35, 0.45, 0.6 );
G.windSpeed.value = 7;

const mr = new MeshRenderer();
const shadows = new SunShadows();
const sr = new SceneRenderer( mr, scene, camera );
sr.setSize( W, H );
sr.clearColor = [ 0.5, 0.62, 0.8, 1 ];
const spray = new Spray( null, { query, terrain, sceneCopy: sr.opaqueCopy, clouds } );
scene.add( spray.mesh );

// hooks as the sibling systems install them: ShoreSim foam deposit (counts drops here) and the
// breaking wave's shadow (Breakers)
const deposits = new StorageBuffer( { label: 'depositStub', count: 1, type: 'u32' } );
spray.shoreSim = { depositModule: new ShaderModule( { name: 'depositStub',
	bindings: { depositCount: { storage: deposits, access: 'read_write', wgslType: 'array<atomic<u32>>' } },
	code: 'fn shoreSimDepositAt( xz: vec2f, n: u32 ) { atomicAdd( &depositCount[ 0 ], n ); }' } ) };
spray.waveShadow = new ShaderModule( { name: 'waveShadowStub', code: 'fn breakersSprayShadow( p: vec3f, tag: f32 ) -> f32 { return select( 1.0, 0.35, tag >= 1.0 ); }' } );
// a GPU emitter like Breakers: a fan of drops and a mist puff per frame through the spray module
const emitter = new ComputeKernel( { label: 'test emitter', modules: [ spray.module ], workgroupSize: [ 1, 1, 1 ], code: /* wgsl */`
@compute @workgroup_size( 1 )
fn main() {
	let n = 48u;
	let base = sprayReserve( n );
	for ( var i = 0u; i < n; i++ ) {
		let slot = spraySlot( base, i );
		let r0 = sprayRand( i, 11u ); let r1 = sprayRand( i, 12u );
		let a = r0 * 6.283;
		let v = vec3f( cos( a ) * 1.5, 4.0 + r1 * 2.0, sin( a ) * 1.5 );
		let kind = select( SPRAY_DROPLET, SPRAY_MIST, i < 2u );
		sprayWrite( slot, vec3f( -6.0, 0.1, -2.0 ), v, select( 0.005, 0.5, i < 2u ), kind, 2.0, 1.0 + r1 * 0.999 );
	}
}
` } );

const tonemap = new FullscreenPass( { label: 'tonemap', colorFormats: [ 'rgba8unorm' ], bindings: { hdr: { texture: () => sr.sceneRT.texture } },
	code: `fn fragment( in: FSIn ) -> vec4f {
		let c = textureLoad( hdr, vec2i( in.pos.xy ), 0 ).rgb;
		let a = c * 0.6; let t = ( a * ( 2.51 * a + 0.03 ) ) / ( a * ( 2.43 * a + 0.59 ) + 0.14 );
		return vec4f( linearToSrgb( sat3( t ) ), 1.0 ); }` } );
const ldr = new RenderTarget( W, H, { colors: [ 'rgba8unorm' ], label: 'ldr' } );

const dt = 1 / 60;
const V = ( x, y, z ) => new E.Vector3( x, y, z );
const frames = 70;
let tSim = 0, tDraw = 0;
for ( let f = 0; f < frames; f ++ ) {

	G.time.value += dt; G.dt.value = dt;
	if ( f < 50 ) {

		// jet of drops + ligaments, a spray cloud, mist and a clear sheet along a line
		spray.emit( V( - 3, 0.1, 0 ), V( 1.5, 6.5, 0 ), 120, 0.004, SPRAY.DROPLET, { spread: 1.2, jitter: 0.1, life: 1.6 } );
		spray.emit( V( - 3, 0.1, 0 ), V( 1.5, 6, 0 ), 12, 0.012, SPRAY.LIGAMENT, { spread: 0.8, jitter: 0.1, life: 1.5 } );
		if ( f % 4 === 0 ) spray.emit( V( 0, 0.2, 0 ), V( 0, 3.5, 0.5 ), 20, 0.25, SPRAY.SPRAY, { spread: 1.5, jitter: 0.3, life: 2.2, sizeJitter: 0.8 } );
		if ( f % 6 === 0 ) spray.emit( V( 2, 0.3, 0 ), V( - 0.5, 1.2, 0 ), 8, 0.8, SPRAY.MIST, { spread: 1, jitter: 0.5, life: 4 } );
		spray.emit( V( 3, 0.1, 1 ), V( 0.5, 3.2, 1 ), 20, 0.06, SPRAY.SHEET, { to: V( 4, 0.1, - 1 ), spread: 0.4, jitter: 0.03, life: 1.2 } );

	}

	GPU.beginFrame();
	setFrameCamera( camera, W, H );
	const a = performance.now();
	emitter.dispatch( 1 );
	spray.update();
	await GPU.queue.onSubmittedWorkDone();
	GPU.submit();
	await GPU.queue.onSubmittedWorkDone();
	const b = performance.now();
	shadows.render( scene, mr, shadows.update( camera, G.sunDir.value ) );
	sr.render();
	tonemap.render( { colorViews: [ ldr.texture ] } );
	GPU.submit();
	await GPU.queue.onSubmittedWorkDone();
	if ( f >= 10 ) {

		tSim += b - a; tDraw += performance.now() - b;

	}

}

console.log( `spray update ${ ( tSim / ( frames - 10 ) ).toFixed( 3 ) } ms, scene+spray draw ${ ( tDraw / ( frames - 10 ) ).toFixed( 3 ) } ms (${ W }x${ H }, wall clock incl. submit)` );
const dep = new Uint32Array( await readBuffer( deposits.getGPU(), 4 ) );
console.log( 'foam deposits (drops that fell into the water):', dep[ 0 ] );
const img = await readTexture( ldr.texture );
writePNG( out, W, H, new Uint8Array( img.data ) );
console.log( 'wrote', out, mr.stats );
await new Promise( ( r ) => setTimeout( r, 300 ) );
process.exit( 0 );
