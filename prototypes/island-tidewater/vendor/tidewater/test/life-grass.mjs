// GrassField headless render: meadow and dune views at 2560x1267, GPU time with / without grass.
// Usage: node test/life-grass.mjs [outDir]
import { setupLife } from './life-harness.mjs';
import { VegSite, buildGrassMask } from '../src/world/vegetation/Scatter.js';
import { GrassField } from '../src/world/vegetation/GrassField.js';
import { uCamPos, uGustOffset } from '../src/world/vegetation/VegNodes.js';
import { G } from '../src/engine/render/Frame.js';

const out = process.argv[ 2 ] || '.';
const W = +( process.env.W || 2560 ), H = +( process.env.H || 1267 );
const L = await setupLife( { W, H } );
const T = L.terrain;
let t0 = performance.now();
const mask = buildGrassMask( new VegSite( T ) );
console.log( 'mask ms', ( performance.now() - t0 ).toFixed( 0 ), 'res', mask.res );
// densest meadow (G) and dune (R) spots
const best = [ { v: 0 }, { v: 0 } ];
const mres = mask.res, texel = T.size / mres;
for ( let j = 0; j < mres; j += 2 ) for ( let i = 0; i < mres; i += 2 ) {

	const o = ( j * mres + i ) * 4;
	const x = T.origin + ( i + 0.5 ) * texel, z = T.origin + ( j + 0.5 ) * texel;
	if ( Math.hypot( x, z ) > 500 ) continue;
	for ( const [ k, ch ] of [ [ 0, 1 ], [ 1, 0 ] ] ) {

		// average over a 5x5 neighbourhood so we land inside a patch
		let s = 0;
		for ( let b = - 2; b <= 2; b ++ ) for ( let a = - 2; a <= 2; a ++ ) s += mask.data[ ( ( Math.min( mres - 1, Math.max( 0, j + b ) ) * mres + Math.min( mres - 1, Math.max( 0, i + a ) ) ) * 4 ) + ch ];
		if ( s > best[ k ].v ) best[ k ] = { v: s, x, z };

	}

}

console.log( 'meadow', best[ 0 ], 'dune', best[ 1 ] );
t0 = performance.now();
const grass = new GrassField( { terrain: T, mask } );
console.log( 'grass build ms', ( performance.now() - t0 ).toFixed( 0 ), 'patch tris', grass.patchTris );
// ground under the grass (harness heightfield)
const { groundMesh } = await import( './life-harness.mjs' );
for ( const m of grass.meshes ) L.scene.add( m );
G.windSpeed.value = 7;

const onFrame = ( dt ) => {

	uCamPos.value.copy( L.camera.position );
	const wd = G.windDir.value, speed = 0.7 * G.windSpeed.value + 1.5;
	uGustOffset.value.x += wd.x * speed * dt; uGustOffset.value.y += wd.y * speed * dt;
	L.camera.updateMatrixWorld();
	grass.update( L.camera );

};

for ( const [ name, b ] of [ [ 'meadow', best[ 0 ] ], [ 'dune', best[ 1 ] ] ] ) {

	if ( process.env.VIEW && process.env.VIEW !== name ) continue;
	const g = groundMesh( T, b.x, b.z, 260, 0.5 );
	L.scene.add( g );
	const y = T.heightAt( b.x - 6, b.z - 6 ) + 1.7;
	L.camera.position.set( b.x - 6, y, b.z - 6 );
	L.camera.lookAt( b.x + 10, T.heightAt( b.x + 10, b.z + 10 ) + 0.3, b.z + 10 );
	await L.run( 4, onFrame );
	await L.save( `${ out }/grass-${ name }.png` );
	console.log( name, 'cells', grass.levels.map( ( l ) => l.count ), 'tris', grass.triangles, 'draws', L.mr.stats.draws );
	if ( name === 'meadow' ) {

		// wide view from higher up
		L.camera.position.y += 6;
		L.camera.lookAt( b.x + 40, T.heightAt( b.x + 40, b.z + 40 ), b.z + 40 );
		await L.run( 3, onFrame );
		await L.save( `${ out }/grass-${ name }-wide.png` );
		L.camera.position.y -= 6;
		L.camera.lookAt( b.x + 10, T.heightAt( b.x + 10, b.z + 10 ) + 0.3, b.z + 10 );
		const withG = await L.gpuTime( 20, onFrame );
		for ( const m of grass.meshes ) m.visible = false;
		const without = await L.gpuTime( 20, onFrame );
		for ( const m of grass.meshes ) m.visible = true;
		console.log( `frame ms with grass ${ withG.toFixed( 2 ) } without ${ without.toFixed( 2 ) } (${ W }x${ H }, incl. shadows)` );

	}

	L.scene.remove( g );

}

await L.exit();
