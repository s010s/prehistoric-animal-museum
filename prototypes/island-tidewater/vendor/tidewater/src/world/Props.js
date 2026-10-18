import { Color, Matrix4, Vector3 } from '../engine/index.js';
import { Builder, mat4, gridPart, slabPart, sagPoints } from './village/GeoBuilder.js';
import { FishProps } from './fish/FishProps.js';
import { mulberry32 } from '../util/Noise.js';

// Procedural harbour / village props. Every emitter writes into a GeoBuilder `B`
// (in B's current local frame) using the shared material keys:
//   wood, roofMetal, thatch, hard, glass, stone, rope, net, cloth, flag

const _col = new Color();
const _v = new Vector3();

// sRGB hex -> linear [r, g, b]
export const lin = ( hex ) => {

	_col.setHex( hex );
	return [ _col.r, _col.g, _col.b ];

};

export const mulc = ( c, k ) => [ c[ 0 ] * k, c[ 1 ] * k, c[ 2 ] * k ];

// vdata helpers
export const WOOD = ( seed, weather = 0.7, paint = 0, pattern = 0 ) => [ seed, paint, pattern, weather ];
export const HARD = ( seed, rust = 0, metal = 0, rough = 0.5 ) => [ seed, rust, metal, rough ];

export const C = {
	iron: lin( 0x1d1c1b ),
	galv: lin( 0x9aa0a2 ),
	rubber: lin( 0x141414 ),
	brass: lin( 0xb08d4a ),
	rope: lin( 0xb49a6c ),
	ropeDark: lin( 0x7d6a4a ),
	ropeBlue: lin( 0x3e6f8e ),
	white: lin( 0xf2efe6 ),
	orange: lin( 0xe8622a ),
	red: lin( 0xc23b2e ),
	yellow: lin( 0xf0c23a ),
	green: lin( 0x3f7f55 ),
	blue: lin( 0x2f6fa8 ),
	black: lin( 0x202020 ),
	fishSilver: lin( 0x9aa6ad ),
	fishDry: lin( 0x8a6a45 ),
	glassWarm: lin( 0xfff0d0 ),
	straw: lin( 0xc9b27a ),
};

// simple seeded random helper wrapper
export class Rand {

	constructor( fn ) {

		this.fn = fn;

	}

	next() {

		return this.fn();

	}

	range( a, b ) {

		return a + ( b - a ) * this.fn();

	}

	int( a, b ) {

		return Math.floor( this.range( a, b + 1 ) );

	}

	pick( arr ) {

		return arr[ Math.floor( this.fn() * arr.length ) % arr.length ];

	}

	chance( p ) {

		return this.fn() < p;

	}

}

// ---------------------------------------------------------------------------
// Mooring hardware

export function bollard( B, x, y, z, seed = 0.5 ) {

	B.lathe( 'hard', x, y, z, [
		[ 0.0, 0.0 ], [ 0.21, 0.0 ], [ 0.21, 0.045 ], [ 0.21, 0.045 ], [ 0.14, 0.075 ], [ 0.115, 0.14 ],
		[ 0.11, 0.3 ], [ 0.125, 0.37 ], [ 0.175, 0.41 ], [ 0.18, 0.45 ], [ 0.14, 0.49 ], [ 0.0, 0.5 ],
	], { segs: 14, tint: C.iron, data: HARD( seed, 0.3, 0.35, 0.5 ) } );
	for ( let i = 0; i < 4; i ++ ) {

		const a = i / 4 * Math.PI * 2 + Math.PI / 4;
		B.cyl( 'hard', x + Math.cos( a ) * 0.17, y + 0.045, z + Math.sin( a ) * 0.17, 0.018, 0.022, 0.025, { segs: 6, tint: C.iron, data: HARD( seed, 0.8, 0.4, 0.6 ) } );

	}

}

export function cleat( B, x, y, z, ry = 0, seed = 0.5 ) {

	const t = C.iron, d = HARD( seed, 0.5, 0.4, 0.5 );
	B.pushAt( x, y, z, ry );
	B.box( 'hard', 0, 0.012, 0, 0.26, 0.024, 0.09, { tint: t, data: d } );
	B.box( 'hard', - 0.065, 0.055, 0, 0.05, 0.07, 0.055, { tint: t, data: d } );
	B.box( 'hard', 0.065, 0.055, 0, 0.05, 0.07, 0.055, { tint: t, data: d } );
	B.rod( 'hard', [ 0, 0.1, 0 ], [ 0.2, 0.1, 0 ], 0.026, 0.013, { segs: 8, tint: t, data: d } );
	B.rod( 'hard', [ 0, 0.1, 0 ], [ - 0.2, 0.1, 0 ], 0.026, 0.013, { segs: 8, tint: t, data: d } );
	B.pop();

}

// tire fender hanging against a vertical face; ry = direction the face points to
export function tireFender( B, x, yTop, z, ry = 0, drop = 0.7, seed = 0.5 ) {

	B.pushAt( x, 0, z, ry );
	const cy = yTop - drop;
	B.torus( 'hard', 0.12, cy, 0, 0.27, 0.1, { rz: Math.PI / 2, radial: 7, tubular: 16, tint: C.rubber, data: HARD( seed, 0, 0, 0.82 ) } );
	B.tube( 'rope', sagPoints( [ - 0.05, yTop + 0.02, 0 ], [ 0.12, cy + 0.33, 0 ], 0.02, 4 ), 0.016, { tint: C.rope, data: [ seed, 0, 0, 0 ] } );
	B.pop();

}

export function ropeCoil( B, x, y, z, r0 = 0.09, r1 = 0.32, turns = 5, seed = 0.5, tint = C.rope ) {

	const pts = [];
	const n = turns * 12;
	for ( let i = 0; i <= n; i ++ ) {

		const t = i / n;
		const a = t * turns * Math.PI * 2;
		const r = r0 + ( r1 - r0 ) * t;
		pts.push( new Vector3( x + Math.cos( a ) * r, y + 0.02 + Math.sin( a * 3.1 ) * 0.004, z + Math.sin( a ) * r ) );

	}

	// loose tail
	const last = pts[ pts.length - 1 ];
	pts.push( new Vector3( last.x + 0.25, y + 0.02, last.z + 0.3 ) );
	B.tube( 'rope', pts, 0.02, { radial: 4, tint, data: [ seed, 0, 0, 0 ] } );
	// a second, smaller layer on top
	const pts2 = [];
	for ( let i = 0; i <= 24; i ++ ) {

		const a = i / 24 * Math.PI * 4 + 1.3;
		const r = r0 + 0.05 + ( r1 - r0 - 0.1 ) * i / 24;
		pts2.push( new Vector3( x + Math.cos( a ) * r, y + 0.055, z + Math.sin( a ) * r ) );

	}

	B.tube( 'rope', pts2, 0.02, { radial: 4, tint, data: [ seed + 0.3, 0, 0, 0 ] } );

}

// rope loop thrown over a bollard / post with a tail dropping over the edge
export function ropeLoop( B, x, y, z, R, tailTo = null, seed = 0.5 ) {

	B.torus( 'rope', x, y, z, R, 0.022, { rx: 0.18, rz: 0.1, radial: 5, tubular: 14, tint: C.rope, data: [ seed, 0, 0, 0 ] } );
	if ( tailTo ) {

		B.tube( 'rope', sagPoints( [ x + R * 0.8, y - 0.02, z ], tailTo, 0.15, 8 ), 0.022, { tint: C.rope, data: [ seed, 0, 0, 0 ] } );

	}

}

export function lifeRing( B, x, y, z, ry = 0, seed = 0.5 ) {

	const orange = C.orange, white = C.white;
	B.pushAt( x, y, z, ry );
	B.torus( 'hard', 0, 0, 0, 0.29, 0.06, {
		rx: Math.PI / 2, radial: 8, tubular: 24,
		tint: ( px, py, pz ) => ( Math.floor( ( Math.atan2( pz, px ) + Math.PI ) / ( Math.PI / 4 ) + 0.5 ) % 2 ? white : orange ),
		data: HARD( seed, 0, 0, 0.55 ),
	} );
	B.torus( 'rope', 0, 0, 0, 0.345, 0.012, { rx: Math.PI / 2, radial: 4, tubular: 24, tint: C.white, data: [ seed, 0, 0, 0 ] } );
	B.pop();

}

// ---------------------------------------------------------------------------
// Lighting fixtures

// hanging lantern; (x, y, z) = hook point. Returns the local center of the glass.
export function lantern( B, x, y, z, seed = 0.5, scale = 1 ) {

	const s = scale;
	const t = C.iron, d = HARD( seed, 0.35, 0.5, 0.45 );
	B.torus( 'hard', x, y - 0.02 * s, z, 0.02 * s, 0.005 * s, { rx: Math.PI / 2, radial: 3, tubular: 6, tint: t, data: d } );
	B.cyl( 'hard', x, y - 0.13 * s, z, 0.02 * s, 0.12 * s, 0.1 * s, { segs: 6, capTop: true, capBot: true, tint: t, data: d } );
	B.cyl( 'hard', x, y - 0.155 * s, z, 0.125 * s, 0.125 * s, 0.025 * s, { segs: 6, capBot: true, tint: t, data: d } );
	const gy = y - 0.355 * s;
	B.cyl( 'glass', x, gy, z, 0.085 * s, 0.075 * s, 0.2 * s, { segs: 6, capTop: false, tint: C.glassWarm, data: [ seed, 1, 1, 0 ] } );
	for ( let i = 0; i < 4; i ++ ) {

		const a = i / 4 * Math.PI * 2 + Math.PI / 4;
		B.box( 'hard', x + Math.cos( a ) * 0.085 * s, gy + 0.1 * s, z + Math.sin( a ) * 0.085 * s, 0.014 * s, 0.2 * s, 0.014 * s, { skip: 12, tint: t, data: d } );

	}

	B.cyl( 'hard', x, gy - 0.04 * s, z, 0.1 * s, 0.07 * s, 0.04 * s, { segs: 6, capBot: true, tint: t, data: d } );
	return [ x, gy + 0.1 * s, z ];

}

// Wall-mounted porch light: bracket out of a wall facing +z. Returns glass center (world).
export function wallLantern( B, x, y, z, seed = 0.5 ) {

	const t = C.iron, d = HARD( seed, 0.3, 0.5, 0.45 );
	B.box( 'hard', x, y, z + 0.01, 0.08, 0.16, 0.02, { tint: t, data: d } );
	B.rod( 'hard', [ x, y + 0.02, z + 0.01 ], [ x, y + 0.05, z + 0.2 ], 0.01, 0.01, { segs: 5, tint: t, data: d } );
	const c = lantern( B, x, y + 0.05, z + 0.2, seed, 0.75 );
	return B.toWorld( c[ 0 ], c[ 1 ], c[ 2 ] );

}

// Wooden lamp post with iron arm and lantern. armDir: yaw the arm points to. Returns lantern center (local).
export function lampPost( B, x, y, z, armYaw, h = 3.2, seed = 0.5 ) {

	const wd = WOOD( seed, 0.75, 0.62, 0 );
	const pc = lin( 0xd6cfbd );
	B.box( 'wood', x, y + h / 2, z, 0.14, h, 0.14, { grain: 1, tint: pc, data: wd } );
	B.box( 'wood', x, y + h + 0.03, z, 0.18, 0.06, 0.18, { grain: 0, tint: pc, data: wd } );
	B.pushAt( x, y, z, armYaw );
	const t = C.iron, d = HARD( seed, 0.35, 0.5, 0.45 );
	const ay = h - 0.18;
	B.box( 'hard', 0, ay, 0.35, 0.035, 0.035, 0.62, { tint: t, data: d } );
	B.rod( 'hard', [ 0, ay - 0.35, 0.075 ], [ 0, ay - 0.01, 0.4 ], 0.012, 0.012, { segs: 5, tint: t, data: d } );
	B.torus( 'hard', 0, ay - 0.08, 0.2, 0.08, 0.008, { ry: Math.PI / 2, rz: Math.PI / 2, radial: 3, tubular: 8, tint: t, data: d } );
	const c = lantern( B, 0, ay - 0.02, 0.6, seed );
	const w = B.toWorld( c[ 0 ], c[ 1 ], c[ 2 ] );
	B.pop();
	return w;

}

// low boardwalk / path light: short post with a lantern on top. Returns world light position.
export function pathLight( B, x, y, z, seed = 0.5 ) {

	const wd = WOOD( seed, 0.8, 0, 0 );
	B.box( 'wood', x, y + 0.55, z, 0.12, 1.1, 0.12, { grain: 1, tint: [ 1, 1, 1 ], data: wd } );
	B.box( 'wood', x, y + 1.12, z, 0.16, 0.04, 0.16, { grain: 0, tint: [ 1, 1, 1 ], data: wd } );
	const t = C.iron, d = HARD( seed, 0.35, 0.5, 0.45 );
	const gy = y + 1.14;
	B.cyl( 'hard', x, gy, z, 0.07, 0.07, 0.03, { segs: 8, capBot: true, tint: t, data: d } );
	B.cyl( 'glass', x, gy + 0.03, z, 0.06, 0.06, 0.15, { segs: 8, capTop: false, tint: C.glassWarm, data: [ seed, 1, 1, 0 ] } );
	B.cyl( 'hard', x, gy + 0.18, z, 0.015, 0.1, 0.07, { segs: 8, capBot: true, tint: t, data: d } );
	return B.toWorld( x, gy + 0.1, z );

}

// ---------------------------------------------------------------------------
// Furniture

export function bench( B, x, y, z, ry = 0, len = 1.6, seed = 0.5, paint = null ) {

	B.pushAt( x, y, z, ry );
	const tint = paint || [ 1, 1, 1 ];
	const wd = ( s ) => WOOD( s, 0.8, paint ? 0.55 : 0, 0 );
	for ( let i = 0; i < 3; i ++ ) B.box( 'wood', 0, 0.44, - 0.13 + i * 0.13, len, 0.04, 0.11, { grain: 0, tint, data: wd( seed + i * 0.1 ) } );
	for ( const sx of [ - len / 2 + 0.15, len / 2 - 0.15 ] ) {

		B.box( 'wood', sx, 0.21, - 0.13, 0.07, 0.42, 0.07, { grain: 1, tint, data: wd( seed + 0.5 ) } );
		B.box( 'wood', sx, 0.21, 0.13, 0.07, 0.42, 0.07, { grain: 1, tint, data: wd( seed + 0.6 ) } );
		B.box( 'wood', sx, 0.4, 0, 0.06, 0.05, 0.4, { grain: 2, tint, data: wd( seed + 0.7 ) } );
		B.beam( 'wood', [ sx, 0.42, - 0.2 ], [ sx, 0.9, - 0.28 ], 0.06, 0.05, { tint, data: wd( seed + 0.8 ) } );

	}

	B.box( 'wood', 0, 0.68, - 0.245, len, 0.1, 0.03, { grain: 0, rx: - 0.16, tint, data: wd( seed + 0.3 ) } );
	B.box( 'wood', 0, 0.84, - 0.27, len, 0.1, 0.03, { grain: 0, rx: - 0.16, tint, data: wd( seed + 0.4 ) } );
	B.pop();

}

export function bucket( B, x, y, z, tint = C.blue, seed = 0.5 ) {

	B.lathe( 'hard', x, y, z, [
		[ 0.0, 0.0 ], [ 0.1, 0.0 ], [ 0.1, 0.0 ], [ 0.135, 0.28 ], [ 0.142, 0.295 ], [ 0.13, 0.29 ], [ 0.095, 0.03 ], [ 0.0, 0.03 ],
	], { segs: 12, tint, data: HARD( seed, 0, 0, 0.5 ) } );
	B.torus( 'hard', x, y + 0.29, z, 0.14, 0.006, { rz: Math.PI / 2, arc: Math.PI, radial: 4, tubular: 10, tint: C.galv, data: HARD( seed, 0.2, 0.8, 0.4 ) } );

}

// ---------------------------------------------------------------------------
// Fish, lobsters and their displays: modelled and drawn by fish/FishProps.js (one instanced mesh
// with the fish material, collected on the builder as B.fishProps).

const _fm = new Matrix4();
const fishProps = ( B ) => B.fishProps || ( B.fishProps = new FishProps() );

// A fish in B's local frame. o.pose:
//   'side': lying on its side, nose toward local +x; (x, y, z) = the surface under its middle
//   'tail': hung by the tail, nose down, left flank toward local +z; (x, y, z) = the twine loop
//           ('split' fish: the flesh side faces +z)
//   'gill': hung from a hook through the gill cover and mouth, nose up; (x, y, z) = the hook
// o: species (fish/FishSpecies.js), len (m), ry / rx / rz (rotation of the placement, as for the
//   other props), flip (the other flank up), curl / sag (sideways / up-down bend, 1 / length), jaw
//   (mouth opening, rad), kind ('whole', 'split' (salted, butterflied), 'head' / 'trunk' (cut
//   behind the head)), seed, cloudy (eyes), wet, dried, blood (gills, cut faces)
export function fish( B, x, y, z, o = {} ) {

	const species = o.species || 'redSnapper', len = o.len || 0.4, kind = o.kind || 'whole';
	let pose = o.pose || 'side';
	let anchor = [ 0, 0, 0 ];
	let py = y;
	if ( pose === 'tail' ) {

		anchor = FishProps.tailAnchor( species );
		if ( kind === 'split' ) pose = 'tailFlat';

	} else if ( pose === 'gill' ) anchor = FishProps.gillAnchor( species );
	else {

		py += kind === 'split' ? 0.012 : FishProps.restHeight( species, len );
		if ( o.flip ) pose = 'sideFlip';

	}

	mat4( x, py, z, o.ry || 0, o.rx || 0, o.rz || 0, _fm );
	_fm.premultiply( B.frame );
	fishProps( B ).add( kind, species, _fm, pose, len, { ...o, anchor } );

}

// Crushed ice heaped in a basin of inner radius r, on the basin floor at (x, y, z).
export function iceBed( B, x, y, z, r, seed = 0.5 ) {

	mat4( x, y, z, seed * 6.28, 0, 0, _fm );
	_fm.premultiply( B.frame );
	fishProps( B ).add( 'ice', null, _fm, 'flat', r, { seed, flags: 0 } );

}

// A torn banana leaf lying flat, from its stalk end at (x, y, z) toward local +x (rotated by ry),
// its tip raised by the angle tilt.
export function bananaLeaf( B, x, y, z, ry = 0, len = 0.9, seed = 0.5, tilt = 0 ) {

	mat4( x, y, z, ry, 0, tilt, _fm );
	_fm.premultiply( B.frame );
	fishProps( B ).add( 'leaf', null, _fm, 'flat', len, { seed, anchor: [ 0, 0, 0 ] } );

}

// Caribbean spiny lobster (body length len without the antennae) resting on (x, y, z), head
// toward local +x.
export function lobster( B, x, y, z, ry = 0, len = 0.3, seed = 0.5, rx = 0 ) {

	mat4( x, y + len * 0.035, z, ry, rx, 0, _fm );
	_fm.premultiply( B.frame );
	fishProps( B ).add( 'lobster', null, _fm, 'flat', len, { seed } );

}

// Twine from (a) down to a loop around a fish's tail stalk at (b).
export function fishTwine( B, a, b, seed = 0.5, loop = 0.018 ) {

	B.tube( 'rope', [ new Vector3( a[ 0 ], a[ 1 ], a[ 2 ] ), new Vector3( b[ 0 ], b[ 1 ] + loop * 0.5, b[ 2 ] ) ], 0.0035, { radial: 3, tint: C.rope, data: [ seed, 0, 0, 0 ] } );
	const pts = [];
	for ( let i = 0; i <= 8; i ++ ) {

		const t = i / 8 * Math.PI * 2;
		pts.push( new Vector3( b[ 0 ] + Math.cos( t ) * loop, b[ 1 ] + Math.sin( t * 2 ) * 0.003, b[ 2 ] + Math.sin( t ) * loop * 0.6 ) );

	}

	B.tube( 'rope', pts, 0.003, { radial: 3, tint: C.rope, data: [ seed, 0, 0, 0 ] } );

}

// Galvanised S-hook hanging from a rail of radius railR at (x, yRail, z); the fish hangs from its
// lower bend, at y = yRail - railR - 0.12 (returned).
export function sHook( B, x, yRail, z, railR = 0.06, seed = 0.5 ) {

	const d = HARD( seed, 0.35, 0.85, 0.35 );
	const r = railR + 0.012;
	B.torus( 'hard', x, yRail, z, r, 0.0045, { ry: Math.PI / 2, arc: Math.PI * 1.25, rz: - Math.PI * 0.1, radial: 4, tubular: 8, tint: C.galv, data: d } );
	const y0 = yRail - r;
	B.rod( 'hard', [ x, y0 + 0.004, z - 0.004 ], [ x, y0 - 0.08, z ], 0.0045, 0.0045, { segs: 4, tint: C.galv, data: d } );
	B.torus( 'hard', x, y0 - 0.1, z, 0.022, 0.0045, { ry: Math.PI / 2, rz: Math.PI, arc: Math.PI * 1.2, radial: 4, tubular: 8, tint: C.galv, data: d } );
	return y0 - 0.12;

}

export function cleaningTable( B, x, y, z, ry = 0, seed = 0.5 ) {

	B.pushAt( x, y, z, ry );
	const wd = ( s ) => WOOD( s, 0.75, 0, 0 );
	for ( let i = 0; i < 5; i ++ ) B.box( 'wood', 0, 0.88, - 0.26 + i * 0.13, 1.35, 0.045, 0.12, { grain: 0, data: wd( seed + i * 0.13 ) } );
	for ( const sx of [ - 0.6, 0.6 ] ) for ( const sz of [ - 0.27, 0.27 ] ) B.box( 'wood', sx, 0.43, sz, 0.07, 0.86, 0.07, { grain: 1, data: wd( seed + sx + sz ) } );
	B.box( 'wood', 0, 0.25, 0, 1.25, 0.03, 0.5, { grain: 0, data: wd( seed + 0.9 ) } );
	B.box( 'wood', 0, 0.8, - 0.28, 1.25, 0.1, 0.03, { grain: 0, data: wd( seed + 0.4 ) } );
	// cutting board with a snapper cut behind the head, the knife beside it
	B.box( 'wood', 0.2, 0.915, 0.02, 0.56, 0.025, 0.34, { grain: 0, tint: [ 1.25, 1.2, 1.1 ], data: WOOD( seed + 0.2, 0.25, 0, 0 ) } );
	const board = 0.928;
	const cut = { species: 'redSnapper', len: 0.44, ry: 0.12, sag: 0.08, blood: 1, cloudy: 0.5, seed, jaw: 0.25 };
	fish( B, 0.17, board, 0.02, { ...cut, kind: 'trunk' } );
	fish( B, 0.21, board, 0.035, { ...cut, kind: 'head', ry: 0.4 } );
	// fillet knife: steel blade, dark wooden handle with brass rivets
	B.pushAt( 0.26, board + 0.002, 0.13, - 0.45 );
	const blade = [ [ 0, 0.011 ], [ 0.13, 0.009 ], [ 0.175, 0.002 ], [ 0.19, - 0.004 ], [ 0.12, - 0.009 ], [ 0, - 0.01 ] ].map( ( p ) => new Vector3( p[ 0 ], 0, p[ 1 ] ) );
	B.slab( 'hard', blade, 0.0016, { up: new Vector3( 0, 1, 0 ), tint: lin( 0xc8ccd0 ), data: HARD( seed, 0.05, 0.95, 0.18 ) } );
	B.box( 'wood', - 0.055, 0.009, 0, 0.11, 0.018, 0.024, { grain: 0, tint: C.black, data: WOOD( seed, 0.2, 0.8, 0 ) } );
	for ( const rx of [ - 0.085, - 0.03 ] ) B.cyl( 'hard', rx, 0.0175, 0, 0.0035, 0.0035, 0.002, { segs: 5, tint: lin( 0xb08d3a ), data: HARD( seed, 0.1, 0.9, 0.3 ) } );
	B.pop();
	// blood from the cut, smeared on the board
	const smear = [];
	for ( let i = 0; i < 9; i ++ ) {

		const a = i / 9 * Math.PI * 2;
		smear.push( new Vector3( 0.215 + Math.cos( a ) * 0.05 * ( 1 + 0.25 * Math.sin( a * 3 + seed * 9 ) ), board + 0.0005, 0.04 + Math.sin( a ) * 0.028 ) );

	}

	B.slab( 'hard', smear, 0.0008, { up: new Vector3( 0, 1, 0 ), tint: lin( 0x4a0808 ), data: HARD( seed, 0, 0, 0.15 ) } );
	// a blackfin tuna waiting its turn
	fish( B, - 0.33, 0.9025, - 0.06, { species: 'tuna', len: 0.52, ry: 2.75, sag: - 0.12, curl: 0.05, jaw: 0.3, seed: seed + 0.3 } );
	bucket( B, - 0.3, 0.265, 0.05, C.white, seed );
	B.pop();

}

// ---------------------------------------------------------------------------
// Fishing gear

// Fisherman's float. kind 0: egg float, 1: lobster spar buoy, 2: round float
export function buoy( B, x, y, z, colA, colB, kind = 0, seed = 0.5, o = {} ) {

	B.pushAt( x, y, z, o.ry || 0, o.rx || 0, o.rz || 0 );
	const d = HARD( seed, 0, 0, 0.42 );
	if ( kind === 0 ) {

		B.lathe( 'hard', 0, 0, 0, [ [ 0.0, 0.0 ], [ 0.08, 0.025 ], [ 0.125, 0.12 ], [ 0.1, 0.25 ], [ 0.04, 0.305 ], [ 0.0, 0.31 ] ], {
			segs: 8, tint: ( px, py ) => ( py > 0.15 ? colA : colB ), data: d,
		} );
		B.torus( 'hard', 0, 0.335, 0, 0.025, 0.008, { rx: Math.PI / 2, radial: 3, tubular: 6, tint: C.black, data: d } );

	} else if ( kind === 1 ) {

		B.lathe( 'hard', 0, 0, 0, [ [ 0.0, 0.0 ], [ 0.05, 0.0 ], [ 0.09, 0.08 ], [ 0.09, 0.32 ], [ 0.05, 0.4 ], [ 0.0, 0.4 ] ], {
			segs: 8, tint: ( px, py ) => ( py > 0.14 && py < 0.26 ? colB : colA ), data: d,
		} );
		B.cyl( 'wood', 0, 0.38, 0, 0.012, 0.014, 0.5, { segs: 5, data: WOOD( seed, 0.8, 0, 0 ) } );
		B.cyl( 'wood', 0, - 0.12, 0, 0.014, 0.012, 0.14, { segs: 5, data: WOOD( seed, 0.8, 0, 0 ) } );

	} else {

		B.lathe( 'hard', 0, 0, 0, [ [ 0.0, 0.0 ], [ 0.08, 0.03 ], [ 0.09, 0.12 ], [ 0.0, 0.2 ] ], { segs: 7, tint: colA, data: d } );

	}

	B.pop();

}

// a string of floats hanging from two points (on a wall or between posts)
export function buoyString( B, a, b, count, rand, sag = 0.25 ) {

	const pts = sagPoints( a, b, sag, 10 );
	B.tube( 'rope', pts, 0.01, { radial: 4, tint: C.rope, data: [ rand.next(), 0, 0, 0 ] } );
	const pal = [ [ C.orange, C.white ], [ C.red, C.white ], [ C.yellow, C.black ], [ C.white, C.blue ], [ C.green, C.yellow ], [ C.orange, C.orange ] ];
	for ( let i = 0; i < count; i ++ ) {

		const t = ( i + 0.5 ) / count;
		const p = pts[ Math.round( t * 10 ) ];
		const [ ca, cb ] = rand.pick( pal );
		const kind = rand.chance( 0.5 ) ? 0 : 2;
		buoy( B, p.x, p.y - 0.34, p.z, ca, cb, kind, rand.next(), { rz: rand.range( - 0.15, 0.15 ) } );

	}

}

// oar lying from p0 (grip) to p1 (blade tip)
export function oar( B, p0, p1, seed = 0.5, bladeTint = null ) {

	_v.set( p1[ 0 ] - p0[ 0 ], p1[ 1 ] - p0[ 1 ], p1[ 2 ] - p0[ 2 ] );
	const L = _v.length();
	_v.divideScalar( L );
	const bs = L - 0.55;
	const pb = [ p0[ 0 ] + _v.x * bs, p0[ 1 ] + _v.y * bs, p0[ 2 ] + _v.z * bs ];
	B.rod( 'wood', p0, pb, 0.022, 0.024, { segs: 6, data: WOOD( seed, 0.55, 0, 0 ) } );
	B.beam( 'wood', pb, p1, 0.14, 0.018, { tint: bladeTint || [ 1, 1, 1 ], data: WOOD( seed + 0.2, 0.5, bladeTint ? 0.6 : 0, 0 ) } );

}

// ---------------------------------------------------------------------------
// Rowboat. Local frame: origin at the keel midpoint, length along z (bow +z), gunwale at y = D.
// upsideDown flips it over so it rests on its gunwales: the midship gunwale sits on the sand and the
// ends (the sheer rises toward bow and stern) dig in, as a boat settles into soft sand. The inside of
// the hull is kept so the space under it stays closed (dark, no sand seen through a gap).

function hullSection( t, L, Bm, D ) {

	// t: 0 stern (transom) .. 1 bow (stem)
	const f = t < 0.42 ? 0.7 + 0.3 * Math.sin( Math.PI / 2 * t / 0.42 ) : Math.pow( Math.cos( Math.PI / 2 * ( t - 0.42 ) / 0.58 ), 0.85 );
	const halfB = Bm / 2 * f;
	const sheer = D + 0.09 * Math.pow( 2 * t - 1, 2 ) + 0.1 * t * t;
	const keel = 0.05 * Math.pow( Math.max( 0, 0.45 - t ) / 0.45, 2 ) + 0.42 * Math.pow( Math.max( 0, t - 0.62 ) / 0.38, 2.2 );
	return { halfB, sheer, keel, z: ( t - 0.5 ) * L };

}

export function rowboat( B, x, y, z, ry = 0, o = {} ) {

	const L = o.length ?? 4.1, Bm = o.beam ?? 1.38, D = o.depth ?? 0.52;
	const seed = o.seed ?? 0.5;
	const hullCol = o.hull ?? lin( 0x2f7f8f );
	const bottomCol = o.bottom ?? lin( 0x8f3a2a );
	const trimCol = o.trim ?? C.white;
	const upside = !! o.upsideDown;
	B.pushAt( x, y, z, ry, o.rx || 0, ( upside ? Math.PI : 0 ) + ( o.rz || 0 ) );
	if ( upside ) B.push( mat4( 0, - ( D + 0.035 ), 0 ) );

	const NT = 16, NS = 10;
	const secPoint = ( t, s ) => {

		// s in [-1, 1] across the section (port .. starboard): round bilge, slight V near the keel
		const S = hullSection( t, L, Bm, D );
		const a = Math.abs( s );
		const ang = a * Math.PI / 2;
		const xx = S.halfB * Math.sign( s ) * Math.pow( Math.sin( ang ), 0.85 );
		const yy = S.keel + ( S.sheer - S.keel ) * ( 1 - Math.pow( Math.cos( ang ), 1.25 ) );
		return [ xx, yy, S.z ];

	};

	const outer = [], inner = [];
	const eps = 1e-3;
	const buildSurface = ( inset, list ) => {

		for ( let j = 0; j <= NS; j ++ ) {

			for ( let i = 0; i <= NT; i ++ ) {

				const t = 0.02 + 0.96 * i / NT, s = - 1 + 2 * j / NS;
				const p = secPoint( t, s );
				const pt = secPoint( Math.min( 1, t + eps ), s ), pt2 = secPoint( Math.max( 0, t - eps ), s );
				const ps = secPoint( t, Math.min( 1, s + eps ) ), ps2 = secPoint( t, Math.max( - 1, s - eps ) );
				const dt = new Vector3( pt[ 0 ] - pt2[ 0 ], pt[ 1 ] - pt2[ 1 ], pt[ 2 ] - pt2[ 2 ] );
				const ds = new Vector3( ps[ 0 ] - ps2[ 0 ], ps[ 1 ] - ps2[ 1 ], ps[ 2 ] - ps2[ 2 ] );
				const n = dt.clone().cross( ds ).normalize();
				// make the normal point outward (away from the boat centerline / downward)
				const cx = p[ 0 ], cy = p[ 1 ] - D * 0.9;
				if ( n.x * cx + n.y * cy < 0 ) n.negate();
				list.push( { p: [ p[ 0 ] - n.x * inset, p[ 1 ] - n.y * inset, p[ 2 ] - n.z * inset ], n: n.toArray(), s, t } );

			}

		}

	};

	buildSurface( 0, outer );
	const girth = ( j ) => Math.abs( - 1 + 2 * j / NS ) * ( Bm * 0.5 + D ) * 0.9;
	const hullPart = ( list, flip ) => gridPart( NT, NS, ( i, j ) => {

		const v = list[ j * ( NT + 1 ) + i ];
		return { p: v.p, n: flip ? [ - v.n[ 0 ], - v.n[ 1 ], - v.n[ 2 ] ] : v.n, uv: [ v.t * L, girth( j ) ] };

	} );

	const waterline = D * 0.42;
	B.add( 'wood', hullPart( outer, false ), new Matrix4(),
		( px, py ) => ( py < waterline ? bottomCol : hullCol ),
		WOOD( seed, 0.5, 0.7, 1 ) );
	if ( ! upside || o.interior !== false ) {

		buildSurface( 0.03, inner );
		B.add( 'wood', hullPart( inner, true ), new Matrix4(), lin( 0xd8d2c0 ), WOOD( seed + 0.3, 0.55, 0.6, 5 ) );

	}

	// gunwales, keel, transom
	for ( const side of [ - 1, 1 ] ) {

		const pts = [];
		for ( let i = 0; i <= NT; i ++ ) {

			const t = 0.02 + 0.96 * i / NT;
			const p = secPoint( t, side );
			pts.push( new Vector3( p[ 0 ] - side * 0.012, p[ 1 ] + 0.01, p[ 2 ] ) );

		}

		B.tube( 'wood', pts, 0.028, { radial: 4, tint: trimCol, data: WOOD( seed + 0.1, 0.6, 0.65, 0 ) } );

	}

	const keelPts = [];
	for ( let i = 0; i <= NT; i ++ ) {

		const t = 0.02 + 0.96 * i / NT;
		const p = secPoint( t, 0 );
		keelPts.push( new Vector3( 0, p[ 1 ] - 0.015, p[ 2 ] ) );

	}

	B.tube( 'wood', keelPts, 0.028, { radial: 4, tint: bottomCol, data: WOOD( seed + 0.2, 0.6, 0.6, 0 ) } );
	const tr = [];
	for ( let j = 0; j <= 10; j ++ ) {

		const p = secPoint( 0.02, - 1 + 2 * j / 10 );
		tr.push( new Vector3( p[ 0 ], p[ 1 ], p[ 2 ] ) );

	}

	B.add( 'wood', slabPart( tr, 0.035, new Vector3( 1, 0, 0 ), new Vector3( 0, 0, - 1 ) ), new Matrix4(), hullCol, WOOD( seed + 0.4, 0.55, 0.7, 6 ) );

	if ( ! upside ) {

		// thwarts and oars
		for ( const t of [ 0.3, 0.62 ] ) {

			const S = hullSection( t, L, Bm, D );
			B.box( 'wood', 0, S.sheer - 0.17, S.z, S.halfB * 1.85, 0.035, 0.22, { grain: 0, tint: trimCol, data: WOOD( seed + t, 0.6, 0.6, 0 ) } );

		}

		if ( o.oars !== false ) {

			oar( B, [ - 0.3, D * 0.55, - 1.2 ], [ - 0.35, D * 0.4, 1.35 ], seed + 0.1 );
			oar( B, [ 0.32, D * 0.55, - 1.1 ], [ 0.28, D * 0.45, 1.4 ], seed + 0.7 );

		}

	}

	if ( upside ) B.pop();
	B.pop();

}

// Derelict hull half buried in the sand: keel, broken ribs and a few surviving planks.
// Local frame: length along z, keel at y = 0 (bury it by passing y below the sand).
export function wreck( B, x, y, z, ry, rand, o = {} ) {

	const L = o.length ?? 7.5, Bm = o.beam ?? 2.6, D = o.depth ?? 1.3;
	B.pushAt( x, y, z, ry, o.rx || 0, o.rz || 0 );
	const wd = () => WOOD( rand.next(), rand.range( 0.9, 1.0 ) );
	const tone = [ 0.78, 0.74, 0.7 ];
	const keel = [];
	for ( let i = 0; i <= 10; i ++ ) {

		const t = i / 10;
		keel.push( new Vector3( 0, 0.12 * Math.pow( 2 * t - 1, 4 ) + ( t > 0.85 ? ( t - 0.85 ) * 3.5 : 0 ), ( t - 0.5 ) * L ) );

	}

	B.tube( 'wood', keel, 0.1, { radial: 5, tint: tone, data: wd() } );
	const nr = 11;
	for ( let i = 1; i < nr; i ++ ) {

		const t = i / nr;
		const half = Bm / 2 * Math.pow( Math.sin( Math.PI * ( 0.08 + 0.84 * t ) ), 0.7 );
		const zz = ( t - 0.5 ) * L;
		for ( const side of [ - 1, 1 ] ) {

			if ( rand.chance( 0.18 ) ) continue;
			const keep = rand.chance( 0.35 ) ? rand.range( 0.35, 0.8 ) : 1; // broken ribs
			const pts = [];
			for ( let k = 0; k <= 6; k ++ ) {

				const a = k / 6 * keep;
				const ang = a * Math.PI / 2;
				pts.push( new Vector3( side * half * Math.sin( ang ), D * ( 1 - Math.cos( ang ) ) * 1.05 + 0.05, zz + rand.range( - 0.02, 0.02 ) ) );

			}

			B.tube( 'wood', pts, 0.055, { radial: 4, tint: tone, data: wd() } );

		}

	}

	// a few planks clinging to one side
	for ( let k = 0; k < 3; k ++ ) {

		const a = ( 0.25 + k * 0.14 ) * Math.PI / 2;
		const t0 = 0.2 + rand.range( 0, 0.1 ), t1 = 0.55 + rand.range( 0, 0.2 );
		const p0 = [ Bm / 2 * 0.95 * Math.sin( a ) + 0.05, D * ( 1 - Math.cos( a ) ) + 0.05, ( t0 - 0.5 ) * L ];
		const p1 = [ Bm / 2 * 0.95 * Math.sin( a ) + 0.05, D * ( 1 - Math.cos( a ) ) + 0.05, ( t1 - 0.5 ) * L ];
		B.beam( 'wood', p0, p1, 0.035, 0.2, { roll: - a, tint: tone, data: wd() } );

	}

	B.pop();

}

// ---------------------------------------------------------------------------
// Racks, fences, stands

// Net drying rack: two T-posts with a pole, a net draped over it. Local frame: along x.
export function netRack( B, x, gy, z, ry, len = 3.2, netTint = lin( 0x3f6f5f ), seed = 0.5, groundFn = null ) {

	B.pushAt( x, 0, z, ry );
	const h = 1.95;
	const wd = WOOD( seed, 0.85, 0, 0 );
	for ( const sx of [ - len / 2, len / 2 ] ) {

		const g = groundFn ? groundFn( sx, 0 ) : gy;
		B.cyl( 'wood', sx, g - 0.4, 0, 0.055, 0.065, h + 0.45, { segs: 6, data: wd } );
		B.box( 'wood', sx, g + h - 0.02, 0, 0.08, 0.08, 0.6, { grain: 2, data: wd } );

	}

	const gm = groundFn ? ( groundFn( - len / 2, 0 ) + groundFn( len / 2, 0 ) ) / 2 : gy;
	B.rod( 'wood', [ - len / 2 - 0.2, gm + h + 0.05, 0 ], [ len / 2 + 0.2, gm + h + 0.05, 0 ], 0.04, 0.04, { segs: 6, data: WOOD( seed + 0.3, 0.8, 0, 0 ) } );
	// draped net
	const NX = 18, NY = 12;
	const top = gm + h + 0.09;
	const drop = h - 0.35;
	const part = gridPart( NX, NY, ( i, j ) => {

		const u = i / NX, v = j / NY; // v: 0 front bottom -> 1 back bottom
		const xx = ( u - 0.5 ) * ( len - 0.3 );
		const side = v < 0.5 ? 1 : - 1;
		const a = Math.abs( v - 0.5 ) * 2; // 0 at the pole, 1 at the bottom edges
		const fold = Math.sin( u * 23 + v * 3 ) * 0.04 + Math.sin( u * 7.3 ) * 0.05;
		const yy = top - a * drop + Math.sin( u * Math.PI ) * a * 0.1;
		const zz = side * ( 0.04 + a * 0.22 + fold * a );
		return { p: [ xx, yy, zz ], n: [ 0, 0.2, side ], uv: [ xx, v * drop * 2 ] };

	} );
	B.add( 'net', part, new Matrix4(), netTint, ( px, py ) => [ seed, Math.min( 1, Math.max( 0, ( top - py ) / drop ) ) * 0.8, 0.045, 0 ] );
	// float line along the bottom edges
	for ( const side of [ - 1, 1 ] ) {

		for ( let i = 0; i < 5; i ++ ) {

			const xx = ( ( i + 0.5 ) / 5 - 0.5 ) * ( len - 0.4 );
			buoy( B, xx, top - drop - 0.06, side * 0.27, C.orange, C.orange, 2, seed + i * 0.1, { rx: side * 0.2 } );

		}

	}

	B.pop();

}

// A-frame fish drying rack with rows of split, salted fish hung by the tail. Local frame along x.
export function fishRack( B, x, gy, z, ry, len = 2.6, seed = 0.5, rand = null ) {

	B.pushAt( x, gy, z, ry );
	const wd = WOOD( seed, 0.9, 0, 0 );
	for ( const sx of [ - len / 2, len / 2 ] ) {

		B.rod( 'wood', [ sx, - 0.2, - 0.7 ], [ sx, 2.05, 0.05 ], 0.035, 0.03, { segs: 5, data: wd } );
		B.rod( 'wood', [ sx, - 0.2, 0.7 ], [ sx, 2.05, - 0.05 ], 0.035, 0.03, { segs: 5, data: wd } );

	}

	const kinds = [ 'jack', 'mullet', 'redSnapper', 'mullet' ];
	const fr = new Rand( mulberry32( Math.floor( seed * 4294967296 ) ) ); // the caller's sequence stays as it was
	for ( const [ py, pz ] of [ [ 1.95, 0 ], [ 1.25, - 0.36 ], [ 1.25, 0.36 ] ] ) {

		B.rod( 'wood', [ - len / 2 - 0.15, py, pz ], [ len / 2 + 0.15, py, pz ], 0.025, 0.025, { segs: 5, data: WOOD( seed + py, 0.85, 0, 0 ) } );
		const n = Math.floor( len / 0.22 );
		for ( let i = 0; i < n; i ++ ) {

			if ( rand && rand.chance( 0.4 ) ) continue;
			const l = ( rand ? rand.range( 0.3, 0.42 ) : 0.36 ) * 1.35;
			const xx = - len / 2 + 0.15 + i * ( len - 0.3 ) / ( n - 1 ) + fr.range( - 0.03, 0.03 );
			const drop = fr.range( 0.05, 0.1 );
			const s = seed + i * 0.07 + py;
			// flesh side out, toward whoever looks at this side of the rack
			const out = pz < 0 || ( pz === 0 && i % 2 ) ? Math.PI : 0;
			fishTwine( B, [ xx, py - 0.02, pz ], [ xx, py - drop, pz ], s, 0.012 );
			fish( B, xx, py - drop, pz, {
				species: kinds[ ( i + Math.round( py * 3 ) ) % kinds.length ], kind: 'split', pose: 'tail', len: l, ry: out + fr.range( - 0.25, 0.25 ),
				sag: fr.range( - 0.25, 0.25 ), curl: fr.range( - 0.35, 0.1 ), dried: 1, wet: 0, seed: s % 1,
			} );

		}

	}

	B.pop();

}

// Fence along a local polyline of [x, z] points. style: 'picket' | 'rail'
export function fence( B, pts, groundFn, style = 'picket', tint = C.white, seed = 0.5, colliders = null, toWorld = null ) {

	const painted = style === 'picket';
	for ( let s = 0; s < pts.length - 1; s ++ ) {

		const [ x0, z0 ] = pts[ s ], [ x1, z1 ] = pts[ s + 1 ];
		const L = Math.hypot( x1 - x0, z1 - z0 );
		const n = Math.max( 1, Math.round( L / 2.0 ) );
		const yaw = Math.atan2( x1 - x0, z1 - z0 );
		for ( let i = 0; i <= n; i ++ ) {

			if ( s > 0 && i === 0 ) continue;
			const t = i / n;
			const px = x0 + ( x1 - x0 ) * t, pz = z0 + ( z1 - z0 ) * t;
			const g = groundFn( px, pz );
			B.box( 'wood', px, g + 0.42, pz, 0.09, 1.1, 0.09, { grain: 1, tint: painted ? tint : [ 1, 1, 1 ], data: WOOD( seed + i * 0.1, 0.8, painted ? 0.5 : 0, 0 ) } );

		}

		for ( let i = 0; i < n; i ++ ) {

			const ta = i / n, tb = ( i + 1 ) / n;
			const ax = x0 + ( x1 - x0 ) * ta, az = z0 + ( z1 - z0 ) * ta, bx = x0 + ( x1 - x0 ) * tb, bz = z0 + ( z1 - z0 ) * tb;
			const ga = groundFn( ax, az ), gb = groundFn( bx, bz );
			for ( const ry of painted ? [ 0.25, 0.7 ] : [ 0.35, 0.78 ] ) {

				B.beam( 'wood', [ ax, ga + ry, az ], [ bx, gb + ry, bz ], 0.03, 0.08, { tint: painted ? tint : [ 1, 1, 1 ], data: WOOD( seed + ry + i, 0.8, painted ? 0.45 : 0, 0 ) } );

			}

			if ( painted ) {

				const L2 = Math.hypot( bx - ax, bz - az );
				const np = Math.floor( L2 / 0.14 );
				for ( let k = 0; k < np; k ++ ) {

					const tt = ( k + 0.5 ) / np;
					const px = ax + ( bx - ax ) * tt, pz = az + ( bz - az ) * tt;
					const g = ga + ( gb - ga ) * tt;
					const h = 0.9 + ( ( k * 7 + i * 3 ) % 5 ) * 0.012;
					B.box( 'wood', px, g + h / 2 - 0.05, pz, 0.075, h, 0.022, { grain: 1, ry: yaw + Math.PI / 2, tint, data: WOOD( seed + k * 0.37, 0.8, 0.45, 0 ) } );
					B.box( 'wood', px, g + h - 0.03, pz, 0.053, 0.053, 0.022, { grain: 1, ry: yaw + Math.PI / 2, rz: Math.PI / 4, tint, data: WOOD( seed + k * 0.37, 0.8, 0.45, 0 ) } );

				}

			}

		}

		if ( colliders && toWorld ) {

			const a = toWorld( x0, z0 ), b = toWorld( x1, z1 );
			const cx = ( a.x + b.x ) / 2, cz = ( a.z + b.z ) / 2;
			const g = Math.max( groundFn( x0, z0 ), groundFn( x1, z1 ) );
			colliders.addBox( new Vector3( cx, g + 0.5, cz ), new Vector3( 0.06, 0.6, L / 2 ), Math.atan2( b.x - a.x, b.z - a.z ), { tag: 'fence' } );

		}

	}

}

// Water tank on a timber stand. Returns height of the stand top.
export function waterTank( B, x, gy, z, seed = 0.5, galvanized = true ) {

	const wd = WOOD( seed, 0.85, 0, 0 );
	const h = 1.7, s = 0.62;
	for ( const sx of [ - s, s ] ) for ( const sz of [ - s, s ] ) B.box( 'wood', x + sx, gy + h / 2 - 0.2, z + sz, 0.12, h + 0.4, 0.12, { grain: 1, data: wd } );
	for ( const sz of [ - s, s ] ) B.beam( 'wood', [ x - s, gy + 0.3, z + sz ], [ x + s, gy + h - 0.2, z + sz ], 0.04, 0.12, { data: wd } );
	for ( let i = 0; i < 9; i ++ ) B.box( 'wood', x, gy + h + 0.02, z - 0.7 + i * 0.175, 1.5, 0.045, 0.16, { grain: 0, data: WOOD( seed + i * 0.1, 0.85, 0, 0 ) } );
	const ty = gy + h + 0.045;
	if ( galvanized ) {

		B.cyl( 'roofMetal', x, ty, z, 0.6, 0.6, 1.25, { segs: 20, capTop: false, swapUV: true, tint: C.galv, data: [ seed, 0.55, 1, 0 ] } );
		B.cyl( 'roofMetal', x, ty + 1.25, z, 0.08, 0.62, 0.22, { segs: 20, swapUV: false, tint: C.galv, data: [ seed + 0.5, 0.6, 1, 0 ] } );

	} else {

		B.cyl( 'hard', x, ty, z, 0.6, 0.6, 1.25, { segs: 20, capTop: false, tint: lin( 0x2a2e2c ), data: HARD( seed, 0, 0, 0.55 ) } );
		B.cyl( 'hard', x, ty + 1.25, z, 0.1, 0.6, 0.15, { segs: 20, tint: lin( 0x2a2e2c ), data: HARD( seed, 0, 0, 0.55 ) } );

	}

	B.rod( 'hard', [ x + 0.5, ty + 0.1, z ], [ x + 0.8, ty + 0.1, z ], 0.03, 0.03, { segs: 6, tint: C.galv, data: HARD( seed, 0.4, 0.8, 0.4 ) } );
	B.rod( 'hard', [ x + 0.8, ty + 0.1, z ], [ x + 0.8, gy + 0.6, z ], 0.03, 0.03, { segs: 6, tint: C.galv, data: HARD( seed, 0.4, 0.8, 0.4 ) } );
	return ty;

}

// stack of firewood logs against something; local frame along x
export function woodpile( B, x, gy, z, ry = 0, rand ) {

	B.pushAt( x, gy, z, ry );
	for ( let row = 0; row < 4; row ++ ) {

		const n = 6 - ( row > 2 ? 1 : 0 );
		for ( let i = 0; i < n; i ++ ) {

			const r = rand.range( 0.055, 0.075 );
			const xx = - 0.5 + i * 0.16 + ( row % 2 ) * 0.08;
			B.cyl( 'wood', xx, r + row * 0.13, - 0.25, r, r, 0.5 + rand.range( - 0.05, 0.05 ), {
				segs: 7, capTop: true, capBot: true, rx: Math.PI / 2, ry: rand.range( - 0.05, 0.05 ),
				tint: [ 1.05, 0.95, 0.85 ], data: WOOD( rand.next(), 0.35, 0, 0 ),
			} );

		}

	}

	B.pop();

}

// Pennant flag on a pole. The flag material orients the cloth downwind on the GPU.
export function flagPole( B, x, gy, z, h = 5, flagTint = C.red, seed = 0.5 ) {

	B.cyl( 'wood', x, gy - 0.3, z, 0.035, 0.06, h + 0.3, { segs: 7, tint: C.white, data: WOOD( seed, 0.6, 0.6, 0 ) } );
	B.lathe( 'hard', x, gy + h, z, [ [ 0, 0 ], [ 0.05, 0.02 ], [ 0.05, 0.06 ], [ 0, 0.09 ] ], { segs: 8, tint: C.brass, data: HARD( seed, 0.2, 0.9, 0.35 ) } );
	const w = B.toWorld( x, 0, z );
	const L = 1.3, H = 0.55;
	// geometry is laid out at the pole's world position (for correct culling bounds); the flag
	// material swings it downwind on the GPU using vdata (distance from pole, pole x/z)
	const part = gridPart( 10, 3, ( i, j ) => {

		const a = i / 10 * L;
		const hh = H * ( 1 - 0.75 * i / 10 );
		const yy = gy + h - 0.1 - ( j / 3 - 0.5 ) * hh - H / 2;
		return { p: [ a, yy, 0 ], n: [ 0, 0, 1 ], uv: [ a, j / 3 * hh ] };

	} );
	const m = B.frame.clone().invert().multiply( new Matrix4().makeTranslation( w.x, 0, w.z ) );
	B.add( 'flag', part, m, flagTint, ( px ) => [ seed, px, w.x, w.z ] );

}

// Laundry line between two local points with a few hanging cloths.
export function laundryLine( B, a, b, rand, colors ) {

	const pts = sagPoints( a, b, 0.18, 10 );
	B.tube( 'rope', pts, 0.006, { radial: 3, tint: C.white, data: [ rand.next(), 0, 0, 0 ] } );
	const dir = new Vector3( b[ 0 ] - a[ 0 ], 0, b[ 2 ] - a[ 2 ] ).normalize();
	const yaw = Math.atan2( dir.x, dir.z ) - Math.PI / 2;
	const n = rand.int( 3, 5 );
	for ( let i = 0; i < n; i ++ ) {

		const t = ( i + 0.7 ) / ( n + 0.6 );
		const p = pts[ Math.round( t * 10 ) ];
		const w = rand.range( 0.4, 0.75 ), h = rand.range( 0.45, 0.8 );
		const part = gridPart( 3, 4, ( ii, jj ) => {

			const x = ( ii / 3 - 0.5 ) * w, y = - jj / 4 * h;
			return { p: [ x, y, Math.sin( ii * 1.9 + jj ) * 0.02 ], n: [ 0, 0, 1 ], uv: [ x + w / 2, - y ] };

		} );
		const m = mat4( p.x, p.y + 0.01, p.z, yaw );
		const cs = rand.next();
		B.add( 'cloth', part, m, rand.pick( colors ), ( px, py ) => [ cs, Math.min( 1, - py / 0.8 ), 0, 0 ] );

	}

}

// ---------------------------------------------------------------------------
// Instanced props (barrels, crates, lobster traps)

function buildBarrelProto( B ) {

	const prof = [];
	for ( let i = 0; i <= 6; i ++ ) {

		const y = i / 6 * 0.88;
		prof.push( [ 0.25 + 0.035 * Math.sin( Math.PI * y / 0.88 ), y ] );

	}

	B.lathe( 'wood', 0, 0, 0, prof, { segs: 14, rRef: 0.27, tint: [ 1, 1, 1 ], data: WOOD( 0.3, 0.55, 0, 5 ) } );
	B.cyl( 'wood', 0, 0.82, 0, 0.255, 0.255, 0.01, { segs: 14, capTop: true, tint: [ 0.95, 0.9, 0.85 ], data: WOOD( 0.7, 0.6, 0, 6 ) } );
	for ( const y of [ 0.08, 0.26, 0.62, 0.8 ] ) {

		const r = 0.25 + 0.035 * Math.sin( Math.PI * y / 0.88 ) + 0.004;
		B.cyl( 'hard', 0, y - 0.025, 0, r, r, 0.05, { segs: 14, capTop: false, tint: C.iron, data: HARD( 0.4, 0.45, 0.45, 0.55 ) } );

	}

}

function buildCrateProto( B ) {

	const w = 0.62, d = 0.42, h = 0.4;
	const wd = ( s ) => WOOD( s, 0.65, 0, 0 );
	for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) {

		B.box( 'wood', sx * ( w / 2 - 0.02 ), h / 2, sz * ( d / 2 - 0.02 ), 0.04, h, 0.04, { grain: 1, data: wd( 0.1 + sx * 0.2 + sz * 0.3 ) } );

	}

	for ( let i = 0; i < 3; i ++ ) {

		const y = 0.07 + i * 0.13;
		for ( const sz of [ - 1, 1 ] ) B.box( 'wood', 0, y, sz * ( d / 2 - 0.005 ), w - 0.02, 0.09, 0.012, { grain: 0, data: wd( 0.2 + i * 0.1 + sz * 0.05 ) } );
		for ( const sx of [ - 1, 1 ] ) B.box( 'wood', sx * ( w / 2 - 0.005 ), y, 0, 0.012, 0.09, d - 0.02, { grain: 2, data: wd( 0.5 + i * 0.1 + sx * 0.05 ) } );

	}

	B.box( 'wood', 0, 0.015, 0, w - 0.03, 0.02, d - 0.03, { grain: 0, data: wd( 0.8 ) } );
	for ( let i = 0; i < 3; i ++ ) B.box( 'wood', 0, h - 0.01, - d / 2 + 0.08 + i * 0.13, w, 0.018, 0.09, { grain: 0, skip: 8, data: wd( 0.9 + i * 0.1 ) } );

}

function buildTrapProto( B ) {

	// wooden slat lobster pot: 0.9 long (x), 0.5 wide (z), half-round top
	const L = 0.9, W = 0.5, R = 0.25;
	const wd = ( s ) => WOOD( s, 0.8, 0, 0 );
	for ( const sz of [ - 1, 1 ] ) B.box( 'wood', 0, 0.025, sz * ( W / 2 - 0.02 ), L, 0.05, 0.04, { grain: 0, data: wd( 0.1 + sz * 0.1 ) } );
	for ( let i = 0; i < 5; i ++ ) B.box( 'wood', 0, 0.052, - W / 2 + 0.06 + i * 0.095, L - 0.04, 0.012, 0.06, { grain: 0, data: wd( 0.3 + i * 0.05 ) } );
	for ( const sx of [ - L / 2 + 0.03, 0, L / 2 - 0.03 ] ) {

		B.torus( 'wood', sx, 0.05, 0, R - 0.01, 0.014, { rx: - Math.PI / 2, rz: Math.PI / 2, arc: Math.PI, radial: 3, tubular: 8, tint: [ 0.9, 0.85, 0.8 ], data: wd( 0.6 + sx ) } );

	}

	for ( let i = 0; i < 7; i ++ ) {

		const a = ( i + 0.5 ) / 7 * Math.PI;
		const yy = 0.05 + Math.sin( a ) * ( R - 0.005 ), zz = Math.cos( a ) * ( R - 0.005 );
		B.box( 'wood', 0, yy, zz, L - 0.02, 0.012, 0.045, { grain: 0, rx: - ( a - Math.PI / 2 ), data: wd( 0.7 + i * 0.05 ) } );

	}

	// net ends (half discs)
	for ( const sx of [ - L / 2 + 0.03, L / 2 - 0.03 ] ) {

		const pts = [];
		for ( let i = 0; i <= 10; i ++ ) {

			const a = i / 10 * Math.PI;
			pts.push( new Vector3( sx, 0.05 + Math.sin( a ) * ( R - 0.01 ), Math.cos( a ) * ( R - 0.01 ) ) );

		}

		B.add( 'net', slabPart( pts, 0.0, new Vector3( 0, 0, 1 ), new Vector3( 1, 0, 0 ) ), new Matrix4(), lin( 0x4a6a58 ), [ 0.5, 0, 0.035, 0 ] );

	}

	B.tube( 'rope', sagPoints( [ - 0.1, 0.05 + R, 0 ], [ 0.1, 0.05 + R, 0 ], - 0.12, 6 ), 0.01, { radial: 4, tint: C.ropeBlue, data: [ 0.3, 0, 0, 0 ] } );

}

// Repeated props (barrels, crates, lobster traps). Each prototype is built once; every add()
// stamps a transformed copy straight into the merged static batches of the target builder,
// so repeated props cost no extra draw calls or shadow casters.
export class InstancedProps {

	constructor( target ) {

		this.target = target;
		this.protos = {
			barrel: this._proto( buildBarrelProto ),
			crate: this._proto( buildCrateProto ),
			trap: this._proto( buildTrapProto ),
		};
		this.counts = { barrel: 0, crate: 0, trap: 0 };
		this._m = new Matrix4();

	}

	_proto( fn ) {

		const B = new Builder();
		fn( B );
		return B;

	}

	add( type, x, y, z, ry = 0, color = null, rx = 0, rz = 0 ) {

		const proto = this.protos[ type ];
		const n = this.counts[ type ] ++;
		const seedOffset = ( ( n * 0.6180339887 + type.length * 0.137 ) % 1 ) * 7.0;
		mat4( x, y, z, ry, rx, rz, this._m );
		for ( const key in proto.batches ) {

			this.target.batch( key ).addBatch( proto.batches[ key ], this._m, color, seedOffset );

		}

	}

	get count() {

		let n = 0;
		for ( const k in this.counts ) n += this.counts[ k ];
		return n;

	}

	// kept for API compatibility: props are merged, nothing to build
	build() {

		return [];

	}

}
