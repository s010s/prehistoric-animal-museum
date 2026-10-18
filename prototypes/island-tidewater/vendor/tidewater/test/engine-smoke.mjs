import { writePNG } from './headless.mjs';
import { GPU } from '../src/engine/gpu/GPU.js';
import { RenderTarget } from '../src/engine/gpu/Texture.js';
import { readTexture } from '../src/engine/gpu/Readback.js';
import { FrameUniforms, G, setFrameCamera } from '../src/engine/render/Frame.js';
import { Material } from '../src/engine/render/Material.js';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';
import { SunShadows } from '../src/engine/render/Shadows.js';
import { FullscreenPass } from '../src/engine/render/FullscreenPass.js';
import * as E from '../src/engine/index.js';

await GPU.init( { headless: true } );
const W = 640, H = 360;
const scene = new E.Scene();
const ground = new E.Mesh( new E.PlaneGeometry( 60, 60 ).rotateX( - Math.PI / 2 ), new Material( { name: 'ground', color: 0x9a8a70, roughness: 0.9 } ) );
ground.castShadow = true;
const box = new E.Mesh( new E.BoxGeometry( 2, 2, 2 ), new Material( { name: 'box', color: 0xcc4422, roughness: 0.4,
	uniforms: { stripe: [ 'f32', 6 ] },
	surface: 's.albedo = mix( s.albedo, vec3f( 0.9 ), step( 0.5, fract( in.P.y * mat.stripe ) ) );' } ) );
box.position.set( 0, 1, 0 ); box.castShadow = true;
const ball = new E.Mesh( new E.SphereGeometry( 1, 48, 24 ), new Material( { name: 'ball', color: 0xdddddd, metalness: 1, roughness: 0.25 } ) );
ball.position.set( 3, 1, 1 ); ball.castShadow = true;
const inst = new E.InstancedMesh( new E.BoxGeometry( 0.4, 0.4, 0.4 ), new Material( { name: 'inst', color: 0x3377cc, vertex: 'v.worldOffset = vec3f( 0.0, 0.2 * sin( f32( v.instance ) ), 0.0 );' } ), 20 );
const m = new E.Matrix4();
for ( let i = 0; i < 20; i ++ ) inst.setMatrixAt( i, m.makeTranslation( - 6 + Math.cos( i ) * 3, 0.3, - 2 + Math.sin( i ) * 3 ) );
inst.castShadow = true;
scene.add( ground, box, ball, inst );

const camera = new E.PerspectiveCamera( 55, W / H, 0.1, 1000 );
camera.position.set( 6, 5, 9 ); camera.lookAt( 0, 0.5, 0 );
G.sunDir.value.set( 0.5, 0.7, 0.3 ).normalize();
G.sunColor.value.setRGB( 3, 2.9, 2.7 );
G.skyIrradiance.value.setRGB( 0.25, 0.32, 0.45 );

const rt = new RenderTarget( W, H, { colors: [ 'rgba16float', 'rgba16float', 'rgba8unorm' ], depth: 'depth32float', label: 'scene' } );
const mr = new MeshRenderer();
const shadows = new SunShadows();
const tonemap = new FullscreenPass( { label: 'tonemap', colorFormats: [ 'rgba8unorm' ], bindings: { hdr: { texture: () => rt.texture } },
	code: `fn fragment( in: FSIn ) -> vec4f {
		let c = textureLoad( hdr, vec2i( in.pos.xy ), 0 ).rgb;
		let a = c * 0.8; let t = ( a * ( 2.51 * a + 0.03 ) ) / ( a * ( 2.43 * a + 0.59 ) + 0.14 );
		return vec4f( linearToSrgb( sat3( t ) ), 1.0 ); }` } );
const out = new E.Vector2();
const ldr = new RenderTarget( W, H, { colors: [ 'rgba8unorm' ], label: 'ldr' } );
for ( let f = 0; f < 2; f ++ ) {
	GPU.beginFrame();
	setFrameCamera( camera, W, H );
	shadows.render( scene, mr, shadows.update( camera, G.sunDir.value ) );
	mr.render( scene, { camera, kind: 'main', colorViews: rt.textures.map( ( t ) => t.view() ), colorFormats: rt.formats,
		clearColors: [ [ 0.4, 0.55, 0.8, 1 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ] ], depthView: rt.depthTexture.view(), depthFormat: 'depth32float', clearDepth: 0 } );
	tonemap.render( { colorViews: [ ldr.texture ] } );
	GPU.submit();
}
const img = await readTexture( ldr.texture );
writePNG( process.argv[ 2 ] || '/tmp/engine-smoke.png', W, H, new Uint8Array( img.data ) );
console.log( 'stats', mr.stats );
await new Promise( ( r ) => setTimeout( r, 200 ) );
process.exit( 0 );
