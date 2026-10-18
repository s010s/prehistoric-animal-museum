// Terrain stream test: TerrainData -> TerrainGPU -> Terrain (CDLOD + WGSL material), rendered
// headless at the real resolution with the engine's sun shadows.
//   node test/world-terrain.mjs [outDir] [--time]
import { worldHarness, done } from './world-harness.mjs';
import { TerrainData } from '../src/world/TerrainData.js';
import { TerrainGPU } from '../src/world/TerrainGPU.js';
import { Terrain } from '../src/world/Terrain.js';
import { computeShoreField } from '../src/world/ShoreField.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { Rocks } from '../src/world/Rocks.js';
import { Colliders } from '../src/world/Colliders.js';

const out = process.argv[ 2 ] && ! process.argv[ 2 ].startsWith( '--' ) ? process.argv[ 2 ] : '/tmp';
const H = await worldHarness( { sun: [ 0.5, 0.42, 0.45 ] } );
let t = performance.now();
const data = new TerrainData();
console.log( 'TerrainData', ( performance.now() - t ).toFixed( 0 ), 'ms' );
t = performance.now();
const shore = computeShoreField( data, { res: 512, swellDir: [ WORLD.swellDir.x, WORLD.swellDir.y ] } );
console.log( 'ShoreField', ( performance.now() - t ).toFixed( 0 ), 'ms' );
const gpu = new TerrainGPU( data, shore );
console.log( 'TerrainGPU', gpu.timings );
const terrain = new Terrain( { scene: H.scene, terrainData: data, terrainGPU: gpu } );
terrain.material.appliesHillShadow = true;
if ( process.argv.includes( '--wet' ) ) {

	// stand-in for App's shoreSim wetness (the real one comes from ShoreSim's module)
	terrain.wetness = { modules: [], code: 'fn terrainWetness( xz: vec2f, h: f32 ) -> vec2f { let w = smoothstep( 1.2, 0.2, h ); return vec2f( w, w * smoothstep( 0.3, 0.7, fract( xz.x * 0.05 ) ) ); }' };
	terrain.finalizeMaterial();

}
const rocks = process.argv.includes( '--no-rocks' ) ? null : new Rocks( { scene: H.scene, terrain, colliders: new Colliders() } );
if ( rocks ) rocks.material.appliesHillShadow = true;
if ( rocks ) console.log( 'rocks', rocks.stats().rocks, rocks.timings );
H.before.push( ( cam ) => { terrain.update( cam ); if ( rocks ) rocks.update( cam ); } );

if ( process.argv.includes( '--hooks' ) ) {

	const { installGroundBounce } = await import( '../src/materials/GroundBounce.js' );
	const { LocalLights } = await import( '../src/materials/LocalLights.js' );
	installGroundBounce( { terrain: gpu } );
	if ( process.argv.includes( '--night' ) ) {

		const ll = new LocalLights();
		for ( const [ x, z, c ] of [ [ 18, - 62, [ 1, 0.7, 0.4 ] ], [ 24, - 66, [ 1, 0.6, 0.3 ] ], [ 12, - 68, [ 0.5, 0.7, 1 ] ] ] ) {

			ll.add( { position: new H.E.Vector3( x, data.heightAt( x, z ) + 1.2, z ), color: new H.E.Color( ...c ), intensity: 3, range: 12, kind: 'lantern' } );

		}

		H.G.night.value = 1;
		H.G.exposure.value = 12;
		H.G.sunColor.value.setRGB( 0.02, 0.025, 0.04 );
		H.G.skyIrradiance.value.setRGB( 0.004, 0.006, 0.01 );
		H.before.push( ( cam ) => ll.update( cam, 1 / 60 ) );

	}

}

const views = {
	beach: { pos: [ 10, 4, - 30 ], target: [ 20, 0.5, - 60 ] },
	overview: { pos: [ 150, 180, 250 ], target: [ 0, 0, - 150 ] },
	hills: { pos: [ - 60, 40, - 40 ], target: [ 0, 30, - 300 ] },
	closeSand: { pos: [ 18, 3.2, - 58 ], target: [ 22, 1.5, - 66 ], fov: 50 },
	rocksShore: { pos: [ 150, 6, - 20 ], target: [ 175, 1, - 45 ] },
	headland: { pos: [ -150, 12, 10 ], target: [ -190, 2, -30 ] },
	seabed: { pos: [ - 40, 6, 30 ], target: [ - 60, - 4, 60 ] },
};
if ( rocks ) {

	// a dry boulder near the bay for a close-up (contact shadows, ground contact drift)
	const r = rocks.instances.filter( ( q ) => q.size > 1.2 && q.y > 0.8 && q.y < 6 ).sort( ( a, b ) => Math.hypot( a.x - 18, a.z + 60 ) - Math.hypot( b.x - 18, b.z + 60 ) )[ 0 ];
	if ( r ) {

		// from the sun side, above the ground
		const L = H.G.sunDir.value, lx = L.x / Math.hypot( L.x, L.z ), lz = L.z / Math.hypot( L.x, L.z );
		const cx = r.x + lx * r.size * 3.5, cz = r.z + lz * r.size * 3.5;
		views.boulder = { pos: [ cx, Math.max( data.heightAt( cx, cz ), r.y ) + r.size * 1.3 + 1.2, cz ], target: [ r.x, r.y, r.z ], fov: 50 };

	}

}

const only = process.argv.find( ( a ) => a.startsWith( '--view=' ) );
for ( const [ k, v ] of Object.entries( views ) ) {

	if ( only && only.slice( 7 ) !== k ) continue;
	await H.shot( `${ out }/claude-terrain-${ k }.png`, v );

}

if ( process.argv.includes( '--time' ) ) {

	H.setView( views.beach );
	console.log( 'main pass (beach view) ms', await H.timeMain( 12 ) );
	H.setView( views.overview );
	console.log( 'main pass (overview) ms', await H.timeMain( 12 ) );
	const { ShadowUniforms } = await import( '../src/engine/render/wgsl/lighting.js' );
	ShadowUniforms.fields.enabled.value = 0;
	console.log( 'overview without sun shadow map lookups ms', await H.timeMain( 12 ) );
	H.setView( views.beach );
	console.log( 'beach without sun shadow map lookups ms', await H.timeMain( 12 ) );
	terrain.mesh.visible = false; if ( rocks ) rocks.group.visible = false;
	console.log( 'baseline (nothing drawn) ms', await H.timeMain( 12 ) );

}

await done();
