// Ocean surface from above and below the waterline.  node test/ocean-surface.mjs [outDir]
import { makeOceanScene } from './ocean-scene.mjs';

const out = process.argv[ 2 ] || '/tmp';
const s = await makeOceanScene();
const shots = [
	[ 'above', [ 0, 6, 40 ], [ 60, 0, - 60 ] ],
	[ 'grazing', [ - 50, 2.2, 0 ], [ 200, 0, - 10 ] ],
	[ 'down', [ 20, 14, 10 ], [ 30, - 4, - 8 ] ],
	[ 'below', [ 10, - 3, 10 ], [ 40, 2, - 20 ] ],
];
for ( const [ name, p, t ] of shots ) {

	s.camera.position.set( ...p );
	s.camera.lookAt( ...t );
	for ( let i = 0; i < 3; i ++ ) s.frame();
	await s.save( `${ out }/ocean-surface-${ name }.png` );
	console.log( name, 'mr stats', JSON.stringify( s.mr.stats ), 'nodes', s.cdlod.count );

}

s.camera.position.set( 0, 6, 40 ); s.camera.lookAt( 60, 0, - 60 );
console.log( 'frame ms (fft + caustics + scene + water @ 2560x1267):', ( await s.time( 30 ) ).toFixed( 2 ) );
process.exit( 0 );
