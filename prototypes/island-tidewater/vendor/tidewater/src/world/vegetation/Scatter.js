import * as THREE from '../../engine/index.js';
import { Noise2D, mulberry32, smoothstep, clamp } from '../../util/Noise.js';
import { WORLD } from '../WorldLayout.js';
import { getDetailTexture } from '../terrain/DetailTextures.js';

// CPU-side vegetation placement: land cover, exclusion zones and per-type scattering.
//
// The land cover mirrors the terrain shader's classification (Terrain.js: forest weight from
// height, macro noise, slope and gullies; the same detail-texture fbm samples), so trees stand on
// the forest floor, the meadow grass on the meadow and bare rock stays bare.

export const RULES = {
	minHeight: 1.8, // wet sand / water below
	villageRadius: 100, // palms inside it are capped (between the houses)
	villagePalms: 10,
	pathClear: 12, // big plants: around the pier path x = 55, z in [-130, -40]
	path: { x: WORLD.pier.x, z0: - 130, z1: - 40 },
	spawnClear: 5,
	obstacleClear: 2, // around village footprints and boardwalks
	// default boardwalk (pier steps -> plaza) when no village object is supplied
	boardwalk: [ [ 55, - 65 ], [ 54.6, - 72 ], [ 52.4, - 82 ], [ 48.4, - 92 ], [ 44.8, - 100.5 ], [ 42.6, - 107.2 ] ],
	boardwalkWidth: 1.8,
};

// bilinear sample of one channel of the (repeating) detail texture at uv
function detailSampler() {

	const tex = getDetailTexture();
	const S = tex.image.width, d = tex.image.data;
	return ( u, v, c ) => {

		const x = u * S - 0.5, y = v * S - 0.5;
		const xi = Math.floor( x ), yi = Math.floor( y );
		const tx = x - xi, ty = y - yi;
		const x0 = ( ( xi % S ) + S ) % S, y0 = ( ( yi % S ) + S ) % S;
		const x1 = ( x0 + 1 ) % S, y1 = ( y0 + 1 ) % S;
		const a = d[ ( y0 * S + x0 ) * 4 + c ], b = d[ ( y0 * S + x1 ) * 4 + c ];
		const e = d[ ( y1 * S + x0 ) * 4 + c ], f = d[ ( y1 * S + x1 ) * 4 + c ];
		return ( ( a * ( 1 - tx ) + b * tx ) * ( 1 - ty ) + ( e * ( 1 - tx ) + f * tx ) * ty ) / 255;

	};

}

const rot = ( x, z, a ) => [ x * Math.cos( a ) - z * Math.sin( a ), x * Math.sin( a ) + z * Math.cos( a ) ];

export class VegSite {

	constructor( terrain, { seed = 1234, footprints = [], paths = null } = {} ) {

		this.terrain = terrain;
		this.noise = new Noise2D( seed );
		this.noise2 = new Noise2D( seed * 7 + 3 );
		this.n = new THREE.Vector3();
		this.village = WORLD.village.center;
		this.spawn = WORLD.spawn.position;
		this.detail = detailSampler();
		this.hasVillage = footprints.length > 0;
		this.setObstacles( footprints, paths ?? [ { points: RULES.boardwalk, width: RULES.boardwalkWidth } ] );

	}

	// footprints: [{ x, z, r }] (buildings / props), paths: [{ points: [[x, z], ...], width }]
	setObstacles( footprints, paths ) {

		this.footprints = footprints.map( ( f ) => ( { x: f.x, z: f.z, r: f.r } ) );
		this.segments = [];
		for ( const p of paths ) {

			const pts = p.points;
			for ( let i = 0; i < pts.length - 1; i ++ ) {

				this.segments.push( [ pts[ i ][ 0 ], pts[ i ][ 1 ], pts[ i + 1 ][ 0 ], pts[ i + 1 ][ 1 ], ( p.width ?? 1.8 ) * 0.5 ] );

			}

		}

		// bounds for a cheap early out
		const b = this.obstacleBounds = { x0: Infinity, z0: Infinity, x1: - Infinity, z1: - Infinity };
		const grow = ( x, z, r ) => {

			b.x0 = Math.min( b.x0, x - r ); b.x1 = Math.max( b.x1, x + r );
			b.z0 = Math.min( b.z0, z - r ); b.z1 = Math.max( b.z1, z + r );

		};

		for ( const f of this.footprints ) grow( f.x, f.z, f.r );
		for ( const g of this.segments ) {

			grow( g[ 0 ], g[ 1 ], g[ 4 ] );
			grow( g[ 2 ], g[ 3 ], g[ 4 ] );

		}

	}

	// distance from (x, z) to the nearest footprint / boardwalk edge (large if far away)
	obstacleDist( x, z ) {

		const b = this.obstacleBounds;
		const pad = 25;
		if ( x < b.x0 - pad || x > b.x1 + pad || z < b.z0 - pad || z > b.z1 + pad ) return 1e9;
		let d = 1e9;
		for ( const f of this.footprints ) d = Math.min( d, Math.hypot( x - f.x, z - f.z ) - f.r );
		for ( const [ x0, z0, x1, z1, hw ] of this.segments ) {

			const dx = x1 - x0, dz = z1 - z0;
			const l2 = dx * dx + dz * dz || 1;
			const t = clamp( ( ( x - x0 ) * dx + ( z - z0 ) * dz ) / l2, 0, 1 );
			d = Math.min( d, Math.hypot( x - x0 - dx * t, z - z0 - dz * t ) - hw );

		}

		return d;

	}

	height( x, z ) {

		return this.terrain.heightAt( x, z );

	}

	// bilinear sample of a terrain mask array (Float32 0..1 or Uint8 0..255)
	_mask( arr, x, z, scale = 1 ) {

		const t = this.terrain;
		const fx = ( x - t.origin ) / t.texel - 0.5, fz = ( z - t.origin ) / t.texel - 0.5;
		if ( fx < 0 || fz < 0 || fx >= t.res - 1 || fz >= t.res - 1 ) return 0;
		const i = Math.floor( fx ), j = Math.floor( fz );
		const tx = fx - i, tz = fz - j;
		const k = j * t.res + i;
		return ( ( arr[ k ] * ( 1 - tx ) + arr[ k + 1 ] * tx ) * ( 1 - tz ) + ( arr[ k + t.res ] * ( 1 - tx ) + arr[ k + t.res + 1 ] * tx ) * tz ) * scale;

	}

	rock( x, z ) {

		return this._mask( this.terrain.rock, x, z );

	}

	normalY( x, z ) {

		return this.terrain.normalAt( x, z, this.n ).y;

	}

	villageDist( x, z ) {

		return Math.hypot( x - this.village.x, z - this.village.z );

	}

	pathDist( x, z ) {

		const p = RULES.path;
		const cz = clamp( z, p.z0, p.z1 );
		return Math.hypot( x - p.x, z - cz );

	}

	spawnDist( x, z ) {

		return Math.hypot( x - this.spawn.x, z - this.spawn.z );

	}

	// the central bay / beach "zone" (dune plants)
	inBay( x, z ) {

		return Math.abs( x - 10 ) < 235 && z > - 245 && z < - 30;

	}

	// Land cover at (x, z), matching Terrain.js:
	//   forest: forest-floor weight (0 meadow .. 1 forest); slope: 1 - N.y; rock: bare-rock tendency
	//   (mask + steepness); gully, sand, path: splat masks; macro: large-scale fbm
	cover( x, z, out = {} ) {

		const t = this.terrain;
		const h = this.height( x, z );
		const ny = this.normalY( x, z );
		const slope = 1 - ny;
		const [ ax, az ] = rot( x, z, 0.7 ), [ bx, bz ] = rot( x, z, 2.1 );
		const mA = this.detail( ax / 173, az / 173, 3 ), mB = this.detail( bx / 47, bz / 47, 3 );
		const macro = mA * 0.6 + mB * 0.4;
		const gully = this._mask( t.gully, x, z, 1 / 255 ) * smoothstep( - 0.5, 0.5, h );
		const forest = clamp( smoothstep( 9, 24, h + ( macro - 0.5 ) * 18 ) + smoothstep( 0.18, 0.36, slope ) + gully * 0.6, 0, 1 );
		const rock = this.rock( x, z );
		out.h = h; out.ny = ny; out.slope = slope; out.macro = macro; out.mA = mA; out.mB = mB;
		out.gully = gully; out.forest = forest; out.rock = rock;
		out.bare = Math.max( rock * 1.4, smoothstep( 0.42, 0.55, slope ) ); // > 0.5: bare rock face
		out.sand = this._mask( t.sand, x, z, 1 / 255 );
		out.path = this._mask( t.path, x, z, 1 / 255 );
		// the eroded embankment's face (0.55 toe .. 1 lip; TerrainData._scarp)
		out.scarp = t.scarp ? this._mask( t.scarp, x, z, 1 / 255 ) : 0;
		return out;

	}

	// Common exclusion test; returns true if a plant of radius `clear` may stand at (x, z).
	allowed( x, z, c, { minH = RULES.minHeight, maxBare = 0.35, clear = 0, big = false, maxSand = 0.5, maxPath = 0.3 } = {} ) {

		if ( c.h < minH || c.bare > maxBare || c.sand > maxSand || c.path > maxPath ) return false;
		// nothing rooted on the embankment face
		if ( c.scarp > 0.3 ) return false;
		if ( this.spawnDist( x, z ) < RULES.spawnClear + clear ) return false;
		// the pier path corridor: big plants keep RULES.pathClear, small ones half of it
		if ( this.pathDist( x, z ) < ( big ? RULES.pathClear : RULES.pathClear * 0.5 ) ) return false;
		if ( this.obstacleDist( x, z ) < RULES.obstacleClear + clear ) return false;
		if ( this.terrain.pathDistance && this.terrain.pathDistance( x, z ) < 0.6 + clear * 0.5 ) return false;
		return true;

	}

	// ground height under a trunk (lowest point of the footprint so nothing floats)
	groundY( x, z, r ) {

		let h = this.height( x, z );
		if ( r > 0 ) {

			h = Math.min( h, this.height( x + r, z ), this.height( x - r, z ), this.height( x, z + r ), this.height( x, z - r ) );

		}

		return h;

	}

	downhill( x, z ) {

		this.terrain.normalAt( x, z, this.n );
		const l = Math.hypot( this.n.x, this.n.z );
		return l > 1e-4 ? [ this.n.x / l, this.n.z / l ] : [ 0, 1 ];

	}

}

// Spatial hash of placed plants for minimum-distance tests across types.
class Occupancy {

	constructor( cell = 4 ) {

		this.cell = cell;
		this.map = new Map();

	}

	_key( i, j ) {

		return ( i + 32768 ) * 65536 + ( j + 32768 );

	}

	add( x, z, r, kind ) {

		const k = this._key( Math.floor( x / this.cell ), Math.floor( z / this.cell ) );
		let a = this.map.get( k );
		if ( ! a ) this.map.set( k, a = [] );
		a.push( x, z, r, kind );

	}

	// true if a circle (x, z, r) is free
	free( x, z, r, spacing = 1 ) {

		const reach = r + 8;
		const c = this.cell;
		const i0 = Math.floor( ( x - reach ) / c ), i1 = Math.floor( ( x + reach ) / c );
		const j0 = Math.floor( ( z - reach ) / c ), j1 = Math.floor( ( z + reach ) / c );
		for ( let j = j0; j <= j1; j ++ ) for ( let i = i0; i <= i1; i ++ ) {

			const a = this.map.get( this._key( i, j ) );
			if ( ! a ) continue;
			for ( let k = 0; k < a.length; k += 4 ) {

				const dx = a[ k ] - x, dz = a[ k + 1 ] - z;
				const d = ( a[ k + 2 ] + r ) * spacing;
				if ( dx * dx + dz * dz < d * d ) return false;

			}

		}

		return true;

	}

}

const KIND = { PALM: 1, TREE: 2, BANANA: 3, SHRUB: 4, YOUNG: 5, FERN: 6, BROAD: 7 };

// Jittered-grid dart throwing over a rectangle.
function scatter( rand, x0, z0, x1, z1, step, fn ) {

	for ( let z = z0; z < z1; z += step ) {

		for ( let x = x0; x < x1; x += step ) {

			fn( x + rand() * step, z + rand() * step );

		}

	}

}

// Open meadow slopes away from the village (the headlands): 0..1 weight for extra scattered trees,
// tree clumps and scrub. Denser in the gullies and hollows, thinner on the high exposed slopes,
// none on bare rock, the beach sand or the paths; open grassy patches are left by the noise
// gating of the callers.
let _site = null;
function headland( x, z, c, sandOk = false ) {

	const s = _site;
	if ( c.h < 2.3 || c.h > 80 || c.bare > 0.45 || c.path > 0.3 ) return 0;
	const dv = s.villageDist( x, z );
	const away = smoothstep( RULES.villageRadius + 5, RULES.villageRadius + 40, dv );
	if ( away <= 0 ) return 0;
	const exposed = smoothstep( 18, 55, c.h ) * ( 1 - c.gully );
	const shelter = 1 - 0.6 * exposed + 0.5 * c.gully;
	return away * shelter * ( sandOk ? 1 : 1 - smoothstep( 0.35, 0.7, c.sand ) ) * ( 1 - smoothstep( 0.25, 0.45, c.rock ) );

}

export function scatterVegetation( site, seed = 99 ) {

	_site = site;

	const rand = mulberry32( seed );
	// occ: trunks / plant footprints (everything tests against it); occT: tree crowns (trees keep
	// their spacing, palms stay out of the crowns, the understory may grow beneath them)
	const occ = new Occupancy( 4 );
	const occT = new Occupancy( 6 );
	const N = site.noise, N2 = site.noise2;
	const out = { palms: [], trees: [], bananas: [], shrubs: [], youngPalms: [], ferns: [], monsteras: [], elephantEars: [], heliconias: [], strelitzias: [] };
	const TAU = Math.PI * 2;
	const c = {};

	// island bounds (land lies roughly within these); the headlands either side of the bay reach
	// south to z ~ +320 (HZ1)
	const X0 = - 660, X1 = 660, Z0 = - 900, Z1 = - 20, HZ1 = 320;

	// --- broadleaf trees: a closed canopy on the forest ground (hillsides, gullies), thinning at
	// the forest edge into scattered trees; a few lone trees on the meadow ----------------------
	scatter( rand, X0, Z0, X1, HZ1, 4.6, ( x, z ) => {

		site.cover( x, z, c );
		if ( c.h < 3 ) return;
		const clump = N.fbm( x / 60, z / 60, 3 ) * 0.6 + N2.fbm( x / 17, z / 17, 2 ) * 0.4;
		let p = c.forest > 0.5 ? 0.9 : smoothstep( 0.15, 0.5, c.forest ) * 0.38 * smoothstep( - 0.25, 0.2, clump ) + 0.008;
		// headlands (south of the bay line): wind-shaped scattered trees and clumps, not a closed forest
		if ( z > Z1 ) p = c.forest > 0.5 ? 0.45 * smoothstep( - 0.2, 0.2, clump ) : p;
		if ( c.forest <= 0.5 ) p += headland( x, z, c ) * ( 0.9 * smoothstep( - 0.2, 0.2, clump ) + 0.1 );
		if ( rand() > p ) return;
		// crowns must not overhang the houses: trunks >= 7 m from footprints / boardwalks
		if ( ! site.allowed( x, z, c, { minH: 3, maxBare: 0.3, clear: 5, big: true } ) ) return;
		// emergent giants now and then; smaller trees at the forest edge
		// sub-canopy trees fill the gaps between the big crowns
		const sub = c.forest > 0.5 && rand() < 0.3;
		const s = ( sub ? 0.55 + rand() * 0.2 : 0.8 + rand() * 0.5 ) * ( c.forest > 0.5 ? 1 : 0.85 ) * ( rand() < 0.08 ? 1.3 : 1 );
		const sy = 0.78 + rand() * 0.34 + ( rand() < 0.1 ? 0.25 : 0 );
		const r = 2.5 * s;
		if ( ! occT.free( x, z, r, 1 ) ) return;
		occT.add( x, z, r, KIND.TREE );
		occ.add( x, z, 0.5 * s, KIND.TREE );
		const yaw = rand() * TAU;
		out.trees.push( { x, y: site.groundY( x, z, 0.6 ) - 0.15, z, s, sy, yaw, la: yaw, l: sy, H: 12.5 * s * sy, seed: rand() } );

	} );

	// --- coconut palms along the back of the beach (groves, leaning to the sea) -------------
	const beachPalm = ( x, z, h ) => {

		const [ dhx, dhz ] = site.downhill( x, z );
		const lx = dhx * 0.35, lz = 1 + dhz * 0.35; // mostly toward the sea (+z)
		const la = Math.atan2( lz, lx ) + ( rand() - 0.5 ) * 1.1;
		const nearShore = 1 - smoothstep( 2.3, 5.5, h );
		const lean = ( 0.1 + 0.32 * nearShore ) * ( 0.55 + 0.75 * rand() );
		const s = 0.85 + rand() * 0.32;
		const H = ( 7 + rand() * 6.5 ) * ( 0.9 + 0.2 * s );
		return { x, y: site.groundY( x, z, 0.35 ) - 0.05, z, s, yaw: rand() * TAU, la, l: lean, H, seed: rand() };

	};

	scatter( rand, - 240, - 230, 250, - 40, 3.4, ( x, z ) => {

		if ( ! site.inBay( x, z ) ) return;
		if ( site.villageDist( x, z ) < RULES.villageRadius ) return;
		site.cover( x, z, c );
		const grove = N.fbm( x / 48, z / 48, 3 ) + 0.4 * N2.fbm( x / 17, z / 17, 2 );
		const band = smoothstep( 1.95, 2.35, c.h ) * ( 1 - smoothstep( 5.2, 7.2, c.h ) );
		const p = 0.5 * smoothstep( - 0.28, 0.22, grove ) * band;
		if ( rand() > p ) return;
		if ( ! site.allowed( x, z, c, { minH: 2.0, maxBare: 0.2, clear: 3, big: true, maxSand: 1.01, maxPath: 0.5 } ) || c.ny < 0.9 ) return;
		if ( ! occ.free( x, z, 1.95, 1 ) || ! occT.free( x, z, 1.5, 1 ) ) return;
		occ.add( x, z, 1.95, KIND.PALM );
		out.palms.push( beachPalm( x, z, c.h ) );

	} );

	// --- a few palms inside the village radius: between the houses and along the beach edge,
	// clear of buildings, boardwalks and the pier path --------------------------------------
	const vc = [];
	scatter( rand, - 70, - 220, 150, - 60, 3.5, ( x, z ) => {

		if ( site.villageDist( x, z ) >= RULES.villageRadius ) return;
		if ( ! site.hasVillage && z < - 106 ) return; // unknown houses: stay on the beach edge
		site.cover( x, z, c );
		if ( c.h < 2.05 || c.h > 14 || c.bare > 0.2 || c.ny < 0.9 ) return;
		if ( site.pathDist( x, z ) < RULES.pathClear || site.spawnDist( x, z ) < RULES.spawnClear + 3 ) return;
		const od = site.obstacleDist( x, z );
		if ( od < 3.5 ) return;
		const between = site.hasVillage ? smoothstep( 4.5, 6, od ) * ( 1 - smoothstep( 10, 16, od ) ) : 0;
		const beach = smoothstep( 2.0, 2.3, c.h ) * ( 1 - smoothstep( 3.6, 4.4, c.h ) );
		vc.push( { x, z, h: c.h, r: rand() * ( 0.25 + Math.max( between, beach ) ) } );

	} );
	vc.sort( ( a, b ) => b.r - a.r );
	let village = 0;
	for ( const v of vc ) {

		if ( village >= RULES.villagePalms ) break;
		if ( ! occ.free( v.x, v.z, 5.5, 1 ) || ! occT.free( v.x, v.z, 3, 1 ) ) continue;
		occ.add( v.x, v.z, 5.5, KIND.PALM );
		out.palms.push( beachPalm( v.x, v.z, v.h ) );
		village ++;

	}

	out.villagePalms = village;

	// --- palms scattered over the valley and the forest edge (above the canopy here and there)
	scatter( rand, X0, Z0, X1, Z1, 12, ( x, z ) => {

		site.cover( x, z, c );
		const patch = N2.fbm( x / 110 + 3.3, z / 110 - 1.7, 3 );
		const p = ( 0.04 + 0.4 * smoothstep( 0.0, 0.45, patch ) ) * ( 1 - smoothstep( 60, 160, c.h ) );
		if ( rand() > p ) return;
		if ( site.villageDist( x, z ) < RULES.villageRadius ) return;
		if ( ! site.allowed( x, z, c, { minH: 6, maxBare: 0.2, clear: 3, big: true } ) || c.ny < 0.8 ) return;
		if ( ! occ.free( x, z, 2.0, 1 ) || ! occT.free( x, z, 1.2, 1 ) ) return;
		occ.add( x, z, 2.0, KIND.PALM );
		const [ dhx, dhz ] = site.downhill( x, z );
		const s = 0.8 + rand() * 0.35;
		out.palms.push( {
			x, y: site.groundY( x, z, 0.35 ) - 0.05, z, s, yaw: rand() * TAU,
			la: Math.atan2( dhz, dhx ) + ( rand() - 0.5 ) * 1.5, l: 0.03 + rand() * 0.12,
			H: ( 8 + rand() * 7 ) * s, seed: rand(),
		} );

	} );

	// lean clustered palms away from each other (natural "fan" groups)
	for ( const p of out.palms ) {

		let ax = 0, az = 0;
		for ( const q of out.palms ) {

			if ( q === p ) continue;
			const dx = p.x - q.x, dz = p.z - q.z;
			const d2 = dx * dx + dz * dz;
			if ( d2 < 25 && d2 > 1e-6 ) {

				const d = Math.sqrt( d2 );
				ax += dx / d * ( 5 - d );
				az += dz / d * ( 5 - d );

			}

		}

		if ( ax !== 0 || az !== 0 ) {

			const cx = Math.cos( p.la ), cz = Math.sin( p.la );
			const w = Math.min( 1, Math.hypot( ax, az ) / 3 );
			p.la = Math.atan2( cz * ( 1 - w ) + az / Math.hypot( ax, az ) * w, cx * ( 1 - w ) + ax / Math.hypot( ax, az ) * w );
			p.l = Math.max( p.l, 0.14 + 0.1 * w );

		}

	}

	// --- shrubs: thickets along the forest edge and in the gullies, understory in the forest,
	// a few clumps out on the meadow and the back of the beach -----------------------------
	scatter( rand, X0, Z0, X1, HZ1, 3.0, ( x, z ) => {

		site.cover( x, z, c );
		if ( c.h < 2.3 ) return;
		const thicket = N.fbm( x / 26 + 11.3, z / 26 - 4.1, 3 ) * 0.7 + N2.fbm( x / 9, z / 9, 2 ) * 0.3;
		const edge = smoothstep( 0.2, 0.45, c.forest ) * ( 1 - smoothstep( 0.75, 0.95, c.forest ) );
		const bay = site.inBay( x, z ) && c.h < 5.5;
		let p = edge * 0.75 + c.gully * 0.5 + ( c.forest > 0.9 ? 0.12 : 0 ) + ( bay ? 0.08 : 0.03 );
		const open = headland( x, z, c, true );
		p += open * ( 0.32 + 0.45 * ( 1 - smoothstep( 3.5, 9, c.h ) ) ) * ( 1 - smoothstep( 0.5, 0.8, c.forest ) );
		p *= smoothstep( - 0.2, 0.25, thicket );
		if ( site.villageDist( x, z ) < RULES.villageRadius ) p *= 0.35;
		if ( rand() > p ) return;
		if ( ! site.allowed( x, z, c, { minH: 2.3, maxBare: 0.4, clear: 1.2 } ) ) return;
		const s = ( 0.75 + rand() * 0.8 ) * ( open > 0.3 ? 1.35 : 1 );
		const sy = 0.65 + rand() * 0.65;
		if ( ! occ.free( x, z, 0.85 * s, 1 ) ) return;
		occ.add( x, z, 0.85 * s, KIND.SHRUB );
		const yaw = rand() * TAU;
		out.shrubs.push( { x, y: site.groundY( x, z, 0.3 ) - 0.08 * s, z, s, sy, yaw, la: yaw, l: - sy, H: 1.6 * s * sy, seed: rand() } );

	} );

	// --- banana groves on the lower slopes around the village ----------------------------------
	scatter( rand, - 280, - 420, 360, - 40, 4.2, ( x, z ) => {

		const dv = site.villageDist( x, z );
		if ( dv > 330 ) return;
		site.cover( x, z, c );
		const grove = N2.fbm( x / 38 - 5.1, z / 38 + 2.2, 3 );
		const p = 0.75 * smoothstep( 0.12, 0.38, grove ) * ( 1 - smoothstep( 220, 330, dv ) ) * ( 1 - smoothstep( 0.8, 1, c.forest ) * 0.6 );
		if ( rand() > p ) return;
		if ( ! site.allowed( x, z, c, { minH: 3.4, maxBare: 0.2, clear: 1.5 } ) || c.ny < 0.82 ) return;
		const s = 0.8 + rand() * 0.45;
		if ( ! occ.free( x, z, 1.1 * s, 1 ) ) return;
		occ.add( x, z, 1.1 * s, KIND.BANANA );
		out.bananas.push( { x, y: site.groundY( x, z, 0.2 ) - 0.05, z, s, yaw: rand() * TAU, la: rand() * TAU, l: rand() * 0.08, H: 1.8 * s * ( 0.8 + rand() * 0.5 ), seed: rand() } );

	} );

	// --- young palms: grove edges, forest edge, the back of the beach ---------------------------
	scatter( rand, X0, Z0, X1, Z1, 6.5, ( x, z ) => {

		site.cover( x, z, c );
		if ( c.h < 2.3 || c.h > 120 ) return;
		const grove = N.fbm( x / 48, z / 48, 3 );
		const p = ( site.inBay( x, z ) ? 0.22 : 0.1 ) * smoothstep( - 0.3, 0.2, grove ) * ( 1 - c.forest * 0.6 );
		if ( rand() > p ) return;
		if ( ! site.allowed( x, z, c, { minH: 2.3, maxBare: 0.2, clear: 1.5 } ) ) return;
		const s = 0.7 + rand() * 0.6;
		if ( ! occ.free( x, z, 1.1 * s, 1 ) ) return;
		occ.add( x, z, 1.1 * s, KIND.YOUNG );
		out.youngPalms.push( { x, y: c.h - 0.05, z, s, yaw: rand() * TAU, la: rand() * TAU, l: rand() * 0.1, H: 0.35 * s, seed: rand() } );

	} );

	// --- ferns: forest floor, gullies, the shady foot of the forest edge --------------------------
	scatter( rand, X0, Z0, X1, Z1, 2.2, ( x, z ) => {

		site.cover( x, z, c );
		if ( c.h < 4 ) return;
		const fn = N2.fbm( x / 28 - 9.9, z / 28 + 3.7, 3 );
		const p = ( 0.08 + 0.72 * smoothstep( 0.3, 0.8, c.forest ) + c.gully * 0.4 ) * smoothstep( - 0.35, 0.2, fn );
		if ( rand() > p ) return;
		if ( ! site.allowed( x, z, c, { minH: 4, maxBare: 0.45, clear: 0.5 } ) ) return;
		const s = 0.75 + rand() * 0.7;
		if ( ! occ.free( x, z, 0.5 * s, 1 ) ) return;
		occ.add( x, z, 0.5 * s, KIND.FERN );
		out.ferns.push( { x, y: c.h - 0.03, z, s, yaw: rand() * TAU, la: 0, l: 0, H: 0.05, seed: rand() } );

	} );

	// --- broadleaf understory (big leaves) ------------------------------------------------------
	// monstera: clumps on the shaded forest floor and along the forest edge, in the gullies, and a
	// few in the village gardens
	scatter( rand, X0, Z0, X1, Z1, 3.2, ( x, z ) => {

		site.cover( x, z, c );
		if ( c.h < 3.5 ) return;
		const clump = N2.fbm( x / 22 + 7.7, z / 22 - 1.3, 3 );
		const dv = site.villageDist( x, z );
		const garden = dv < 95 ? 0.18 * smoothstep( 0.3, 0.7, c.forest + 0.4 ) : 0;
		const p = ( 0.5 * smoothstep( 0.35, 0.75, c.forest ) + c.gully * 0.35 + garden ) * smoothstep( 0.0, 0.35, clump );
		if ( rand() > p ) return;
		if ( ! site.allowed( x, z, c, { minH: 3.5, maxBare: 0.35, clear: 1.0, maxSand: 0.15 } ) || c.ny < 0.75 ) return;
		const sc = 0.8 + rand() * 0.6;
		if ( ! occ.free( x, z, 0.9 * sc, 1 ) ) return;
		occ.add( x, z, 0.9 * sc, KIND.BROAD );
		out.monsteras.push( { x, y: c.h - 0.04, z, s: sc, yaw: rand() * TAU, la: rand() * TAU, l: rand() * 0.05, H: 0.02, seed: rand() } );

	} );

	// elephant ears: damp ground (gullies, the low backshore behind the bay, the forest foot)
	scatter( rand, X0, Z0, X1, Z1, 3.6, ( x, z ) => {

		site.cover( x, z, c );
		if ( c.h < 2.6 ) return;
		const clump = N.fbm( x / 30 - 3.1, z / 30 + 8.4, 3 );
		const damp = c.gully * 0.8 + smoothstep( 7, 3, c.h ) * 0.25 + smoothstep( 0.25, 0.5, c.forest ) * ( 1 - smoothstep( 0.7, 0.95, c.forest ) ) * 0.25;
		const p = damp * smoothstep( 0.05, 0.4, clump );
		if ( rand() > p ) return;
		if ( ! site.allowed( x, z, c, { minH: 2.6, maxBare: 0.3, clear: 1.0, maxSand: 0.15 } ) || c.ny < 0.8 ) return;
		const sc = 0.95 + rand() * 0.55;
		if ( ! occ.free( x, z, 1.1 * sc, 1 ) ) return;
		occ.add( x, z, 1.1 * sc, KIND.BROAD );
		out.elephantEars.push( { x, y: c.h - 0.04, z, s: sc, yaw: rand() * TAU, la: rand() * TAU, l: rand() * 0.05, H: 0.02, seed: rand() } );

	} );

	// heliconia: colour around the village (beside houses and paths) and at the sunny forest edge
	scatter( rand, X0, Z0, X1, Z1, 3.4, ( x, z ) => {

		const dv = site.villageDist( x, z );
		site.cover( x, z, c );
		if ( c.h < 3 ) return;
		const edge = smoothstep( 0.2, 0.45, c.forest ) * ( 1 - smoothstep( 0.7, 0.9, c.forest ) );
		const od = site.obstacleDist( x, z );
		const village = dv < 110 ? smoothstep( 16, 4, od ) * 0.45 + 0.04 : 0;
		const p = ( edge * 0.12 + village ) * smoothstep( - 0.1, 0.3, N2.fbm( x / 18 + 2.2, z / 18 - 6.6, 2 ) );
		if ( rand() > p ) return;
		if ( ! site.allowed( x, z, c, { minH: 3, maxBare: 0.3, clear: 1.2, maxSand: 0.25 } ) || c.ny < 0.8 ) return;
		const sc = 0.85 + rand() * 0.35;
		if ( ! occ.free( x, z, 0.9 * sc, 1 ) ) return;
		occ.add( x, z, 0.9 * sc, KIND.BROAD );
		out.heliconias.push( { x, y: c.h - 0.04, z, s: sc, yaw: rand() * TAU, la: rand() * TAU, l: rand() * 0.04, H: 0.02, seed: rand() } );

	} );

	// bird of paradise: planted beside the village houses
	scatter( rand, X0, Z0, X1, Z1, 3.0, ( x, z ) => {

		if ( site.villageDist( x, z ) > 105 ) return;
		site.cover( x, z, c );
		if ( c.h < 3 ) return;
		const od = site.obstacleDist( x, z );
		const p = smoothstep( 10, 3.5, od ) * 0.35 * smoothstep( - 0.2, 0.3, N.fbm( x / 14 - 4.4, z / 14 + 6.6, 2 ) );
		if ( rand() > p ) return;
		if ( ! site.allowed( x, z, c, { minH: 3, maxBare: 0.3, clear: 0.8, maxSand: 0.25 } ) || c.ny < 0.85 ) return;
		const sc = 0.85 + rand() * 0.3;
		if ( ! occ.free( x, z, 0.7 * sc, 1 ) ) return;
		occ.add( x, z, 0.7 * sc, KIND.BROAD );
		out.strelitzias.push( { x, y: c.h - 0.03, z, s: sc, yaw: rand() * TAU, la: rand() * TAU, l: rand() * 0.03, H: 0.02, seed: rand() } );

	} );

	return out;

}

// Ground-flora density mask, RGBA8 over the terrain grid:
//   R dune grass, G tall meadow grass, B sea oats, A beach creeper
// RGBA density mask over the whole terrain at 2 m (linear filtered by the grass shader):
//   R dune grass, G tall meadow grass, B sea oats, A beach creeper. Returns { data, res }.
export const GRASS_MASK_TEXEL = 2;
export function buildGrassMask( site ) {

	const t = site.terrain;
	const res = Math.round( t.size / GRASS_MASK_TEXEL );
	const texel = t.size / res;
	const data = new Uint8Array( res * res * 4 );
	const N = site.noise, N2 = site.noise2;
	const c = {};
	for ( let j = 1; j < res - 1; j ++ ) {

		const z = t.origin + ( j + 0.5 ) * texel;
		if ( z > 0 || z < - 950 ) continue;
		for ( let i = 1; i < res - 1; i ++ ) {

			const k = j * res + i;
			const x = t.origin + ( i + 0.5 ) * texel;
			if ( t.heightAt( x, z ) < 1.7 ) continue;
			if ( site.rock( x, z ) > 0.45 ) continue;
			site.cover( x, z, c );
			if ( c.bare > 0.5 ) continue;
			// exclusions (+2 m so bilinear filtering of the texels never bleeds inside)
			const sd = site.spawnDist( x, z );
			if ( sd < RULES.spawnClear + 2 ) continue;
			const od = site.obstacleDist( x, z );
			if ( od < RULES.obstacleClear + 1 ) continue;
			const keep = smoothstep( RULES.spawnClear + 2, RULES.spawnClear + 4, sd ) * smoothstep( RULES.obstacleClear + 1, RULES.obstacleClear + 3.5, od )
				* ( 1 - smoothstep( 0.2, 0.5, c.path ) ) * ( 1 - smoothstep( 0.25, 0.45, c.bare ) );
			const bay = site.inBay( x, z );
			const clump = N.noise( x / 7.5, z / 7.5 ) * 0.65 + N2.noise( x / 19, z / 19 ) * 0.35;

			// tall meadow grass on the open ground, thinning into the forest; trodden near houses
			const house = site.hasVillage ? 1 - 0.55 * ( 1 - smoothstep( 3, 9, od ) ) : ( 1 - 0.85 * ( 1 - smoothstep( RULES.villageRadius - 6, RULES.villageRadius + 4, site.villageDist( x, z ) ) ) );
			const meadow = smoothstep( 2.5, 4.5, c.h ) * ( 1 - smoothstep( 0.45, 0.85, c.forest ) ) * ( 1 - smoothstep( 0.3, 0.7, c.sand ) ) * house
				* ( 0.75 + 0.25 * smoothstep( - 0.4, 0.3, clump ) );

			// Backshore vegetation edge (in the bay): driven by the ground height above the sea, so it
			// follows the beach profile (and any later embankment): a lobed, noisy edge with tongues
			// of grass reaching seaward and isolated clumps ahead of it; the lowest ~1.5 m (the
			// ~20 m of beach above the waterline) stays bare sand.
			let dune = 0, oats = 0, vine = 0;
			if ( bay ) {

				const lobe = N.noise( x / 16 + 4.4, z / 16 - 2.2 ) * 0.6 + N2.noise( x / 6 - 1.7, z / 6 + 8.1 ) * 0.4;
				let e = c.h - ( 2.15 - lobe * 0.4 ); // > 0 behind the edge
				// Where the embankment runs, the vegetation stops at its lip: the beach below it (up to
				// ~32 m seaward of a face, found by looking landward up the slope) stays sand, the face
				// only carries a few trailing runners and tufts, and the grass on top reaches right to
				// the lip and overhangs it. Elsewhere the ragged edge above applies.
				let belowScarp = 0;
				if ( c.scarp < 0.3 && t.scarp ) {

					// landward: up the smoothed slope (8 m differences: the berm's local normal wanders);
					// the face is only 1 - 3 m wide, so step finely
					let gx = site.height( x + 8, z ) - site.height( x - 8, z ), gz = site.height( x, z + 8 ) - site.height( x, z - 8 );
					const gl = Math.hypot( gx, gz );
					if ( gl > 1e-3 ) {

						gx /= gl; gz /= gl;
						for ( let d = 1; d <= 34; d += 1.5 ) belowScarp = Math.max( belowScarp, site._mask( t.scarp, x + gx * d, z + gz * d, 1 / 255 ) );

					}
					belowScarp = smoothstep( 0.3, 0.5, belowScarp );

				}

				const onFace = smoothstep( 0.3, 0.5, c.scarp );
				e = e * ( 1 - belowScarp ) - 2 * belowScarp;
				const main = smoothstep( 0.0, 0.35, e );
				const ahead = smoothstep( - 0.45, - 0.1, e ) * ( 1 - main ) * smoothstep( 0.35, 0.6, N.noise( x / 2.6 + 9.3, z / 2.6 - 4.1 ) );
				const inland = 1 - smoothstep( 4.8, 6.5, c.h );
				// patchy sward: dense clumps (a few metres), thinner stretches and bare sand gaps
				const patch = N2.noise( x / 4.2 + 5.5, z / 4.2 - 3.3 ) * 0.6 + N.noise( x / 11 - 7.1, z / 11 + 1.9 ) * 0.4;
				const clumpD = ( 0.3 + 0.7 * smoothstep( - 0.45, 0.25, patch ) ) * ( 0.6 + 0.4 * smoothstep( - 0.35, 0.35, clump ) );
				dune = Math.max( main * clumpD, ahead * 0.85 ) * inland * ( 1 - smoothstep( 0.4, 0.8, c.forest ) );
				// the face: sparse tufts hanging on (more near the lip)
				dune = dune * ( 1 - onFace ) + onFace * 0.18 * smoothstep( 0.7, 1.0, c.scarp ) * smoothstep( 0.0, 0.4, patch );
				// sea oats: fore-dune tufts just behind the edge
				oats = smoothstep( 0.0, 0.25, e ) * ( 1 - smoothstep( 1.4, 2.2, e ) ) * smoothstep( 0.0, 0.45, N.noise( x / 13 + 3.1, z / 13 - 7.7 ) );
				// creepers (beach morning glory): runners mat the ground at the edge and reach further
				// seaward than the grass
				vine = smoothstep( - 0.6, - 0.15, e ) * ( 1 - smoothstep( 1.2, 2.0, e ) ) * smoothstep( - 0.15, 0.3, N2.noise( x / 9 - 2.3, z / 9 + 5.3 ) );
				// runners trailing down the face from the lip, and matting its top
				vine = Math.max( vine * ( 1 - onFace ), onFace * 0.6 * smoothstep( 0.0, 0.35, N2.noise( x / 3.5 + 1.1, z / 3.5 - 2.9 ) ) );

			}

			const o = k * 4;
			data[ o ] = Math.round( 255 * clamp( dune * keep, 0, 1 ) );
			data[ o + 1 ] = Math.round( 255 * clamp( meadow * keep * ( 1 - dune ), 0, 1 ) );
			data[ o + 2 ] = Math.round( 255 * clamp( oats * keep, 0, 1 ) );
			data[ o + 3 ] = Math.round( 255 * clamp( vine * keep, 0, 1 ) );

		}

	}

	return { data, res };

}
