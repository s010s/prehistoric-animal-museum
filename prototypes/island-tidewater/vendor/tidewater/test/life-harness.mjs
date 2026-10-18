// Shared headless harness for the "living things" stream tests (vegetation, reef, fish, wildlife,
// whale): GPU init, the island ground from TerrainData (a plain lit heightfield mesh standing in for
// the terrain stream's CDLOD terrain), an optional stub sea surface, sun shadows, ACES tonemap, PNG
// output and a rough GPU timer.
//
//   import { setupLife } from './life-harness.mjs';
//   const L = await setupLife( { W: 2560, H: 1267, ground: { center: [ x, z ], size: 400 } } );
//   L.scene.add( ... ); L.camera.position.set( ... ); L.camera.lookAt( ... );
//   await L.run( 3, ( dt, t ) => system.update( dt, L.camera ) );
//   await L.save( 'out.png' );
//   const ms = await L.gpuTime( 20, onFrame );  // average ms per frame (whole frame, noisy)
import { writePNG } from './headless.mjs';
import { GPU } from '../src/engine/gpu/GPU.js';
import { RenderTarget } from '../src/engine/gpu/Texture.js';
import { readTexture } from '../src/engine/gpu/Readback.js';
import { G, setFrameCamera, FrameUniforms } from '../src/engine/render/Frame.js';
import { Material } from '../src/engine/render/Material.js';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';
import { SunShadows } from '../src/engine/render/Shadows.js';
import { FullscreenPass } from '../src/engine/render/FullscreenPass.js';
import * as E from '../src/engine/index.js';

let _terrain = null;
export async function terrainData() {

	if ( ! _terrain ) {

		const { TerrainData } = await import( '../src/world/TerrainData.js' );
		_terrain = new TerrainData();

	}

	return _terrain;

}

// heightfield mesh of TerrainData over a square window
export function groundMesh( terrain, cx, cz, size, res = 1 ) {

	const n = Math.round( size / res ) + 1;
	const pos = new Float32Array( n * n * 3 );
	for ( let j = 0; j < n; j ++ ) for ( let i = 0; i < n; i ++ ) {

		const x = cx - size / 2 + i * res, z = cz - size / 2 + j * res;
		const k = ( j * n + i ) * 3;
		pos[ k ] = x; pos[ k + 1 ] = terrain.heightAt( x, z ); pos[ k + 2 ] = z;

	}

	const idx = new Uint32Array( ( n - 1 ) * ( n - 1 ) * 6 );
	let o = 0;
	for ( let j = 0; j < n - 1; j ++ ) for ( let i = 0; i < n - 1; i ++ ) {

		const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
		idx[ o ++ ] = a; idx[ o ++ ] = c; idx[ o ++ ] = b;
		idx[ o ++ ] = b; idx[ o ++ ] = c; idx[ o ++ ] = d;

	}

	const g = new E.BufferGeometry();
	g.setAttribute( 'position', new E.BufferAttribute( pos, 3 ) );
	g.setIndex( new E.BufferAttribute( idx, 1 ) );
	g.computeVertexNormals();
	const m = new Material( {
		name: 'harness-ground', roughness: 0.95,
		surface: /* wgsl */`
			let h = in.P.y;
			let slope = 1.0 - in.N.y;
			var c = mix( vec3f( 0.62, 0.55, 0.42 ), vec3f( 0.16, 0.22, 0.08 ), smoothstep( 1.5, 4.0, h ) );
			c = mix( c, vec3f( 0.35, 0.32, 0.29 ), smoothstep( 0.25, 0.5, slope ) );
			c = mix( c, vec3f( 0.55, 0.5, 0.38 ), smoothstep( 0.0, -3.0, h ) );
			s.albedo = c;`,
	} );
	const mesh = new E.Mesh( g, m );
	mesh.castShadow = true;
	mesh.name = 'harness-ground';
	return mesh;

}

export async function setupLife( { W = 2560, H = 1267, ground = null, water = false, sun = [ 0.45, 0.62, 0.35 ], fov = 55, near = 0.1, far = 5000, shadowSplits = [ 12, 70, 400 ] } = {} ) {

	await GPU.init( { headless: true } );
	const scene = new E.Scene();
	const camera = new E.PerspectiveCamera( fov, W / H, near, far );
	const T = await terrainData();
	if ( ground ) scene.add( groundMesh( T, ground.center[ 0 ], ground.center[ 1 ], ground.size, ground.res || 1 ) );

	let waterMesh = null;
	if ( water ) {

		// stub sea surface (the ocean stream owns the real one): a flat translucent sheet
		const wm = new Material( { name: 'harness-water', transparent: true, roughness: 0.08, color: 0x0a3a4a, opacity: 0.55, side: 'double' } );
		waterMesh = new E.Mesh( new E.PlaneGeometry( 4000, 4000 ).rotateX( - Math.PI / 2 ), wm );
		waterMesh.userData.late = true;
		waterMesh.frustumCulled = false;
		scene.add( waterMesh );

	}

	G.sunDir.value.set( ...sun ).normalize();
	G.sunColor.value.setRGB( 3.2, 3.0, 2.7 );
	G.skyIrradiance.value.setRGB( 0.22, 0.3, 0.42 );
	G.horizonColor.value.setRGB( 0.55, 0.65, 0.78 );

	const rt = new RenderTarget( W, H, { colors: [ 'rgba16float', 'rgba16float', 'rgba8unorm' ], depth: 'depth32float', label: 'scene' } );
	const ldr = new RenderTarget( W, H, { colors: [ 'rgba8unorm' ], label: 'ldr' } );
	const mr = new MeshRenderer();
	const shadows = new SunShadows( { splits: shadowSplits } );
	const tonemap = new FullscreenPass( { label: 'tonemap', colorFormats: [ 'rgba8unorm' ], bindings: { hdr: { texture: () => rt.texture } },
		code: /* wgsl */`fn fragment( in: FSIn ) -> vec4f {
			let c = textureLoad( hdr, vec2i( in.pos.xy ), 0 ).rgb;
			let a = c * 0.6; let t = ( a * ( 2.51 * a + 0.03 ) ) / ( a * ( 2.43 * a + 0.59 ) + 0.14 );
			return vec4f( linearToSrgb( sat3( t ) ), 1.0 ); }` } );
	const velView = new FullscreenPass( { label: 'velview', colorFormats: [ 'rgba8unorm' ], bindings: { vel: { texture: () => rt.textures[ 1 ] } },
		code: /* wgsl */`fn fragment( in: FSIn ) -> vec4f {
			let v = textureLoad( vel, vec2i( in.pos.xy ), 0 ).xy * frame.resolution;
			return vec4f( sat3( vec3f( 0.5 + v.x * 0.05, 0.5 + v.y * 0.05, length( v ) * 0.05 ) ), 1.0 ); }` } );

	let time = 0;
	const L = {
		GPU, scene, camera, terrain: T, mr, shadows, rt, ldr, W, H, water: waterMesh,
		sky: [ 0.45, 0.6, 0.85, 1 ],
		lastTime: 0,
		frame( dt = 1 / 60, onFrame = null ) {

			time += dt;
			G.time.value = time;
			G.dt.value = dt;
			GPU.beginFrame();
			FrameUniforms.fields.frameIndex.value = GPU.frame;
			camera.aspect = W / H;
			camera.updateProjectionMatrix();
			camera.updateMatrixWorld();
			if ( onFrame ) onFrame( dt, time );
			scene.updateMatrixWorld();
			setFrameCamera( camera, W, H, { prevViewProj: L._prevVP || null } );
			if ( L.shadowsOn !== false ) shadows.render( scene, mr, shadows.update( camera, G.sunDir.value ) );
			mr.render( scene, { camera, kind: 'main', colorViews: rt.textures.map( ( t ) => t.view() ), colorFormats: rt.formats,
				clearColors: [ L.sky, [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ] ], depthView: rt.depthTexture.view(), depthFormat: 'depth32float', clearDepth: 0,
				filter: ( o ) => ! o.userData.late } );
			mr.render( scene, { camera, kind: 'main', late: true, colorViews: rt.textures.map( ( t ) => t.view() ), colorFormats: rt.formats,
				clearColors: [ null, null, null ], depthView: rt.depthTexture.view(), depthFormat: 'depth32float', clearDepth: null,
				filter: ( o ) => !! o.userData.late } );
			if ( L.showVelocity ) velView.render( { colorViews: [ ldr.texture ] } );
			else tonemap.render( { colorViews: [ ldr.texture ] } );
			GPU.submit();
			L._prevVP = FrameUniforms.fields.viewProjNoJitter.value.clone();

		},
		async run( n = 3, onFrame = null, dt = 1 / 60 ) {

			for ( let i = 0; i < n; i ++ ) {

				L.frame( dt, onFrame );
				await GPU.queue.onSubmittedWorkDone();

			}

		},
		async save( path ) {

			const img = await readTexture( ldr.texture );
			writePNG( path, W, H, new Uint8Array( img.data ) );
			console.log( 'wrote', path );

		},
		// average wall time per frame of n frames (GPU bound when the scene is heavy)
		async gpuTime( n = 20, onFrame = null ) {

			await L.run( 2, onFrame );
			const t0 = performance.now();
			for ( let i = 0; i < n; i ++ ) {

				L.frame( 1 / 60, onFrame );
				await GPU.queue.onSubmittedWorkDone();

			}

			return ( performance.now() - t0 ) / n;

		},
		async exit() {

			await new Promise( ( r ) => setTimeout( r, 200 ) );
			process.exit( 0 );

		},
	};
	GPU.device.addEventListener?.( 'uncapturederror', ( e ) => console.error( 'GPU error:', e.error?.message ) );
	return L;

}
