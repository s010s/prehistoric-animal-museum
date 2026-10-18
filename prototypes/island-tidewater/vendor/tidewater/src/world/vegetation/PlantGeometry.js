import * as THREE from '../../engine/index.js';
import { GeoBuilder } from './GeoBuilder.js';
import { mulberry32 } from '../../util/Noise.js';

// Procedural plant geometry. All plants are built in a local frame with the base at the
// origin and +Y up. See VegNodes.plantDeform for the attribute conventions.
//
// Part ids (aMat.x):
//   plant-leaf material: 0 stem / trunk, 1 coconut frond, 2 fern frond, 3 banana leaf, 5 coconut,
//                        broadleaf plants (BROADLEAF mesh): 6 monstera, 7 elephant ear, 8 heliconia leaf,
//                        9 heliconia bract, 10 bird of paradise leaf, 11 its flower (spathe, sepals,
//                        tongue: aMat.y 0 / 0.5 / 1); their petioles / stems are the same part with uv.x < 0
//   canopy material:     0 bark, 1 tree leaf-cluster card, 4 shrub leaf-cluster card, 5 shrub stem
// (far trees / shrubs are octahedral impostors baked from these meshes: Impostors.js)

export const PART = { STEM: 0, FROND: 1, FERN: 2, BANANA: 3, COCONUT: 5, MONSTERA: 6, ELEPHANT: 7, HELICONIA: 8, BRACT: 9, STRELITZIA: 10, BIRD: 11 };

const _up = new THREE.Vector3( 0, 1, 0 );
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

const smooth = ( a, b, x ) => {

	const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) );
	return t * t * ( 3 - 2 * t );

};

// Stem / trunk: a tube whose vertices carry the height fraction u (aVeg.x) and a radial
// offset. The real height is applied in the shader (u * H), so one mesh fits any height.
function addStem( b, { radial, rows, radius, Hgeo, mat = [ 0, 0, 0, 0 ], cap = true, texU = 1, lumps = null } ) {

	const start = b.count;
	for ( let j = 0; j < rows.length; j ++ ) {

		const u = rows[ j ];
		const r = radius( u );
		const du = 0.01;
		const dr = ( radius( u + du ) - radius( u - du ) ) / ( 2 * du * Hgeo );
		for ( let i = 0; i <= radial; i ++ ) {

			const a = ( i / radial ) * Math.PI * 2;
			const c = Math.cos( a ), s = Math.sin( a );
			const rl = lumps ? r * ( 1 + lumps( u, a ) ) : r;
			_v0.set( c * rl, u * Hgeo, s * rl );
			_v1.set( c, - dr, s ).normalize();
			b.vertex( _v0, _v1, ( i / radial ) * texU, u, [ u, 0, 0, 0 ], mat );

		}

	}

	for ( let j = 0; j < rows.length - 1; j ++ ) {

		for ( let i = 0; i < radial; i ++ ) {

			const a = start + j * ( radial + 1 ) + i;
			const c = a + radial + 1;
			b.quad( a, c, c + 1, a + 1 );

		}

	}

	if ( cap ) {

		const uTop = rows[ rows.length - 1 ];
		const top = b.vertex( _v0.set( 0, uTop * Hgeo, 0 ), _up, 0.5, uTop, [ uTop + 0.015, 0, 0, 0 ], mat );
		const ring = start + ( rows.length - 1 ) * ( radial + 1 );
		for ( let i = 0; i < radial; i ++ ) b.tri( ring + i, top, ring + i + 1 );

	}

}

// Pinnate frond / leaf: two wings (leaflet rows) hanging off a curved rachis. The leaflets
// themselves are cut out in the fragment shader with a procedural mask on (s, t).
function addFrond( b, o ) {

	const {
		origin, azimuth, elevation, bend, twist = 0, length,
		segs = 8, cross = 2,
		leafLen, leafAngle, droop, curl = 0.2,
		part = PART.FROND, age = 0, seed = 0, phase = 0, flutter = 1, minWidth = 0.035,
		bendPow = 1.4, stemU = 1, roll = 0, sBase = 0,
	} = o;

	// rachis centre line
	const pts = [];
	const p = origin.clone();
	for ( let k = 0; k <= segs; k ++ ) {

		pts.push( p.clone() );
		const sm = ( k + 0.5 ) / segs;
		const el = elevation - bend * Math.pow( sm, bendPow );
		const az = azimuth + twist * sm;
		_v0.set( Math.cos( el ) * Math.cos( az ), Math.sin( el ), Math.cos( el ) * Math.sin( az ) );
		p.addScaledVector( _v0, length / segs );

	}

	const azPerp = new THREE.Vector3( - Math.sin( azimuth ), 0, Math.cos( azimuth ) );
	const T = new THREE.Vector3(), S = new THREE.Vector3(), Nup = new THREE.Vector3(), side = new THREE.Vector3(), ld = new THREE.Vector3();

	for ( const sigma of [ - 1, 1 ] ) {

		const grid = [];
		for ( let k = 0; k <= segs; k ++ ) {

			const s = k / segs;
			T.subVectors( pts[ Math.min( segs, k + 1 ) ], pts[ Math.max( 0, k - 1 ) ] ).normalize();
			S.crossVectors( T, _up );
			if ( S.lengthSq() < 0.04 ) S.copy( azPerp );
			S.normalize();
			Nup.crossVectors( S, T ).normalize();
			const Ll = Math.max( leafLen( s ), minWidth );
			const al = leafAngle( s );
			// the frond rolls about its rachis toward the tip: one wing hangs lower than the other
			const be = droop( s ) + sigma * roll * s * s;
			side.copy( S ).multiplyScalar( sigma * Math.cos( be ) ).addScaledVector( Nup, - Math.sin( be ) );
			ld.copy( T ).multiplyScalar( Math.cos( al ) ).addScaledVector( side, Math.sin( al ) ).normalize();
			const row = [];
			for ( let j = 0; j <= cross; j ++ ) {

				const t = j / cross;
				const q = pts[ k ].clone().addScaledVector( ld, Ll * t ).addScaledVector( Nup, - Ll * curl * t * t );
				row.push( { q, s, t, Ll, nup: Nup.clone() } );

			}

			grid.push( row );

		}

		// normals from the grid, oriented to the frond's upper side
		const idx = [];
		for ( let k = 0; k <= segs; k ++ ) {

			const r = [];
			for ( let j = 0; j <= cross; j ++ ) {

				const g = grid[ k ][ j ];
				const ka = Math.max( 0, k - 1 ), kb = Math.min( segs, k + 1 );
				const ja = Math.max( 0, j - 1 ), jb = Math.min( cross, j + 1 );
				_v1.subVectors( grid[ kb ][ j ].q, grid[ ka ][ j ].q );
				_v2.subVectors( grid[ k ][ jb ].q, grid[ k ][ ja ].q );
				_v3.crossVectors( _v1, _v2 );
				if ( _v3.lengthSq() < 1e-12 ) _v3.copy( g.nup );
				_v3.normalize();
				if ( _v3.dot( g.nup ) < 0 ) _v3.negate();
				const fl = g.t * smooth( 0.05, 0.3, g.s ) * flutter;
				r.push( b.vertex( g.q, _v3, g.s, g.t, [ stemU, sBase + ( 1 - sBase ) * g.s, fl, phase ], [ part, age, g.Ll, seed ] ) );

			}

			idx.push( r );

		}

		for ( let k = 0; k < segs; k ++ ) {

			for ( let j = 0; j < cross; j ++ ) {

				const a = idx[ k ][ j ], bb = idx[ k + 1 ][ j ], c = idx[ k + 1 ][ j + 1 ], d = idx[ k ][ j + 1 ];
				if ( sigma > 0 ) b.quad( a, d, c, bb );
				else b.quad( a, bb, c, d );

			}

		}

	}

}

function addIcosphere( b, center, radii, mat, veg ) {

	const g = new THREE.IcosahedronGeometry( 1, 0 );
	const p = g.attributes.position;
	const map = new Map();
	const idx = [];
	for ( let i = 0; i < p.count; i ++ ) {

		_v0.fromBufferAttribute( p, i );
		const key = _v0.x.toFixed( 3 ) + ',' + _v0.y.toFixed( 3 ) + ',' + _v0.z.toFixed( 3 );
		let v = map.get( key );
		if ( v === undefined ) {

			_v1.copy( _v0 ).multiply( radii ).add( center );
			_v2.copy( _v0 ).divide( radii ).normalize();
			v = b.vertex( _v1, _v2, 0.5, 0.5, veg, mat );
			map.set( key, v );

		}

		idx.push( v );

	}

	for ( let i = 0; i < idx.length; i += 3 ) b.tri( idx[ i ], idx[ i + 1 ], idx[ i + 2 ] );
	g.dispose();

}

// Coconut palm -----------------------------------------------------------------------

const PALM_H = 10; // geometry trunk height (the shader uses the per-instance height)

const palmRadius = ( u ) => {

	const y = u * PALM_H;
	let r = 0.155 + 0.045 * ( 1 - u ) + 0.19 * Math.exp( - Math.max( y, 0 ) / 0.42 );
	r *= 1 + 0.05 * Math.sin( y * 1.7 ) * ( 1 - u ); // slight irregularity
	r += 0.07 * smooth( 0.955, 0.99, u ) - 0.1 * smooth( 0.995, 1.02, u ); // leaf-base boot
	return r;

};

// buttress roots: lumps around the flared base, fading out within the first ~0.6 m
const palmRootLumps = ( u, a ) => {

	const y = Math.max( u * PALM_H, 0 );
	const k = Math.exp( - y / 0.3 );
	return k * ( 0.16 * Math.max( 0, Math.sin( a * 5 + 0.7 ) ) + 0.08 * Math.sin( a * 11 + 2.1 ) );

};

// Frond parameters shared by both LODs so their silhouettes agree.
function palmFrondParams( rand, count ) {

	// A coconut crown holds 25-35 fronds 4.5-6 m long in a spiral (2/5 phyllotaxis): young ones
	// stand up, mature ones arch out and droop toward the tip, the oldest hang down along the trunk
	// before they drop (the shader browns them on some trees only: one crown mesh is shared).
	const list = [];
	for ( let i = 0; i < count; i ++ ) {

		const a = count > 1 ? i / ( count - 1 ) : 0.5; // 0 youngest .. 1 oldest
		const hanging = count > 10 && i >= count - 2;
		const len = ( 3.8 + 1.5 * smooth( 0, 0.45, a ) ) * ( 0.88 + 0.24 * rand() );
		list.push( {
			a, dead: hanging,
			azimuth: i * 2.39996 + ( rand() - 0.5 ) * 0.4,
			elevation: hanging ? - 1.05 - ( i - ( count - 2 ) ) * 0.25 : 1.0 - 1.25 * Math.pow( a, 0.8 ) + ( rand() - 0.5 ) * 0.3,
			// the rachis arches: most of the bend is in the outer half (the tips hang)
			bend: hanging ? 0.35 : 0.55 + 1.15 * a + rand() * 0.4,
			bendPow: hanging ? 1.2 : 1.9 + rand() * 0.5,
			twist: ( rand() - 0.5 ) * 0.45,
			roll: ( rand() - 0.5 ) * ( hanging ? 0.4 : 0.9 ),
			length: hanging ? len * 0.9 : len,
			attachY: 0.32 - 0.5 * a,
			seed: rand(),
			phase: rand(),
		} );

	}

	return list;

}

function addPalmCrown( b, fronds, { segs, cross, leafScale = 1 } ) {

	for ( const f of fronds ) {

		const origin = new THREE.Vector3( Math.cos( f.azimuth ) * 0.14, f.attachY, Math.sin( f.azimuth ) * 0.14 );
		const Lf = f.length;
		addFrond( b, {
			origin, azimuth: f.azimuth, elevation: f.elevation, bend: f.bend, bendPow: f.bendPow, twist: f.twist, roll: f.roll, length: Lf,
			segs, cross,
			// leaflets start after the bare petiole (~1/5 of the frond), longest a third of the way
			// out (0.6-0.9 m), shortening to the tip
			leafLen: ( s ) => leafScale * 0.23 * Lf * ( smooth( 0.14, 0.3, s ) * ( 1 - 0.68 * smooth( 0.35, 1.0, s ) ) ),
			leafAngle: ( s ) => 1.1 - 0.5 * s,
			// the two rows hang from the rachis in a V (keeled), steeper toward the tip and on old fronds
			droop: ( s ) => ( f.dead ? 1.3 : 0.88 + 0.35 * f.a ) + 0.45 * s,
			curl: f.dead ? 0.15 : 0.45,
			part: PART.FROND,
			age: f.dead ? 1 : f.a * 0.55,
			seed: f.seed, phase: f.phase,
			flutter: f.dead ? 0.3 : 1,
			minWidth: 0.045,
		} );

	}

}

// Full detail coconut palm: ringed trunk, coconut cluster and 15 fronds in one geometry
// (one draw call per pass for the plant-leaf material).
export function buildPalmNear( seed = 11 ) {

	const rand = mulberry32( seed );
	const b = new GeoBuilder();

	const rows = [ - 0.03, 0, 0.015, 0.04, 0.08, 0.14, 0.22, 0.32, 0.43, 0.54, 0.65, 0.76, 0.86, 0.94, 0.975, 0.992, 1.005 ];
	addStem( b, { radial: 10, rows, radius: palmRadius, Hgeo: PALM_H, mat: [ PART.STEM, 0, 0, 0 ], lumps: palmRootLumps } );

	// coconut cluster below the crown (crown-local coordinates)
	const nuts = 6;
	for ( let i = 0; i < nuts; i ++ ) {

		const az = i * 2.39996 + rand() * 0.5;
		const rr = 0.2 + rand() * 0.1;
		const c = new THREE.Vector3( Math.cos( az ) * rr, - 0.3 - rand() * 0.35, Math.sin( az ) * rr );
		const s = 0.12 + rand() * 0.035;
		addIcosphere( b, c, new THREE.Vector3( s, s * 1.12, s ), [ PART.COCONUT, rand(), 0, i / nuts ], [ 1, 0, 0, 0 ] );

	}

	addPalmCrown( b, palmFrondParams( rand, 18 ), { segs: 8, cross: 2 } );

	return { geometry: b.build( 16, new THREE.Vector3( 0, 6, 0 ) ), triangles: b.triangles };

}

// Low detail palm: one geometry (stem + crown) for the plant-leaf material.
export function buildPalmFar( seed = 11 ) {

	const rand = mulberry32( seed );
	const b = new GeoBuilder();
	addStem( b, { radial: 5, rows: [ - 0.03, 0.03, 0.2, 0.6, 1.0 ], radius: palmRadius, Hgeo: PALM_H, mat: [ PART.STEM, 0, 0, 0 ], cap: false } );
	const fronds = palmFrondParams( rand, 18 ).filter( ( f, i ) => i !== 1 && i !== 5 && i !== 9 && i !== 13 );
	addPalmCrown( b, fronds, { segs: 3, cross: 1, leafScale: 1.15 } );
	return { geometry: b.build( 16, new THREE.Vector3( 0, 6, 0 ) ), triangles: b.triangles };

}

// Young palm (no trunk yet) / clumping understory palm.
export function buildYoungPalm( seed = 5, b = new GeoBuilder() ) {

	const rand = mulberry32( seed );
	addStem( b, { radial: 5, rows: [ - 0.2, 0.3, 1.0 ], radius: ( u ) => 0.16 - 0.07 * u, Hgeo: 0.6, mat: [ PART.STEM, 0.35, 0, 0 ], cap: false } );
	const n = 8;
	for ( let i = 0; i < n; i ++ ) {

		const a = i / ( n - 1 );
		const az = i * 2.39996 + rand() * 0.4;
		const Lf = ( 1.7 + 0.9 * a ) * ( 0.85 + 0.3 * rand() );
		addFrond( b, {
			origin: new THREE.Vector3( 0, 0.1 - 0.15 * a, 0 ), azimuth: az,
			elevation: 1.35 - 0.8 * a + ( rand() - 0.5 ) * 0.2, bend: 0.6 + 0.7 * a, twist: ( rand() - 0.5 ) * 0.3, length: Lf,
			segs: 5, cross: 1,
			leafLen: ( s ) => 0.21 * Lf * ( smooth( 0.04, 0.25, s ) * ( 1 - 0.6 * smooth( 0.3, 1, s ) ) ),
			leafAngle: ( s ) => 1.0 - 0.4 * s,
			droop: ( s ) => 0.25 + 0.4 * a + 0.2 * s,
			curl: 0.15, part: PART.FROND, age: a * 0.4, seed: rand(), phase: rand(), minWidth: 0.03,
		} );

	}

	return { geometry: b.build( 4, new THREE.Vector3( 0, 1, 0 ) ), triangles: b.triangles };

}

// Fern: fountain of arching pinnate fronds.
export function buildFern( seed = 3, b = new GeoBuilder() ) {

	const rand = mulberry32( seed );
	const n = 9;
	for ( let i = 0; i < n; i ++ ) {

		const a = i / ( n - 1 );
		const az = i * 2.39996 + rand() * 0.5;
		const Lf = ( 0.75 + 0.5 * a ) * ( 0.85 + 0.3 * rand() );
		addFrond( b, {
			origin: new THREE.Vector3( 0, 0.05, 0 ), azimuth: az,
			elevation: 1.3 - 0.55 * a + ( rand() - 0.5 ) * 0.2, bend: 1.3 + 0.8 * a, twist: ( rand() - 0.5 ) * 0.5, length: Lf,
			segs: 4, cross: 1, bendPow: 1.2,
			leafLen: ( s ) => 0.2 * Lf * ( smooth( 0.02, 0.2, s ) * ( 1 - 0.8 * smooth( 0.35, 1, s ) ) ),
			leafAngle: () => 1.35,
			droop: ( s ) => 0.12 + 0.2 * s,
			curl: 0.08, part: PART.FERN, age: 0, seed: rand(), phase: rand(), minWidth: 0.012, flutter: 0.6,
		} );

	}

	return { geometry: b.build( 1.6, new THREE.Vector3( 0, 0.4, 0 ) ), triangles: b.triangles };

}

// Banana clump (Musa): a main pseudostem, a shorter second stem and a few suckers at its foot, all
// crown geometry in the plant's local frame (instance H ~ 0; heights are in the mesh). Leaves arch
// out and droop, torn into strips along the veins by the wind (cut in the shader); the oldest hang
// dead and brown against the stem. Pseudostems (uv.x < 0 on the banana part) are thick, mottled
// and sheathed with dry fibre (painted in the shader).
export function buildBanana( seed = 9, b = new GeoBuilder() ) {

	const rand = mulberry32( seed );
	const stems = [
		{ h: 2.1 + rand() * 0.5, r: 0.12, leaves: 8, dead: 3, off: 0 },
		{ h: 1.3 + rand() * 0.4, r: 0.085, leaves: 6, dead: 1, off: 0.32 },
		{ h: 0.55 + rand() * 0.25, r: 0.05, leaves: 3, dead: 0, off: 0.3, sucker: true },
		{ h: 0.35 + rand() * 0.2, r: 0.04, leaves: 3, dead: 0, off: 0.28, sucker: true },
	];
	const dirH = new THREE.Vector3();
	let az0 = rand() * Math.PI * 2;
	for ( const st of stems ) {

		az0 += 2.1 + rand() * 0.8;
		const base = new THREE.Vector3( Math.cos( az0 ) * st.off, 0, Math.sin( az0 ) * st.off );
		// a little lean (away from the clump centre for the side stems)
		const leanA = st.off > 0 ? az0 : rand() * Math.PI * 2;
		const lean = new THREE.Vector3( Math.cos( leanA ), 0, Math.sin( leanA ) ).multiplyScalar( ( st.off > 0 ? 0.1 : 0.04 ) + rand() * 0.05 );
		const pts = [];
		for ( let k = 0; k <= 3; k ++ ) {

			const f = k / 3;
			pts.push( base.clone().add( new THREE.Vector3( 0, st.h * f, 0 ) ).addScaledVector( lean, st.h * f * f ) );

		}

		const top = pts[ 3 ];
		const sTop = Math.min( 0.55, 0.2 + st.h * 0.15 );
		const sd = rand();
		addTube( b, pts, { radius: ( f ) => st.r * ( 1 - 0.35 * f ) * ( 1 + 0.25 * Math.exp( - f * 7 ) ), radial: st.sucker ? 4 : 6, part: PART.BANANA, age: 0, seed: sd, phase: rand(), s0: 0, s1: sTop } );
		const n = st.leaves + st.dead;
		for ( let i = 0; i < n; i ++ ) {

			const dead = i >= st.leaves;
			const a = i / Math.max( 1, st.leaves - 1 );
			const az = i * 2.39996 + rand() * 0.6;
			dirH.set( Math.cos( az ), 0, Math.sin( az ) );
			const scale = st.sucker ? 0.35 + rand() * 0.15 : st.h / 2.4;
			const Lf = ( 1.9 + 0.8 * rand() ) * scale * ( dead ? 0.85 : 1 );
			const W = ( st.sucker ? 0.14 : 0.3 + 0.08 * rand() ) * ( st.sucker ? 1 : Math.max( 0.6, scale ) );
			const origin = top.clone().add( new THREE.Vector3( dirH.x * st.r * 0.5, - ( dead ? 0.15 + rand() * 0.35 : a * 0.2 ) * st.h, dirH.z * st.r * 0.5 ) );
			addFrond( b, {
				origin, azimuth: az,
				// young leaves stand up, mature ones arch out and droop; dead ones hang down the stem
				elevation: dead ? - 0.9 - rand() * 0.5 : ( st.sucker ? 1.25 : 1.2 - 0.85 * a ) + ( rand() - 0.5 ) * 0.25,
				bend: dead ? 0.35 : ( st.sucker ? 0.5 : 1.0 + 1.3 * a + rand() * 0.4 ), twist: ( rand() - 0.5 ) * 0.5, length: Lf,
				segs: dead ? 3 : ( st.sucker ? 3 : 5 ), cross: 1, bendPow: 1.6, roll: ( rand() - 0.5 ) * 0.8,
				leafLen: ( s ) => W * Math.pow( Math.max( 0, Math.sin( Math.PI * Math.min( 1, Math.max( 0, ( s - 0.1 ) / 0.9 ) ) ) ), 0.5 ) * ( dead ? 0.6 : 1 ),
				leafAngle: () => 1.45,
				droop: ( s ) => ( dead ? 0.9 : 0.2 + 0.45 * s + 0.2 * a ),
				curl: dead ? 0.5 : 0.15, part: PART.BANANA, age: dead ? 0.92 + rand() * 0.06 : a * 0.45 + rand() * 0.15, seed: rand(), phase: rand(),
				minWidth: 0.03, flutter: dead ? 0.3 : 0.8, sBase: sTop,
			} );

		}

	}

	return { geometry: b.build( 4, new THREE.Vector3( 0, 1.5, 0 ) ), triangles: b.triangles };

}

// Broadleaf trees and shrubs: lobed crowns ------------------------------------------------
//
// A crown is a set of lobes (leaf clusters at the branch ends) [x, y, z, radius] in plant-local
// space. Every leaf card stores the offset to its lobe centre and the lobe id (aLobe), so each
// instance can drop or resize lobes in the vertex shader: one mesh, irregular crowns with gaps.
// The far impostors are baked from the same variants (LOBE_TABLE rows), so the LOD switch keeps
// the crown's shape. Lobes 0-1 are never dropped.

export const TREE_H = 12.5; // nominal height (top of the highest lobe)
// deep, irregular crown: lobes from ~4 m up to the top, so from a distance the canopy is a
// continuous lumpy carpet rather than crowns on bare poles
export const TREE_LOBES = [
	[ 0.4, 9.9, - 0.3, 2.9 ],
	[ - 2.0, 8.3, 1.6, 2.6 ],
	[ 3.0, 7.7, 1.2, 2.4 ],
	[ 1.7, 6.8, - 3.0, 2.5 ],
	[ - 3.2, 6.3, - 1.8, 2.3 ],
	[ 0.4, 5.6, 3.4, 2.2 ],
	[ - 1.1, 11.2, - 1.7, 1.8 ],
	[ 3.7, 5.2, - 0.9, 1.9 ],
];
const TREE_FORK = [ 0.15, 3.7, - 0.05 ];

export const SHRUB_H = 1.6;
export const SHRUB_LOBES = [
	[ 0.0, 0.85, 0.0, 0.8 ],
	[ 0.75, 0.6, 0.35, 0.6 ],
	[ - 0.6, 0.55, 0.55, 0.6 ],
	[ - 0.25, 0.65, - 0.75, 0.62 ],
	[ 0.35, 1.25, - 0.25, 0.48 ],
];

function addBranch( b, p0, p1, r0, r1, radial, rows, mat, hScale, flexFn, radiusFn = null ) {

	const dir = new THREE.Vector3().subVectors( p1, p0 );
	const len = dir.length();
	dir.normalize();
	const tmp = Math.abs( dir.y ) < 0.9 ? _up : new THREE.Vector3( 1, 0, 0 );
	const X = new THREE.Vector3().crossVectors( dir, tmp ).normalize();
	const Z = new THREE.Vector3().crossVectors( X, dir ).normalize();
	const start = b.count;
	for ( let j = 0; j <= rows; j ++ ) {

		const f = j / rows;
		const c = new THREE.Vector3().copy( p0 ).addScaledVector( dir, len * f );
		for ( let i = 0; i <= radial; i ++ ) {

			const a = ( i / radial ) * Math.PI * 2;
			const r = radiusFn ? radiusFn( f, a, c ) : r0 + ( r1 - r0 ) * f;
			const n = new THREE.Vector3().copy( X ).multiplyScalar( Math.cos( a ) ).addScaledVector( Z, Math.sin( a ) );
			const p = c.clone().addScaledVector( n, r );
			b.vertex( p, n, i / radial, f * len, [ Math.max( 0, p.y / hScale ), flexFn( p ), 0, 0 ], mat );

		}

	}

	for ( let j = 0; j < rows; j ++ ) {

		for ( let i = 0; i < radial; i ++ ) {

			const a = start + j * ( radial + 1 ) + i;
			const c = a + radial + 1;
			b.quad( a, c, c + 1, a + 1 );

		}

	}

}

// Curved limb: a tapered tube along a quadratic Bezier p0 -> ctrl -> p1 (rings follow the curve,
// frames rotation-minimised from ring to ring).
function addLimb( b, p0, ctrl, p1, r0, r1, radial, rows, mat, hScale, flexFn ) {

	const start = b.count;
	const pt = ( t ) => new THREE.Vector3()
		.copy( p0 ).multiplyScalar( ( 1 - t ) * ( 1 - t ) )
		.addScaledVector( ctrl, 2 * ( 1 - t ) * t )
		.addScaledVector( p1, t * t );
	const tan = ( t ) => new THREE.Vector3().subVectors( ctrl, p0 ).multiplyScalar( 2 * ( 1 - t ) ).addScaledVector( new THREE.Vector3().subVectors( p1, ctrl ), 2 * t ).normalize();
	let T = tan( 0 );
	let X = new THREE.Vector3().crossVectors( T, Math.abs( T.y ) < 0.9 ? _up : new THREE.Vector3( 1, 0, 0 ) ).normalize();
	let len = 0;
	let prev = pt( 0 );
	for ( let j = 0; j <= rows; j ++ ) {

		const f = j / rows;
		const c = pt( f );
		len += c.distanceTo( prev );
		prev = c;
		const Tn = tan( f );
		// rotation-minimising frame: project the previous X onto the new normal plane
		X.addScaledVector( Tn, - X.dot( Tn ) ).normalize();
		T = Tn;
		const Z = new THREE.Vector3().crossVectors( X, T ).normalize();
		const r = r0 + ( r1 - r0 ) * Math.pow( f, 0.8 );
		for ( let i = 0; i <= radial; i ++ ) {

			const a = ( i / radial ) * Math.PI * 2;
			const n = new THREE.Vector3().copy( X ).multiplyScalar( Math.cos( a ) ).addScaledVector( Z, Math.sin( a ) );
			const p = c.clone().addScaledVector( n, r );
			b.vertex( p, n, i / radial, len, [ Math.max( 0, p.y / hScale ), flexFn( p ), 0, 0 ], mat );

		}

	}

	for ( let j = 0; j < rows; j ++ ) {

		for ( let i = 0; i < radial; i ++ ) {

			const a = start + j * ( radial + 1 ) + i;
			const c = a + radial + 1;
			b.quad( a, c, c + 1, a + 1 );

		}

	}

}

// Leaf-cluster card: a quad facing `normal`, rotated by `yaw` around it. Vertex normals blend the
// lobe sphere and the whole crown (volumetric shading), aMat.y = exposure (0 inner .. 1 outer).
function addCard( b, { center, size, normal, yaw, lobeC, lobeR, lobeId, crownC, crownR, rand, flexFn, hScale, part, clumpC = null, clumpR = 1 } ) {

	const n = normal.clone().normalize();
	const tmp = Math.abs( n.y ) < 0.95 ? _up : new THREE.Vector3( 1, 0, 0 );
	const X = new THREE.Vector3().crossVectors( tmp, n ).normalize();
	const Y = new THREE.Vector3().crossVectors( n, X ).normalize();
	const cy = Math.cos( yaw ), sy = Math.sin( yaw );
	const Xr = X.clone().multiplyScalar( cy ).addScaledVector( Y, sy );
	const Yr = Y.clone().multiplyScalar( cy ).addScaledVector( X, - sy );
	const cr = rand();
	const card = rand();
	const ph = rand();
	const ids = [];
	const corners = [ [ - 0.5, - 0.5, 0, 0 ], [ 0.5, - 0.5, 1, 0 ], [ 0.5, 0.5, 1, 1 ], [ - 0.5, 0.5, 0, 1 ] ];
	for ( const [ x, y, u, v ] of corners ) {

		const p = center.clone().addScaledVector( Xr, x * size ).addScaledVector( Yr, y * size );
		const dl = clumpC ? p.clone().sub( clumpC ).divideScalar( clumpR ) : p.clone().sub( lobeC ).divideScalar( lobeR );
		const dc = p.clone().sub( crownC ).divide( crownR );
		// normals bent outward from the clump (or lobe) centre and from the crown centre: soft,
		// volumetric shading of every clump
		const nn = dl.clone().normalize().multiplyScalar( 0.5 ).addScaledVector( dc.clone().normalize(), 0.4 ).addScaledVector( n, 0.2 ).normalize();
		// exposure: outer / upper leaves lit, the inside of each clump and of the crown dark
		const ext = Math.min( 1, 0.5 * Math.min( 1, dl.length() ) + 0.4 * Math.min( 1, dc.length() ) + 0.25 * Math.max( 0, dc.y ) );
		const hf = Math.max( 0, p.y / hScale );
		ids.push( b.vertex( p, nn, u, v, [ hf, flexFn( p ), 1, ph ], [ part, 0.2 + 0.8 * ext * ext, cr, card ], [ lobeC.x - p.x, lobeC.y - p.y, lobeC.z - p.z, lobeId ] ) );

	}

	b.quad( ids[ 0 ], ids[ 1 ], ids[ 2 ], ids[ 3 ] );

}

// fills a lobe with leaf cards, biased towards its shell (the lobe reads as a volume, with gaps);
// returns card specs (emitted later, outermost first, so near cards draw first: early depth test)
function lobeCards( lobe, id, { count, size, crownC, crownR, rand, flexFn, hScale, part, flatten = 0.6 } ) {

	const lobeC = new THREE.Vector3( lobe[ 0 ], lobe[ 1 ], lobe[ 2 ] );
	const R = lobe[ 3 ];
	const cards = [];
	for ( let k = 0; k < count; k ++ ) {

		let x, y, z;
		do {

			x = rand() * 2 - 1; y = rand() * 2 - 1; z = rand() * 2 - 1;

		} while ( x * x + y * y + z * z > 1 || y < - 0.75 );

		const l = Math.hypot( x, y, z ) || 1;
		const shell = 0.45 + 0.55 * Math.sqrt( l );
		const c = new THREE.Vector3( x / l * shell * R * 0.85, y / l * shell * R * 0.85 * flatten, z / l * shell * R * 0.85 ).add( lobeC );
		const out = c.clone().sub( lobeC ).normalize();
		const normal = out.lerp( _up, 0.35 + rand() * 0.35 ).normalize();
		cards.push( {
			center: c, size: size * ( 0.8 + rand() * 0.45 ), normal, yaw: rand() * 6.283,
			lobeC, lobeR: R, lobeId: id, crownC, crownR, rand, flexFn, hScale, part,
		} );

	}

	return cards;

}

// Leaf clumps at the branch tips of a lobe: each clump a few crossing cards around its centre
// (normals outward from the clump with random tilt), clumps of different sizes and depths with
// real gaps between them (sky and branches show through). Returns { cards, tips }.
function clumpCards( lobe, id, { clumps, clumpR, cardsPer, size, crownC, crownR, rand, flexFn, hScale, part, flatten = 0.7 } ) {

	const lobeC = new THREE.Vector3( lobe[ 0 ], lobe[ 1 ], lobe[ 2 ] );
	const R = lobe[ 3 ];
	const cards = [], tips = [];
	for ( let k = 0; k < clumps; k ++ ) {

		let x, y, z;
		do {

			x = rand() * 2 - 1; y = rand() * 2 - 1; z = rand() * 2 - 1;

		} while ( x * x + y * y + z * z > 1 || y < - 0.55 );

		const l = Math.hypot( x, y, z ) || 1;
		const reach = 0.3 + 0.7 * Math.sqrt( rand() ); // mostly toward the lobe surface, some deeper
		const c = new THREE.Vector3( x / l, y / l * flatten, z / l ).multiplyScalar( reach * R * 0.85 ).add( lobeC );
		const rc = clumpR * ( 0.65 + rand() * 0.7 );
		tips.push( { c, rc } );
		const out = c.clone().sub( lobeC ).normalize();
		for ( let j = 0; j < cardsPer; j ++ ) {

			// crossing cards: each faces a random direction around the clump, biased outward / up
			const dir = new THREE.Vector3( rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1 ).normalize()
				.addScaledVector( out, 0.9 ).addScaledVector( _up, 0.55 ).normalize();
			const center = c.clone().addScaledVector( dir, rc * ( 0.1 + 0.3 * rand() ) )
				.add( new THREE.Vector3( rand() - 0.5, ( rand() - 0.5 ) * 0.6, rand() - 0.5 ).multiplyScalar( rc * 0.5 ) );
			cards.push( {
				center, size: size * rc / clumpR * ( 0.8 + rand() * 0.4 ), normal: dir, yaw: rand() * 6.283,
				lobeC, lobeR: R, lobeId: id, crownC, crownR, rand, flexFn, hScale, part, clumpC: c, clumpR: rc,
			} );

		}

	}

	return { cards, tips };

}

function emitCards( b, cards, crownC ) {

	cards.sort( ( a, c ) => c.center.distanceToSquared( crownC ) - a.center.distanceToSquared( crownC ) );
	for ( const card of cards ) addCard( b, card );

}

// Broadleaf rainforest tree: buttressed trunk forking into limbs that end in leafy lobes.
export function buildTreeNear( seed = 21, b = new GeoBuilder() ) {

	const rand = mulberry32( seed );
	const H = TREE_H;
	const crownC = new THREE.Vector3( 0, 7.8, 0 );
	const crownR = new THREE.Vector3( 5.2, 3.7, 5.2 );
	const flex = ( p ) => Math.min( 1, Math.hypot( p.x, p.z ) / 5 ) * smooth( 3.2, 6.5, p.y );
	const fork = new THREE.Vector3( ...TREE_FORK );

	// trunk with buttress fins at the foot
	const trunkR = ( f, a, c ) => {

		const y = c.y;
		const r = 0.34 - 0.1 * f;
		const fin = Math.pow( Math.max( 0, Math.cos( 4 * a + 0.4 ) ), 4 ) * Math.exp( - Math.max( y, 0 ) / 0.8 );
		return r * ( 1 + 0.9 * fin + 0.25 * Math.exp( - Math.max( y + 0.3, 0 ) / 0.5 ) );

	};

	addBranch( b, new THREE.Vector3( 0, - 0.5, 0 ), fork, 0.34, 0.24, 10, 7, [ 0, 0, 0, 0 ], H, flex, trunkR );

	// limbs to the lobes (the first five from the fork, the rest from the middle of a limb)
	const mids = [];
	TREE_LOBES.forEach( ( L, i ) => {

		const lc = new THREE.Vector3( L[ 0 ], L[ 1 ], L[ 2 ] );
		const end = lc.clone().addScaledVector( lc.clone().sub( crownC ).setY( 0 ).normalize(), - L[ 3 ] * 0.2 ).setY( L[ 1 ] - L[ 3 ] * 0.25 );
		// limbs rise steeply from the fork and spread out (vase-shaped crown), with a random kink
		const bow = ( a, e, k ) => {

			const mid = a.clone().lerp( e, 0.5 );
			const d = e.clone().sub( a );
			const horiz = new THREE.Vector3( d.x, 0, d.z );
			return mid.addScaledVector( horiz, - 0.28 * k ).add( new THREE.Vector3( 0, d.length() * 0.16 * k, 0 ) )
				.add( new THREE.Vector3( ( rand() - 0.5 ) * 0.5, ( rand() - 0.5 ) * 0.3, ( rand() - 0.5 ) * 0.5 ).multiplyScalar( d.length() * 0.25 ) );

		};

		if ( i < 5 ) {

			const start = fork.clone().add( new THREE.Vector3( ( rand() - 0.5 ) * 0.2, - 0.2 - rand() * 0.3, ( rand() - 0.5 ) * 0.2 ) );
			const ctrl = bow( start, end, 1 );
			addLimb( b, start, ctrl, end, 0.18, 0.05, 6, 5, [ 0, 0, 0, 0 ], H, flex );
			// branching point for the secondary limbs: along the curve
			mids.push( start.clone().multiplyScalar( 0.25 ).addScaledVector( ctrl, 0.5 ).addScaledVector( end, 0.25 ) );

		} else {

			let best = mids[ 0 ];
			for ( const m of mids ) if ( m.distanceTo( lc ) < best.distanceTo( lc ) ) best = m;
			addLimb( b, best, bow( best, end, 0.6 ), end, 0.085, 0.03, 4, 3, [ 0, 0, 0, 0 ], H, flex );

		}

	} );

	const cards = [];
	TREE_LOBES.forEach( ( L, i ) => {

		const { cards: cs, tips } = clumpCards( L, i, {
			clumps: Math.round( 3.9 * L[ 3 ] ), clumpR: 0.82, cardsPer: 3, size: 1.45, crownC, crownR, rand, flexFn: flex, hScale: H, part: 1, flatten: 0.72,
		} );
		cards.push( ...cs );
		// short twigs carrying each clump (from part way along the lobe's limb, not one point);
		// only on the two lobes no crown variant drops (twigs don't follow the lobe scaling)
		const base = new THREE.Vector3( L[ 0 ], L[ 1 ] - L[ 3 ] * 0.3, L[ 2 ] );
		if ( i < 2 ) for ( const t of tips ) {

			const from = base.clone().lerp( t.c, 0.4 + rand() * 0.25 ).add( new THREE.Vector3( rand() - 0.5, ( rand() - 0.5 ) * 0.4, rand() - 0.5 ).multiplyScalar( 0.5 ) );
			// ends inside the clump even when the variant shrinks the lobe (no floating twigs)
			addBranch( b, from, from.clone().lerp( t.c, 0.7 ), 0.035, 0.014, 3, 1, [ 0, 0, 0, 0 ], H, flex );

		}

	} );
	emitCards( b, cards, crownC );

	return { geometry: b.build( 14, new THREE.Vector3( 0, 6.5, 0 ) ), triangles: b.triangles };

}

// Shrub: a few leafy lobes on short stems (stems are part 5: bark of a shrub).
export function buildShrubNear( seed = 31, b = new GeoBuilder() ) {

	const rand = mulberry32( seed );
	const crownC = new THREE.Vector3( 0, 0.7, 0 );
	const crownR = new THREE.Vector3( 1.1, 0.75, 1.1 );
	const flex = ( p ) => Math.min( 1, p.y / 1.3 );
	// a few bare stems at the foot
	for ( let i = 0; i < 3; i ++ ) {

		const L = SHRUB_LOBES[ i + 1 ];
		addBranch( b, new THREE.Vector3( 0, - 0.1, 0 ), new THREE.Vector3( L[ 0 ] * 0.6, L[ 1 ] * 0.7, L[ 2 ] * 0.6 ), 0.035, 0.015, 3, 1, [ 5, 0, 0, 0 ], SHRUB_H, flex );

	}

	const cards = [];
	SHRUB_LOBES.forEach( ( L, i ) => cards.push( ...lobeCards( L, i, {
		count: Math.round( 15 * L[ 3 ] ), size: 0.85, crownC, crownR, rand, flexFn: flex, hScale: SHRUB_H, part: 4, flatten: 0.8,
	} ) ) );
	emitCards( b, cards, crownC );

	return { geometry: b.build( 2.2, new THREE.Vector3( 0, 0.7, 0 ) ), triangles: b.triangles };

}

// Per-variant lobe scales (0 = dropped), generated once: trees 3 variants x 8 lobes, then shrubs
// 2 variants x 8 lobes. The near canopy (vertex shader) and the impostor bake read the same table.
export const TREE_VARIANTS = 3;
export const SHRUB_VARIANTS = 2;
export const LOBE_TABLE = ( () => {

	const rand = mulberry32( 4711 );
	const t = new Float32Array( ( TREE_VARIANTS + SHRUB_VARIANTS ) * 8 );
	for ( let v = 0; v < TREE_VARIANTS + SHRUB_VARIANTS; v ++ ) {

		const shrub = v >= TREE_VARIANTS;
		const n = shrub ? SHRUB_LOBES.length : TREE_LOBES.length;
		let dropped = 0;
		for ( let k = 0; k < 8; k ++ ) {

			if ( k >= n ) continue;
			const drop = k >= 2 && rand() < 0.3 && dropped < ( shrub ? 1 : 3 );
			if ( drop ) dropped ++;
			t[ v * 8 + k ] = drop ? 0 : 0.74 + 0.44 * rand();

		}

	}

	return t;

} )();

// Copy of a lobed geometry with the lobe scales of one variant applied on the CPU (for the bake).
export function lobeVariantGeometry( geometry, table, offset ) {

	const pos = geometry.attributes.position;
	const lobe = geometry.attributes.aLobe;
	const src = pos.data.array;
	const stride = pos.data.stride;
	const data = new Float32Array( src );
	for ( let i = 0; i < pos.count; i ++ ) {

		const o = i * stride;
		const id = src[ o + lobe.offset + 3 ];
		if ( id < 0 ) continue;
		const k = 1 - table[ offset + id ];
		data[ o + pos.offset ] += src[ o + lobe.offset ] * k;
		data[ o + pos.offset + 1 ] += src[ o + lobe.offset + 1 ] * k;
		data[ o + pos.offset + 2 ] += src[ o + lobe.offset + 2 ] * k;

	}

	const ib = new THREE.InterleavedBuffer( data, stride );
	const g = new THREE.BufferGeometry();
	for ( const name of Object.keys( geometry.attributes ) ) {

		const a = geometry.attributes[ name ];
		g.setAttribute( name, new THREE.InterleavedBufferAttribute( ib, a.itemSize, a.offset ) );

	}

	g.setIndex( geometry.index );
	g.boundingSphere = geometry.boundingSphere.clone();
	return g;

}

// Merged near geometry of trees + shrubs (one draw call): the vertex shader keeps the tree parts
// (0, 1) for tree instances and the shrub parts (4, 5) for shrub instances.
export function buildCanopyNear() {

	const b = new GeoBuilder();
	const tree = buildTreeNear( 21, b );
	const trees = b.triangles;
	buildShrubNear( 31, b );
	return { geometry: b.build( 14, new THREE.Vector3( 0, 6.5, 0 ) ), triangles: b.triangles, treeTriangles: trees, shrubTriangles: b.triangles - trees };

}

// Merged understory geometry (one draw call): young palm (kind 1), fern (kind 3); the vertex shader
// keeps the plant whose kind matches the instance (floor of its seed). Every instance runs the
// vertices of all kinds in its mesh, so the heavy banana clumps have a mesh of their own.
export const UNDERSTORY = { YOUNG: 1, BANANA: 2, FERN: 3, BANANA_B: 4 };
export function buildUnderstory() {

	const b = new GeoBuilder();
	const tris = {};
	let t0 = 0;
	b.kind = UNDERSTORY.YOUNG; buildYoungPalm( 5, b ); tris.young = b.triangles - t0; t0 = b.triangles;
	b.kind = UNDERSTORY.FERN; buildFern( 3, b ); tris.fern = b.triangles - t0;
	return { geometry: b.build( 4, new THREE.Vector3( 0, 1.5, 0 ) ), triangles: b.triangles, perKind: tris };

}

// Banana clumps: two variants (kinds 2 and 4) in one mesh
export function buildBananas() {

	const b = new GeoBuilder();
	const tris = {};
	let t0 = 0;
	b.kind = UNDERSTORY.BANANA; buildBanana( 9, b ); tris.banana = b.triangles - t0; t0 = b.triangles;
	b.kind = UNDERSTORY.BANANA_B; buildBanana( 23, b ); tris.bananaB = b.triangles - t0;
	return { geometry: b.build( 4, new THREE.Vector3( 0, 1.5, 0 ) ), triangles: b.triangles, perKind: tris };

}


// Broadleaf understory: monstera, elephant ear, heliconia ------------------------------------
//
// A broad leaf is a petiole (thin tube, uv.x < 0) ending in a blade: a grid along the midrib
// (uv.x = y, 0 at the back of the basal lobes .. 1 at the tip) and across it (uv.y = x in units of
// the half-width W, aMat.z). The outline, the monstera slits and holes, tears and veins are cut /
// painted in the fragment shader (VegMaterials: vegPlantMask / vegPlantAlbedo). The grid is only as
// wide as the outline envelope at each y, so few fragments are discarded. Wind: aVeg.y = s (0 at
// the plant base .. 1 at the leaf tip) bends the leaf about the plant centre like the fronds.

// tube along a polyline (petioles, heliconia stems); uv.x in [-1, -0.5] marks it as stem
function addTube( b, pts, { radius, radial = 4, part, age = 0, seed = 0, phase = 0, s0 = 0, s1 = 0.5, W = 0.1 } ) {

	const start = b.count;
	const n = pts.length;
	const T = new THREE.Vector3(), X = new THREE.Vector3(), Y = new THREE.Vector3();
	for ( let i = 0; i < n; i ++ ) {

		T.subVectors( pts[ Math.min( n - 1, i + 1 ) ], pts[ Math.max( 0, i - 1 ) ] ).normalize();
		X.crossVectors( T, _up );
		if ( X.lengthSq() < 1e-4 ) X.set( 1, 0, 0 );
		X.normalize();
		Y.crossVectors( X, T ).normalize();
		const f = i / ( n - 1 );
		const r = radius( f );
		for ( let j = 0; j <= radial; j ++ ) {

			const a = ( j / radial ) * Math.PI * 2;
			_v1.copy( X ).multiplyScalar( Math.cos( a ) ).addScaledVector( Y, Math.sin( a ) );
			_v0.copy( pts[ i ] ).addScaledVector( _v1, r );
			b.vertex( _v0, _v1, - 1 + 0.5 * f, j / radial, [ 1, s0 + ( s1 - s0 ) * f, 0, phase ], [ part, age, W, seed ] );

		}

	}

	for ( let i = 0; i < n - 1; i ++ ) {

		for ( let j = 0; j < radial; j ++ ) {

			const a = start + i * ( radial + 1 ) + j, c = a + radial + 1;
			b.quad( a, a + 1, c + 1, c );

		}

	}

}

// petiole: arches from `origin` (elevation el0) to el1, horizontal direction `dirH`; returns the points
function petiolePoints( origin, dirH, length, el0, el1, segs = 6 ) {

	const pts = [ origin.clone() ];
	const p = origin.clone();
	for ( let k = 0; k < segs; k ++ ) {

		const f = ( k + 0.5 ) / segs;
		const el = el0 + ( el1 - el0 ) * f * f;
		_v0.copy( dirH ).multiplyScalar( Math.cos( el ) ).addScaledVector( _up, Math.sin( el ) );
		p.addScaledVector( _v0, length / segs );
		pts.push( p.clone() );

	}

	return pts;

}

// Blade: attach point, horizontal azimuth `dirH`, blade pitch `pitch` at the attach (0 = level,
// negative = tip down), `bend` (rad, further down toward the tip), `yBack` (share of the blade
// behind the attach: basal lobes / peltate leaves), `env( y )` outline envelope (half-width / W),
// `cup` (edges up (+) / down (-) as a share of W), `roll` (rad, the blade tilts sideways), `wave`
// (margin undulation, share of W).
function addBlade( b, o ) {

	const {
		attach, dirH, pitch, bend, L, W, yBack = 0, env, cup = 0, roll = 0, wave = 0,
		segsY = 8, segsX = 2, part, age = 0, seed = 0, phase = 0, s0 = 0.5, flutter = 0.6,
	} = o;

	const S = new THREE.Vector3( - dirH.z, 0, dirH.x ).normalize(); // side axis (level)
	const rollQ = new THREE.Quaternion();
	const T = new THREE.Vector3(), N = new THREE.Vector3(), Sr = new THREE.Vector3();
	const grid = [];
	// midrib: straight behind the attach, bending down in front of it
	const mid = [];
	const back = attach.clone().addScaledVector( _v0.copy( dirH ).multiplyScalar( Math.cos( pitch ) ).addScaledVector( _up, Math.sin( pitch ) ), - yBack * L );
	const p = back.clone();
	for ( let k = 0; k <= segsY; k ++ ) {

		const y = k / segsY;
		const f = Math.max( 0, ( y - yBack ) / ( 1 - yBack ) );
		const el = pitch - bend * Math.pow( f, 1.4 );
		T.copy( dirH ).multiplyScalar( Math.cos( el ) ).addScaledVector( _up, Math.sin( el ) ).normalize();
		rollQ.setFromAxisAngle( T, roll * ( 0.4 + 0.6 * f ) );
		Sr.copy( S ).applyQuaternion( rollQ );
		N.crossVectors( Sr, T ).normalize();
		mid.push( { p: p.clone(), T: T.clone(), S: Sr.clone(), N: N.clone(), y } );
		if ( k < segsY ) p.addScaledVector( T, L / segsY );

	}

	for ( let k = 0; k <= segsY; k ++ ) {

		const m = mid[ k ];
		const e = Math.max( env( m.y ), 0.02 );
		const row = [];
		for ( let j = - segsX; j <= segsX; j ++ ) {

			const x = j / segsX; // -1 .. 1 of the envelope
			const xa = Math.abs( x );
			const wv = wave * Math.sin( m.y * 23 + seed * 40 + ( x > 0 ? 1.7 : 0 ) ) * xa;
			const q = m.p.clone().addScaledVector( m.S, x * e * W ).addScaledVector( m.N, ( cup * xa * xa + wv ) * e * W );
			row.push( { q, x: x * e, y: m.y, n: m.N } );

		}

		grid.push( row );

	}

	const nx = 2 * segsX;
	const idx = [];
	for ( let k = 0; k <= segsY; k ++ ) {

		const r = [];
		for ( let j = 0; j <= nx; j ++ ) {

			const g = grid[ k ][ j ];
			const ka = Math.max( 0, k - 1 ), kb = Math.min( segsY, k + 1 );
			const ja = Math.max( 0, j - 1 ), jb = Math.min( nx, j + 1 );
			_v1.subVectors( grid[ kb ][ j ].q, grid[ ka ][ j ].q );
			_v2.subVectors( grid[ k ][ jb ].q, grid[ k ][ ja ].q );
			_v3.crossVectors( _v2, _v1 );
			if ( _v3.lengthSq() < 1e-12 ) _v3.copy( g.n );
			_v3.normalize();
			if ( _v3.dot( g.n ) < 0 ) _v3.negate();
			const fl = flutter * Math.abs( g.x ) * smooth( 0.0, 0.6, g.y );
			r.push( b.vertex( g.q, _v3, g.y, g.x, [ 1, s0 + ( 1 - s0 ) * g.y, fl, phase ], [ part, age, W, seed ] ) );

		}

		idx.push( r );

	}

	for ( let k = 0; k < segsY; k ++ ) {

		for ( let j = 0; j < nx; j ++ ) b.quad( idx[ k ][ j ], idx[ k ][ j + 1 ], idx[ k + 1 ][ j + 1 ], idx[ k + 1 ][ j ] );

	}

}

// outline envelopes (half-width / W at y); the shader cuts the exact outline inside them
const heartEnv = ( yBack ) => ( y ) => y < yBack ? 0.75 + 0.3 * ( y / yBack ) : Math.pow( Math.sin( Math.PI * Math.min( 1, 0.5 + 0.5 * ( y - yBack ) / ( 1 - yBack ) ) ), 0.75 ) * 1.02 + 0.02;
const paddleEnv = ( y ) => Math.pow( Math.max( 0, Math.sin( Math.PI * Math.min( 1, y * 1.02 ) ) ), 0.55 ) * 1.02 + 0.02;

// Monstera deliciosa clump: long petioles arching out of the ground, big glossy heart-shaped
// blades with slits and holes (mature), 1-2 small entire juvenile leaves, one old yellowing leaf.
export function buildMonstera( seed = 41, b = new GeoBuilder() ) {

	const rand = mulberry32( seed );
	const n = 8;
	const dirH = new THREE.Vector3();
	for ( let i = 0; i < n; i ++ ) {

		const az = i * 2.39996 + rand() * 0.5;
		dirH.set( Math.cos( az ), 0, Math.sin( az ) );
		// age: juvenile (entire, small, pale) .. mature .. old (yellowing, drooping)
		const age = i === 1 || i === 5 ? 0.1 : i === 6 ? 0.95 : 0.4 + rand() * 0.4;
		const mature = age > 0.3;
		const Lp = ( mature ? 0.65 + rand() * 0.45 : 0.35 + rand() * 0.2 ) * ( age > 0.9 ? 0.8 : 1 );
		const origin = new THREE.Vector3( dirH.x * 0.06, 0.02, dirH.z * 0.06 );
		const pts = petiolePoints( origin, dirH, Lp, 1.35 - rand() * 0.2, ( age > 0.9 ? 0.0 : 0.55 ) + rand() * 0.25, 6 );
		const L = mature ? 0.55 + rand() * 0.35 : 0.28 + rand() * 0.1;
		const W = L * 0.47;
		const ph = rand();
		addTube( b, pts, { radius: ( f ) => 0.016 - 0.005 * f, part: PART.MONSTERA, age, seed: rand(), phase: ph, s0: 0, s1: 0.45 } );
		addBlade( b, {
			attach: pts[ pts.length - 1 ], dirH, pitch: ( age > 0.9 ? - 0.9 : - 0.15 - rand() * 0.35 ), bend: 0.35 + rand() * 0.35,
			L, W, yBack: 0.16, env: heartEnv( 0.16 ), cup: 0.12, roll: ( rand() - 0.5 ) * 0.5, wave: 0.03,
			segsY: 10, segsX: 4, part: PART.MONSTERA, age, seed: rand(), phase: ph, s0: 0.45, flutter: 0.35,
		} );

	}

	return { geometry: b.build( 2.2, new THREE.Vector3( 0, 0.6, 0 ) ), triangles: b.triangles };

}

// Elephant ear (Colocasia): tall upright petioles, huge peltate heart / arrow blades hanging tip down.
export function buildElephantEar( seed = 43, b = new GeoBuilder() ) {

	const rand = mulberry32( seed );
	const n = 8;
	const dirH = new THREE.Vector3();
	for ( let i = 0; i < n; i ++ ) {

		const az = i * 2.39996 + rand() * 0.4;
		dirH.set( Math.cos( az ), 0, Math.sin( az ) );
		const age = i === 6 ? 0.95 : i === 7 ? 0.1 : 0.2 + rand() * 0.5;
		const Lp = ( 0.8 + rand() * 0.6 ) * ( age > 0.9 ? 0.75 : 1 );
		const origin = new THREE.Vector3( dirH.x * 0.05, 0.02, dirH.z * 0.05 );
		const pts = petiolePoints( origin, dirH, Lp, 1.45, ( age > 0.9 ? 0.5 : 1.05 ) + rand() * 0.25, 6 );
		const L = ( 0.75 + rand() * 0.5 ) * ( age < 0.15 ? 0.6 : 1 );
		const W = L * 0.42;
		const ph = rand();
		addTube( b, pts, { radius: ( f ) => 0.03 - 0.014 * f, radial: 5, part: PART.ELEPHANT, age, seed: rand(), phase: ph, s0: 0, s1: 0.5 } );
		addBlade( b, {
			attach: pts[ pts.length - 1 ], dirH, pitch: - 0.45 - rand() * 0.45 - ( age > 0.9 ? 0.5 : 0 ), bend: 0.3 + rand() * 0.25,
			L, W, yBack: 0.3, env: heartEnv( 0.3 ), cup: - 0.1, roll: ( rand() - 0.5 ) * 0.4, wave: 0.05,
			segsY: 9, segsX: 3, part: PART.ELEPHANT, age, seed: rand(), phase: ph, s0: 0.5, flutter: 0.3,
		} );

	}

	return { geometry: b.build( 2.4, new THREE.Vector3( 0, 0.8, 0 ) ), triangles: b.triangles };

}

// Heliconia (bihai type) clump: a few pseudostems with banana-like paddle leaves in one plane, some
// carrying an upright inflorescence of alternating red bracts with yellow lips.
export function buildHeliconia( seed = 47, b = new GeoBuilder() ) {

	const rand = mulberry32( seed );
	const stems = 5;
	const dirH = new THREE.Vector3();
	for ( let i = 0; i < stems; i ++ ) {

		const a = i * 2.39996 + rand() * 0.6;
		const r0 = 0.05 + rand() * 0.22;
		const base = new THREE.Vector3( Math.cos( a ) * r0, 0, Math.sin( a ) * r0 );
		const h = 1.1 + rand() * 1.0;
		const lean = new THREE.Vector3( Math.cos( a ), 0, Math.sin( a ) ).multiplyScalar( 0.08 + rand() * 0.1 );
		const top = base.clone().add( new THREE.Vector3( 0, h, 0 ) ).addScaledVector( lean, h );
		const ph = rand();
		const sd = rand();
		const pts = [];
		for ( let k = 0; k <= 4; k ++ ) pts.push( base.clone().lerp( top, k / 4 ) );
		addTube( b, pts, { radius: ( f ) => 0.028 - 0.012 * f, radial: 5, part: PART.HELICONIA, age: 0.3, seed: sd, phase: ph, s0: 0, s1: 0.55 } );
		// distichous leaves: alternate sides of one plane per stem
		const plane = rand() * Math.PI;
		const nl = 3 + Math.floor( rand() * 2 );
		for ( let k = 0; k < nl; k ++ ) {

			const side = k % 2 ? 1 : - 1;
			const az = plane + ( side > 0 ? 0 : Math.PI ) + ( rand() - 0.5 ) * 0.3;
			dirH.set( Math.cos( az ), 0, Math.sin( az ) );
			const at = base.clone().lerp( top, 0.45 + 0.5 * ( k / nl ) );
			const age = k === 0 && rand() < 0.5 ? 0.95 : 0.2 + rand() * 0.4;
			const Lp = 0.15 + rand() * 0.15;
			const lp = petiolePoints( at, dirH, Lp, 1.2, 1.0, 3 );
			addTube( b, lp, { radius: () => 0.01, radial: 3, part: PART.HELICONIA, age, seed: sd, phase: ph, s0: 0.5, s1: 0.6 } );
			const L = 0.8 + rand() * 0.5;
			addBlade( b, {
				attach: lp[ lp.length - 1 ], dirH, pitch: ( age > 0.9 ? - 0.4 : 0.85 + rand() * 0.3 ), bend: ( age > 0.9 ? 1.4 : 0.9 + rand() * 0.5 ),
				L, W: L * 0.15, yBack: 0, env: paddleEnv, cup: 0.25, roll: ( rand() - 0.5 ) * 0.6, wave: 0.02,
				segsY: 7, segsX: 1, part: PART.HELICONIA, age, seed: rand(), phase: ph, s0: 0.6, flutter: 0.6,
			} );

		}

		// inflorescence on some stems: an upright zig-zag of boat-shaped bracts above the leaves
		if ( rand() < 0.6 ) {

			const nb = 6 + Math.floor( rand() * 3 );
			const H0 = top.clone();
			const Lax = 0.45 + rand() * 0.15;
			const baz = plane + Math.PI * 0.5;
			for ( let k = 0; k < nb; k ++ ) {

				const f = k / ( nb - 1 );
				const at = H0.clone().add( new THREE.Vector3( 0, Lax * f * 0.9 + 0.04, 0 ) );
				const az = baz + ( k % 2 ? 0 : Math.PI );
				dirH.set( Math.cos( az ), 0, Math.sin( az ) );
				const L = 0.22 * ( 1 - 0.45 * f );
				addBlade( b, {
					attach: at, dirH, pitch: 0.5, bend: - 0.35, L, W: L * 0.3, yBack: 0, env: ( y ) => Math.sin( Math.PI * Math.min( 1, 0.15 + y * 0.9 ) ) * 1.02 + 0.05,
					cup: 1.2, segsY: 3, segsX: 1, part: PART.BRACT, age: f, seed: rand(), phase: ph, s0: 0.62, flutter: 0.05,
				} );

			}

			const ax = [ H0.clone(), H0.clone().add( new THREE.Vector3( 0, Lax, 0 ) ) ];
			addTube( b, ax, { radius: () => 0.009, radial: 3, part: PART.BRACT, age: 0, seed: sd, phase: ph, s0: 0.6, s1: 0.65 } );

		}

	}

	return { geometry: b.build( 2.8, new THREE.Vector3( 0, 1.2, 0 ) ), triangles: b.triangles };

}

// Bird of paradise (Strelitzia reginae): a fan of stiff, upright grey-green paddle leaves on long
// petioles, flowers on stalks among them: a horizontal green-purple beak (spathe) with orange sepals
// and a blue tongue standing out of it.
export function buildStrelitzia( seed = 53, b = new GeoBuilder() ) {

	const rand = mulberry32( seed );
	const dirH = new THREE.Vector3();
	const n = 11;
	for ( let i = 0; i < n; i ++ ) {

		// fan: mostly in one plane (distichous), spread a little
		const side = i % 2 ? 1 : - 1;
		const az = 0.3 + ( side > 0 ? 0 : Math.PI ) + ( rand() - 0.5 ) * 0.9;
		dirH.set( Math.cos( az ), 0, Math.sin( az ) );
		const age = i === 9 ? 0.95 : 0.2 + rand() * 0.5;
		const Lp = 0.55 + rand() * 0.45;
		const origin = new THREE.Vector3( ( rand() - 0.5 ) * 0.12, 0.02, ( rand() - 0.5 ) * 0.12 );
		const pts = petiolePoints( origin, dirH, Lp, 1.45, ( age > 0.9 ? 0.6 : 1.15 ) + rand() * 0.2, 4 );
		const L = 0.45 + rand() * 0.2;
		const ph = rand();
		addTube( b, pts, { radius: ( f ) => 0.012 - 0.004 * f, radial: 3, part: PART.STRELITZIA, age, seed: rand(), phase: ph, s0: 0, s1: 0.5 } );
		addBlade( b, {
			attach: pts[ pts.length - 1 ], dirH, pitch: ( age > 0.9 ? 0.2 : 1.0 + rand() * 0.3 ), bend: 0.25 + rand() * 0.2,
			L, W: L * 0.2, yBack: 0, env: paddleEnv, cup: 0.2, roll: ( rand() - 0.5 ) * 0.5, wave: 0.02,
			segsY: 5, segsX: 1, part: PART.STRELITZIA, age, seed: rand(), phase: ph, s0: 0.5, flutter: 0.2,
		} );

	}

	const flowers = 2 + Math.floor( rand() * 2 );
	for ( let i = 0; i < flowers; i ++ ) {

		const az = rand() * Math.PI * 2;
		dirH.set( Math.cos( az ), 0, Math.sin( az ) );
		const base = new THREE.Vector3( ( rand() - 0.5 ) * 0.15, 0.02, ( rand() - 0.5 ) * 0.15 );
		const top = base.clone().add( new THREE.Vector3( dirH.x * 0.08, 0.85 + rand() * 0.3, dirH.z * 0.08 ) );
		const ph = rand();
		addTube( b, [ base, base.clone().lerp( top, 0.5 ), top ], { radius: () => 0.01, radial: 3, part: PART.STRELITZIA, age: 0.3, seed: rand(), phase: ph, s0: 0, s1: 0.55 } );
		// spathe: a boat-shaped beak held level
		addBlade( b, {
			attach: top, dirH, pitch: 0.12, bend: 0.15, L: 0.19, W: 0.022, yBack: 0.1, env: ( y ) => Math.sin( Math.PI * Math.min( 1, 0.1 + y * 0.95 ) ) * 1.05 + 0.08,
			cup: 1.5, segsY: 4, segsX: 1, part: PART.BIRD, age: 0, seed: rand(), phase: ph, s0: 0.55, flutter: 0.02,
		} );
		// orange sepals fanning up and forward out of the beak, the blue tongue among them
		const at = top.clone().addScaledVector( dirH, 0.05 ).add( new THREE.Vector3( 0, 0.02, 0 ) );
		for ( let k = 0; k < 3; k ++ ) {

			const a2 = az + ( k - 1 ) * 0.35;
			const d2 = new THREE.Vector3( Math.cos( a2 ), 0, Math.sin( a2 ) );
			addBlade( b, {
				attach: at, dirH: d2, pitch: 1.0 + ( rand() - 0.5 ) * 0.3, bend: - 0.3, L: 0.11 + rand() * 0.03, W: 0.012, yBack: 0, env: ( y ) => Math.sin( Math.PI * Math.min( 1, 0.2 + y * 0.8 ) ) + 0.1,
				cup: 0.3, segsY: 2, segsX: 1, part: PART.BIRD, age: 0.5, seed: rand(), phase: ph, s0: 0.6, flutter: 0.05,
			} );

		}

		addBlade( b, {
			attach: at, dirH, pitch: 0.55, bend: 0.1, L: 0.09, W: 0.008, yBack: 0, env: () => 0.9,
			cup: 0.4, segsY: 2, segsX: 1, part: PART.BIRD, age: 1, seed: rand(), phase: ph, s0: 0.6, flutter: 0.05,
		} );

	}

	return { geometry: b.build( 1.8, new THREE.Vector3( 0, 0.7, 0 ) ), triangles: b.triangles };

}

// Broadleaf geometry; kinds continue after the understory's so the shared deformation's per-kind
// rules (fern fade) never match. Monstera (by far the most numerous) has a mesh of its own; elephant
// ears and heliconias share one (one draw call each).
export const BROADLEAF = { MONSTERA: 11, ELEPHANT: 12, HELICONIA: 13, STRELITZIA: 14 };
export function buildMonsteraMesh() {

	const b = new GeoBuilder();
	b.kind = BROADLEAF.MONSTERA; buildMonstera( 41, b );
	return { geometry: b.build( 2.2, new THREE.Vector3( 0, 0.6, 0 ) ), triangles: b.triangles };

}

export function buildBroadleaf() {

	const b = new GeoBuilder();
	const tris = {};
	let t0 = 0;
	b.kind = BROADLEAF.ELEPHANT; buildElephantEar( 43, b ); tris.elephant = b.triangles - t0; t0 = b.triangles;
	b.kind = BROADLEAF.HELICONIA; buildHeliconia( 47, b ); tris.heliconia = b.triangles - t0; t0 = b.triangles;
	b.kind = BROADLEAF.STRELITZIA; buildStrelitzia( 53, b ); tris.strelitzia = b.triangles - t0;
	return { geometry: b.build( 3, new THREE.Vector3( 0, 1, 0 ) ), triangles: b.triangles, perKind: tris };

}
