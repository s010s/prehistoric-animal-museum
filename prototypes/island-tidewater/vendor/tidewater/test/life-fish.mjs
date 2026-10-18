// Fish (FishSchools + FishProps) headless test: underwater near the reef, above water, a close-up
// of individual species, and the GPU cost of the fish sets.
//   node test/life-fish.mjs [outDir]
import { setupLife } from './life-harness.mjs';
import * as E from '../src/engine/index.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { FishSchools } from '../src/world/Fish.js';
import { FishProps } from '../src/world/fish/FishProps.js';

const out = process.argv[ 2 ] || '/tmp';
const W = 2560, H = 1267;
const rc = WORLD.reef.center;
const L = await setupLife( { W, H, ground: { center: [ rc.x, rc.z ], size: 360, res: 0.75 }, water: true, near: 0.05 } );
const t0 = performance.now();
const fish = new FishSchools( { parent: L.scene, terrain: L.terrain, center: rc.clone(), radius: WORLD.reef.radius + 10 } );
console.log( 'fish', fish.fishCount, 'groups', fish.groups.length, 'build ms', ( performance.now() - t0 ).toFixed( 0 ) );

// pick the reef group nearest to the reef centre with a decent count, to aim the camera at
const groups = fish.groups.filter( ( g ) => g.zone && g.count > 3 );
const shots = [];
const findGroup = ( name ) => fish.groups.find( ( g ) => g.sp.name === name );

const step = ( dt ) => fish.update( dt, L.camera.position );

async function shot( name, pos, target, frames = 30 ) {

	L.camera.position.copy( pos );
	L.camera.lookAt( target );
	await L.run( frames, ( dt ) => {

		step( dt );
		if ( typeof target === 'function' ) L.camera.lookAt( target() );

	} );
	await L.save( `${ out }/fish-${ name }.png` );
	const b = fish.batch;
	console.log( name, 'visible', b.visibleInstances, 'fade', b.fadeInstances, 'tris', b.visibleTriangles, 'stats', JSON.stringify( L.mr.stats ) );

}

// underwater, looking along the reef
const y0 = L.terrain.heightAt( rc.x, rc.z );
console.log( 'reef centre ground', y0.toFixed( 2 ) );
await shot( 'underwater', new E.Vector3( rc.x + 14, Math.max( y0 + 2, - 6 ), rc.z + 10 ), new E.Vector3( rc.x, y0 + 0.5, rc.z ) );

// close-ups of a few groups
for ( const name of [ 'grunt', 'yellowtail', 'parrot', 'stingray', 'turtle', 'barracuda', 'bait' ] ) {

	const g = findGroup( name );
	if ( ! g ) { console.log( 'no group', name ); continue; }
	const i = g.offset * 3;
	const c = new E.Vector3( fish.pos[ i ], fish.pos[ i + 1 ], fish.pos[ i + 2 ] );
	const Ls = fish.size[ g.offset ];
	const d = Math.max( 0.6, Ls * 3.5 );
	await shot( name, new E.Vector3( c.x + d, c.y + d * 0.25, c.z + d * 0.4 ), new E.Vector3( c.x, c.y, c.z ), 8 );

}

// above the water
L.water.visible = true;
await shot( 'above', new E.Vector3( rc.x + 30, 6, rc.z + 30 ), new E.Vector3( rc.x, - 2, rc.z ) );

// GPU cost: underwater view, with and without the fish
L.camera.position.set( rc.x + 14, Math.max( y0 + 2, - 6 ), rc.z + 10 );
L.camera.lookAt( rc.x, y0 + 0.5, rc.z );
const withFish = await L.gpuTime( 30, step );
fish.group.visible = false;
const without = await L.gpuTime( 30, step );
fish.group.visible = true;
const tc = performance.now();
for ( let i = 0; i < 60; i ++ ) step( 1 / 60 );
console.log( `frame ms with fish ${ withFish.toFixed( 2 ) } without ${ without.toFixed( 2 ) } ; CPU update ${ ( ( performance.now() - tc ) / 60 ).toFixed( 2 ) } ms` );

// GPU cost in the densest view: inside the bait ball
{

	const g = findGroup( 'bait' );
	const c = new E.Vector3( fish.pos[ g.offset * 3 ], fish.pos[ g.offset * 3 + 1 ], fish.pos[ g.offset * 3 + 2 ] );
	L.camera.position.set( c.x + 4, c.y + 0.5, c.z + 3 );
	L.camera.lookAt( c );
	const a = await L.gpuTime( 30, step );
	const n = fish.batch.visibleInstances + fish.batch.fadeInstances, tr = fish.batch.visibleTriangles;
	fish.group.visible = false;
	const b = await L.gpuTime( 30, step );
	fish.group.visible = true;
	console.log( `bait view: ${ n } fish drawn, ${ tr } triangles, frame ms ${ a.toFixed( 2 ) } vs ${ b.toFixed( 2 ) } without` );

}

// close-ups (distance ~ 1.3 body lengths) of the bigger swimmers
for ( const name of [ 'turtle', 'stingray', 'eagleRay', 'parrot', 'grouper', 'angel' ] ) {

	const g = findGroup( name );
	if ( ! g ) { console.log( 'no group', name ); continue; }
	const at = () => new E.Vector3( fish.pos[ g.offset * 3 ], fish.pos[ g.offset * 3 + 1 ], fish.pos[ g.offset * 3 + 2 ] );
	const Ls = fish.size[ g.offset ];
	const d = Math.max( 0.35, Ls * 1.3 );
	L.camera.position.copy( at() ).add( new E.Vector3( d * 0.7, d * 0.5, d * 0.5 ) );
	await L.run( 4, ( dt ) => {

		step( dt );
		L.camera.position.copy( at() ).add( new E.Vector3( d * 0.7, d * 0.5, d * 0.5 ) );
		L.camera.lookAt( at() );

	} );
	await L.save( `${ out }/fish-close-${ name }.png` );

}

// motion vectors of a school while the camera is still
L.showVelocity = true;
{

	const g = findGroup( 'yellowtail' );
	const c = new E.Vector3( fish.pos[ g.offset * 3 ], fish.pos[ g.offset * 3 + 1 ], fish.pos[ g.offset * 3 + 2 ] );
	L.camera.position.set( c.x + 3, c.y + 0.5, c.z + 2 );
	L.camera.lookAt( c );
	await L.run( 4, step );
	await L.save( `${ out }/fish-velocity.png` );

}
L.showVelocity = false;

// props: a market display on the beach (whole fish on ice, a split fish, a cut fish, a lobster, a leaf)
let bx = rc.x, bz = rc.z;
for ( let k = 0; k < 400 && L.terrain.heightAt( bx, bz ) < 1.2; k ++ ) { bx += 1; bz -= 0.6; }
const by = L.terrain.heightAt( bx, bz ) + 0.9;
console.log( 'props at', bx.toFixed( 1 ), by.toFixed( 2 ), bz.toFixed( 1 ) );
const props = new FishProps();
const fm = new E.Matrix4();
const at = ( x, y, z, ry = 0 ) => fm.makeRotationY( ry ).setPosition( bx + x, by + y, bz + z );
props.add( 'ice', null, at( 0, 0, 0 ), 'flat', 0.45, { seed: 0.3, flags: 0 } );
props.add( 'leaf', null, at( 0.9, 0, 0.1, 0.4 ), 'flat', 0.5, { seed: 0.6 } );
const sp = [ 'redSnapper', 'grouper', 'tuna', 'mahi', 'parrot', 'grunt' ];
sp.forEach( ( s, i ) => {

	const len = s === 'tuna' || s === 'mahi' ? 0.55 : 0.35;
	props.add( 'whole', s, at( - 0.25 + ( i % 3 ) * 0.25, 0.05 + FishProps.restHeight( s, len ), - 0.2 + Math.floor( i / 3 ) * 0.3, 0.2 * i ), i % 2 ? 'side' : 'sideFlip', len, { seed: i * 0.17, jaw: 0.25, curl: 0.4 * ( i % 2 ? 1 : - 1 ), anchor: [ 0, 0, 0 ] } );

} );
props.add( 'split', 'redSnapper', at( 1.4, 0.8, - 0.3 ), 'tailFlat', 0.45, { anchor: FishProps.tailAnchor( 'redSnapper' ), dried: 0.8, wet: 0 } );
props.add( 'whole', 'mullet', at( 1.8, 0.8, - 0.3 ), 'tail', 0.35, { anchor: FishProps.tailAnchor( 'mullet' ) } );
props.add( 'head', 'tuna', at( 0.9, 0.08, 0.6 ), 'side', 0.6, { blood: 1 } );
props.add( 'trunk', 'tuna', at( 1.3, 0.08, 0.6 ), 'side', 0.6, { blood: 1 } );
props.add( 'lobster', null, at( 0.7, 0.04, - 0.4, 1 ), 'flat', 0.35, {} );
const pm = props.build();
L.scene.add( pm );
fish.group.visible = false;
L.camera.position.set( bx + 0.5, by + 1.1, bz + 1.6 );
L.camera.lookAt( bx + 0.6, by + 0.1, bz );
await L.run( 4 );
await L.save( `${ out }/fish-props.png` );
L.camera.position.set( bx + 0.1, by + 0.45, bz + 0.45 );
L.camera.lookAt( bx - 0.05, by + 0.1, bz - 0.05 );
await L.run( 4 );
await L.save( `${ out }/fish-props-close.png` );
console.log( 'props visible', props.batch.visibleInstances, 'fade', props.batch.fadeInstances );
await L.exit();
