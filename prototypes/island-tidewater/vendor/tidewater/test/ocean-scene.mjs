// Shared harness for the ocean stream's render tests: FFT + surface + water material + floor with
// stubbed terrain / sky / clouds modules (the other streams' systems).
import { writePNG } from './headless.mjs';
import { GPU } from '../src/engine/gpu/GPU.js';
import { RenderTarget } from '../src/engine/gpu/Texture.js';
import { readTexture } from '../src/engine/gpu/Readback.js';
import { G, setFrameCamera } from '../src/engine/render/Frame.js';
import { Material } from '../src/engine/render/Material.js';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';
import { SceneRenderer, LAYERS } from '../src/engine/render/SceneRenderer.js';
import { SunShadows } from '../src/engine/render/Shadows.js';
import { FullscreenPass } from '../src/engine/render/FullscreenPass.js';
import { ShaderModule } from '../src/engine/gpu/Shader.js';
import * as E from '../src/engine/index.js';
import { OceanFFT } from '../src/ocean/OceanFFT.js';
import { CDLOD } from '../src/core/CDLOD.js';
import { WaterSurface } from '../src/ocean/WaterSurface.js';
import { WaterMaterial } from '../src/ocean/WaterMaterial.js';
import { createFoamTexture } from '../src/ocean/FoamTexture.js';
import { Caustics } from '../src/ocean/Caustics.js';
import { installUnderwaterLighting } from '../src/ocean/UnderwaterLighting.js';

// analytic sea floor: depth 12 m offshore rising to a beach toward +x (shore at x ~ 60)
export const terrainStub = {
	module: new ShaderModule( { name: 'terrainStub', code: /* wgsl */`
fn terrainHeightAt( xz: vec2f ) -> f32 { return max( -12.0, min( 3.0, ( xz.x - 60.0 ) * 0.12 ) ) + 0.3 * sin( xz.y * 0.05 ); }
fn terrainNormalRock( xz: vec2f ) -> vec4f {
	let e = 0.5;
	let dx = ( terrainHeightAt( xz + vec2f( e, 0.0 ) ) - terrainHeightAt( xz - vec2f( e, 0.0 ) ) ) / ( 2.0 * e );
	let dz = ( terrainHeightAt( xz + vec2f( 0.0, e ) ) - terrainHeightAt( xz - vec2f( 0.0, e ) ) ) / ( 2.0 * e );
	return vec4f( -dx, -dz, 0.0, 1.0 );
}
fn terrainSunShadowAt( P: vec3f ) -> f32 { return 1.0; }
fn terrainShoreSample( xz: vec2f ) -> vec4f { return vec4f( ( 60.0 - xz.x ) / 12.0, 1.0, 0.0, 0.0 ); }
fn terrainUvOf( xz: vec2f ) -> vec2f { return xz / 1000.0 + 0.5; }
` } ),
};

export const skyStub = {
	module: new ShaderModule( { name: 'skyStub', code: /* wgsl */`
fn skyRadiance( dir: vec3f, withSun: bool ) -> vec3f {
	let t = clamp( dir.y, -0.1, 1.0 );
	var c = mix( vec3f( 0.75, 0.85, 1.0 ) * 1.4, vec3f( 0.18, 0.35, 0.8 ) * 1.1, pow( max( t, 0.0 ), 0.45 ) );
	let s = max( dot( dir, frame.sunDir ), 0.0 );
	c += vec3f( 1.0, 0.9, 0.7 ) * pow( s, 64.0 ) * 1.5;
	if ( withSun && s > 0.99995 ) { c += vec3f( 2000.0 ); }
	return c;
}
fn skyRadianceWithClouds( dir: vec3f, withSun: bool ) -> vec3f { return skyRadiance( dir, withSun ); }
fn skyReflectionRadiance( dir: vec3f ) -> vec3f { return skyRadiance( dir, false ); }
` } ),
};

export async function makeOceanScene( { W = 2560, H = 1267, terrain = true, caustics = true, floor = true, extra = null, sky = skyStub, clouds = null } = {} ) {

	const T = terrain === true ? terrainStub : terrain || null;

	await GPU.init( { headless: true } );
	G.sunDir.value.set( 0.45, 0.55, - 0.7 ).normalize();
	G.sunColor.value.setRGB( 3.2, 3.0, 2.7 );
	G.skyIrradiance.value.setRGB( 0.28, 0.36, 0.5 );
	G.horizonColor.value.setRGB( 0.8, 0.88, 1.0 );

	const scene = new E.Scene();
	const fft = new OceanFFT( null );
	const foamTexture = createFoamTexture( null );
	const cdlod = new CDLOD( { gridSize: 32, leafSize: 8, levels: 12, minY: - 25, maxY: 25 } );
	const surface = new WaterSurface( { fft, cdlod, foamTexture } );
	if ( T ) surface.terrain = T;
	const cau = caustics ? new Caustics( null, fft ) : null;
	const ctx = { surface, fft, scene, caustics: cau, terrain: T, extraSystems: {} };
	if ( extra ) await extra( ctx );
	if ( cau && surface.detail ) cau.detail = surface.detail;
	installUnderwaterLighting( { fft, caustics: cau, terrain: T, surface, shore: surface.shore, shoreSim: surface.shoreSim, clouds } );

	const mr = new MeshRenderer();
	const shadows = new SunShadows();
	const camera = new E.PerspectiveCamera( 55, W / H, 0.1, 20000 );
	const sr = new SceneRenderer( mr, scene, camera );
	sr.setSize( W, H );
	sr.clearColor = [ 0.5, 0.65, 0.9, 1 ];

	if ( floor ) {

		// floor following the stub terrain (sand), lit by the scene lighting + underwater hooks
		const geo = new E.PlaneGeometry( 600, 600, 300, 300 ).rotateX( - Math.PI / 2 );
		const m = new Material( { name: 'floor', color: 0xc8b48a, roughness: 0.9, modules: [ ( T || terrainStub ).module ],
			vertex: 'v.position.y = terrainHeightAt( v.position.xz ); let n = terrainNormalRock( v.position.xz ); v.normal = normalize( vec3f( n.x, 1.0, n.y ) );',
			surface: 's.albedo = mix( s.albedo, s.albedo * vec3f( 0.8, 0.85, 0.9 ), 0.5 + 0.5 * sin( in.P.x * 0.7 ) * sin( in.P.z * 0.9 ) );' } );
		const mesh = new E.Mesh( geo, m );
		mesh.frustumCulled = false;
		scene.add( mesh );

	}

	const waterMaterial = new WaterMaterial( { surface, sky, sceneCopy: sr.opaqueCopy } );
	waterMaterial.clouds = clouds;
	if ( ctx.onMaterial ) ctx.onMaterial( waterMaterial, sr );
	const ocean = new E.Mesh( cdlod.geometry, waterMaterial );
	ocean.frustumCulled = false;
	ocean.layers.set( LAYERS.WATER );
	scene.add( ocean );

	const ldr = new RenderTarget( W, H, { colors: [ 'rgba8unorm' ], label: 'ldr' } );
	const tonemap = new FullscreenPass( { label: 'tonemap', colorFormats: [ 'rgba8unorm' ], bindings: { hdr: { texture: () => sr.sceneRT.texture } },
		code: `fn fragment( in: FSIn ) -> vec4f {
			let c = textureLoad( hdr, vec2i( in.pos.xy ), 0 ).rgb;
			let a = c * 0.6; let t = ( a * ( 2.51 * a + 0.03 ) ) / ( a * ( 2.43 * a + 0.59 ) + 0.14 );
			return vec4f( linearToSrgb( sat3( t ) ), 1.0 ); }` } );

	let time = 0;
	const frame = ( dt = 1 / 60 ) => {

		GPU.beginFrame();
		time += dt;
		G.time.value = time;
		G.dt.value = dt;
		camera.updateMatrixWorld();
		const under = camera.position.y < 0;
		G.cameraUnderwater.value = under ? 1 : 0;
		G.cameraWaterHeight.value = 0;
		fft.update( dt );
		if ( cau ) cau.update();
		for ( const f of state.before ) f( dt );
		cdlod.update( camera );
		shadows.render( scene, mr, shadows.update( camera, G.sunDir.value ) );
		setFrameCamera( camera, W, H );
		sr.render();
		tonemap.render( { colorViews: [ ldr.texture ] } );
		GPU.submit();

	};

	const state = {
		W, H, ctx, scene, fft, cdlod, surface, waterMaterial, camera, sr, mr, caustics: cau, frame, before: [],
		async save( path ) {

			const img = await readTexture( ldr.texture );
			writePNG( path, W, H, new Uint8Array( img.data ) );

		},
		async time( n = 30 ) {

			await GPU.queue.onSubmittedWorkDone();
			const t0 = performance.now();
			for ( let i = 0; i < n; i ++ ) frame();
			await GPU.queue.onSubmittedWorkDone();
			return ( performance.now() - t0 ) / n;

		},
	};
	return state;

}
