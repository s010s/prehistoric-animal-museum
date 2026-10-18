import { Vector3 } from '../../engine/index.js';
import { Noise2D, mulberry32, smoothstep as sstep } from '../../util/Noise.js';
import { WORLD } from '../WorldLayout.js';
import { PATHS, polylineDistance } from '../terrain/IslandShape.js';
import { C, lin, mulc, WOOD, buoy, ropeCoil, bucket, rowboat, oar, woodpile } from '../Props.js';
import {
	KIND, stone, minGround, driftLog, branch, plank, coconut, husk, weedMat, seagrassWrack, frond, shell, coralPiece,
	tyre, bottle, flipFlop, ropeScrap, netScrap, wheelbarrow, plankPile, floatBuoy,
} from './DebrisShapes.js';
import { SCAN, SCAN_SIZE } from './ScannedDebris.js';

// Where the debris goes. Works on the CPU terrain (TerrainData) after the village, vegetation and
// rocks exist, and keeps clear of everything the player walks on or through: boardwalks, the
// pier, footpaths, doorways (stairs, stoops, porches and the approach to them), the spawn point,
// colliders, plant trunks and rocks.
//
//  - village: clutter groups against the back and side walls of the houses and sheds (crate
//    stacks, barrels, lobster traps with floats and rope, tyres, buckets, planks, firewood),
//    gear stored under the stilt huts, beached skiffs, a wheelbarrow and board piles
//  - shore: the wrack line along the upper swash limit (sargassum mats, seagrass ribbons,
//    twigs, coconuts and husks, shells, coral rubble, rope, net scraps, floats and a little
//    litter), driftwood logs and root balls along the storm line, fallen fronds and coconuts under
//    the palms, stones in the rocky coves
//  - a density mask (2 m texels) for the camera-following pebble field: R pebbles, G cobbles,
//    B shell / coral grit, A stone palette (0 basalt .. 1 coral limestone)

const TAU = Math.PI * 2;
const SHORE_SHIFT = 2.0; // m: shoreline debris placed this far seaward of its height band

// 2D signed distances
function boxDist( o, x, z ) {

	const dx = x - o.x, dz = z - o.z;
	const lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c;
	const qx = Math.abs( lx ) - o.hx, qz = Math.abs( lz ) - o.hz;
	return Math.hypot( Math.max( qx, 0 ), Math.max( qz, 0 ) ) + Math.min( Math.max( qx, qz ), 0 );

}

function segDist( o, x, z ) {

	const abx = o.bx - o.x, abz = o.bz - o.z;
	const t = Math.max( 0, Math.min( 1, ( ( x - o.x ) * abx + ( z - o.z ) * abz ) / ( abx * abx + abz * abz || 1 ) ) );
	return Math.hypot( x - o.x - abx * t, z - o.z - abz * t ) - o.r;

}

// Spatial hash of 2D obstacle shapes (boxes, circles, capsules) with a clearance pad.
class Obstacles {

	constructor( cell = 4 ) {

		this.cell = cell;
		this.map = new Map();
		this.count = 0;

	}

	_insert( o, x0, z0, x1, z1 ) {

		const c = this.cell;
		for ( let j = Math.floor( z0 / c ); j <= Math.floor( z1 / c ); j ++ ) for ( let i = Math.floor( x0 / c ); i <= Math.floor( x1 / c ); i ++ ) {

			const k = i * 73856093 ^ j * 19349663;
			let l = this.map.get( k );
			if ( ! l ) this.map.set( k, l = [] );
			l.push( o );

		}

		this.count ++;

	}

	box( x, z, hx, hz, rotY, pad = 0, tag = '' ) {

		const o = { t: 0, x, z, hx, hz, c: Math.cos( rotY ), s: Math.sin( rotY ), pad, tag };
		const r = Math.hypot( hx, hz ) + pad + 2.5;
		this._insert( o, x - r, z - r, x + r, z + r );
		return o;

	}

	circle( x, z, r, pad = 0, tag = '' ) {

		const o = { t: 1, x, z, r, pad, tag };
		const R = r + pad + 2.5;
		this._insert( o, x - R, z - R, x + R, z + R );
		return o;

	}

	capsule( ax, az, bx, bz, r, pad = 0, tag = '' ) {

		const o = { t: 2, x: ax, z: az, bx, bz, r, pad, tag };
		const R = r + pad + 2.5;
		this._insert( o, Math.min( ax, bx ) - R, Math.min( az, bz ) - R, Math.max( ax, bx ) + R, Math.max( az, bz ) + R );
		return o;

	}

	// clearance (m) from the padded obstacles; values beyond ~2.5 m are clamped
	dist( x, z, ignore = null ) {

		const c = this.cell;
		const l = this.map.get( Math.floor( x / c ) * 73856093 ^ Math.floor( z / c ) * 19349663 );
		if ( ! l ) return 2.5;
		let best = 2.5;
		for ( const o of l ) {

			if ( ignore && ignore( o ) ) continue;
			const d = ( o.t === 0 ? boxDist( o, x, z ) : o.t === 1 ? Math.hypot( x - o.x, z - o.z ) - o.r : segDist( o, x, z ) ) - o.pad;
			if ( d < best ) best = d;

		}

		return best;

	}

}

// Debris-to-debris spacing
class Occupancy {

	constructor( cell = 2 ) {

		this.cell = cell;
		this.map = new Map();

	}

	free( x, z, r, k = 1 ) {

		const c = this.cell, R = r + 3;
		for ( let j = Math.floor( ( z - R ) / c ); j <= Math.floor( ( z + R ) / c ); j ++ ) for ( let i = Math.floor( ( x - R ) / c ); i <= Math.floor( ( x + R ) / c ); i ++ ) {

			const l = this.map.get( i * 73856093 ^ j * 19349663 );
			if ( ! l ) continue;
			for ( const o of l ) if ( Math.hypot( o.x - x, o.z - z ) < ( o.r + r ) * k ) return false;

		}

		return true;

	}

	add( x, z, r ) {

		const k = Math.floor( x / this.cell ) * 73856093 ^ Math.floor( z / this.cell ) * 19349663;
		let l = this.map.get( k );
		if ( ! l ) this.map.set( k, l = [] );
		l.push( { x, z, r } );

	}

}

export class DebrisPlacer {

	constructor( { B, inst, terrain, village = null, vegetation = null, rocks = null, colliders = null, seed = 5150, detail = null } ) {

		this.B = B;
		this.inst = inst;
		this.T = terrain;
		this.village = village;
		this.vegetation = vegetation;
		this.rocks = rocks;
		this.colliders = colliders;
		this.rand = mulberry32( seed );
		this.noise = new Noise2D( seed + 1 );
		this.detail = detail;
		this.ground = ( x, z ) => this.T.heightAt( x, z );
		this.obs = new Obstacles();
		this.occ = new Occupancy();
		this.counts = {};
		this.log = [];
		this.newColliders = 0;
		this.rockSpots = []; // stones / rocks near the shore (for the pebble mask)
		this.scanned = []; // photoscanned debris instances (ScannedDebris)
		this._buildObstacles();

	}

	count( k, n = 1, x = null, z = null ) {

		this.counts[ k ] = ( this.counts[ k ] || 0 ) + n;
		if ( x !== null && this.log ) this.log.push( [ k, x, z ] );

	}

	// ------------------------------------------------------------------ terrain queries

	_idx( x, z ) {

		const T = this.T;
		const i = Math.max( 0, Math.min( T.res - 1, Math.round( ( x - T.origin ) / T.texel - 0.5 ) ) );
		const j = Math.max( 0, Math.min( T.res - 1, Math.round( ( z - T.origin ) / T.texel - 0.5 ) ) );
		return j * T.res + i;

	}

	sand( x, z ) {

		return this.T.sand[ this._idx( x, z ) ] / 255;

	}

	rockM( x, z ) {

		return this.T.rock[ this._idx( x, z ) ];

	}

	pathM( x, z ) {

		return this.T.path ? this.T.path[ this._idx( x, z ) ] / 255 : 0;

	}

	slope( x, z, e = 0.8 ) {

		const g = this.ground;
		return Math.hypot( g( x + e, z ) - g( x - e, z ), g( x, z + e ) - g( x, z - e ) ) / ( 2 * e );

	}

	// unit downhill direction (toward the sea on a beach)
	downhill( x, z, e = 1.0 ) {

		const g = this.ground;
		const gx = g( x + e, z ) - g( x - e, z ), gz = g( x, z + e ) - g( x, z - e );
		const l = Math.hypot( gx, gz ) || 1;
		return [ - gx / l, - gz / l ];

	}

	// ------------------------------------------------------------------ keep-clear

	_buildObstacles() {

		const O = this.obs;
		const col = this.colliders;
		const stiltHuts = new Set();
		if ( this.village ) for ( const b of this.village.buildings ) if ( b.stilts ) stiltHuts.add( b.name );
		const stiltBoxes = [];
		if ( this.village ) for ( const b of this.village.buildings ) if ( b.stilts ) stiltBoxes.push( b );
		this.doorways = [];
		if ( col ) {

			for ( const b of col.boxes ) {

				const t = b.tag;
				// stilt huts: gear may go under the floor (the stilts stay obstacles)
				if ( t === 'house' && stiltBoxes.some( ( s ) => Math.hypot( s.x - b.center.x, s.z - b.center.z ) < 0.5 ) ) {

					O.box( b.center.x, b.center.z, b.half.x, b.half.z, b.rotY, - 0.6, 'hutFloor' );
					continue;

				}

				let pad = 0.06;
				if ( t === 'stairs' || t === 'stoop' || t === 'porch' || t === 'ladder' || t === 'pierStep' ) pad = 0.9;
				else if ( t === 'boardwalk' || t.startsWith( 'pier' ) ) pad = 0.4;
				else if ( b.walkable ) pad = 0.3;
				O.box( b.center.x, b.center.z, b.half.x, b.half.z, b.rotY, pad, t );
				if ( t === 'stairs' || t === 'stoop' ) {

					// the approach to the door: a clear lane in front of the steps
					const fx = Math.sin( b.rotY ), fz = Math.cos( b.rotY );
					O.capsule( b.center.x, b.center.z, b.center.x + fx * 3.2, b.center.z + fz * 3.2, 0.9, 0, 'doorway' );
					this.doorways.push( { x: b.center.x, z: b.center.z, fx, fz } );

				}

			}

			for ( const c of col.cylinders ) O.circle( c.x, c.z, c.radius, c.tag === 'pile' ? 0.25 : 0.05, c.tag );

		}

		// boardwalks and the pier
		if ( this.village ) {

			const lanes = [ this.village.path, ...( this.village.sidePaths || [] ) ].filter( Boolean );
			for ( const lane of lanes ) {

				const S = lane.samples, w = ( lane.width || 1.8 ) / 2;
				for ( let k = 0; k < S.length - 1; k ++ ) O.capsule( S[ k ].p.x, S[ k ].p.z, S[ k + 1 ].p.x, S[ k + 1 ].p.z, w, 0.35, 'boardwalk' );

			}

		}

		const pier = WORLD.pier;
		O.capsule( pier.x, pier.zStart - 3, pier.x, pier.zEnd + pier.headDepth, pier.width / 2, 0.6, 'pier' );
		const sp = WORLD.spawn.position;
		O.circle( sp.x, sp.z, 3.5, 0, 'spawn' );
		// big village props registered as footprints (boats, wreck, racks)
		if ( this.village ) for ( const f of this.village.getFootprints() ) if ( f.kind === 'prop' ) O.circle( f.x, f.z, f.r * 0.55, 0, 'prop' );

		// plant trunks
		const V = this.vegetation && this.vegetation.records;
		if ( V ) {

			for ( const r of V.palms || [] ) O.circle( r.x, r.z, 0.3 * ( r.s || 1 ), 0.05, 'palm' );
			for ( const r of V.trees || [] ) O.circle( r.x, r.z, 0.45 * ( r.s || 1 ), 0.05, 'tree' );
			for ( const r of V.bananas || [] ) O.circle( r.x, r.z, 0.3, 0.05, 'banana' );
			for ( const r of V.youngPalms || [] ) O.circle( r.x, r.z, 0.2, 0.05, 'youngPalm' );

		}

		// rocks
		if ( this.rocks ) for ( const r of this.rocks.instances ) O.circle( r.x, r.z, r.size * 0.8, 0.02, 'rock' );

	}

	// true if an item of radius r at (x, z) is clear of everything (paths optional)
	clear( x, z, r, { path = 0.25, spacing = 1, ignore = null } = {} ) {

		if ( this.obs.dist( x, z, ignore ) < r ) return false;
		if ( path !== null && this.T.pathDistance( x, z ) < r + path ) return false;
		return this.occ.free( x, z, r, spacing );

	}

	take( x, z, r ) {

		this.occ.add( x, z, r );

	}

	addBox( x, y, z, hx, hy, hz, ry, tag ) {

		if ( ! this.colliders ) return;
		this.colliders.addBox( new Vector3( x, y, z ), new Vector3( hx, hy, hz ), ry, { tag } );
		this.obs.box( x, z, hx, hz, ry, 0.05, tag );
		this.newColliders ++;

	}

	addCyl( x, z, r, y0, y1, tag ) {

		if ( ! this.colliders ) return;
		this.colliders.addCylinder( x, z, r, y0, y1, { tag } );
		this.obs.circle( x, z, r, 0.05, tag );
		this.newColliders ++;

	}

	// ------------------------------------------------------------------ run

	run() {

		const t = {};
		let t0 = performance.now();
		const step = ( name, fn ) => {

			fn.call( this );
			const t1 = performance.now();
			t[ name ] = t1 - t0;
			t0 = t1;

		};

		step( 'village', this._village );
		step( 'boats', this._boatsAndYards );
		step( 'logs', this._logs );
		step( 'palms', this._palmLitter );
		step( 'wrack', this._wrack );
		step( 'coves', this._coves );
		step( 'mask', this._mask );
		this.timings = t;
		return this;

	}

	// ------------------------------------------------------------------ village clutter

	// house / shed rectangles from the colliders
	_buildingBoxes() {

		const out = [];
		if ( ! this.village || ! this.colliders ) return out;
		const boxes = this.colliders.boxes.filter( ( b ) => b.tag === 'house' || b.tag === 'shed' );
		for ( const b of this.village.buildings ) {

			let best = null, bd = Infinity;
			for ( const c of boxes ) {

				const d = Math.hypot( c.center.x - b.x, c.center.z - b.z );
				if ( d < bd ) {

					bd = d; best = c;

				}

			}

			if ( best && bd < 1 ) out.push( { name: b.name, stilts: b.stilts, x: best.center.x, z: best.center.z, hx: best.half.x, hz: best.half.z, ry: best.rotY, floorY: b.floorY, shed: best.tag === 'shed' } );

		}

		return out;

	}

	// local (house frame) -> world
	_hw( h, lx, lz ) {

		const c = Math.cos( h.ry ), s = Math.sin( h.ry );
		return [ h.x + lx * c + lz * s, h.z - lx * s + lz * c ];

	}

	_village() {

		const rand = this.rand;
		const houses = this._buildingBoxes();
		this.houses = houses;
		const weights = { crates: 3, traps: 3, barrels: 2, junk: 2.5, stones: 1, firewood: 0.8, boards: 1 };
		const pickType = ( used ) => {

			let sum = 0;
			for ( const k in weights ) if ( ! used.has( k ) ) sum += weights[ k ];
			let u = rand() * sum;
			for ( const k in weights ) {

				if ( used.has( k ) ) continue;
				u -= weights[ k ];
				if ( u <= 0 ) return k;

			}

			return 'crates';

		};

		for ( const h of houses ) {

			if ( h.stilts ) {

				this._underHut( h );
				continue;

			}

			// candidate spots against the back and side walls (the front, +z, has the door)
			const spots = [];
			const gap = 0.45;
			// spot frames: local +z points away from the wall
			for ( const u of [ - 0.6, 0, 0.6 ] ) spots.push( { lx: u * h.hx, lz: - h.hz - gap, ry: Math.PI, wall: 'back' } );
			for ( const s of [ - 1, 1 ] ) for ( const v of [ - 0.5, 0.1 ] ) spots.push( { lx: s * ( h.hx + gap ), lz: v * h.hz, ry: s * Math.PI / 2, wall: 'side' } );
			for ( const s of [ - 1, 1 ] ) spots.push( { lx: s * ( h.hx + 0.9 ), lz: - h.hz - 0.9, ry: Math.PI - s * Math.PI / 4, wall: 'corner' } );
			// shuffle
			for ( let i = spots.length - 1; i > 0; i -- ) {

				const j = Math.floor( rand() * ( i + 1 ) );
				[ spots[ i ], spots[ j ] ] = [ spots[ j ], spots[ i ] ];

			}

			let want = h.shed ? 1 + Math.floor( rand() * 2 ) : 2 + Math.floor( rand() * 2 );
			const used = new Set();
			for ( const sp of spots ) {

				if ( want <= 0 ) break;
				const [ x, z ] = this._hw( h, sp.lx, sp.lz );
				const type = pickType( used );
				if ( this._group( type, x, z, h.ry + sp.ry, h ) ) {

					want --;
					used.add( type );

				}

			}

		}

		// the market plaza and the pier foot get a few more crates, barrels and baskets of floats
		const extra = [
			[ 'crates', 34.4, - 114.4, 0.3 ], [ 'barrels', 47.6, - 114.8, - 0.4 ], [ 'traps', 60.4, - 63.2, 0.2 ],
			[ 'crates', 50.6, - 62.5, - 0.2 ], [ 'traps', 76.2, - 66.0, - 0.1 ], [ 'junk', 86.5, - 66.5, 0.3 ],
			[ 'barrels', 42.2, - 67.8, 0.5 ], [ 'crates', 96.8, - 62.8, - 0.1 ],
		];
		for ( const [ type, x, z, ry ] of extra ) {

			for ( let k = 0; k < 8; k ++ ) {

				const jx = x + ( rand() - 0.5 ) * k * 0.6, jz = z + ( rand() - 0.5 ) * k * 0.6;
				if ( this._group( type, jx, jz, ry, null ) ) break;

			}

		}

	}

	// gear stored under a stilt hut
	_underHut( h ) {

		const rand = this.rand;
		const g = this.ground;
		const ignore = ( o ) => o.tag === 'hutFloor';
		const items = [ 'traps', 'floats', 'crates', 'oars', 'coil' ];
		let placed = 0;
		for ( let k = 0; k < 40 && placed < 4; k ++ ) {

			const lx = ( rand() - 0.5 ) * h.hx * 1.5, lz = ( rand() - 0.5 ) * h.hz * 1.5;
			const [ x, z ] = this._hw( h, lx, lz );
			const type = items[ placed % items.length ];
			const r = type === 'oars' ? 1.2 : 0.55;
			if ( ! this.clear( x, z, r, { ignore, path: 0.1 } ) ) continue;
			const gy = g( x, z );
			if ( type === 'traps' ) {

				this.inst.add( 'trap', x, gy - 0.02, z, h.ry + ( rand() - 0.5 ) * 0.3, this._tone() );
				if ( rand() < 0.7 ) this.inst.add( 'trap', x + 0.03, gy + 0.29, z, h.ry + ( rand() - 0.5 ) * 0.3, this._tone() );
				this.addBox( x, gy + 0.3, z, 0.48, 0.3, 0.28, h.ry, 'trap' );

			} else if ( type === 'floats' ) {

				for ( let q = 0; q < 4 + Math.floor( rand() * 5 ); q ++ ) this._float( x + ( rand() - 0.5 ) * 0.8, z + ( rand() - 0.5 ) * 0.8 );

			} else if ( type === 'crates' ) {

				this.inst.add( 'crate', x, gy - 0.02, z, h.ry + ( rand() - 0.5 ) * 0.2, this._tone() );
				this.addBox( x, gy + 0.2, z, 0.33, 0.21, 0.24, h.ry, 'crate' );

			} else if ( type === 'oars' ) {

				const a = h.ry + ( rand() - 0.5 ) * 0.4;
				const ca = Math.cos( a ), sa = Math.sin( a );
				for ( const o of [ - 0.12, 0.12 ] ) {

					const p0 = [ x - ca * 1.1 + sa * o, gy + 0.03, z + sa * 1.1 + ca * o ], p1 = [ x + ca * 1.1 + sa * o, gy + 0.03, z - sa * 1.1 + ca * o ];
					p0[ 1 ] = g( p0[ 0 ], p0[ 2 ] ) + 0.025; p1[ 1 ] = g( p1[ 0 ], p1[ 2 ] ) + 0.012;
					oar( this.B, p0, p1, rand(), rand() < 0.5 ? lin( 0xc23b2e ) : lin( 0x2f6fa8 ) );

				}

			} else {

				ropeCoil( this.B, x, gy - 0.01, z, 0.07, 0.26 + rand() * 0.1, 4, rand(), rand() < 0.5 ? C.rope : C.ropeBlue );

			}

			this.take( x, z, r );
			this.count( 'hut:' + type );
			placed ++;

		}

	}

	_tone() {

		const r = this.rand;
		return [ 0.82 + r() * 0.26, 0.84 + r() * 0.18, 0.8 + r() * 0.18 ];

	}

	// fishing float lying on the ground, sun-faded
	_float( x, z ) {

		floatBuoy( this.B, this.ground, x, z, this.rand );

	}

	// one clutter group at (x, z), local x along the wall (ry). h: the building it leans against
	_group( type, x, z, ry, h ) {

		const rand = this.rand;
		const g = this.ground;
		const B = this.B;
		const radius = { crates: 0.75, barrels: 0.75, traps: 0.8, junk: 0.9, stones: 0.8, firewood: 0.75, boards: 1.6 }[ type ] || 0.8;
		if ( ! this.clear( x, z, radius, { path: 0.3 } ) ) return false;
		if ( this.slope( x, z ) > 0.45 ) return false;
		const gy = minGround( g, x, z, radius * 0.7 );
		if ( gy < 1.2 ) return false;
		const c = Math.cos( ry ), s = Math.sin( ry );
		const at = ( lx, lz ) => [ x + lx * c + lz * s, z - lx * s + lz * c ];

		if ( type === 'crates' ) {

			const n = 2 + Math.floor( rand() * 3 );
			const slots = [ [ - 0.34, 0 ], [ 0.34, 0.02 ], [ 0, 0.48 ], [ 0.66, 0.5 ] ];
			let top = 0.4;
			for ( let k = 0; k < n; k ++ ) {

				const [ px, pz ] = at( slots[ k ][ 0 ] + ( rand() - 0.5 ) * 0.05, slots[ k ][ 1 ] * 0.45 );
				this.inst.add( 'crate', px, g( px, pz ) - 0.02, pz, ry + ( rand() - 0.5 ) * 0.15, this._tone() );

			}

			// one on top
			if ( rand() < 0.75 ) {

				const [ px, pz ] = at( ( rand() - 0.5 ) * 0.3, 0 );
				this.inst.add( 'crate', px, gy + 0.38, pz, ry + ( rand() - 0.5 ) * 0.4, this._tone() );
				top = 0.8;
				if ( rand() < 0.3 ) {

					this.inst.add( 'crate', px + 0.02, gy + 0.76, pz, ry + ( rand() - 0.5 ) * 0.5, this._tone() );
					top = 1.18;

				}

			}

			this.addBox( x, gy + top / 2, z, 0.72, top / 2, 0.36, ry, 'crate' );

		} else if ( type === 'barrels' ) {

			const n = 2 + Math.floor( rand() * 2 );
			for ( let k = 0; k < n; k ++ ) {

				const [ px, pz ] = at( ( k - ( n - 1 ) / 2 ) * 0.58 + ( rand() - 0.5 ) * 0.06, ( rand() - 0.5 ) * 0.12 );
				const py = g( px, pz );
				this.inst.add( 'barrel', px, py - 0.03, pz, rand() * TAU, [ 0.8 + rand() * 0.3, 0.85 + rand() * 0.15, 0.8 + rand() * 0.15 ] );
				this.addCyl( px, pz, 0.3, py, py + 0.9, 'barrel' );

			}

			// one lying on its side in front
			if ( rand() < 0.4 ) {

				const [ px, pz ] = at( ( rand() - 0.5 ) * 0.4, 0.75 );
				if ( this.clear( px, pz, 0.5, { path: 0.3 } ) ) {

					const py = g( px, pz );
					const a = ry + ( rand() - 0.5 ) * 0.6;
					// lying: rotate the upright barrel about its local z, pivot at the base centre
					const lx = Math.cos( a ) * 0.44, lz = - Math.sin( a ) * 0.44;
					this.inst.add( 'barrel', px - lx, py + 0.26, pz - lz, a, [ 0.8, 0.8, 0.75 ], 0, - Math.PI / 2 );
					this.addBox( px, py + 0.28, pz, 0.46, 0.28, 0.3, a, 'barrel' );
					this.take( px, pz, 0.5 );

				}

			}

		} else if ( type === 'traps' ) {

			const n = 2 + Math.floor( rand() * 3 );
			const y = gy - 0.02;
			for ( let k = 0; k < n; k ++ ) {

				const [ px, pz ] = at( k < 2 ? ( k - 0.5 ) * 0.96 * ( n > 1 ? 1 : 0 ) : ( rand() - 0.5 ) * 0.4, 0 );
				const yy = k < 2 ? g( px, pz ) - 0.02 : y + 0.31 * ( k - 1 );
				this.inst.add( 'trap', px, yy, pz, ry + ( rand() - 0.5 ) * 0.2, this._tone() );

			}

			const top = 0.3 + 0.31 * Math.max( 0, n - 2 );
			this.addBox( x, gy + top / 2, z, 1.0, top / 2, 0.3, ry, 'trap' );
			for ( let q = 0; q < 1 + Math.floor( rand() * 4 ); q ++ ) {

				const [ px, pz ] = at( ( rand() - 0.5 ) * 1.6, 0.45 + rand() * 0.35 );
				this._float( px, pz );

			}

			if ( rand() < 0.6 ) {

				const [ px, pz ] = at( 1.1 + rand() * 0.3, 0.3 );
				if ( this.clear( px, pz, 0.35, { path: 0.3 } ) ) ropeCoil( B, px, g( px, pz ) - 0.01, pz, 0.07, 0.24 + rand() * 0.1, 4, rand(), rand() < 0.5 ? C.rope : C.ropeBlue );

			}

		} else if ( type === 'junk' ) {

			// an old tyre or two, a bucket, a leaning board, a few stones
			const [ tx, tz ] = at( - 0.35, 0.1 );
			tyre( B, g, tx, tz, rand );
			if ( rand() < 0.5 ) tyre( B, g, tx + 0.02, tz, rand, { y: g( tx, tz ) + 0.1, sink: 0 } );
			this.addCyl( tx, tz, 0.36, gy, gy + 0.3, 'tyre' );
			const [ bx, bz ] = at( 0.45, 0.2 );
			bucket( B, bx, g( bx, bz ) - 0.01, bz, [ C.blue, C.white, lin( 0xc94a3a ), lin( 0x3f7f55 ) ][ Math.floor( rand() * 4 ) ], rand() );
			if ( rand() < 0.6 ) {

				// a board leaning against the wall
				const [ px, pz ] = at( 0.1, - 0.2 );
				B.pushAt( px, g( px, pz ), pz, ry );
				B.box( 'wood', 0, 0.62, 0.0, 0.2, 1.3, 0.025, { grain: 1, rx: - 0.22, data: WOOD( rand(), 0.9, rand() < 0.3 ? 0.3 : 0, 0 ), tint: [ 1, 1, 1 ] } );
				B.pop();

			}

			for ( let q = 0; q < 2 + Math.floor( rand() * 3 ); q ++ ) {

				const [ px, pz ] = at( ( rand() - 0.5 ) * 1.4, 0.3 + rand() * 0.4 );
				const sz = 0.05 + rand() * 0.08;
				stone( B, g, px, pz, sz * 1.2, sz * 0.7, sz, rand, { palette: 1 + rand() * 0.6, sink: 0.35 } );

			}

		} else if ( type === 'stones' ) {

			// a small heap of fieldstones (cleared from the garden)
			const n = 5 + Math.floor( rand() * 6 );
			for ( let q = 0; q < n; q ++ ) {

				const a = rand() * TAU, d = Math.sqrt( rand() ) * 0.55;
				const px = x + Math.cos( a ) * d, pz = z + Math.sin( a ) * d;
				const sz = 0.09 + rand() * 0.12;
				const lift = ( 1 - d / 0.55 ) * 0.2 * ( q > 2 ? 1 : 0 );
				stone( B, g, px, pz, sz * ( 1 + rand() * 0.4 ), sz * 0.75, sz, rand, { palette: 1 + 0.1 + rand() * 0.55, sink: 0.3, angular: 0.6, y: minGround( g, px, pz, sz ) + lift } );

			}

			this.addCyl( x, z, 0.5, gy, gy + 0.35, 'stones' );

		} else if ( type === 'firewood' ) {

			const [ px, pz ] = at( 0, 0.05 );
			woodpile( B, px, g( px, pz ) - 0.02, pz, ry, { range: ( a, b ) => a + ( b - a ) * rand(), next: rand } );
			this.addBox( px, gy + 0.3, pz - 0, 0.6, 0.3, 0.3, ry, 'woodpile' );

		} else if ( type === 'boards' ) {

			const [ px, pz ] = at( 0, 0.3 );
			const r = plankPile( B, g, px, pz, ry + ( rand() - 0.5 ) * 0.15, rand, { len: 2.0 + rand() * 0.8 } );
			this.addBox( px, gy + r.h / 2, pz, r.L / 2, r.h / 2, 0.45, ry, 'boards' );

		}

		this.take( x, z, radius );
		this.count( 'group:' + type, 1, x, z );
		return true;

	}

	// ------------------------------------------------------------------ boats, yards, fire pit

	_boatsAndYards() {

		const rand = this.rand;
		const g = this.ground;
		const B = this.B;
		// beached skiffs on the upper beach, away from the other boats
		const skiffs = [
			{ at: [ 27, - 62.5 ], ry: - 0.25, up: true, hull: lin( 0x4f8f5a ), bottom: lin( 0x2f2f2f ) },
			{ at: [ 101, - 61.5 ], ry: 0.6, up: false, hull: lin( 0xe8d8b0 ), bottom: lin( 0x9a4030 ), rz: 0.22 },
		];
		for ( const s of skiffs ) {

			for ( let k = 0; k < 30; k ++ ) {

				const x = s.at[ 0 ] + ( rand() - 0.5 ) * k * 0.5, z = s.at[ 1 ] + ( rand() - 0.5 ) * k * 0.4;
				const c = Math.cos( s.ry ), sn = Math.sin( s.ry );
				// hull footprint: 4.1 x 1.4
				let ok = true;
				for ( const t of [ - 1.8, - 0.9, 0, 0.9, 1.8 ] ) if ( ! this.clear( x + sn * t, z + c * t, 0.95, { path: 0.4 } ) ) ok = false;
				if ( ! ok ) continue;
				const gy = g( x, z );
				if ( gy < 1.3 ) continue;
				rowboat( B, x, gy + ( s.up ? - 0.04 : 0.02 ), z, s.ry, { upsideDown: s.up, seed: rand(), hull: s.hull, bottom: s.bottom, trim: C.white, rz: s.rz || 0, oars: ! s.up } );
				this.addBox( x, gy + 0.4, z, 0.72, 0.45, 2.0, s.ry, 'rowboat' );
				for ( const t of [ - 1.8, - 0.9, 0, 0.9, 1.8 ] ) this.take( x + sn * t, z + c * t, 0.95 );
				if ( s.up ) {

					// oars and a float next to the upturned hull
					const ox = x + c * 1.2, oz = z - sn * 1.2;
					oar( B, [ ox + sn * 1.2, g( ox + sn * 1.2, oz + c * 1.2 ) + 0.025, oz + c * 1.2 ], [ ox - sn * 1.1, g( ox - sn * 1.1, oz - c * 1.1 ) + 0.012, oz - c * 1.1 ], rand(), lin( 0xe0b640 ) );
					this._float( ox + 0.4, oz - 0.3 );

				}

				this.count( 'skiff', 1, x, z );
				break;

			}

		}

		// wheelbarrows by the sheds / yards
		for ( const [ x0, z0, ry ] of [ [ 23.8, - 121.2, 1.9 ], [ 70.5, - 125.8, - 1.2 ], [ 90.5, - 143.6, 2.6 ] ] ) {

			for ( let k = 0; k < 16; k ++ ) {

				const x = x0 + ( rand() - 0.5 ) * k * 0.5, z = z0 + ( rand() - 0.5 ) * k * 0.5;
				if ( ! this.clear( x, z, 0.9, { path: 0.3 } ) || this.slope( x, z ) > 0.3 ) continue;
				const c = Math.cos( ry ), s = Math.sin( ry );
				wheelbarrow( B, g, x - c * 0.2, z + s * 0.2, ry, rand );
				this.addBox( x, g( x, z ) + 0.35, z, 0.85, 0.35, 0.35, ry, 'wheelbarrow' );
				this.take( x, z, 0.9 );
				this.count( 'wheelbarrow', 1, x, z );
				break;

			}

		}

		// fire pit on the upper beach west of the path: ring of stones, charred wood, log seats
		{

			const cx = - 6, cz = - 64.5;
			for ( let k = 0; k < 20; k ++ ) {

				const x = cx + ( rand() - 0.5 ) * k * 0.8, z = cz + ( rand() - 0.5 ) * k * 0.5;
				if ( ! this.clear( x, z, 2.6, { path: 0.5 } ) ) continue;
				const gy = g( x, z );
				if ( gy < 1.5 || gy > 3.5 ) continue;
				const n = 9;
				for ( let q = 0; q < n; q ++ ) {

					const a = q / n * TAU + rand() * 0.2;
					const sz = 0.1 + rand() * 0.05;
					stone( B, g, x + Math.cos( a ) * 0.62, z + Math.sin( a ) * 0.62, sz * 1.2, sz * 0.8, sz, rand, { palette: 0.1 + rand() * 0.3, sink: 0.3, angular: 0.4 } );

				}

				for ( let q = 0; q < 4; q ++ ) branch( B, g, x + ( rand() - 0.5 ) * 0.3, z + ( rand() - 0.5 ) * 0.3, rand() * TAU, 0.5 + rand() * 0.3, 0.03, rand, { tone: [ 0.16, 0.14, 0.13 ], weather: 0.3, twigs: 0 } );
				// two log seats
				for ( const a of [ 0.4 + rand() * 0.3, Math.PI + 0.2 + rand() * 0.3 ] ) {

					const lx = x + Math.cos( a ) * 1.75, lz = z + Math.sin( a ) * 1.75;
					const res = this._scanLog( SCAN.TRUNK, lx, lz, - a + Math.PI / 2, 1.0 + rand() * 0.15, 1.1, 0.2 );
					this._logCollider( lx, lz, - a + Math.PI / 2, res.len, res );

				}

				this.take( x, z, 2.4 );
				this.firePit = [ x, z ];
				this.count( 'firePit', 1, x, z );
				break;

			}

		}

	}


	// ------------------------------------------------------------------ driftwood

	// candidate points on the beach at a given height band (world xz), stepping along x
	_beachPoints( hMin, hMax, stepX = 1.0 ) {

		const out = [];
		const g = this.ground;
		for ( let x = - 190; x < 190; x += stepX ) {

			for ( let z = - 95; z < - 20; z += 0.5 ) {

				const h = g( x, z );
				if ( h < hMin || h > hMax ) continue;
				if ( this.sand( x, z ) < 0.55 || this.rockM( x, z ) > 0.3 ) continue;
				out.push( [ x + ( this.rand() - 0.5 ) * stepX, z + ( this.rand() - 0.5 ) * 0.5, h ] );

			}

		}

		return out;

	}

	_logs() {

		const rand = this.rand;
		const g = this.ground;
		const B = this.B;
		// big logs and root balls along the storm line (upper beach, at the vegetation edge)
		const cand = this._beachPoints( 1.9, 3.2, 1.0 );
		for ( let i = cand.length - 1; i > 0; i -- ) {

			const j = Math.floor( rand() * ( i + 1 ) );
			[ cand[ i ], cand[ j ] ] = [ cand[ j ], cand[ i ] ];

		}

		let big = 0, mid = 0;
		for ( const [ x0, z0 ] of cand ) {

			if ( big >= 26 ) break;
			const [ sx, sz ] = this.downhill( x0, z0 );
			const x = x0 + sx * SHORE_SHIFT, z = z0 + sz * SHORE_SHIFT;
			const len = 2.6 + rand() * 3.8;
			const r0 = 0.16 + rand() * 0.16;
			const [ ddx, ddz ] = this.downhill( x, z );
			// roughly along the shore (perpendicular to the downhill direction)
			const yaw = Math.atan2( ddx, ddz ) + ( rand() - 0.5 ) * 0.9;
			if ( ! this._logClear( x, z, yaw, len, r0 + 0.3, 3.5 ) ) continue;
			const res = this._scanLog( SCAN.TRUNK, x, z, yaw, len / SCAN_SIZE[ 0 ][ 0 ], r0 / 0.14, 0.2 + rand() * 0.2 );
			this._logTake( x, z, yaw, res.len, res.r + 0.2 );
			this._logCollider( x, z, yaw, res.len, res );
			this.log.push( [ 'bigLog', x, z ] );
			big ++;

		}

		// medium logs and big branches in the wrack band
		const cand2 = this._beachPoints( 1.3, 2.0, 1.5 );
		for ( let i = cand2.length - 1; i > 0; i -- ) {

			const j = Math.floor( rand() * ( i + 1 ) );
			[ cand2[ i ], cand2[ j ] ] = [ cand2[ j ], cand2[ i ] ];

		}

		for ( const [ x0, z0 ] of cand2 ) {

			if ( mid >= 36 ) break;
			const [ sx, sz ] = this.downhill( x0, z0 );
			const x = x0 + sx * SHORE_SHIFT, z = z0 + sz * SHORE_SHIFT;
			const len = 1.1 + rand() * 2.0;
			const r0 = 0.06 + rand() * 0.08;
			const [ ddx, ddz ] = this.downhill( x, z );
			const yaw = Math.atan2( ddx, ddz ) + ( rand() - 0.5 ) * 1.4;
			if ( ! this._logClear( x, z, yaw, len, r0 + 0.2, 1.2 ) ) continue;
			// gnarled branch pieces and short trunk sections
			const kind = rand() < 0.35 ? SCAN.TRUNK : rand() < 0.5 ? SCAN.BRANCH_A : SCAN.BRANCH_B;
			const s = kind === SCAN.TRUNK ? len / SCAN_SIZE[ 0 ][ 0 ] : 1.4 + rand() * 1.6;
			const res = this._scanLog( kind, x, z, yaw, s, kind === SCAN.TRUNK ? r0 / 0.14 : s * ( 0.8 + rand() * 0.3 ), 0.15 + rand() * 0.2 );
			this._logTake( x, z, yaw, res.len, res.r + 0.15 );
			if ( res.r > 0.1 ) this._logCollider( x, z, yaw, res.len, res );
			mid ++;

		}

		this.count( 'logs:big', big );
		this.count( 'logs:mid', mid );

	}

	// a photoscanned log / branch lying on the ground along yaw: scale sx along its length, sg
	// across (girth), resting on the ground under both halves, sunk by `sink` of its height
	_scanLog( asset, x, z, yaw, sx, sg, sink ) {

		const g = this.ground, rand = this.rand;
		const S = SCAN_SIZE[ asset ];
		const len = S[ 0 ] * sx, h = S[ 1 ] * sg;
		const dx = Math.cos( yaw ), dz = - Math.sin( yaw );
		const hA = minGround( g, x - dx * len * 0.3, z - dz * len * 0.3, h * 0.4 ), hB = minGround( g, x + dx * len * 0.3, z + dz * len * 0.3, h * 0.4 );
		const pitch = Math.atan2( hB - hA, len * 0.6 );
		const y = Math.min( ( hA + hB ) / 2, g( x, z ) + 0.05 ) + h * ( 0.5 - sink );
		// rolled about its long axis: some pieces show their broken / split side
		this.scanned.push( { asset, x, y, z, yaw, pitch, roll: ( rand() - 0.5 ) * 0.6 + ( rand() < 0.3 ? Math.PI : 0 ), sx, sy: sg, sz: sg * ( 0.9 + rand() * 0.2 ), rnd: rand() } );
		return { y, r: h / 2, len };

	}

	_logClear( x, z, yaw, len, r, spacing ) {

		const dx = Math.cos( yaw ), dz = - Math.sin( yaw );
		for ( let t = - 0.5; t <= 0.5; t += 0.25 ) {

			const px = x + dx * len * t, pz = z + dz * len * t;
			if ( this.obs.dist( px, pz ) < r || this.T.pathDistance( px, pz ) < r + 0.3 ) return false;
			if ( ! this.occ.free( px, pz, r + spacing * ( t === 0 ? 1 : 0.3 ) ) ) return false;

		}

		return true;

	}

	_logTake( x, z, yaw, len, r ) {

		const dx = Math.cos( yaw ), dz = - Math.sin( yaw );
		for ( let t = - 0.5; t <= 0.5; t += 0.25 ) this.take( x + dx * len * t, z + dz * len * t, r );

	}

	_logCollider( x, z, yaw, len, res ) {

		// box along the log (top below the step height for thin ones: the player steps over)
		const top = res.y + res.r;
		const bottom = this.ground( x, z ) - 0.1;
		this.addBox( x, ( top + bottom ) / 2, z, len / 2, ( top - bottom ) / 2, res.r * 0.95, yaw, 'log' );

	}

	// ------------------------------------------------------------------ under the palms

	_palmLitter() {

		const rand = this.rand;
		const g = this.ground;
		const B = this.B;
		const V = this.vegetation && this.vegetation.records;
		if ( ! V ) return;
		const vc = WORLD.village.center;
		for ( const p of V.palms ) {

			const dv = Math.hypot( p.x - vc.x, p.z - vc.z );
			if ( dv > 300 ) continue;
			const h = g( p.x, p.z );
			if ( h < 0.9 || h > 30 ) continue;
			// only where the ground is open (beach, paths, the village): tall grass hides litter
			const open = Math.max( this.sand( p.x, p.z ), this.pathM( p.x, p.z ), dv < 75 ? 1 : 0 );
			if ( open < 0.3 ) continue;
			const near = dv < 160 ? 1 : 0.6;
			// coconuts, clustered on one side (they roll downhill)
			const [ ddx, ddz ] = this.downhill( p.x, p.z );
			const nC = rand() < 0.6 * near ? 1 + Math.floor( rand() * rand() * 5 ) : 0;
			for ( let k = 0; k < nC; k ++ ) {

				const a = Math.atan2( ddz, ddx ) + ( rand() - 0.5 ) * 2.2;
				const d = 0.45 + rand() * 1.8;
				const x = p.x + Math.cos( a ) * d, z = p.z + Math.sin( a ) * d;
				if ( ! this.clear( x, z, 0.12, { path: 0.15, spacing: 0.9 } ) ) continue;
				coconut( B, g, x, z, rand, { age: rand() < 0.3 ? rand() * 0.3 : 0.35 + rand() * 0.65 } );
				this.take( x, z, 0.11 );
				this.count( 'coconut' );

			}

			if ( rand() < 0.35 * near ) {

				const a = rand() * TAU, d = 0.6 + rand() * 1.5;
				const x = p.x + Math.cos( a ) * d, z = p.z + Math.sin( a ) * d;
				if ( this.clear( x, z, 0.1, { path: 0.15 } ) ) {

					husk( B, g, x, z, rand );
					this.count( 'husk' );

				}

			}

			// fallen fronds lying radially outward
			const nF = rand() < 0.45 * near * near ? 1 + Math.floor( rand() * 1.5 ) : 0;
			for ( let k = 0; k < nF; k ++ ) {

				const a = rand() * TAU;
				const len = 2.4 + rand() * 1.6;
				const bx = p.x + Math.cos( a ) * 0.5, bz = p.z + Math.sin( a ) * 0.5;
				const yaw = - a + ( rand() - 0.5 ) * 0.4; // local +x along the frond
				let ok = true;
				for ( const t of [ 0.3, 0.6, 0.95 ] ) {

					const x = bx + Math.cos( a ) * len * t, z = bz + Math.sin( a ) * len * t;
					if ( this.obs.dist( x, z, ( o ) => o.tag === 'palm' ) < 0.3 || this.T.pathDistance( x, z ) < 0.4 ) ok = false;

				}

				if ( ! ok ) continue;
				frond( B, g, bx, bz, yaw, len, rand, { dry: 0.35 + rand() * 0.65 } );
				this.count( 'frond', 1, bx, bz );

			}

		}

	}

	// ------------------------------------------------------------------ the wrack line

	_wrack() {

		const rand = this.rand;
		const g = this.ground;
		const B = this.B;
		const nz = this.noise;
		const pts = [];
		// scan the beach band, 0.5 m grid
		for ( let x = - 200; x < 200; x += 0.5 ) for ( let z = - 90; z < - 25; z += 0.5 ) {

			const jx = x + ( rand() - 0.5 ) * 0.5, jz = z + ( rand() - 0.5 ) * 0.5;
			const h = g( jx, jz );
			if ( h < 0.3 || h > 2.6 ) continue;
			if ( this.sand( jx, jz ) < 0.5 || this.rockM( jx, jz ) > 0.35 ) continue;
			pts.push( [ jx, jz, h ] );

		}

		this.wrackPoints = 0;
		for ( const [ x, z, h ] of pts ) {

			// the last high-water line meanders around h ~1.5 (the terrain paints its wrack band at
			// 1.15 - 2.1), an older storm line higher up; items cluster in patches along it
			const hLine = 1.5 + 0.22 * nz.noise( x / 19, z / 19 );
			const sl = Math.max( 0.025, this.slope( x, z ) );
			const d = Math.abs( h - hLine ) / sl;
			const lineK = Math.exp( - ( d / 0.9 ) * ( d / 0.9 ) );
			const hStorm = 2.15 + 0.25 * nz.noise( x / 31 + 7, z / 31 );
			const ds = Math.abs( h - hStorm ) / sl;
			const stormK = Math.exp( - ( ds / 1.6 ) * ( ds / 1.6 ) ) * 0.6;
			const patch = sstep( - 0.35, 0.45, nz.noise( x / 8.5, z / 8.5 + 3 ) );
			const swash = sstep( 0.35, 0.6, h ) * sstep( 1.15, 0.9, h );
			const line = lineK * patch;
			const u = rand();
			if ( line < 0.02 && stormK < 0.02 && swash < 0.02 ) continue;
			this.wrackPoints ++;

			// probabilities per 0.25 m^2 sample
			const P = [
				[ 'conch', 0.004 * ( line + stormK * 0.5 ) ],
				[ 'scanBranch', 0.03 * ( line + stormK ) ],
				[ 'twig', 0.05 * ( line + stormK ) ],
				[ 'coral', 0.04 * ( line + stormK * 0.7 ) + 0.005 * swash ],
				[ 'pumice', 0.012 * ( line + stormK * 0.5 ) ],
				[ 'shell', 0.016 * ( line + stormK * 0.5 ) + 0.006 * swash ],
				[ 'coconut', 0.012 * ( line + stormK ) ],
				[ 'husk', 0.008 * ( line + stormK ) ],

				[ 'rope', 0.0045 * ( lineK + stormK ) ],
				[ 'net', 0.0012 * ( lineK + stormK ) ],
				[ 'float', 0.0022 * ( lineK + stormK ) ],
				[ 'litter', 0.0022 * ( lineK + stormK ) ],
				[ 'plank', 0.0018 * ( lineK + stormK ) ],
				[ 'stone', 0.01 * line ],
			];
			let acc = 0;
			let type = null;
			for ( const [ t, p ] of P ) {

				acc += p;
				if ( u < acc ) {

					type = t;
					break;

				}

			}

			if ( ! type ) continue;
			// the wrack sits ~2 m further down the beach than the height bands suggest
			const [ ddx, ddz ] = this.downhill( x, z );
			const wx = x + ddx * SHORE_SHIFT, wz = z + ddz * SHORE_SHIFT;
			this._wrackItem( type, wx, wz, g( wx, wz ), rand );

		}

	}

	_wrackItem( type, x, z, h, rand ) {

		const g = this.ground;
		const B = this.B;
		const r = { scanBranch: 0.35, conch: 0.1, weed: 0.3, weedFresh: 0.25, grass: 0.22, twig: 0.25, coral: 0.08, pumice: 0.06, shell: 0.05, coconut: 0.12, husk: 0.1, rope: 0.3, net: 0.7, float: 0.2, litter: 0.15, plank: 0.6, stone: 0.12 }[ type ];
		if ( ! this.clear( x, z, r, { path: 0.2, spacing: type === 'weed' || type === 'grass' ? 0.55 : 0.8 } ) ) return;
		switch ( type ) {

			case 'weed': {

				// mats drifted into ribbons along the high-water line (elongated along the shore)
				const R = 0.16 + rand() * rand() * 0.5;
				const [ ddx, ddz ] = this.downhill( x, z );
				const along = Math.atan2( ddx, - ddz ) + ( rand() - 0.5 ) * 0.5;
				weedMat( B, g, x, z, R, 0.015 + R * 0.06, rand, { dry: Math.min( 1, sstep( 1.2, 1.9, h ) * 0.7 + 0.25 + rand() * 0.25 ), aspect: 1.2 + rand() * 0.8, rot: along, strands: 1 + Math.floor( rand() * 3 ) } );
				this.take( x, z, R * 1.3 );
				break;

			}

			case 'weedFresh': {

				const R = 0.1 + rand() * 0.2;
				weedMat( B, g, x, z, R, 0.02 + R * 0.1, rand, { dry: rand() * 0.15, strands: 2 } );
				this.take( x, z, R );
				break;

			}

			case 'grass': {

				const [ ddx, ddz ] = this.downhill( x, z );
				seagrassWrack( B, g, x, z, 0.1 + rand() * 0.22, rand, { dir: Math.atan2( ddx, - ddz ) } );
				this.take( x, z, 0.2 );
				break;

			}

			case 'twig': {

				const len = 0.3 + rand() * rand() * 1.4;
				branch( B, g, x, z, rand() * TAU, len, 0.012 + rand() * 0.02 * len, rand, { weather: 0.9 + rand() * 0.1 } );
				this.take( x, z, len * 0.4 );
				break;

			}

			case 'coral': {

				coralPiece( B, g, x, z, 0.07 + rand() * 0.12, rand );
				this.take( x, z, 0.08 );
				break;

			}

			case 'shell': {

				shell( B, g, x, z, 0.045 + rand() * rand() * 0.1, rand );
				this.take( x, z, 0.05 );
				break;

			}

			case 'scanBranch': {

				// gnarled branch pieces and wood fragments washed up along the line
				const kind = rand() < 0.5 ? SCAN.BRANCH_A : SCAN.BRANCH_B;
				const s = 0.6 + rand() * 1.2;
				const [ ddx, ddz ] = this.downhill( x, z );
				this._scanLog( kind, x, z, Math.atan2( ddx, ddz ) + ( rand() - 0.5 ) * 2.0, s, s * ( 0.8 + rand() * 0.3 ), 0.15 + rand() * 0.2 );
				this.take( x, z, 0.3 * s );
				break;

			}

			case 'conch': {

				const s = 0.8 + rand() * 0.5;
				const sz = SCAN_SIZE[ SCAN.SHELL ];
				const y = g( x, z ) + sz[ 1 ] * s * 0.3;
				this.scanned.push( { asset: SCAN.SHELL, x, y, z, yaw: rand() * TAU, pitch: ( rand() - 0.5 ) * 0.4, roll: rand() < 0.3 ? Math.PI : ( rand() - 0.5 ) * 0.4, sx: s, sy: s, sz: s, rnd: rand() } );
				this.take( x, z, 0.1 );
				break;

			}

			case 'pumice': {

				const sz = 0.025 + rand() * 0.045;
				stone( B, g, x, z, sz * 1.25, sz * 0.8, sz, rand, { palette: 0.6 + rand() * 0.08, sink: 0.25, tint: [ 1.08, 1.06, 1.02 ] } );
				this.take( x, z, sz );
				break;

			}

			case 'coconut': coconut( B, g, x, z, rand, { age: 0.4 + rand() * 0.6 } ); this.take( x, z, 0.12 ); break;
			case 'husk': husk( B, g, x, z, rand ); this.take( x, z, 0.1 ); break;
			case 'rope': ropeScrap( B, g, x, z, rand, { tangle: rand() < 0.3 } ); this.take( x, z, 0.3 ); break;
			case 'net': netScrap( B, g, x, z, rand ); this.take( x, z, 0.7 ); break;
			case 'float': this._float( x, z ); this.take( x, z, 0.2 ); break;
			case 'litter': ( rand() < 0.55 ? bottle : flipFlop )( B, g, x, z, rand ); this.take( x, z, 0.15 ); break;
			case 'plank': {

				const len = 0.6 + rand() * 1.4;
				plank( B, g, x, z, rand() * TAU, len, 0.1 + rand() * 0.12, 0.02 + rand() * 0.015, rand, { paint: rand() < 0.35 ? 0.2 + rand() * 0.3 : 0, tint: rand() < 0.35 ? [ lin( 0x5dbcb0 ), lin( 0xec8b76 ), lin( 0x8cc2e0 ), lin( 0xf0cf7c ) ][ Math.floor( rand() * 4 ) ] : undefined } );
				this.take( x, z, len * 0.45 );
				break;

			}

			case 'stone': {

				const sz = 0.05 + rand() * 0.09;
				stone( B, g, x, z, sz * 1.2, sz * 0.65, sz, rand, { palette: 0.3 + rand() * 0.6, sink: 0.35 } );
				this.take( x, z, sz );
				break;

			}

		}

		this.count( 'wrack:' + type, 1, x, z );

	}

	// ------------------------------------------------------------------ rocky coves

	_coves() {

		const rand = this.rand;
		const g = this.ground;
		const B = this.B;
		const nz = this.noise;
		const vc = WORLD.village.center;
		let n = 0;
		for ( let z = - 200; z < 330; z += 1.2 ) for ( let x = - 520; x < 520; x += 1.2 ) {

			const jx = x + ( rand() - 0.5 ) * 1.2, jz = z + ( rand() - 0.5 ) * 1.2;
			const h = g( jx, jz );
			if ( h < - 0.35 || h > 2.6 ) continue;
			const rk = this.rockM( jx, jz );
			if ( rk < 0.3 ) continue;
			const sl = this.slope( jx, jz );
			if ( sl > 0.55 ) continue;
			const dv = Math.hypot( jx - vc.x, jz - vc.z );
			const near = dv < 260 ? 1 : 0.3;
			const cl = sstep( - 0.1, 0.5, nz.noise( jx / 7, jz / 7 + 11 ) );
			const p = 0.2 * cl * near * sstep( 0.3, 0.6, rk ) * ( 1 - sl ) * ( dv < 320 ? 1 : 0 );
			if ( rand() > p ) continue;
			const sz = 0.1 + rand() * rand() * 0.34;
			if ( ! this.clear( jx, jz, sz * 1.1, { path: 0.2, spacing: 0.9 } ) ) continue;
			stone( B, g, jx, jz, sz * ( 1 + rand() * 0.5 ), sz * ( 0.55 + rand() * 0.3 ), sz, rand, { palette: 0.05 + rand() * 0.45, sink: 0.3, tilt: 0.5, angular: rand() * 0.5, detail: dv < 200 ? 1 : 0 } );
			this.take( jx, jz, sz );
			this.rockSpots.push( [ jx, jz, sz ] );
			if ( n % 10 === 0 ) this.log.push( [ 'cove', jx, jz ] );
			n ++;

		}

		this.count( 'coveStones', n );

	}

	// ------------------------------------------------------------------ pebble mask

	_mask() {

		const T = this.T;
		const MR = 1024;
		const texel = T.size / MR;
		const data = new Uint8Array( MR * MR * 4 );
		const nz = this.noise;
		const res = T.res, H = T.heights;
		const step = Math.round( texel / T.texel );
		const vc = WORLD.village.center;
		for ( let j = 0; j < MR; j ++ ) {

			const z = T.origin + ( j + 0.5 ) * texel;
			const tj = Math.min( res - 1, j * step );
			for ( let i = 0; i < MR; i ++ ) {

				const ti = Math.min( res - 1, i * step );
				const k = tj * res + ti;
				const h = H[ k ];
				if ( h < - 0.6 || h > 45 ) continue;
				const x = T.origin + ( i + 0.5 ) * texel;
				const sand = T.sand[ k ] / 255, rock = T.rock[ k ], path = T.path ? T.path[ k ] / 255 : 0;
				const n1 = nz.noise( x / 9, z / 9 ), n2 = nz.noise( x / 3.1 + 5, z / 3.1 );
				// wrack band on the beach
				const band = sstep( 1.05, 1.35, h ) * sstep( 2.3, 1.8, h ) * sstep( 0.4, 0.7, sand );
				const swash = sstep( 0.3, 0.6, h ) * sstep( 1.2, 0.95, h ) * sand;
				const dry = sstep( 2.0, 2.6, h ) * sand * ( 1 - sstep( 6, 10, h ) );
				const shore = sstep( - 0.4, 0.1, h ) * sstep( 3.5, 2.2, h );
				const village = sstep( 120, 70, Math.hypot( x - vc.x, z - vc.z ) ) * sstep( 1.5, 2.5, h ) * ( 1 - sand * 0.6 );
				let peb = band * ( 0.25 + 0.45 * sstep( - 0.3, 0.5, n1 ) ) + swash * 0.12 + dry * 0.06 * sstep( 0.2, 0.7, n2 );
				peb += shore * sstep( 0.25, 0.5, rock ) * 0.6;
				peb += path * 0.45 * sstep( 1.0, 2.0, h );
				peb += village * 0.12 * sstep( 0.0, 0.6, n2 );
				let cob = shore * sstep( 0.3, 0.6, rock ) * ( 0.35 + 0.5 * sstep( - 0.4, 0.4, n1 ) );
				cob += band * 0.06 + path * 0.08 * sstep( 1.5, 2.5, h ) + village * 0.05;
				let grit = band * ( 0.35 + 0.5 * sstep( - 0.2, 0.6, n2 ) ) + swash * 0.25 + dry * 0.08;
				grit += shore * sstep( 0.25, 0.5, rock ) * 0.1;
				// palette: coral limestone on the white-sand beach, basalt on the rocky shores
				const pal = Math.max( 0, Math.min( 1, 0.22 + sand * 0.5 - rock * 0.35 + n2 * 0.12 + village * 0.1 ) );
				const o = ( j * MR + i ) * 4;
				data[ o ] = Math.min( 255, peb * 255 );
				data[ o + 1 ] = Math.min( 255, cob * 255 );
				data[ o + 2 ] = Math.min( 255, grit * 255 );
				data[ o + 3 ] = pal * 255;

			}

		}

		// cobbles and pebbles around the base of shore rocks and cove stones
		const stamp = ( x, z, r, peb, cob ) => {

			const i0 = Math.floor( ( x - r - T.origin ) / texel ), i1 = Math.floor( ( x + r - T.origin ) / texel );
			const j0 = Math.floor( ( z - r - T.origin ) / texel ), j1 = Math.floor( ( z + r - T.origin ) / texel );
			for ( let j = Math.max( 0, j0 ); j <= Math.min( MR - 1, j1 ); j ++ ) for ( let i = Math.max( 0, i0 ); i <= Math.min( MR - 1, i1 ); i ++ ) {

				const px = T.origin + ( i + 0.5 ) * texel, pz = T.origin + ( j + 0.5 ) * texel;
				const f = sstep( r, r * 0.4, Math.hypot( px - x, pz - z ) );
				const o = ( j * MR + i ) * 4;
				data[ o ] = Math.min( 255, data[ o ] + peb * f * 255 );
				data[ o + 1 ] = Math.min( 255, data[ o + 1 ] + cob * f * 255 );

			}

		};

		if ( this.rocks ) for ( const r of this.rocks.instances ) if ( r.y < 4 && r.y > - 1.5 && r.size > 0.5 ) stamp( r.x, r.z, r.size * 2.2 + 1, 0.25, 0.35 );
		for ( const [ x, z, s ] of this.rockSpots ) stamp( x, z, s * 4 + 0.6, 0.15, 0.1 );
		this.mask = { data, res: MR, texel };

	}

}
