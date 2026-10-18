// The whole world stream together: terrain + rocks + village / pier + boat at the dock + debris,
// with the ground bounce and contact shadow hooks, at 2560x1267 with the engine's sun shadows.
//   node test/world-all.mjs [outDir] [--view=name] [--time] [--no-debris]
import { worldHarness, done } from './world-harness.mjs';
import { TerrainData } from '../src/world/TerrainData.js';
import { TerrainGPU } from '../src/world/TerrainGPU.js';
import { Terrain } from '../src/world/Terrain.js';
import { Rocks } from '../src/world/Rocks.js';
import { Colliders } from '../src/world/Colliders.js';
import { Village } from '../src/world/Village.js';
import { BoatModel } from '../src/world/BoatModel.js';
import { computeShoreField } from '../src/world/ShoreField.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { installGroundBounce } from '../src/materials/GroundBounce.js';

const out = process.argv[ 2 ] && ! process.argv[ 2 ].startsWith( '--' ) ? process.argv[ 2 ] : '/tmp';
const H = await worldHarness( { sun: [ 0.5, 0.5, 0.45 ] } );
const data = new TerrainData();
const colliders = new Colliders();
const village = new Village( { scene: H.scene, terrain: data, colliders } );
const shore = computeShoreField( data, { res: 512, swellDir: [ WORLD.swellDir.x, WORLD.swellDir.y ] } );
const gpu = new TerrainGPU( data, shore );
const terrain = new Terrain( { scene: H.scene, terrainData: data, terrainGPU: gpu } );
terrain.material.appliesHillShadow = true;
const rocks = new Rocks( { scene: H.scene, terrain, village, colliders } );
rocks.material.appliesHillShadow = true;
const boat = new BoatModel();
boat.group.position.copy( WORLD.boatDock.position );
boat.group.rotation.y = WORLD.boatDock.heading;
H.scene.add( boat.group );
let debris = null;
if ( ! process.argv.includes( '--no-debris' ) ) {

	const { Debris } = await import( '../src/world/Debris.js' );
	debris = new Debris( { scene: H.scene, terrain, village, vegetation: null, rocks, colliders } );

}

installGroundBounce( { terrain: gpu } );
H.before.push( ( cam ) => {

	terrain.update( cam );
	rocks.update( cam );
	if ( village.update ) village.update( 1 / 60, cam );
	if ( debris && debris.update ) debris.update( cam, 1 / 60 );
	boat.update( 1 / 60 );

} );

const views = {
	spawn: { pos: [ 18, data.heightAt( 18, - 60 ) + 1.7, - 60 ], target: [ 50, 2, - 10 ] },
	pierBeach: { pos: [ 40, 4, - 45 ], target: [ 60, 1.5, 10 ] },
	underPier: { pos: [ 50, 1.2, - 35 ], target: [ 56, 1.8, - 20 ] },
	dock: { pos: [ 72, 5, 28 ], target: [ 64, 1.5, 38 ] },
	village: { pos: [ 5, 30, - 60 ], target: [ 40, 5, - 118 ] },
	wide: { pos: [ 180, 90, 120 ], target: [ 20, 0, - 80 ] },
};
const only = process.argv.find( ( a ) => a.startsWith( '--view=' ) );
for ( const [ k, v ] of Object.entries( views ) ) {

	if ( only && only.slice( 7 ) !== k ) continue;
	await H.shot( `${ out }/claude-world-${ k }.png`, v, 4 );

}

if ( process.argv.includes( '--time' ) ) {

	for ( const k of [ 'spawn', 'village', 'wide' ] ) {

		H.setView( views[ k ] );
		console.log( `main pass (${ k }) ms`, await H.timeMain( 12 ) );

	}

}

await done();
