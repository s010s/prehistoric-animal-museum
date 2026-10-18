// Headless test of MarineSnow: the specks around an underwater camera (real OceanFFT for the sway,
// stub water query), drawn in the opaque pass over a dark water background, with the torch on.
// usage: node test/ocean-spray-snow.mjs [out.png]
import { writePNG } from './headless.mjs';
import { GPU } from '../src/engine/gpu/GPU.js';
import { RenderTarget } from '../src/engine/gpu/Texture.js';
import { ShaderModule } from '../src/engine/gpu/Shader.js';
import { readTexture } from '../src/engine/gpu/Readback.js';
import { G, setFrameCamera } from '../src/engine/render/Frame.js';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';
import { SceneRenderer } from '../src/engine/render/SceneRenderer.js';
import { FullscreenPass } from '../src/engine/render/FullscreenPass.js';
import { SunShadows } from '../src/engine/render/Shadows.js';
import * as E from '../src/engine/index.js';
import { OceanFFT } from '../src/ocean/OceanFFT.js';
import { MarineSnow } from '../src/fx/MarineSnow.js';

await GPU.init( { headless: true } );
const W = Number( process.env.W || 1280 ), H = Number( process.env.H || 720 );
const out = process.argv[ 2 ] || '/tmp/ocean-snow.png';

const fft = new OceanFFT( null );
const query = { module: new ShaderModule( { name: 'queryStub', code: 'fn waterQueryHeightAtXZ( xz: vec2f ) -> f32 { return 0.0; }' } ) };
const snow = new MarineSnow( { fft, query } );
// torch pointing forward from the camera
const flash = {
	on: { value: 1 }, pos: { value: new E.Vector3( 0.2, - 2.1, 0 ) }, dir: { value: new E.Vector3( 0, - 0.1, - 1 ).normalize() },
	col: { value: new E.Vector3( 40, 38, 34 ) }, cone: { value: new E.Vector2( 0.97, 0.85 ) },
};
snow.setFlash( flash );

const scene = new E.Scene();
scene.add( snow.mesh );
const camera = new E.PerspectiveCamera( 60, W / H, 0.05, 500 );
camera.position.set( 0, - 2, 0 ); camera.lookAt( 0, - 2.2, - 5 );
G.sunDir.value.set( 0.3, 0.8, - 0.4 ).normalize();
G.sunColor.value.setRGB( 5, 4.8, 4.5 );
G.skyIrradiance.value.setRGB( 0.35, 0.45, 0.6 );

const mr = new MeshRenderer();
const shadows = new SunShadows();
const sr = new SceneRenderer( mr, scene, camera );
sr.setSize( W, H );
sr.clearColor = [ 0.005, 0.03, 0.05, 1 ];
const tonemap = new FullscreenPass( { label: 'tonemap', colorFormats: [ 'rgba8unorm' ], bindings: { hdr: { texture: () => sr.sceneRT.texture } },
	code: `fn fragment( in: FSIn ) -> vec4f {
		let c = textureLoad( hdr, vec2i( in.pos.xy ), 0 ).rgb;
		let a = c * 2.0; let t = ( a * ( 2.51 * a + 0.03 ) ) / ( a * ( 2.43 * a + 0.59 ) + 0.14 );
		return vec4f( linearToSrgb( sat3( t ) ), 1.0 ); }` } );
const ldr = new RenderTarget( W, H, { colors: [ 'rgba8unorm' ], label: 'ldr' } );

let tDraw = 0;
const frames = 20;
for ( let f = 0; f < frames; f ++ ) {

	G.time.value += 1 / 60; G.dt.value = 1 / 60;
	GPU.beginFrame();
	setFrameCamera( camera, W, H );
	fft.update( 1 / 60 );
	snow.update( camera, true );
	shadows.render( scene, mr, shadows.update( camera, G.sunDir.value ) );
	GPU.submit();
	await GPU.queue.onSubmittedWorkDone();
	const a = performance.now();
	sr.render();
	GPU.submit();
	await GPU.queue.onSubmittedWorkDone();
	if ( f >= 5 ) tDraw += performance.now() - a;
	tonemap.render( { colorViews: [ ldr.texture ] } );
	GPU.submit();

}

console.log( `snow draw (opaque pass incl. copies) ${ ( tDraw / ( frames - 5 ) ).toFixed( 3 ) } ms at ${ W }x${ H }` );
const img = await readTexture( ldr.texture );
writePNG( out, W, H, new Uint8Array( img.data ) );
console.log( 'wrote', out, mr.stats );
await new Promise( ( r ) => setTimeout( r, 300 ) );
process.exit( 0 );
