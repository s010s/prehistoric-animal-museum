import { BufferGeometry, Color, Euler, Group, Mesh, Vector3 } from '../engine/index.js';
import { mulberry32 } from '../util/Noise.js';
import { Builder, Batch } from './village/GeoBuilder.js';
import { createVillageMaterials } from './village/VillageMaterials.js';
import { VillageTextures } from './village/TextureBaker.js';
import { buildHouse, buildBoathouse, buildMarketStall, buildShed } from './village/Buildings.js';
import { buildBoardwalk } from './village/Boardwalk.js';
import { buildPier, PIER } from './Pier.js';
import { G } from '../engine/render/Frame.js';
import {
	InstancedProps, Rand, lin, C, WOOD, rowboat, netRack, fishRack, fence, laundryLine, oar, buoy,
	bench, ropeCoil, pathLight, lampPost, bucket, wreck,
} from './Props.js';

// Tropical fishing village: timber pier with a T-head, stilt fishing huts on the beach,
// a boathouse, a boardwalk up to a small market plaza and a dozen painted cottages on
// the slope, dressed with nets, traps, barrels, crates, boats and lanterns.
//
// All static geometry (including repeated props) is merged per material: 6 draw calls
// (wood + glass, hard + rope, roof metal, thatch, stone, fabric). The opaque materials
// share one vertex / index buffer; the wood mesh is the only shadow caster and covers all
// opaque geometry in the shadow passes (see _assemble). Surface detail comes from GPU-baked
// PBR texture sets (village/TextureBaker.js, 43 MB) sampled with metre-scale uvs.

const PASTELS = {
	turquoise: lin( 0x5dbcb0 ),
	coral: lin( 0xec8b76 ),
	cream: lin( 0xefe2c2 ),
	sky: lin( 0x8cc2e0 ),
	yellow: lin( 0xf0cf7c ),
	mint: lin( 0xa9dcbf ),
	pink: lin( 0xf2b3aa ),
	white: lin( 0xf1ede2 ),
	lavender: lin( 0xbdb3da ),
	sea: lin( 0x6aa6b8 ),
};

const TRIMS = {
	white: lin( 0xf3efe6 ),
	cream: lin( 0xe9dfc6 ),
	navy: lin( 0x2e4f73 ),
	teal: lin( 0x2d7f7a ),
	red: lin( 0xa8463a ),
	green: lin( 0x4c7d4c ),
	yellow: lin( 0xe0b545 ),
	blue: lin( 0x3f79ae ),
};

const ROOFS = {
	red: lin( 0xa64a35 ),
	green: lin( 0x5f8a6a ),
	blue: lin( 0x4f7898 ),
	teal: lin( 0x3f8a86 ),
	rust: lin( 0x8a5a40 ),
	grey: lin( 0x8c9296 ),
};

const CURTAINS = [ lin( 0xe8d6b0 ), lin( 0xd98c7a ), lin( 0x9cc0d8 ), lin( 0xf0e8d8 ), lin( 0xc9d89a ) ];

const _lanternEuler = new Euler();

export class Village {

	constructor( { scene, terrain, colliders } ) {

		this.scene = scene;
		this.terrain = terrain;
		this.colliders = colliders;
		this.lights = [];
		this.footprints = [];
		this.foundationChecks = [];
		this.buildings = [];
		this.group = new Group();
		this.group.name = 'Village';

		const rand = new Rand( mulberry32( 90210 ) );
		this.rand = rand;
		// tileable PBR texture sets, baked on the GPU the first time a village material renders
		this.textures = new VillageTextures();
		this.materials = createVillageMaterials( this.textures );
		// one builder: everything static merges into a single mesh per material
		this.B = new Builder();
		this.harbor = this.B;
		this.town = this.B;
		this.inst = new InstancedProps( this.B );

		const specs = this._layout( rand );
		this._flattenPads( specs );

		const ctx = ( B ) => ( { B, terrain, colliders, rand, lights: this.lights, inst: this.inst, checks: this.foundationChecks } );

		// the fish sign at the pier entrance is its own small mesh: it swings in the wind (update())
		this.signB = new Builder();
		this.pierInfo = buildPier( { B: this.harbor, terrain, colliders, rand, lights: this.lights, inst: this.inst, signB: this.signB, hang: () => new Builder() } );

		// boardwalk from the foot of the pier steps up to the plaza
		const foot = this.pierInfo.stepFoot;
		this.path = buildBoardwalk( ctx( this.harbor ), [
			[ foot.x, foot.z + 0.05 ], [ 54.6, - 72 ], [ 52.4, - 82 ], [ 48.4, - 92 ], [ 44.8, - 100.5 ], [ 42.6, - 107.2 ],
		], { width: 1.8, startY: foot.y + 0.24, lightEvery: 70 } );
		this._plaza( ctx( this.town ) );

		for ( const s of specs.houses ) {

			const B = s.harbor ? this.harbor : this.town;
			const res = buildHouse( ctx( B ), s );
			this.buildings.push( { name: s.name, x: s.x, z: s.z, floorY: res.floorY, roofTop: res.roofTop, stilts: s.foundation === 'stilts', footprint: res.footprint } );
			this.footprints.push( res.footprint );

		}

		for ( const s of specs.sheds ) {

			const res = buildShed( ctx( this.town ), s );
			this.buildings.push( { name: s.name, x: s.x, z: s.z, floorY: res.floorY, roofTop: res.roofTop, stilts: false, footprint: res.footprint } );
			this.footprints.push( res.footprint );

		}

		// plank side paths from the plaza / main boardwalk to the nearest houses
		this.sidePaths = [
			buildBoardwalk( ctx( this.town ), [ [ 36.8, - 110.6 ], [ 32.0, - 109.3 ], [ 27.4, - 107.6 ] ], { width: 1.1, lift: 0.2, lightEvery: 1e9 } ),
			buildBoardwalk( ctx( this.town ), [ [ 46.8, - 97.8 ], [ 53.5, - 98.5 ], [ 61.7, - 99.1 ] ], { width: 1.1, lift: 0.2, lightEvery: 1e9 } ),
		];

		this.footprints.push( buildBoathouse( ctx( this.harbor ), specs.boathouse ).footprint );
		this.footprints.push( buildMarketStall( ctx( this.town ), specs.stall ).footprint );

		this._beachProps( ctx( this.harbor ) );
		this._villageProps( ctx( this.town ) );

		this._assemble();
		this._buildSign();
		this._buildLanterns();
		scene.add( this.group );

	}

	// ------------------------------------------------------------------ layout

	_layout( rand ) {

		const P = PASTELS, T = TRIMS, R = ROOFS;
		const curtain = () => rand.pick( CURTAINS );
		const houses = [
			// front row (just above the beach)
			{ name: 'A', x: 13.5, z: - 106.5, yaw: 0.12, w: 6.2, d: 5.0, roof: 'gable', roofMat: 'metal', roofColor: R.red, wall: P.turquoise, trim: T.white, accent: T.navy, siding: 1, porch: { depth: 2.1, rail: 'balusters' }, paint: 0.62, stovepipe: true, buoys: - 1, porchPaint: lin( 0x8a9aa0 ) },
			{ name: 'B', x: 26.5, z: - 112.0, yaw: - 0.08, w: 5.2, d: 4.5, roof: 'hip', roofMat: 'thatch', wall: P.coral, trim: T.cream, accent: T.teal, siding: 2, shutters: 'bahama', paint: 0.55, thatchAge: 0.35, annex: { w: 3.0, d: 2.0, wall: lin( 0xefe2c2 ) } },
			{ name: 'C', x: 62.5, z: - 106.0, yaw: - 0.1, w: 7.0, d: 5.8, stories: 2, roof: 'gableFront', roofMat: 'metal', galv: true, rust: 0.55, wall: P.cream, trim: T.white, accent: T.blue, siding: 1, porch: { depth: 2.2, rail: 'x' }, paint: 0.7, antenna: true, tank: 1, doorGlass: true },
			{ name: 'D', x: 79.0, z: - 110.5, yaw: - 0.18, w: 6.0, d: 5.0, roof: 'gable', roofMat: 'metal', roofColor: R.green, wall: P.sky, trim: T.white, accent: T.yellow, siding: 2, porch: { depth: 1.9, width: 4.4, offset: - 0.6, rail: 'balusters' }, doorX: - 0.6, paint: 0.66, gutter: true, woodpile: 1 },
			{ name: 'E', x: 96.0, z: - 115.5, yaw: - 0.3, w: 5.4, d: 4.6, roof: 'hip', roofMat: 'metal', roofColor: R.teal, wall: P.yellow, trim: T.white, accent: T.green, siding: 1, shutters: 'louver', paint: 0.58, buoys: 1, annex: { w: 3.2, d: 2.0 } },
			// middle row
			{ name: 'F', x: - 3.0, z: - 125.0, yaw: 0.22, w: 5.6, d: 5.0, roof: 'gableFront', roofMat: 'thatch', wall: P.mint, trim: T.white, accent: T.red, siding: 2, porch: { depth: 1.9, rail: 'x' }, paint: 0.5, thatchAge: 0.55, shutters: 'board' },
			{ name: 'G', x: 16.5, z: - 130.0, yaw: 0.1, w: 6.6, d: 5.6, stories: 2, roof: 'gable', roofMat: 'metal', roofColor: R.blue, wall: P.pink, trim: T.white, accent: T.teal, siding: 1, porch: { depth: 2.2, rail: 'balusters' }, paint: 0.72, chimney: - 1, doorGlass: true },
			{ name: 'H', x: 57.5, z: - 128.5, yaw: - 0.05, w: 6.0, d: 5.2, roof: 'gableFront', roofMat: 'thatch', wall: P.turquoise, trim: T.cream, accent: T.yellow, siding: 2, porch: { depth: 2.0, rail: 'x' }, paint: 0.55, thatchAge: 0.3, shutters: 'board', woodpile: - 1, annex: { w: 3.4, d: 2.2, x: 0.6, wall: lin( 0x8cc2e0 ) } },
			{ name: 'I', x: 75.5, z: - 132.5, yaw: - 0.2, w: 5.4, d: 4.6, roof: 'gable', roofMat: 'metal', roofColor: R.red, rust: 0.6, wall: P.cream, trim: T.red, accent: T.red, siding: 1, paint: 0.6, tank: - 1, stovepipe: true },
			{ name: 'J', x: 96.5, z: - 135.0, yaw: - 0.32, w: 6.2, d: 5.0, roof: 'hip', roofMat: 'metal', roofColor: R.grey, galv: true, rust: 0.7, wall: P.sky, trim: T.white, accent: T.navy, siding: 2, porch: { depth: 1.9, rail: 'balusters' }, paint: 0.6, annex: { w: 3.6, d: 2.0, x: - 0.8 } },
			// back row (plateau)
			{ name: 'K', x: 3.5, z: - 151.0, yaw: 0.18, w: 6.0, d: 5.2, roof: 'gable', roofMat: 'metal', roofColor: R.green, wall: P.yellow, trim: T.white, accent: T.blue, siding: 1, porch: { depth: 2.0, rail: 'x' }, paint: 0.64, gutter: true },
			{ name: 'L', x: 30.5, z: - 149.0, yaw: 0.04, w: 7.4, d: 5.6, stories: 2, roof: 'hip', roofMat: 'metal', roofColor: R.red, wall: P.white, trim: T.white, accent: T.green, siding: 1, porch: { depth: 2.3, rail: 'balusters' }, paint: 0.78, antenna: true, chimney: 1, doorGlass: true },
			{ name: 'M', x: 55.0, z: - 152.5, yaw: - 0.06, w: 5.2, d: 4.8, roof: 'gableFront', roofMat: 'thatch', wall: P.coral, trim: T.white, accent: T.teal, siding: 1, paint: 0.52, thatchAge: 0.45, shutters: 'bahama', annex: { w: 3.0, d: 1.8 } },
			{ name: 'N', x: 78.5, z: - 156.0, yaw: - 0.22, w: 6.0, d: 5.0, roof: 'gable', roofMat: 'metal', roofColor: R.teal, wall: P.lavender, trim: T.white, accent: T.navy, siding: 2, porch: { depth: 1.9, rail: 'balusters' }, paint: 0.62, tank: 1 },
		];

		// stilt fishing huts just above the beach, close to the pier foot (floor ~3 m)
		const huts = [
			{ name: 'S1', harbor: true, x: 67.8, z: - 64.6, yaw: 0.05, w: 4.0, d: 4.2, floorY: 3.0, foundation: 'stilts', roof: 'gableFront', roofMat: 'metal', roofColor: ROOFS.rust, rust: 0.8, wall: P.sea, trim: T.white, accent: T.red, siding: 2, paint: 0.52, weather: 0.85, porch: { depth: 1.6, rail: 'x' }, shutters: 'board', closedChance: 0.3, fewWindows: true, rimRaw: true, buoys: 1, porchBench: false, railNet: lin( 0x3f6f5f ) },
			{ name: 'S2', harbor: true, x: 79.8, z: - 70.4, yaw: - 0.12, w: 4.4, d: 4.0, floorY: 3.05, foundation: 'stilts', roof: 'gableFront', roofMat: 'thatch', thatchAge: 0.6, wall: P.coral, trim: T.cream, accent: T.teal, siding: 2, paint: 0.48, weather: 0.9, porch: { depth: 1.6, rail: 'x' }, shutters: 'board', closedChance: 0.25, fewWindows: true, rimRaw: true, porchBench: false, railNet: lin( 0x9a4a38 ) },
			{ name: 'S3', harbor: true, x: 37.2, z: - 72.4, yaw: 0.18, w: 4.0, d: 4.0, floorY: 3.15, foundation: 'stilts', roof: 'gable', roofMat: 'thatch', thatchAge: 0.5, wall: P.yellow, trim: T.white, accent: T.blue, siding: 2, paint: 0.5, weather: 0.85, porch: { depth: 1.6, rail: 'x' }, shutters: 'board', closedChance: 0.2, fewWindows: true, rimRaw: true, buoys: - 1, porchBench: false },
		];

		for ( const h of [ ...houses, ...huts ] ) {

			h.curtain = h.curtain || curtain();
			if ( h.foundation === undefined ) h.foundation = rand.chance( 0.5 ) ? 'stone' : 'posts';
			if ( h.foundation === 'stone' ) h.stoneStyle = rand.chance( 0.6 ) ? 1 : 0;

		}

		const sheds = [
			{ name: 'shed1', x: 21.5, z: - 119.5, yaw: 0.1, wall: lin( 0xb9c9b0 ), door: TRIMS.red },
			{ name: 'shed2', x: 68.0, z: - 124.0, yaw: - 0.2, wall: lin( 0xd8b8a0 ), door: TRIMS.teal, galv: true },
			{ name: 'shed3', x: 89.0, z: - 146.0, yaw: - 0.3, wall: lin( 0xa8c4d4 ), door: TRIMS.yellow },
			{ name: 'shed4', x: 43.5, z: - 155.5, yaw: 0.0, wall: lin( 0xe8d8a8 ), door: TRIMS.blue },
		];

		return {
			houses: [ ...houses, ...huts ],
			sheds,
			boathouse: { x: 92.5, z: - 57.5, yaw: - 0.08, wall: lin( 0x8fb3a8 ), paint: 0.58 },
			stall: { x: 40.2, z: - 113.2, yaw: 0.05 },
		};

	}

	// carve gentle building pads into the heightmap (must happen before anything reads heights)
	_flattenPads( specs ) {

		const t = this.terrain;
		if ( typeof t.flatten !== 'function' ) return;
		for ( const s of specs.houses ) {

			if ( s.foundation === 'stilts' ) continue;
			const pd = s.porch ? s.porch.depth : 1.0;
			const cy = Math.cos( s.yaw ), sy = Math.sin( s.yaw );
			const cz = pd / 2;
			const cx = s.x + cz * sy, czw = s.z + cz * cy;
			let sum = 0, n = 0;
			for ( let i = - 2; i <= 2; i ++ ) for ( let j = - 2; j <= 2; j ++ ) {

				sum += t.heightAt( cx + i * s.w / 5, czw + j * ( s.d + pd ) / 5 );
				n ++;

			}

			const r = Math.hypot( s.w, s.d + pd ) / 2 + 0.3;
			t.flatten( cx, czw, r, sum / n, 3.5 );

		}

		// market plaza
		{

			const px = 41.5, pz = - 111.0;
			let sum = 0, n = 0;
			for ( let i = - 2; i <= 2; i ++ ) for ( let j = - 2; j <= 2; j ++ ) {

				sum += t.heightAt( px + i, pz + j );
				n ++;

			}

			t.flatten( px, pz, 5.5, sum / n, 4 );

		}

		if ( typeof t.buildMinMax === 'function' ) t.buildMinMax();

	}

	// ------------------------------------------------------------------ plaza

	_plaza( ctx ) {

		const { B, terrain, colliders, rand, lights } = ctx;
		// benches, a lamp and some barrels around the market stall
		const g = ( x, z ) => terrain.heightAt( x, z );
		bench( B, 36.2, g( 36.2, - 108.2 ), - 108.2, 0.9, 1.6, rand.next(), lin( 0x4f8fa0 ) );
		colliders.addBox( new Vector3( 36.2, g( 36.2, - 108.2 ) + 0.45, - 108.2 ), new Vector3( 0.85, 0.45, 0.3 ), 0.9, { tag: 'bench' } );
		bench( B, 45.8, g( 45.8, - 108.6 ), - 108.6, - 0.85, 1.6, rand.next(), lin( 0xb05a45 ) );
		colliders.addBox( new Vector3( 45.8, g( 45.8, - 108.6 ) + 0.45, - 108.6 ), new Vector3( 0.85, 0.45, 0.3 ), - 0.85, { tag: 'bench' } );
		const lw = lampPost( B, 44.3, g( 44.3, - 106.2 ), - 106.2, - 2.4, 3.3, rand.next() );
		lights.push( { position: lw, color: new Color( 1.0, 0.72, 0.42 ), intensity: 5, kind: 'lantern' } );
		colliders.addCylinder( 44.3, - 106.2, 0.1, g( 44.3, - 106.2 ), g( 44.3, - 106.2 ) + 3.4, { tag: 'lampPost' } );
		this.foundationChecks.push( { x: 44.3, y: g( 44.3, - 106.2 ), z: - 106.2 } );
		for ( const [ x, z ] of [ [ 37.4, - 115.6 ], [ 38.1, - 116.1 ] ] ) {

			this.inst.add( 'barrel', x, g( x, z ) - 0.02, z, rand.range( 0, 6 ), [ rand.range( 0.85, 1.05 ), 0.92, 0.85 ] );
			colliders.addCylinder( x, z, 0.32, g( x, z ), g( x, z ) + 0.9, { tag: 'barrel' } );

		}

		this.footprints.push( { x: 41.5, z: - 111, r: 6, kind: 'plaza' } );

	}

	// ------------------------------------------------------------------ beach props

	_beachProps( ctx ) {

		const { B, terrain, colliders, rand } = ctx;
		const g = ( x, z ) => terrain.heightAt( x, z );
		const box = ( x, y, z, hx, hy, hz, ry, tag ) => colliders.addBox( new Vector3( x, y, z ), new Vector3( hx, hy, hz ), ry, { tag } );

		// rowboats pulled up on the sand: two upturned ones down the beach west of Joe's fish stand (kept
		// clear of it), one by the pier foot
		const BX = - 26; // the upturned pair and their oars, relative to where they first stood by the stand
		const boats = [
			{ x: 46.8 + BX, z: - 57.2, ry: 0.35, up: true, hull: lin( 0x2f8f9a ), bottom: lin( 0xa0402e ) },
			{ x: 43.9 + BX, z: - 59.8, ry: 0.55, up: true, hull: lin( 0xe9e4d6 ), bottom: lin( 0x2e5f86 ) },
			{ x: 63.5, z: - 55.6, ry: - 0.35, up: false, hull: lin( 0xd8c35a ), bottom: lin( 0x3e6f5a ), rz: 0.14 },
		];
		for ( const b of boats ) {

			const gy = g( b.x, b.z );
			rowboat( B, b.x, gy + ( b.up ? 0.0 : 0.05 ), b.z, b.ry, { upsideDown: b.up, seed: rand.next(), hull: b.hull, bottom: b.bottom, trim: C.white, rz: b.rz || 0 } );
			box( b.x, gy + 0.4, b.z, 0.72, 0.45, 2.0, b.ry, 'rowboat' );
			this.footprints.push( { x: b.x, z: b.z, r: 2.4, kind: 'prop' } );

		}

		// one more boat pulled up next to the boathouse, and an old wreck by the waterline
		{

			const bx = 84.6, bz = - 53.2, gy = g( bx, bz );
			rowboat( B, bx, gy + 0.03, bz, 0.45, { seed: rand.next(), hull: lin( 0xd0e4ea ), bottom: lin( 0xb04a30 ), trim: lin( 0x2f5f7a ), rz: - 0.16, oars: false } );
			box( bx, gy + 0.4, bz, 0.72, 0.45, 2.0, 0.45, 'rowboat' );
			this.footprints.push( { x: bx, z: bz, r: 2.4, kind: 'prop' } );
			const wx = 102.5, wz = - 49.8;
			wreck( B, wx, g( wx, wz ) - 0.12, wz, 0.95, rand, { rz: 0.22, beam: 3.1, depth: 1.05 } );
			box( wx, g( wx, wz ) + 0.4, wz, 1.3, 0.6, 3.6, 0.95, 'wreck' );
			this.footprints.push( { x: wx, z: wz, r: 4, kind: 'prop' } );

		}

		// oars leaning against the first upturned boat, oars on the sand
		oar( B, [ 48.1 + BX, g( 48.1 + BX, - 55.7 ) + 0.03, - 55.7 ], [ 49.6 + BX, g( 49.6 + BX, - 57.9 ) + 0.05, - 57.9 ], rand.next(), lin( 0xc23b2e ) );
		oar( B, [ 48.4 + BX, g( 48.4 + BX, - 55.4 ) + 0.03, - 55.4 ], [ 49.9 + BX, g( 49.9 + BX, - 57.6 ) + 0.06, - 57.6 ], rand.next(), lin( 0xc23b2e ) );

		// net drying racks
		const racks = [ [ 41.8, - 64.2, 0.25, lin( 0x3f6f5f ) ], [ 74.6, - 58.6, - 0.12, lin( 0x2f5f8a ) ], [ 86.4, - 64.0, 0.3, lin( 0xb0553a ) ] ];
		for ( const [ x, z, ry, tint ] of racks ) {

			const cy = Math.cos( ry ), sy = Math.sin( ry );
			netRack( B, x, g( x, z ), z, ry, 3.2, tint, rand.next(), ( lx, lz ) => g( x + lx * cy + lz * sy, z - lx * sy + lz * cy ) );
			for ( const sx of [ - 1.6, 1.6 ] ) {

				const px = x + sx * cy, pz = z - sx * sy;
				colliders.addCylinder( px, pz, 0.1, g( px, pz ) - 0.4, g( px, pz ) + 2.0, { tag: 'rack' } );
				this.foundationChecks.push( { x: px, y: g( px, pz ) - 0.4, z: pz } );

			}

			this.footprints.push( { x, z, r: 2.2, kind: 'prop' } );

		}

		// fish drying rack between the huts
		fishRack( B, 73.8, g( 73.8, - 69.5 ), - 69.5, 0.2, 2.6, rand.next(), rand );
		box( 73.8, g( 73.8, - 69.5 ) + 1.0, - 69.5, 1.45, 1.0, 0.75, 0.2, 'rack' );
		this.foundationChecks.push( { x: 73.8, y: g( 73.8, - 69.5 ) - 0.2, z: - 69.5 } );

		// crates, traps and barrels around the pier foot and the huts
		const X = PIER.x;
		const cluster = ( items ) => {

			for ( const [ type, x, z, ry, stack ] of items ) {

				const gy = g( x, z );
				const y = gy + ( stack ? stack : 0 ) - 0.02;
				const tone = [ rand.range( 0.82, 1.08 ), rand.range( 0.84, 1.02 ), rand.range( 0.8, 0.98 ) ];
				this.inst.add( type, x, y, z, ry, tone );
				if ( ! stack ) {

					if ( type === 'barrel' ) colliders.addCylinder( x, z, 0.32, gy, gy + 0.9, { tag: 'barrel' } );
					else box( x, gy + 0.25, z, type === 'trap' ? 0.48 : 0.33, 0.3, type === 'trap' ? 0.28 : 0.24, ry, type );

				}

			}

		};

		cluster( [
			[ 'barrel', X + 2.4, - 62.4, 0.4 ], [ 'barrel', X + 3.05, - 62.9, 1.9 ], [ 'crate', X + 2.6, - 61.2, 0.1 ],
			[ 'crate', X + 2.65, - 61.25, 0.4, 0.4 ], [ 'trap', X - 2.6, - 61.0, 0.05 ], [ 'trap', X - 2.65, - 61.6, 0.08 ], [ 'trap', X - 2.6, - 61.3, 0.2, 0.31 ],
			[ 'crate', X - 3.4, - 62.4, 0.6 ],
			[ 'trap', 64.5, - 61.6, 0.3 ], [ 'trap', 65.3, - 61.2, 0.15 ], [ 'trap', 64.9, - 61.4, 0.5, 0.31 ], [ 'trap', 64.6, - 61.5, 1.9, 0.62 ],
			[ 'barrel', 71.3, - 62.3, 0.1 ], [ 'crate', 71.1, - 61.2, 0.3 ], [ 'crate', 71.9, - 61.4, 1.3 ],
			[ 'trap', 83.2, - 67.4, 0.4 ], [ 'trap', 83.9, - 67.9, 0.2 ], [ 'barrel', 82.6, - 68.9, 0.7 ],
			[ 'crate', 88.0, - 53.0, 0.2 ], [ 'crate', 88.1, - 53.0, 0.6, 0.4 ], [ 'barrel', 89.0, - 52.2, 0.3 ],
			[ 'trap', 34.6, - 68.6, 0.3 ], [ 'trap', 35.3, - 68.2, 0.1 ], [ 'crate', 39.6, - 68.9, 0.5 ],
		] );

		// loose buoys and rope coils on the sand
		const pal = [ [ C.orange, C.white ], [ C.red, C.white ], [ C.yellow, C.black ], [ C.white, C.blue ] ];
		for ( const [ x, z ] of [ [ 60.8, - 60.3 ], [ 61.3, - 60.9 ], [ 66.2, - 58.4 ], [ 89.6, - 51.2 ], [ 45.2, - 62.3 ] ] ) {

			const [ a, b ] = rand.pick( pal );
			buoy( B, x, g( x, z ) - 0.02, z, a, b, rand.chance( 0.5 ) ? 0 : 2, rand.next(), { rz: 1.4, ry: rand.range( 0, 6 ) } );

		}

		ropeCoil( B, 59.6, g( 59.6, - 59.2 ), - 59.2, 0.08, 0.34, 5, rand.next() );
		ropeCoil( B, 90.4, g( 90.4, - 52.4 ), - 52.4, 0.08, 0.28, 4, rand.next(), C.ropeBlue );

		// a buoy string on posts between the huts and the fence-like line of old posts
		for ( let i = 0; i < 5; i ++ ) {

			const x = 57.8 + i * 1.6, z = - 67.8 - i * 0.25;
			B.cyl( 'wood', x, g( x, z ) - 0.4, z, 0.06, 0.07, 1.65, { segs: 6, data: WOOD( rand.next(), 0.95 ) } );
			colliders.addCylinder( x, z, 0.08, g( x, z ) - 0.4, g( x, z ) + 1.25, { tag: 'post' } );
			this.foundationChecks.push( { x, y: g( x, z ) - 0.4, z } );
			if ( i > 0 ) {

				const px = 57.8 + ( i - 1 ) * 1.6, pz = - 67.8 - ( i - 1 ) * 0.25;
				B.tube( 'rope', [ new Vector3( px, g( px, pz ) + 1.15, pz ), new Vector3( ( px + x ) / 2, ( g( px, pz ) + g( x, z ) ) / 2 + 0.95, ( pz + z ) / 2 ), new Vector3( x, g( x, z ) + 1.15, z ) ], 0.014, { radial: 4, tint: C.rope, data: [ rand.next(), 0, 0, 0 ] } );

			}

		}

	}

	// ------------------------------------------------------------------ village props

	_villageProps( ctx ) {

		const { B, terrain, colliders, rand, lights } = ctx;
		const g = ( x, z ) => terrain.heightAt( x, z );

		// picket fence around house A's side yard and a rail fence near G
		const fenceAt = ( pts, style, tint ) => {

			fence( B, pts, g, style, tint, rand.next(), colliders, ( x, z ) => new Vector3( x, 0, z ) );
			for ( const [ x, z ] of pts ) this.foundationChecks.push( { x, y: g( x, z ) - 0.13, z } );

		};

		fenceAt( [ [ 5.2, - 101.5 ], [ 5.6, - 108.5 ], [ 9.0, - 111.2 ] ], 'picket', TRIMS.white );
		fenceAt( [ [ 21.5, - 124.0 ], [ 23.6, - 131.5 ], [ 22.8, - 135.5 ] ], 'rail' );
		fenceAt( [ [ 70.0, - 102.5 ], [ 72.5, - 106.0 ] ], 'picket', TRIMS.cream );
		fenceAt( [ [ 86.5, - 150.0 ], [ 87.8, - 158.5 ] ], 'rail' );

		// laundry lines
		const cloth = [ lin( 0xf2f0ea ), lin( 0xd9534a ), lin( 0x4f8fc0 ), lin( 0xf0c850 ), lin( 0x7fbf9f ), lin( 0xe89ab0 ) ];
		const pole = ( x, z ) => {

			B.cyl( 'wood', x, g( x, z ) - 0.3, z, 0.04, 0.05, 2.5, { segs: 6, data: WOOD( rand.next(), 0.9 ) } );
			colliders.addCylinder( x, z, 0.06, g( x, z ) - 0.3, g( x, z ) + 2.2, { tag: 'pole' } );
			this.foundationChecks.push( { x, y: g( x, z ) - 0.3, z } );
			return [ x, g( x, z ) + 2.1, z ];

		};

		laundryLine( B, pole( 7.8, - 112.8 ), pole( 12.6, - 114.6 ), rand, cloth );
		laundryLine( B, pole( 21.0, - 136.8 ), pole( 25.2, - 137.6 ), rand, cloth );
		laundryLine( B, pole( 83.2, - 138.2 ), pole( 87.4, - 140.0 ), rand, cloth );

		// fish drying rack and scattered gear in the village
		fishRack( B, 67.0, g( 67.0, - 118.5 ), - 118.5, - 0.25, 2.4, rand.next(), rand );
		colliders.addBox( new Vector3( 67.0, g( 67.0, - 118.5 ) + 1.0, - 118.5 ), new Vector3( 1.35, 1.0, 0.75 ), - 0.25, { tag: 'rack' } );
		this.foundationChecks.push( { x: 67.0, y: g( 67.0, - 118.5 ) - 0.2, z: - 118.5 } );
		netRack( B, 5.5, g( 5.5, - 136.5 ), - 136.5, 0.35, 3.0, lin( 0x6a5a8a ), rand.next(), ( lx, lz ) => g( 5.5 + lx * Math.cos( 0.35 ) + lz * Math.sin( 0.35 ), - 136.5 - lx * Math.sin( 0.35 ) + lz * Math.cos( 0.35 ) ) );
		for ( const sx of [ - 1.5, 1.5 ] ) {

			const px = 5.5 + sx * Math.cos( 0.35 ), pz = - 136.5 - sx * Math.sin( 0.35 );
			colliders.addCylinder( px, pz, 0.1, g( px, pz ) - 0.4, g( px, pz ) + 2.0, { tag: 'rack' } );
			this.foundationChecks.push( { x: px, y: g( px, pz ) - 0.4, z: pz } );

		}

		const clutter = [
			[ 'barrel', 20.4, - 105.2, 0.3 ], [ 'crate', 21.2, - 104.6, 0.8 ], [ 'crate', 21.25, - 104.65, 1.1, 0.4 ],
			[ 'trap', 69.2, - 110.8, 0.2 ], [ 'trap', 69.3, - 111.4, 0.1 ], [ 'trap', 69.25, - 111.1, 0.3, 0.31 ],
			[ 'barrel', 86.6, - 118.8, 0.2 ], [ 'crate', 85.9, - 119.6, 0.4 ],
			[ 'crate', 64.6, - 134.2, 0.3 ], [ 'barrel', 63.9, - 133.4, 1.0 ],
			[ 'trap', 47.9, - 150.2, 0.6 ], [ 'trap', 48.2, - 150.8, 0.4 ],
			[ 'barrel', 25.4, - 157.4, 0.5 ], [ 'barrel', 26.1, - 157.8, 1.5 ],
			[ 'crate', 9.8, - 145.4, 0.2 ], [ 'crate', 91.6, - 128.5, 0.9 ],
		];
		for ( const [ type, x, z, ry, stack ] of clutter ) {

			const gy = g( x, z );
			this.inst.add( type, x, gy + ( stack || 0 ) - 0.02, z, ry, [ rand.range( 0.82, 1.08 ), rand.range( 0.84, 1.02 ), rand.range( 0.8, 0.98 ) ] );
			if ( ! stack ) {

				if ( type === 'barrel' ) colliders.addCylinder( x, z, 0.32, gy, gy + 0.9, { tag: 'barrel' } );
				else colliders.addBox( new Vector3( x, gy + 0.25, z ), new Vector3( type === 'trap' ? 0.48 : 0.33, 0.3, type === 'trap' ? 0.28 : 0.24 ), ry, { tag: type } );

			}

		}

		// upturned rowboat on trestles in a yard + a bucket
		rowboat( B, 88.2, g( 88.2, - 124.5 ) + 0.55, - 124.5, 1.2, { upsideDown: true, seed: rand.next(), hull: lin( 0xc9463a ), bottom: lin( 0x2d2d2d ), trim: C.white } );
		for ( const o of [ - 1.2, 1.2 ] ) {

			const px = 88.2 + o * Math.sin( 1.2 ), pz = - 124.5 + o * Math.cos( 1.2 );
			B.box( 'wood', px, g( px, pz ) + 0.26, pz, 1.1, 0.07, 0.09, { grain: 0, ry: 1.2 + Math.PI / 2, data: WOOD( rand.next(), 0.85 ) } );
			for ( const s of [ - 0.4, 0.4 ] ) {

				const lx = px + s * Math.cos( 1.2 + Math.PI / 2 ), lz = pz - s * Math.sin( 1.2 + Math.PI / 2 );
				B.box( 'wood', lx, g( lx, lz ) + 0.08, lz, 0.07, 0.5, 0.07, { grain: 1, data: WOOD( rand.next(), 0.85 ) } );

			}

		}

		colliders.addBox( new Vector3( 88.2, g( 88.2, - 124.5 ) + 0.6, - 124.5 ), new Vector3( 0.75, 0.6, 2.0 ), 1.2, { tag: 'rowboat' } );
		this.foundationChecks.push( { x: 88.2, y: g( 88.2, - 124.5 ) - 0.17, z: - 124.5 } );
		bucket( B, 86.9, g( 86.9, - 122.6 ), - 122.6, C.blue, rand.next() );

		// a couple of extra path lights toward the upper houses
		for ( const [ x, z ] of [ [ 33.5, - 125.5 ], [ 48.0, - 130.5 ], [ 42.0, - 142.0 ] ] ) {

			const w = pathLight( B, x, g( x, z ) - 0.25, z, rand.next() );
			lights.push( { position: w, color: new Color( 1.0, 0.7, 0.4 ), intensity: 2.5, kind: 'pathLight' } );
			colliders.addCylinder( x, z, 0.1, g( x, z ) - 0.25, g( x, z ) + 0.95, { tag: 'pathLight' } );
			this.foundationChecks.push( { x, y: g( x, z ) - 0.25, z } );

		}

	}

	// ------------------------------------------------------------------ meshes

	_assemble() {

		const B = this.B;
		const mats = this.materials;
		const take = ( key ) => {

			const b = B.batches[ key ];
			delete B.batches[ key ];
			return b;

		};

		// fold small emitter keys into bigger materials (fewer draw calls):
		//   glass -> wood (pattern 9), rope -> hard (vdata.w = 2 + radius), cloth / net / flag -> fabric
		const wood = B.batch( 'wood' ), hard = B.batch( 'hard' ), fabric = B.batch( 'fabric' );
		const glass = take( 'glass' ), rope = take( 'rope' ), cloth = take( 'cloth' ), net = take( 'net' ), flag = take( 'flag' );
		if ( glass ) wood.append( glass, ( d ) => [ d[ 0 ], d[ 1 ], 9, d[ 2 ] ] );
		if ( rope ) hard.append( rope, ( d ) => [ d[ 0 ], 0, 0, 2 + d[ 1 ] ] );
		if ( cloth ) fabric.append( cloth, ( d ) => [ d[ 0 ], d[ 1 ], 0, 0 ] );
		// nets get their own blended material (see createNetMaterial)
		const nets = new Batch();
		if ( net ) nets.append( net, ( d ) => [ d[ 0 ], d[ 1 ], Math.max( 0.02, d[ 2 ] ), 0 ] );
		if ( flag ) fabric.append( flag, ( d ) => [ d[ 0 ], d[ 1 ], d[ 2 ] + 10000, d[ 3 ] ] );

		// All opaque geometry lives in ONE set of vertex / index buffers. Each opaque material
		// draws its own index range; the wood mesh is the only shadow caster and widens its
		// range to cover everything during the shadow passes (1 shadow draw per cascade).
		const opaque = new Batch();
		const ranges = {};
		for ( const key of [ 'wood', 'hard', 'roofMetal', 'thatch', 'stone' ] ) {

			const b = B.batches[ key ];
			if ( ! b || b.vcount === 0 ) continue;
			const start = opaque.idx.length;
			opaque.append( b );
			ranges[ key ] = { start, count: opaque.idx.length - start };

		}

		const shared = opaque.build();
		const total = shared.index.count;
		this.meshes = [];
		for ( const key in ranges ) {

			const geo = new BufferGeometry();
			for ( const name in shared.attributes ) geo.setAttribute( name, shared.attributes[ name ] );
			geo.setIndex( shared.index );
			geo.boundingBox = shared.boundingBox;
			geo.boundingSphere = shared.boundingSphere;
			const r = ranges[ key ];
			geo.setDrawRange( r.start, r.count );
			const mesh = new Mesh( geo, mats[ key ] );
			mesh.name = 'village_' + key;
			mesh.receiveShadow = true;
			mesh.castShadow = key === 'wood';
			if ( key === 'wood' ) {

				// the engine has no onBeforeShadow / onAfterShadow: onBeforeRender runs per pass
				// (before the draw list is built) with that pass's camera; the sun shadow cascade
				// cameras (render/Shadows.js) are flagged isShadowCamera (and use standard depth)
				const range = geo.drawRange;
				mesh.onBeforeRender = ( renderer, scene, camera ) => {

					this.textures.bake();
					const shadow = !! camera && ( camera.isShadowCamera === true || camera.reversedDepth === false );
					range.start = shadow ? 0 : r.start;
					range.count = shadow ? total : r.count;

				};

			}

			this.meshes.push( mesh );

		}

		this.shadowTriangles = total / 3;

		if ( fabric.vcount > 0 ) {

			const mesh = new Mesh( fabric.build(), mats.fabric );
			mesh.name = 'village_fabric';
			mesh.receiveShadow = true;
			mesh.castShadow = false;
			this.meshes.push( mesh );

		}

		if ( nets.vcount > 0 ) {

			const mesh = new Mesh( nets.build(), mats.net );
			mesh.name = 'village_nets';
			mesh.receiveShadow = true;
			mesh.castShadow = false;
			this.meshes.push( mesh );

		}

		// fish, lobsters, ice and banana leaves (market stall, drying racks, cleaning tables): one
		// instanced mesh with the fish material (fish/FishProps.js)
		if ( B.fishProps ) this.group.add( B.fishProps.build() );

		// the texture bake is recorded by whichever village mesh is drawn first in a frame
		// (the TSL version's VillageBakeNode.updateBefore); bake() is a no-op afterwards
		const bake = () => this.textures.bake();
		for ( const mesh of this.meshes ) if ( ! mesh.onBeforeRender ) mesh.onBeforeRender = bake;

		for ( const mesh of this.meshes ) {

			// never culled: all pipelines compile during the app's loading-screen precompile and
			// the texture bake runs on the first frame
			mesh.frustumCulled = false;
			mesh.matrixAutoUpdate = false;
			mesh.updateMatrix();
			this.group.add( mesh );

		}

		// release the CPU-side builders
		this.B = this.harbor = this.town = null;
		this.inst = null;

	}

	// The painted fish sign hangs from the arch beam on two short chains: a pendulum about the
	// chain tops (info.signPivot), same materials as the rest of the village (no new pipelines).
	_buildSign() {

		const S = this.signB, pivot = this.pierInfo.signPivot;
		this.signB = null;
		if ( ! S || ! pivot ) return;
		this.sign = new Group();
		this.sign.name = 'village_sign';
		this.sign.position.copy( pivot );
		this.sign.rotation.order = 'YXZ';
		for ( const key of [ 'wood', 'hard' ] ) {

			const b = S.batches[ key ];
			if ( ! b || b.vcount === 0 ) continue;
			const geo = b.build();
			geo.translate( - pivot.x, - pivot.y, - pivot.z );
			const mesh = new Mesh( geo, this.materials[ key ] );
			mesh.name = 'village_sign_' + key;
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			this.sign.add( mesh );

		}

		this.group.add( this.sign );
		this._swing = { t: 0, a: 0, av: 0, b: 0, bv: 0 };

	}

	// The pier's lanterns hang from their lamp-post arms (and the arch beam) on short chains: small
	// pendulums about the top of the chain, pushed by the wind with gusts. Same materials as the rest
	// of the village (no new pipelines); the light positions follow the lanterns.
	_buildLanterns() {

		const hung = this.pierInfo.hung || [];
		this.lanterns = [];
		const mats = this.materials;
		for ( const h of hung ) {

			const S = h.B;
			h.B = null;
			const g = new Group();
			g.name = 'village_lantern';
			g.position.copy( h.pivot );
			const glass = S.batches.glass;
			delete S.batches.glass;
			if ( glass ) S.batch( 'wood' ).append( glass, ( d ) => [ d[ 0 ], d[ 1 ], 9, d[ 2 ] ] );
			for ( const key of [ 'wood', 'hard' ] ) {

				const b = S.batches[ key ];
				if ( ! b || b.vcount === 0 ) continue;
				const geo = b.build();
				geo.translate( - h.pivot.x, - h.pivot.y, - h.pivot.z );
				geo.computeBoundingSphere();
				const mesh = new Mesh( geo, mats[ key ] );
				mesh.name = 'village_lantern_' + key;
				mesh.castShadow = false;
				mesh.receiveShadow = true;
				g.add( mesh );

			}

			this.group.add( g );
			this.lanterns.push( { obj: g, pivot: h.pivot, rest: h.rest, live: h.live, t: Math.random() * 50, ph: Math.random() * 6.28, x: 0, z: 0, vx: 0, vz: 0 } );

		}

	}

	_updateLanterns( dt ) {

		if ( ! this.lanterns || ! this.lanterns.length ) return;
		const v = G.windSpeed.value, wx = G.windDir.value.x, wz = G.windDir.value.y;
		const n = Math.max( 1, Math.ceil( Math.min( dt, 0.1 ) / ( 1 / 120 ) ) ), h = Math.min( dt, 0.1 ) / n;
		const W = 5.4, Z = 0.05; // rad/s (0.34 m pendulum), damping ratio
		for ( const l of this.lanterns ) {

			for ( let i = 0; i < n; i ++ ) {

				const t = l.t += h, p = l.ph;
				const gust = 1 + 0.4 * Math.sin( t * 0.73 + p ) * Math.sin( t * 0.31 + p * 0.5 ) + 0.25 * Math.sin( t * 2.3 + Math.sin( t * 0.9 + p ) * 1.5 );
				// lean the wind holds (tan ~ drag / weight, ~3 degrees at 7 m/s) plus buffeting
				const px = 0.0011 * v * v * gust * wx + 0.0012 * v * Math.sin( t * 1.9 + p + Math.sin( t * 0.53 ) * 2 );
				const pz = 0.0011 * v * v * gust * wz + 0.0012 * v * Math.sin( t * 1.6 + p * 1.7 + Math.sin( t * 0.41 ) * 2 );
				l.vx += ( W * W * ( px - l.x ) - 2 * Z * W * l.vx ) * h;
				l.x += l.vx * h;
				l.vz += ( W * W * ( pz - l.z ) - 2 * Z * W * l.vz ) * h;
				l.z += l.vz * h;

			}

			// bottom toward +x: +rotation about z; toward +z: -rotation about x
			l.obj.rotation.set( l.z, 0, - l.x );
			_lanternEuler.set( l.z, 0, - l.x );
			l.live.copy( l.rest ).sub( l.pivot ).applyEuler( _lanternEuler ).add( l.pivot );

		}

	}

	update( dt = 1 / 60 ) {

		this._updateLanterns( dt );

		// all other animation (flags, nets, laundry, lantern flicker) runs on the GPU from G.time / G.windDir / G.night
		const s = this._swing;
		if ( ! s ) return;
		// damped pendulum driven by the wind's push on the board (drag ~ v^2 on the face-on part of the
		// wind, with gusts), and a stiffer, smaller twist on the two chains
		const v = G.windSpeed.value, wx = G.windDir.value.x, wz = G.windDir.value.y;
		const n = Math.max( 1, Math.ceil( Math.min( dt, 0.1 ) / ( 1 / 120 ) ) ), h = Math.min( dt, 0.1 ) / n;
		const W = 4.9, WT = 10.5; // rad/s: swing (0.4 m to the board's centre) and twist (bifilar chains)
		for ( let i = 0; i < n; i ++ ) {

			const t = s.t += h;
			const gust = 1 + 0.35 * Math.sin( t * 0.73 + 1.3 ) * Math.sin( t * 0.31 ) + 0.22 * Math.sin( t * 2.1 + Math.sin( t * 0.9 ) ) + 0.1 * Math.sin( t * 5.3 + 2.0 );
			// tan of the lean the wind holds the board at (~9 degrees face-on at 7 m/s), plus turbulence
			// that keeps it moving when the wind is along the board
			const push = - 0.0033 * v * v * gust * wz * Math.abs( wz ) - 0.0009 * v * Math.sin( t * 1.7 + Math.sin( t * 0.43 ) * 2 );
			s.av += ( W * W * ( push * Math.cos( s.a ) - Math.sin( s.a ) ) - 2 * 0.07 * W * s.av ) * h;
			s.a += s.av * h;
			const twist = 0.004 * v * v * wx * wz * gust + 0.0015 * v * Math.sin( t * 2.9 + 1.1 );
			s.bv += ( WT * WT * ( twist - s.b ) - 2 * 0.12 * WT * s.bv ) * h;
			s.b += s.bv * h;

		}

		this.sign.rotation.set( s.a, s.b, 0 );

	}

	getLightSources() {

		return this.lights;

	}

	// circles { x, z, r } covered by buildings / big props (useful to keep vegetation out)
	getFootprints() {

		return this.footprints;

	}

	getStats() {

		let triangles = 0, drawCalls = 0;
		for ( const m of this.meshes ) {

			const total = m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count;
			triangles += Math.min( total, m.geometry.drawRange.count ) / 3;
			drawCalls ++;

		}

		const shadowCasters = this.meshes.filter( ( m ) => m.castShadow ).length;
		return { triangles, drawCalls, shadowCasters, shadowTriangles: this.shadowTriangles, lights: this.lights.length, textureMB: this.textures.bytes / 1048576, bakeMs: this.textures.bakeMs, baked: this.textures.baked };

	}

	dispose() {

		for ( const m of this.meshes ) m.geometry.dispose();
		for ( const k in this.materials ) this.materials[ k ].dispose();
		this.textures.dispose();
		this.scene.remove( this.group );

	}

}

