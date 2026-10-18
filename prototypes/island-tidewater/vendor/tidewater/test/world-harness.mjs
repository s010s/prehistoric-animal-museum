// Shared headless harness for the world stream tests (terrain, rocks, debris, village, pier, boat).
//   const H = await worldHarness( { width: 2560, height: 1267 } );
//   H.scene.add( ... ); H.shot( '/tmp/x.png', { pos: [ x, y, z ], target: [ x, y, z ], fov: 55 } );
// Sun shadows from the engine, a simple sky-coloured clear, ACES tonemap. Stubs for modules owned
// by other streams (shoreSim etc.) live in the tests that need them.
import { writePNG } from './headless.mjs';
import { GPU } from '../src/engine/gpu/GPU.js';
import { RenderTarget } from '../src/engine/gpu/Texture.js';
import { readTexture } from '../src/engine/gpu/Readback.js';
import { G, setFrameCamera, FrameUniforms } from '../src/engine/render/Frame.js';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';
import { SunShadows } from '../src/engine/render/Shadows.js';
import { FullscreenPass } from '../src/engine/render/FullscreenPass.js';
import * as E from '../src/engine/index.js';

export async function worldHarness( { width = 2560, height = 1267, sun = [ 0.45, 0.55, 0.35 ] } = {} ) {

	await GPU.init( { headless: true } );
	const W = width, H = height;
	const scene = new E.Scene();
	const camera = new E.PerspectiveCamera( 55, W / H, 0.1, 20000 );
	G.sunDir.value.set( ...sun ).normalize();
	G.sunColor.value.setRGB( 3.2, 3.0, 2.75 );
	G.skyIrradiance.value.setRGB( 0.22, 0.3, 0.42 );
	G.horizonColor.value.setRGB( 0.55, 0.65, 0.78 );
	const rt = new RenderTarget( W, H, { colors: [ 'rgba16float', 'rgba16float', 'rgba8unorm' ], depth: 'depth32float', label: 'scene' } );
	const mr = new MeshRenderer();
	const shadows = new SunShadows();
	const tonemap = new FullscreenPass( { label: 'tonemap', colorFormats: [ 'rgba8unorm' ], bindings: { hdr: { texture: () => rt.texture } },
		code: `fn fragment( in: FSIn ) -> vec4f {
			let c = textureLoad( hdr, vec2i( in.pos.xy ), 0 ).rgb;
			let a = c * 0.6 * frame.exposure; let t = ( a * ( 2.51 * a + 0.03 ) ) / ( a * ( 2.43 * a + 0.59 ) + 0.14 );
			return vec4f( linearToSrgb( sat3( t ) ), 1.0 ); }` } );
	const ldr = new RenderTarget( W, H, { colors: [ 'rgba8unorm' ], label: 'ldr' } );
	const h = {
		GPU, G, E, scene, camera, mr, shadows, rt, W, H, before: [],
		setView( { pos, target, fov = 55 } ) {

			camera.fov = fov; camera.updateProjectionMatrix();
			camera.position.set( ...pos ); camera.lookAt( ...target ); camera.updateMatrixWorld();

		},
		renderFrame( { mainOnly = false } = {} ) {

			GPU.beginFrame();
			FrameUniforms.fields.frameIndex.value = ( FrameUniforms.fields.frameIndex.value + 1 ) >>> 0;
			setFrameCamera( camera, W, H );
			for ( const f of h.before ) f( camera );
			if ( ! mainOnly ) shadows.render( scene, mr, shadows.update( camera, G.sunDir.value ) );
			mr.render( scene, { camera, kind: 'main', colorViews: rt.textures.map( ( t ) => t.view() ), colorFormats: rt.formats,
				clearColors: [ [ 0.5, 0.62, 0.8, 1 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ] ], depthView: rt.depthTexture.view(), depthFormat: 'depth32float', clearDepth: 0 } );
			if ( h.after ) h.after();
			if ( ! mainOnly ) tonemap.render( { colorViews: [ ldr.texture ] } );
			GPU.submit();

		},
		async shot( path, view, frames = 3 ) {

			if ( view ) h.setView( view );
			for ( let f = 0; f < frames; f ++ ) h.renderFrame();
			const img = await readTexture( ldr.texture );
			writePNG( path, W, H, new Uint8Array( img.data ) );
			console.log( 'wrote', path, 'triangles', mr.stats.triangles );

		},
		// wall time of the main pass alone (GPU shared with other agents: noisy)
		async timeMain( n = 10 ) {

			h.renderFrame(); await GPU.queue.onSubmittedWorkDone();
			const ts = [];
			for ( let i = 0; i < n; i ++ ) {

				const t0 = performance.now();
				h.renderFrame( { mainOnly: true } );
				await GPU.queue.onSubmittedWorkDone();
				ts.push( performance.now() - t0 );

			}

			ts.sort( ( a, b ) => a - b );
			return { min: ts[ 0 ], median: ts[ n >> 1 ] };

		},
	};
	return h;

}

export async function done() {

	await new Promise( ( r ) => setTimeout( r, 300 ) );
	process.exit( 0 );

}
