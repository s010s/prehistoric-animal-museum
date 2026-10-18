// Caustics: the splatted focal-plane maps and a flat floor 3 m under water seen from above the
// surface with the water hidden.  node test/ocean-caustics.mjs [outDir]
import { makeOceanScene } from './ocean-scene.mjs';
import { ShaderModule } from '../src/engine/gpu/Shader.js';
import { readFloatTexture, writeFloatPNG, stats } from './ocean-util.mjs';

const out = process.argv[ 2 ] || '/tmp';
const s = await makeOceanScene( { W: 1280, H: 720 } );
s.camera.position.set( 0, 14, 0.01 ); s.camera.lookAt( 0, 0, 0 );
for ( let i = 0; i < 3; i ++ ) s.frame();
for ( const [ name, layer ] of [ [ 'fine', s.caustics.fine ], [ 'broad', s.caustics.broad ] ] ) {

	const img = await readFloatTexture( layer.texture );
	console.log( name, 'R', stats( img, 0 ), 'G', stats( img, 1 ) );
	writeFloatPNG( `${ out }/ocean-caustics-${ name }.png`, img, { channels: [ 0, 1, - 1 ], lo: 0, hi: 3 } );

}

// floor view: hide the water (the floor's lighting hook still sees the waves)
s.waterMaterial.visible = false;
for ( let i = 0; i < 2; i ++ ) s.frame();
await s.save( `${ out }/ocean-caustics-floor.png` );
process.exit( 0 );
