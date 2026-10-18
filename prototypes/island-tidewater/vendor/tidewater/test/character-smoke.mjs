// Skinned character smoke test: loads a GLB (skin + clips), plays a clip and renders a few
// frames of a studio view with the engine alone.
//   node test/character-smoke.mjs [model.glb] [out.png] [clip] [yawDeg]
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writePNG } from './headless.mjs';
import { GPU } from '../src/engine/gpu/GPU.js';
import { RenderTarget } from '../src/engine/gpu/Texture.js';
import { readTexture } from '../src/engine/gpu/Readback.js';
import { G, setFrameCamera } from '../src/engine/render/Frame.js';
import { Material } from '../src/engine/render/Material.js';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';
import { SunShadows } from '../src/engine/render/Shadows.js';
import { FullscreenPass } from '../src/engine/render/FullscreenPass.js';
import { SkinnedModel } from '../src/engine/render/Skinning.js';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
import * as E from '../src/engine/index.js';

const file = process.argv[ 2 ] || new URL( '../public/models/characters/joe.glb', import.meta.url ).pathname;
const OUT = process.argv[ 3 ] || '/tmp/character-smoke.png';
const CLIP = process.argv[ 4 ] || null;
const YAW = Number( process.argv[ 5 ] || 0 ) * Math.PI / 180;

// embedded images -> RGBA8 with macOS sips (no image decoding in Node)
const tmp = mkdtempSync( join( tmpdir(), 'char-img-' ) );
let nImg = 0;
globalThis.__assetImage = async ( bytes, mime ) => {

	const src = join( tmp, 'i' + ( nImg ++ ) + ( mime === 'image/png' ? '.png' : '.jpg' ) );
	writeFileSync( src, bytes );
	const out = src + '.bmp';
	execFileSync( 'sips', [ '-s', 'format', 'bmp', src, '--out', out ], { stdio: 'ignore' } );
	return readBMP( readFileSync( out ) );

};

await GPU.init( { headless: true } );
const W = 720, H = 900;
const scene = new E.Scene();
const ground = new E.Mesh( new E.PlaneGeometry( 30, 30 ).rotateX( - Math.PI / 2 ), new Material( { name: 'ground', color: 0x7a7266, roughness: 0.9 } ) );
ground.castShadow = true;
scene.add( ground );

const buf = readFileSync( file );
const gltf = parseGLB( buf.buffer.slice( buf.byteOffset, buf.byteOffset + buf.byteLength ) );
const model = await SkinnedModel.create( gltf );
model.group.rotation.y = YAW;
scene.add( model.group );
console.log( 'clips', model.clipNames().map( ( n ) => n + ' ' + model.clipDuration( n ).toFixed( 2 ) + 's' ).join( ', ' ) );
if ( CLIP ) model.play( CLIP, { fade: 0.01 } );

const camera = new E.PerspectiveCamera( 30, W / H, 0.1, 100 );
camera.position.set( 0, 1.2, 4.2 ); camera.lookAt( 0, 0.95, 0 );
// CAM="x,y,z,tx,ty,tz[,fov]" overrides the studio camera (close-ups)
if ( process.env.CAM ) {

	const c = process.env.CAM.split( ',' ).map( Number );
	camera.position.set( c[ 0 ], c[ 1 ], c[ 2 ] ); camera.lookAt( c[ 3 ], c[ 4 ], c[ 5 ] );
	if ( c[ 6 ] ) { camera.fov = c[ 6 ]; camera.updateProjectionMatrix(); }

}
G.sunDir.value.set( 0.45, 0.75, 0.5 ).normalize();
G.sunColor.value.setRGB( 3, 2.9, 2.7 );
G.skyIrradiance.value.setRGB( 0.3, 0.36, 0.45 );

const rt = new RenderTarget( W, H, { colors: [ 'rgba16float', 'rgba16float', 'rgba8unorm' ], depth: 'depth32float', label: 'scene' } );
const mr = new MeshRenderer();
const shadows = new SunShadows();
const tonemap = new FullscreenPass( { label: 'tonemap', colorFormats: [ 'rgba8unorm' ], bindings: { hdr: { texture: () => rt.texture } },
	code: `fn fragment( in: FSIn ) -> vec4f {
		let c = textureLoad( hdr, vec2i( in.pos.xy ), 0 ).rgb;
		let a = c * 0.8; let t = ( a * ( 2.51 * a + 0.03 ) ) / ( a * ( 2.43 * a + 0.59 ) + 0.14 );
		return vec4f( linearToSrgb( sat3( t ) ), 1.0 ); }` } );
const ldr = new RenderTarget( W, H, { colors: [ 'rgba8unorm' ], label: 'ldr' } );
const frames = Number( process.env.FRAMES || 1 );
const step = Number( process.env.STEP || 0.5 );
for ( let f = 0; f < frames; f ++ ) {

	for ( let k = 0; k < 3; k ++ ) {

		model.update( k === 0 ? ( f === 0 ? 0 : step ) : 0 );
		GPU.beginFrame();
		setFrameCamera( camera, W, H );
		shadows.render( scene, mr, shadows.update( camera, G.sunDir.value ) );
		mr.render( scene, { camera, kind: 'main', colorViews: rt.textures.map( ( t ) => t.view() ), colorFormats: rt.formats,
			clearColors: [ [ 0.55, 0.62, 0.72, 1 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ] ], depthView: rt.depthTexture.view(), depthFormat: 'depth32float', clearDepth: 0 } );
		tonemap.render( { colorViews: [ ldr.texture ] } );
		GPU.submit();

	}

	const img = await readTexture( ldr.texture );
	writePNG( frames > 1 ? OUT.replace( /\.png$/, `_${ f }.png` ) : OUT, W, H, new Uint8Array( img.data ) );

}

console.log( 'stats', mr.stats );
await new Promise( ( r ) => setTimeout( r, 200 ) );
process.exit( 0 );

function readBMP( b ) {

	const off = b.readUInt32LE( 10 ), w = b.readInt32LE( 18 ), h0 = b.readInt32LE( 22 ), bpp = b.readUInt16LE( 28 );
	const h = Math.abs( h0 ), bytes = bpp / 8, row = Math.ceil( w * bytes / 4 ) * 4;
	const data = new Uint8Array( w * h * 4 );
	for ( let y = 0; y < h; y ++ ) {

		const sy = h0 > 0 ? h - 1 - y : y;
		for ( let x = 0; x < w; x ++ ) {

			const o = off + sy * row + x * bytes, d = ( y * w + x ) * 4;
			data[ d ] = b[ o + 2 ]; data[ d + 1 ] = b[ o + 1 ]; data[ d + 2 ] = b[ o ]; data[ d + 3 ] = bytes === 4 ? b[ o + 3 ] : 255;

		}

	}

	return { data, width: w, height: h };

}
