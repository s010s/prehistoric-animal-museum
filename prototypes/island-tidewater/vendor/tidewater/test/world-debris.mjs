// Debris stream test: natural debris, village clutter, pebble field and the photoscanned logs /
// shells over the terrain, rendered headless at 2560x1267 from a few viewpoints.
//   node test/world-debris.mjs [outPrefix=/tmp/claude-debris-]
import './headless.mjs';
import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { worldHarness, done } from './world-harness.mjs';
import { TerrainData } from '../src/world/TerrainData.js';
import { TerrainGPU } from '../src/world/TerrainGPU.js';
import { computeShoreField } from '../src/world/ShoreField.js';
import { Colliders } from '../src/world/Colliders.js';
import { standard } from '../src/materials/Materials.js';

const OUT = process.argv[ 2 ] || '/tmp/claude-debris-';
const ROOT = new URL( '../public', import.meta.url ).pathname;

// ---- asset hooks for ScannedDebris (no fetch / image decoding in Node)
globalThis.__debrisFile = async ( url ) => {

	const b = readFileSync( join( ROOT, url.replace( /^.*models\//, 'models/' ) ) );
	return b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength );

};
const tmp = mkdtempSync( join( tmpdir(), 'debris-img-' ) );
// JPEG -> BMP with macOS sips, then read the BMP (RGBA8, top row first)
globalThis.__debrisImage = async ( url ) => {

	const src = join( ROOT, url.replace( /^.*models\//, 'models/' ) );
	const out = join( tmp, url.replace( /^.*\//, '' ) + '.bmp' );
	execFileSync( 'sips', [ '-s', 'format', 'bmp', src, '--out', out ], { stdio: 'ignore' } );
	const b = readFileSync( out );
	const off = b.readUInt32LE( 10 ), w = b.readInt32LE( 18 ), h0 = b.readInt32LE( 22 ), bpp = b.readUInt16LE( 28 );
	const h = Math.abs( h0 ), bytes = bpp / 8, row = Math.ceil( w * bytes / 4 ) * 4;
	const data = new Uint8Array( w * h * 4 );
	for ( let y = 0; y < h; y ++ ) {

		const sy = h0 > 0 ? h - 1 - y : y;
		for ( let x = 0; x < w; x ++ ) {

			const o = off + sy * row + x * bytes, d = ( y * w + x ) * 4;
			data[ d ] = b[ o + 2 ]; data[ d + 1 ] = b[ o + 1 ]; data[ d + 2 ] = b[ o ]; data[ d + 3 ] = 255;

		}

	}

	return { data, width: w, height: h };

};

const H = await worldHarness( { width: 2560, height: 1267 } );
const { E } = H;

let t0 = performance.now();
const data = new TerrainData();
let shore = null;
try {

	shore = computeShoreField( data );

} catch ( e ) {

	console.log( 'shore field skipped:', e.message );

}

const gpu = new TerrainGPU( data, shore );
console.log( 'terrain', ( performance.now() - t0 ).toFixed( 0 ), 'ms' );

// ---- ground: the real Terrain if it imports and builds, else a coarse heightfield mesh
let terrain = null;
try {

	const { Terrain } = await import( '../src/world/Terrain.js' );
	terrain = new Terrain( { scene: H.scene, terrainData: data, terrainGPU: gpu } );
	H.before.push( ( cam ) => terrain.update( cam ) );
	console.log( 'using real Terrain' );

} catch ( e ) {

	console.log( 'Terrain unavailable (' + e.message.split( '\n' )[ 0 ] + '): coarse ground mesh' );
	const N = 480, x0 = - 200, z0 = - 260, S = 440;
	const g = new E.PlaneGeometry( S, S, N, N ).rotateX( - Math.PI / 2 );
	const P = g.attributes.position;
	for ( let i = 0; i < P.count; i ++ ) {

		const x = P.getX( i ) + x0 + S / 2, z = P.getZ( i ) + z0 + S / 2;
		P.setXYZ( i, x, data.heightAt( x, z ), z );

	}

	g.computeVertexNormals();
	const ground = new E.Mesh( g, standard( { name: 'ground', roughness: 0.95, modules: [ gpu.module, gpu.sunModulationModule ], defines: { MATERIAL_SUN_MODULATION: 1 },
		surface: `
	let h = in.P.y;
	let sand = vec3f( 0.62, 0.52, 0.36 ); let grass = vec3f( 0.16, 0.2, 0.07 ); let wetSand = vec3f( 0.34, 0.28, 0.2 );
	var c = mix( wetSand, sand, smoothstep( 0.2, 0.9, h ) );
	c = mix( c, grass, smoothstep( 3.5, 5.0, h ) * smoothstep( 0.6, 0.9, in.N.y ) );
	s.albedo = c;` } ) );
	ground.receiveShadow = true;
	H.scene.add( ground );

}

// sea plane (flat, dark) so the shoreline reads
const sea = new E.Mesh( new E.PlaneGeometry( 3000, 3000 ).rotateX( - Math.PI / 2 ), standard( { name: 'sea', color: 0x0d3a4a, roughness: 0.08 } ) );
sea.position.y = 0;
H.scene.add( sea );

// ---- village: the real materials when VillageMaterials is ported, else stubs (tint as albedo)
let villageMats = null, villageTextures = null;
try {

	const { createVillageMaterials } = await import( '../src/world/village/VillageMaterials.js' );
	const { VillageTextures } = await import( '../src/world/village/TextureBaker.js' );
	villageTextures = new VillageTextures();
	villageMats = createVillageMaterials( villageTextures );
	console.log( 'using real village materials' );

} catch ( e ) {

	console.log( 'village materials unavailable (' + e.message.split( '\n' )[ 0 ] + '): stubs' );
	const stub = ( name, color, rough ) => standard( { name, color, roughness: rough, attributes: { tint: 'vec3f' }, varyings: { vT: 'vec3f' },
		vertex: 'o.vT = v.tint;', surface: 's.albedo = s.albedo * in.vs.vT;' } );
	villageMats = { wood: stub( 'stubWood', 0xffffff, 0.8 ), hard: stub( 'stubHard', 0xffffff, 0.5 ), fabric: stub( 'stubFabric', 0xffffff, 0.9 ) };

}

const { Debris } = await import( '../src/world/Debris.js' );
const colliders = new Colliders();
t0 = performance.now();
const debris = new Debris( { scene: H.scene, terrain: { data, gpu }, village: { materials: villageMats, textures: villageTextures, buildings: [], getFootprints: () => [], path: null }, colliders } );
console.log( 'debris built', ( performance.now() - t0 ).toFixed( 0 ), 'ms' );
await debris.scanned.promise;
console.log( 'stats', JSON.stringify( { ...debris.stats(), timings: undefined } ) );

let baked = false;
H.before.push( ( cam ) => {

	if ( ! baked ) {

		gpu.updateSunShadow( null, true );
		baked = true;

	}

	debris.update( cam );

} );

const y = ( x, z, up ) => data.heightAt( x, z ) + up;
// views: pick near the scanned instances / wrack line
const scan = debris.scanned.instances;
const log = scan.find( ( r ) => r.asset === 0 && r.y > 0.5 && r.y < 3 ) || scan[ 0 ];
const shell = scan.find( ( r ) => r.asset === 3 && r.y > 0.3 ) || scan[ 1 ];
console.log( 'log at', log && [ log.x, log.y, log.z ].map( ( v ) => v.toFixed( 1 ) ), 'shell at', shell && [ shell.x, shell.y, shell.z ].map( ( v ) => v.toFixed( 1 ) ) );

// camera on the sun side of a target (sun from +x +z in the harness): d metres away, eye height up
const sunSide = ( tx, tz, d, up, fov = 55, ty = null ) => {

	const px = tx + d * 0.8, pz = tz + d * 0.6;
	return { pos: [ px, y( px, pz, up ), pz ], target: [ tx, ty ?? y( tx, tz, 0 ), tz ], fov };

};
const views = {
	beach: sunSide( 18, - 52, 7, 1.7 ),
	spawn: { pos: [ 18, y( 18, - 60, 1.7 ), - 60 ], target: [ 18, y( 18, - 40, 0.5 ), - 40 ], fov: 55 },
	forest: sunSide( 40, - 110, 8, 1.7 ),
};
if ( log ) {

	views.wrack = sunSide( log.x, log.z, 12, 1.8 );
	views.log = sunSide( log.x, log.z, 3.2, 1.3, 50, log.y );
	views.logFar = sunSide( log.x, log.z, 28, 1.7, 14, log.y );

}

if ( shell ) views.shell = sunSide( shell.x, shell.z, 0.8, 0.6, 50, shell.y );

// debug: NATURE_DEBUG=<wgsl> appended to the nature surface (e.g. 's.emissive = s.albedo; s.albedo = vec3f( 0.0 );')
if ( process.env.NATURE_DEBUG ) {

	const m = debris.materials.nature;
	m.surface = m._surface + '\n' + process.env.NATURE_DEBUG + '\n';
	m.needsUpdate = true;

}

if ( process.env.SCAN_DEBUG ) {

	const m = debris.scanned.material;
	m.surface = m._surface + '\n' + process.env.SCAN_DEBUG + '\n';
	m.needsUpdate = true;

}

if ( process.env.DEBRIS_OFF ) debris.group.visible = false;
const only = process.env.VIEWS ? process.env.VIEWS.split( ',' ) : Object.keys( views );
for ( const k of only ) await H.shot( OUT + k + '.png', views[ k ], 4 );

H.setView( views.beach );
const t = await H.timeMain( 10 );
console.log( 'main pass (beach view): min', t.min.toFixed( 2 ), 'ms, median', t.median.toFixed( 2 ), 'ms' );
await done();
