// Dump the clouds' generated textures (weather, synoptic, fibres, a slice of the shape / detail volumes)
// as PNGs for comparison with the three.js version. usage: node test/sky-textures.mjs [outDir]
import { writePNG } from './headless.mjs';
import { GPU } from '../src/engine/gpu/GPU.js';
import { readTexture } from '../src/engine/gpu/Readback.js';
import { FullscreenPass } from '../src/engine/render/FullscreenPass.js';
import { Texture } from '../src/engine/gpu/Texture.js';
import { Atmosphere } from '../src/sky/Atmosphere.js';
import { Clouds } from '../src/sky/Clouds.js';

await GPU.init( { headless: true } );
const out = process.argv[ 2 ] || '/tmp';
const clouds = new Clouds( null, new Atmosphere() );
GPU.submit();

for ( const [ name, n, is3D ] of [ [ 'weatherTex', 512 ], [ 'synTex', 256 ], [ 'fibTex', 1024 ], [ 'shapeTex', 128, true ], [ 'detailTex', 64, true ] ] ) {

	const dst = new Texture( { width: n, height: n, format: 'rgba8unorm', usage: [ 'render', 'copySrc', 'sample' ] } );
	const pass = new FullscreenPass( { label: 'dump', colorFormats: [ 'rgba8unorm' ], bindings: { src: { texture: clouds[ name ] } },
		code: is3D
			? 'fn fragment( in: FSIn ) -> vec4f { return vec4f( textureSampleLevel( src, smpLinearRepeat, vec3f( in.uv, 0.5 ), 0.0 ).rgb, 1.0 ); }'
			: 'fn fragment( in: FSIn ) -> vec4f { return vec4f( textureSampleLevel( src, smpLinearRepeat, in.uv, 0.0 ).rgb, 1.0 ); }' } );
	pass.render( { colorViews: [ dst ] } );
	const img = await readTexture( dst );
	writePNG( `${ out }/tex-${ name }.png`, n, n, new Uint8Array( img.data ) );

}

process.exit( 0 );
