import { Color, Matrix4, Vector3 } from '../../engine/index.js';
import { slabPart, quad01Part, gridPart } from './GeoBuilder.js';
import {
	WOOD, HARD, C, lin, wallLantern, lantern, buoyString, waterTank, woodpile, rowboat, oar, flagPole,
	bucket, fish, iceBed, bananaLeaf, lobster, fishTwine, sHook, Rand,
} from '../Props.js';
import { mulberry32 } from '../../util/Noise.js';

// Parametric tropical fishing-village buildings: cottages, two-storey houses and stilt huts,
// plus a boathouse and a market stall. All geometry goes into a GeoBuilder in the building's
// local frame (x across the facade, +z = front, y = world height).

const UP = new Vector3( 0, 1, 0 );
const V3 = ( x, y, z ) => new Vector3( x, y, z );
const _v = new Vector3();
const _h = new Vector3();
const WARM = new Color( 1.0, 0.68, 0.38 );

function frameFns( terrain, x, z, yaw ) {

	const cy = Math.cos( yaw ), sy = Math.sin( yaw );
	const toW = ( lx, lz ) => ( { x: x + lx * cy + lz * sy, z: z - lx * sy + lz * cy } );
	const gAt = ( lx, lz ) => {

		const p = toW( lx, lz );
		return terrain.heightAt( p.x, p.z );

	};

	return { toW, gAt };

}

function linspace( a, b, n ) {

	const out = [];
	if ( n <= 1 ) return [ ( a + b ) / 2 ];
	for ( let i = 0; i < n; i ++ ) out.push( a + ( b - a ) * i / ( n - 1 ) );
	return out;

}

// pentagonal gable end in the local XY plane (base width `base` along x), extruded by `t` along z
function gableEndPart( base, hSide, hApex, t ) {

	const pts = [ V3( - base / 2, 0, t / 2 ), V3( base / 2, 0, t / 2 ), V3( base / 2, hSide, t / 2 ), V3( 0, hApex, t / 2 ), V3( - base / 2, hSide, t / 2 ) ];
	return slabPart( pts, t, V3( 1, 0, 0 ), V3( 0, 0, 1 ) );

}

// ---------------------------------------------------------------------------
// shared building blocks (all in the builder's current frame; wall surface at z = 0, facing +z)

function windowUnit( B, rand, cx, sillY, ww, wh, st ) {

	const tw = 0.085, tp = 0.035;
	const trim = st.trim, td = () => [ rand.next(), st.trimPaint, 0, st.weather ];
	B.box( 'wood', cx - ww / 2 - tw / 2, sillY + wh / 2, tp / 2, tw, wh + 0.02, tp, { grain: 1, skip: 44, tint: trim, data: td() } );
	B.box( 'wood', cx + ww / 2 + tw / 2, sillY + wh / 2, tp / 2, tw, wh + 0.02, tp, { grain: 1, skip: 44, tint: trim, data: td() } );
	B.box( 'wood', cx, sillY + wh + 0.06, tp / 2 + 0.004, ww + 2 * tw + 0.05, 0.12, tp + 0.008, { grain: 0, skip: 32, tint: trim, data: td() } );
	B.box( 'wood', cx, sillY + wh + 0.13, 0.04, ww + 2 * tw + 0.1, 0.025, 0.075, { grain: 0, tint: trim, data: td() } );
	B.box( 'wood', cx, sillY - 0.025, 0.045, ww + 2 * tw + 0.08, 0.045, 0.09, { grain: 0, rx: 0.1, tint: trim, data: td() } );

	if ( st.closed ) {

		// closed board shutters instead of glass
		for ( const s of [ - 1, 1 ] ) {

			B.box( 'wood', cx + s * ww / 4, sillY + wh / 2, 0.018, ww / 2 - 0.006, wh, 0.03, { grain: 0, tint: st.accent, data: [ rand.next(), st.paint, st.closedPattern ?? 3, st.weather ] } );

		}

		return null;

	}

	// sash frame, glass, muntins
	B.box( 'wood', cx, sillY + 0.03, 0.012, ww, 0.06, 0.024, { grain: 0, skip: 35, tint: trim, data: td() } );
	B.box( 'wood', cx, sillY + wh - 0.03, 0.012, ww, 0.06, 0.024, { grain: 0, skip: 35, tint: trim, data: td() } );
	B.box( 'wood', cx, sillY + wh / 2, 0.016, ww, 0.045, 0.03, { grain: 0, skip: 35, tint: trim, data: td() } );
	B.box( 'wood', cx - ww / 2 + 0.025, sillY + wh / 2, 0.012, 0.05, wh, 0.024, { grain: 1, skip: 44, tint: trim, data: td() } );
	B.box( 'wood', cx + ww / 2 - 0.025, sillY + wh / 2, 0.012, 0.05, wh, 0.024, { grain: 1, skip: 44, tint: trim, data: td() } );
	B.box( 'wood', cx, sillY + wh / 2, 0.01, 0.022, wh - 0.1, 0.018, { grain: 1, skip: 44, tint: trim, data: td() } );
	const lit = rand.chance( st.litChance ?? 0.6 ) ? 1 : 0;
	B.part( 'glass', quad01Part( ww - 0.05, wh - 0.05 ), cx, sillY + wh / 2, 0.004, { tint: st.curtain, data: [ rand.next(), 0, lit, 0 ] } );

	if ( st.shutters === 'louver' || st.shutters === 'board' ) {

		const sw = ww / 2 + 0.03, sh = wh + 0.05;
		const pat = st.shutters === 'louver' ? 4 : 3;
		for ( const s of [ - 1, 1 ] ) {

			const hx = cx + s * ( ww / 2 + tw );
			const open = rand.range( 0.02, 0.45 );
			B.pushAt( hx, 0, 0.03, - s * open );
			B.box( 'wood', s * ( sw / 2 + 0.01 ), sillY + wh / 2, 0.016, sw, sh, 0.028, { grain: 0, tint: st.accent, data: [ rand.next(), st.paint, pat, st.weather ] } );
			if ( pat === 4 ) {

				for ( const yy of [ sillY + wh / 2 - sh / 2 + 0.035, sillY + wh / 2 + sh / 2 - 0.035 ] ) {

					B.box( 'wood', s * ( sw / 2 + 0.01 ), yy, 0.033, sw, 0.06, 0.012, { grain: 0, skip: 32, tint: st.accent, data: [ rand.next(), st.paint, 0, st.weather ] } );

				}

				for ( const xx of [ 0.03, sw - 0.03 ] ) {

					B.box( 'wood', s * ( xx + 0.01 ), sillY + wh / 2, 0.033, 0.055, sh - 0.12, 0.012, { grain: 1, skip: 44, tint: st.accent, data: [ rand.next(), st.paint, 0, st.weather ] } );

				}

			}

			B.pop();

		}

	} else if ( st.shutters === 'bahama' ) {

		const bw = ww + 2 * tw + 0.08, bh = wh + 0.12;
		const hy = sillY + wh + 0.14;
		const ang = rand.range( 0.45, 0.75 );
		B.pushAt( cx, hy, 0.05, 0, - ang );
		B.box( 'wood', 0, - bh / 2, 0.015, bw, bh, 0.03, { grain: 0, tint: st.accent, data: [ rand.next(), st.paint, 4, st.weather ] } );
		B.box( 'wood', 0, - bh + 0.03, 0.035, bw, 0.06, 0.015, { grain: 0, tint: st.accent, data: [ rand.next(), st.paint, 0, st.weather ] } );
		B.pop();
		// prop sticks
		const tipY = hy - Math.cos( ang ) * bh, tipZ = 0.05 + Math.sin( ang ) * bh;
		for ( const s of [ - 1, 1 ] ) {

			B.rod( 'wood', [ cx + s * ( bw / 2 - 0.08 ), sillY - 0.02, 0.07 ], [ cx + s * ( bw / 2 - 0.08 ), tipY + 0.02, tipZ - 0.02 ], 0.012, 0.012, { segs: 4, data: WOOD( rand.next(), 0.8 ) } );

		}

	}

	return lit ? { x: cx, y: sillY + wh / 2 } : null;

}

function doorUnit( B, rand, cx, floorY, st ) {

	const dw = 0.92, dh = 2.08, tw = 0.09;
	const trim = st.trim, td = () => [ rand.next(), st.trimPaint, 0, st.weather ];
	B.box( 'wood', cx, floorY + dh / 2, 0.012, dw, dh, 0.045, { grain: 1, tint: st.accent, data: [ rand.next(), st.paint, st.doorPattern ?? 3, st.weather ] } );
	B.box( 'wood', cx - dw / 2 - tw / 2, floorY + dh / 2 + 0.02, 0.02, tw, dh + 0.04, 0.04, { grain: 1, tint: trim, data: td() } );
	B.box( 'wood', cx + dw / 2 + tw / 2, floorY + dh / 2 + 0.02, 0.02, tw, dh + 0.04, 0.04, { grain: 1, tint: trim, data: td() } );
	B.box( 'wood', cx, floorY + dh + 0.1, 0.024, dw + 2 * tw + 0.06, 0.14, 0.048, { grain: 0, tint: trim, data: td() } );
	B.box( 'wood', cx, floorY + dh + 0.18, 0.045, dw + 2 * tw + 0.12, 0.025, 0.09, { grain: 0, tint: trim, data: td() } );
	B.box( 'wood', cx, floorY + 0.015, 0.05, dw + 0.12, 0.03, 0.1, { grain: 0, data: WOOD( rand.next(), 0.7 ) } );
	if ( st.doorGlass ) {

		B.box( 'wood', cx, floorY + 1.55, 0.04, 0.56, 0.5, 0.012, { grain: 0, tint: trim, data: td() } );
		B.part( 'glass', quad01Part( 0.46, 0.4 ), cx, floorY + 1.55, 0.047, { tint: st.curtain, data: [ rand.next(), 0, rand.chance( 0.5 ) ? 1 : 0, 0 ] } );
		B.box( 'wood', cx, floorY + 1.55, 0.049, 0.02, 0.4, 0.006, { grain: 1, tint: trim, data: td() } );

	}

	B.lathe( 'hard', cx + dw / 2 - 0.1, floorY + 0.98, 0.035, [ [ 0, 0 ], [ 0.012, 0 ], [ 0.012, 0.03 ], [ 0.028, 0.045 ], [ 0.0, 0.065 ] ], { segs: 8, rx: Math.PI / 2, tint: C.brass, data: HARD( rand.next(), 0.1, 0.9, 0.35 ) } );

}

// Straight stair out along +z from (cx, topY, zs) down to the terrain. Registers walkable colliders.
function stairRun( ctx, fr, cx, zs, topY, width, st ) {

	const { B, colliders, rand } = ctx;
	const tread = 0.28, maxRise = 0.2;
	let g = fr.gAt( cx, zs + 0.8 );
	let n = Math.max( 1, Math.ceil( ( topY - g ) / maxRise ) );
	g = fr.gAt( cx, zs + n * tread );
	n = Math.max( 1, Math.ceil( ( topY - g ) / maxRise ) );
	g = Math.min( g, fr.gAt( cx, zs + n * tread ) );
	const rh = ( topY - g ) / n;
	for ( let k = 1; k < n; k ++ ) {

		const top = topY - k * rh;
		const zc = zs + ( k - 0.5 ) * tread;
		B.box( 'wood', cx, top - 0.02, zc, width, 0.04, tread + 0.02, { grain: 0, tint: st.stepTint || [ 1, 1, 1 ], data: WOOD( rand.next(), 0.75, st.stepPaint || 0, 0 ) } );
		const gb = Math.min( fr.gAt( cx, zc ), top - 0.1 );
		fr.addBoxL( cx, ( top + gb - 0.4 ) / 2, zc, width / 2, ( top - gb + 0.4 ) / 2, tread / 2 + 0.005, { walkable: true, solid: true, tag: 'stairs' } );

	}

	const run = n * tread;
	for ( const s of [ - 1, 1 ] ) {

		const sx = cx + s * ( width / 2 + 0.025 );
		B.beam( 'wood', [ sx, topY - 0.1, zs - 0.02 ], [ sx, g - 0.02, zs + run + 0.05 ], 0.05, 0.24, { tint: st.trim, data: WOOD( rand.next(), 0.75, st.trimPaint * 0.8, 0 ) } );
		if ( n >= 5 ) {

			// handrail for taller stairs
			B.box( 'wood', sx, g + 0.5, zs + run - 0.1, 0.07, 1.0 + 0.3, 0.07, { grain: 1, tint: st.trim, data: WOOD( rand.next(), 0.75, st.trimPaint, 0 ) } );
			B.beam( 'wood', [ sx, topY + 0.9, zs + 0.05 ], [ sx, g + 0.95, zs + run - 0.1 ], 0.06, 0.05, { tint: st.trim, data: WOOD( rand.next(), 0.75, st.trimPaint, 0 ) } );

		}

		fr.checks.push( fr.worldPt( sx, g - 0.02, zs + run ) );

	}

	return { g, run, n };

}

// ---------------------------------------------------------------------------
// House / cottage / stilt hut

export function buildHouse( ctx, s ) {

	const { B, terrain, colliders, rand, lights, checks } = ctx;
	const { x, z, yaw, w, d } = s;
	const { toW, gAt } = frameFns( terrain, x, z, yaw );
	const fr = {
		toW, gAt, checks,
		worldPt: ( lx, y, lz ) => {

			const p = toW( lx, lz );
			return { x: p.x, y, z: p.z };

		},
		addBoxL: ( lx, ly, lz, hx, hy, hz, opts ) => {

			const p = toW( lx, lz );
			return colliders.addBox( _v.set( p.x, ly, p.z ), _h.set( hx, hy, hz ), yaw, opts );

		},
	};

	const stories = s.stories || 1;
	const storyH = s.storyH || ( stories > 1 ? 2.75 : 2.95 );
	const H = stories * storyH;
	const t = 0.14;
	const porch = s.porch || null;
	const pd = porch ? porch.depth : 0;
	const pw = porch ? Math.min( w, porch.width || w ) : 0;
	const pcx = porch ? ( porch.offset || 0 ) : 0;

	const annexD = s.annex ? ( s.annex.d ?? 2.2 ) : 0;
	let gMin = Infinity, gMax = - Infinity;
	for ( let i = 0; i <= 4; i ++ ) for ( let j = 0; j <= 6; j ++ ) {

		const g = gAt( ( i / 4 - 0.5 ) * w, - d / 2 - annexD + j / 6 * ( d + pd + annexD ) );
		gMin = Math.min( gMin, g );
		gMax = Math.max( gMax, g );

	}

	const floorY = s.floorY ?? ( gMax + ( s.clearance ?? 0.55 ) );
	const yE = floorY + H;

	const st = {
		trim: s.trim, accent: s.accent, curtain: s.curtain || lin( 0xd8c8a8 ),
		paint: s.paint ?? 0.7, trimPaint: Math.min( 1, ( s.paint ?? 0.7 ) + 0.16 ), weather: s.weather ?? 0.6,
		shutters: s.shutters || 'louver', doorGlass: !! s.doorGlass, litChance: s.litChance ?? 0.6,
		stepTint: s.porchPaint || null, stepPaint: s.porchPaint ? 0.5 : 0,
	};
	const wallData = () => [ rand.next(), st.paint, s.siding ?? 1, st.weather ];
	const trimData = () => [ rand.next(), st.trimPaint, 0, st.weather ];
	const gableSiding = ( s.siding ?? 1 ) === 1 ? 2 : 1;

	B.pushAt( x, 0, z, yaw );

	// ------------------------------------------------------------- foundation
	const rimH = 0.24;
	const fnd = s.foundation || 'posts';
	if ( fnd === 'stone' ) {

		const bot = gMin - 0.35, top = floorY - rimH + 0.03;
		const hh = top - bot, sT = 0.32;
		const tint = s.plaster || lin( 0xe6dfcf );
		const sd = () => [ rand.next(), s.stoneStyle ?? 1, 0, 0 ];
		B.box( 'stone', 0, bot + hh / 2, d / 2 - sT / 2 + 0.03, w + 0.06, hh, sT, { grain: 0, tint, data: sd() } );
		B.box( 'stone', 0, bot + hh / 2, - d / 2 + sT / 2 - 0.03, w + 0.06, hh, sT, { grain: 0, tint, data: sd() } );
		B.box( 'stone', w / 2 - sT / 2 + 0.03, bot + hh / 2, 0, sT, hh, d - 2 * sT + 0.06, { grain: 2, tint, data: sd() } );
		B.box( 'stone', - w / 2 + sT / 2 - 0.03, bot + hh / 2, 0, sT, hh, d - 2 * sT + 0.06, { grain: 2, tint, data: sd() } );
		for ( const [ cx, cz ] of [ [ - w / 2, - d / 2 ], [ w / 2, - d / 2 ], [ w / 2, d / 2 ], [ - w / 2, d / 2 ], [ 0, d / 2 ], [ 0, - d / 2 ] ] ) checks.push( fr.worldPt( cx, bot, cz ) );

	} else {

		const stilts = fnd === 'stilts';
		const nx = Math.max( 2, Math.ceil( w / 2.1 ) + 1 ), nz = Math.max( 2, Math.ceil( d / 2.1 ) + 1 );
		const xs = linspace( - w / 2 + 0.14, w / 2 - 0.14, nx ), zs = linspace( - d / 2 + 0.14, d / 2 - 0.14, nz );
		const pts = [];
		for ( let i = 0; i < nx; i ++ ) for ( let j = 0; j < nz; j ++ ) {

			const edge = i === 0 || j === 0 || i === nx - 1 || j === nz - 1;
			if ( ! edge && ! stilts && ( i + j ) % 2 ) continue;
			pts.push( [ xs[ i ], zs[ j ], edge ] );

		}

		for ( const [ lx, lz, edge ] of pts ) {

			const g = gAt( lx, lz );
			const top = floorY - rimH + 0.02;
			if ( stilts ) {

				const bottom = g - 0.9;
				B.cyl( 'wood', lx, bottom, lz, 0.1, 0.12, top - bottom, { segs: 8, rx: rand.range( - 0.015, 0.015 ), rz: rand.range( - 0.015, 0.015 ), tint: [ 0.95, 0.92, 0.9 ], data: WOOD( rand.next(), rand.range( 0.75, 1 ) ) } );
				const p = toW( lx, lz );
				colliders.addCylinder( p.x, p.z, 0.14, bottom, top, { tag: 'stilt' } );
				checks.push( { x: p.x, y: bottom, z: p.z } );

			} else if ( edge || ( s.clearance ?? 0.55 ) > 0.3 ) {

				const bottom = g - 0.3;
				B.box( 'wood', lx, ( bottom + top ) / 2, lz, 0.16, top - bottom, 0.16, { grain: 1, data: WOOD( rand.next(), 0.85 ) } );
				B.box( 'stone', lx, g - 0.06, lz, 0.34, 0.26, 0.34, { grain: 0, tint: lin( 0xcfc8b8 ), data: [ rand.next(), 0, 0, 0 ] } );
				checks.push( fr.worldPt( lx, g - 0.19, lz ) );

			}

		}

		if ( stilts ) {

			// cross bracing around the perimeter
			const tall = floorY - gMin;
			if ( tall > 1.2 ) {

				const yT = floorY - rimH - 0.15;
				for ( const [ ax, az, bx, bz ] of [
					[ xs[ 0 ], zs[ 0 ], xs[ nx - 1 ], zs[ 0 ] ], [ xs[ 0 ], zs[ nz - 1 ], xs[ nx - 1 ], zs[ nz - 1 ] ],
					[ xs[ 0 ], zs[ 0 ], xs[ 0 ], zs[ nz - 1 ] ], [ xs[ nx - 1 ], zs[ 0 ], xs[ nx - 1 ], zs[ nz - 1 ] ] ] ) {

					const ga = gAt( ax, az ), gb = gAt( bx, bz );
					const yB = Math.max( ga, gb ) + 0.35;
					if ( yT - yB < 0.8 ) continue;
					const nxv = az === bz ? 0 : ( ax < 0 ? - 1 : 1 ), nzv = az === bz ? ( az < 0 ? - 1 : 1 ) : 0;
					const o = 0.13;
					B.beam( 'wood', [ ax + nxv * o, yT, az + nzv * o ], [ bx + nxv * o, yB, bz + nzv * o ], 0.045, 0.16, { data: WOOD( rand.next(), 0.9 ) } );
					B.beam( 'wood', [ ax + nxv * o * 1.4, yB, az + nzv * o * 1.4 ], [ bx + nxv * o * 1.4, yT, bz + nzv * o * 1.4 ], 0.045, 0.16, { data: WOOD( rand.next(), 0.9 ) } );

				}

			}

		}

	}

	// rim band + floor edge
	const rimY = floorY - rimH / 2;
	const rimTint = s.rimRaw ? [ 1, 1, 1 ] : st.trim;
	const rimData = () => [ rand.next(), s.rimRaw ? 0 : st.trimPaint, 0, st.weather ];
	B.box( 'wood', 0, rimY, d / 2 + 0.01, w + 0.08, rimH, 0.06, { grain: 0, tint: rimTint, data: rimData() } );
	B.box( 'wood', 0, rimY, - d / 2 - 0.01, w + 0.08, rimH, 0.06, { grain: 0, tint: rimTint, data: rimData() } );
	B.box( 'wood', w / 2 + 0.01, rimY, 0, 0.06, rimH, d + 0.02, { grain: 2, tint: rimTint, data: rimData() } );
	B.box( 'wood', - w / 2 - 0.01, rimY, 0, 0.06, rimH, d + 0.02, { grain: 2, tint: rimTint, data: rimData() } );

	// ------------------------------------------------------------- walls & trim
	const wy = floorY + H / 2;
	B.box( 'wood', 0, wy, d / 2 - t / 2, w, H, t, { grain: 0, tint: s.wall, data: wallData() } );
	B.box( 'wood', 0, wy, - d / 2 + t / 2, w, H, t, { grain: 0, tint: s.wall, data: wallData() } );
	B.box( 'wood', w / 2 - t / 2, wy, 0, t, H, d - 2 * t, { grain: 2, tint: s.wall, data: wallData() } );
	B.box( 'wood', - w / 2 + t / 2, wy, 0, t, H, d - 2 * t, { grain: 2, tint: s.wall, data: wallData() } );
	for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) {

		B.box( 'wood', sx * ( w / 2 - 0.05 ), wy, sz * ( d / 2 - 0.05 ), 0.135, H + 0.01, 0.135, { grain: 1, tint: st.trim, data: trimData() } );

	}

	// frieze under the eaves and belt board between storeys
	const band = ( y, h, proud ) => {

		B.box( 'wood', 0, y, d / 2 + proud / 2, w + 0.02, h, proud, { grain: 0, tint: st.trim, data: trimData() } );
		B.box( 'wood', 0, y, - d / 2 - proud / 2, w + 0.02, h, proud, { grain: 0, tint: st.trim, data: trimData() } );
		B.box( 'wood', w / 2 + proud / 2, y, 0, proud, h, d + 0.02, { grain: 2, tint: st.trim, data: trimData() } );
		B.box( 'wood', - w / 2 - proud / 2, y, 0, proud, h, d + 0.02, { grain: 2, tint: st.trim, data: trimData() } );

	};

	band( yE - 0.1, 0.2, 0.025 );
	if ( stories > 1 ) band( floorY + storyH, 0.16, 0.03 );

	// ------------------------------------------------------------- roof
	const roofType = s.roof || 'gable';
	const isThatch = s.roofMat === 'thatch';
	const a = s.pitch ?? ( isThatch ? 0.68 : 0.44 );
	const ta = Math.tan( a );
	const r0 = 0.12;
	const T = isThatch ? 0.28 : 0.06;
	const ovE = s.ovE ?? ( isThatch ? 0.6 : 0.45 );
	const ovR = s.ovR ?? ( isThatch ? 0.45 : 0.32 );
	const roofKey = isThatch ? 'thatch' : 'roofMetal';
	const roofTint = isThatch ? [ 1, 1, 1 ] : ( s.roofColor || lin( 0xa5452f ) );
	const roofData = () => ( isThatch ? [ rand.next(), s.thatchAge ?? 0.4, 0, 0 ] : [ rand.next(), s.rust ?? 0.4, s.galv ? 1 : 0, 0 ] );
	const roofSlab = ( pts, uDir ) => B.slab( roofKey, pts, T, { uDir: uDir.normalize(), up: UP, tint: roofTint, data: roofData() } );
	const Tv = T / Math.cos( a );
	let roofTop = yE;
	let ridge = null;

	const fascia = ( ax, ay, az, bx, by, bz ) => {

		if ( isThatch ) return;
		B.beam( 'wood', [ ax, ay - 0.1, az ], [ bx, by - 0.1, bz ], 0.032, 0.2, { tint: st.trim, data: trimData() } );

	};

	const rafterTails = ( zWall, zEdge, sign, yWallTop, yEdgeTop, x0, x1 ) => {

		const n = Math.floor( ( x1 - x0 ) / 0.6 );
		for ( let i = 0; i <= n; i ++ ) {

			const px = x0 + ( x1 - x0 ) * i / Math.max( 1, n );
			B.beam( 'wood', [ px, yWallTop - Tv - 0.055, zWall - sign * 0.08 ], [ px, yEdgeTop - Tv - 0.055, zEdge - sign * 0.05 ], 0.05, 0.1, { data: WOOD( rand.next(), 0.7 ) } );

		}

	};

	const gableEnd = ( cx, cz, ry, base ) => {

		const hSide = r0 - 0.03;
		const hApex = r0 + ( base / 2 ) * ta - 0.03;
		B.part( 'wood', gableEndPart( base, hSide, hApex, t ), cx, yE, cz, { ry, tint: s.wall, data: [ rand.next(), st.paint, gableSiding, st.weather ] } );
		return hApex;

	};

	const gableVent = ( cz, dir, yBase, ry ) => {

		// small louvered vent in the gable triangle
		B.pushAt( 0, 0, cz, ry );
		const vy = yBase + 0.45;
		B.box( 'wood', 0, vy, 0.02, 0.5, 0.5, 0.04, { grain: 0, tint: st.trim, data: trimData() } );
		B.box( 'wood', 0, vy, 0.03, 0.38, 0.38, 0.03, { grain: 0, tint: st.accent, data: [ rand.next(), st.paint, 4, st.weather ] } );
		B.pop();

	};

	const ridgeCap = ( p0, p1, across ) => {

		if ( isThatch ) {

			B.rod( 'thatch', [ p0.x, p0.y - 0.06, p0.z ], [ p1.x, p1.y - 0.06, p1.z ], 0.2, 0.2, { segs: 8, tint: [ 0.9, 0.88, 0.85 ], data: [ rand.next(), ( s.thatchAge ?? 0.4 ) + 0.2, 0, 0 ] } );
			return;

		}

		const wc = 0.2, drop = wc * Math.tan( a * 0.85 );
		for ( const sg of [ - 1, 1 ] ) {

			const o = across.clone().multiplyScalar( sg * wc );
			const pts = [ V3( p0.x, p0.y + 0.02, p0.z ), V3( p1.x, p1.y + 0.02, p1.z ), V3( p1.x + o.x, p1.y + 0.02 - drop, p1.z + o.z ), V3( p0.x + o.x, p0.y + 0.02 - drop, p0.z + o.z ) ];
			B.slab( 'roofMetal', pts, 0.01, { up: UP, uDir: o.clone().normalize().negate().setY( 0.3 ), tint: roofTint, data: [ rand.next(), ( s.rust ?? 0.4 ) + 0.2, s.galv ? 1 : 0, 0 ] } );

		}

	};

	const hasPorchEave = porch && stories === 1 && roofType !== 'gableFront';

	if ( roofType === 'gable' ) {

		const X = w / 2 + ovR;
		const yR = yE + r0 + ( d / 2 ) * ta;
		const zf = d / 2 + ovE, yF = yE + r0 - ovE * ta;
		roofSlab( [ V3( - X, yF, zf ), V3( X, yF, zf ), V3( X, yR, 0 ), V3( - X, yR, 0 ) ], V3( 0, yR - yF, - zf ) );
		roofSlab( [ V3( X, yF, - zf ), V3( - X, yF, - zf ), V3( - X, yR, 0 ), V3( X, yR, 0 ) ], V3( 0, yR - yF, zf ) );
		ridgeCap( V3( - X, yR, 0 ), V3( X, yR, 0 ), V3( 0, 0, 1 ) );
		for ( const sx of [ - 1, 1 ] ) {

			gableEnd( sx * ( w / 2 - t / 2 ), 0, Math.PI / 2, d );
			fascia( sx * ( X - 0.016 ), yF, zf, sx * ( X - 0.016 ), yR, 0 );
			fascia( sx * ( X - 0.016 ), yF, - zf, sx * ( X - 0.016 ), yR, 0 );

		}

		fascia( - X, yF, zf - 0.016, X, yF, zf - 0.016 );
		fascia( - X, yF, - zf + 0.016, X, yF, - zf + 0.016 );
		if ( ! isThatch ) {

			rafterTails( d / 2, zf, 1, yE + r0, yF, - w / 2 + 0.1, w / 2 - 0.1 );
			rafterTails( - d / 2, - zf, - 1, yE + r0, yF, - w / 2 + 0.1, w / 2 - 0.1 );

		}

		roofTop = yR + 0.2;
		ridge = { y: yR, axis: 'x', ta, yF, zf };

	} else if ( roofType === 'gableFront' ) {

		const Z = d / 2 + ovR;
		const yR = yE + r0 + ( w / 2 ) * ta;
		const xe = w / 2 + ovE, yF = yE + r0 - ovE * ta;
		roofSlab( [ V3( xe, yF, Z ), V3( xe, yF, - Z ), V3( 0, yR, - Z ), V3( 0, yR, Z ) ], V3( - xe, yR - yF, 0 ) );
		roofSlab( [ V3( - xe, yF, - Z ), V3( - xe, yF, Z ), V3( 0, yR, Z ), V3( 0, yR, - Z ) ], V3( xe, yR - yF, 0 ) );
		ridgeCap( V3( 0, yR, - Z ), V3( 0, yR, Z ), V3( 1, 0, 0 ) );
		for ( const sz of [ - 1, 1 ] ) {

			const hA = gableEnd( 0, sz * ( d / 2 - t / 2 ), sz > 0 ? 0 : Math.PI, w );
			if ( hA > 1.0 && ! s.noVent ) gableVent( sz * ( d / 2 ), sz, yE, sz > 0 ? 0 : Math.PI );
			fascia( xe, yF, sz * ( Z - 0.016 ), 0, yR, sz * ( Z - 0.016 ) );
			fascia( - xe, yF, sz * ( Z - 0.016 ), 0, yR, sz * ( Z - 0.016 ) );

		}

		fascia( xe - 0.016, yF, - Z, xe - 0.016, yF, Z );
		fascia( - xe + 0.016, yF, - Z, - xe + 0.016, yF, Z );
		roofTop = yR + 0.2;
		ridge = { y: yR, axis: 'z', ta, yF, xe };

	} else {

		// hip roof (expects w >= d)
		const ov = ovE;
		const yR = yE + r0 + ( d / 2 ) * ta;
		const ye = yE + r0 - ov * ta;
		const XE = w / 2 + ov, ZE = d / 2 + ov, XR = Math.max( 0, ( w - d ) / 2 );
		if ( XR > 0.02 ) {

			roofSlab( [ V3( - XE, ye, ZE ), V3( XE, ye, ZE ), V3( XR, yR, 0 ), V3( - XR, yR, 0 ) ], V3( 0, yR - ye, - ZE ) );
			roofSlab( [ V3( XE, ye, - ZE ), V3( - XE, ye, - ZE ), V3( - XR, yR, 0 ), V3( XR, yR, 0 ) ], V3( 0, yR - ye, ZE ) );
			ridgeCap( V3( - XR, yR, 0 ), V3( XR, yR, 0 ), V3( 0, 0, 1 ) );

		} else {

			roofSlab( [ V3( - XE, ye, ZE ), V3( XE, ye, ZE ), V3( 0, yR, 0 ) ], V3( 0, yR - ye, - ZE ) );
			roofSlab( [ V3( XE, ye, - ZE ), V3( - XE, ye, - ZE ), V3( 0, yR, 0 ) ], V3( 0, yR - ye, ZE ) );

		}

		roofSlab( [ V3( XE, ye, ZE ), V3( XE, ye, - ZE ), V3( XR, yR, 0 ) ], V3( - XE + XR, yR - ye, 0 ) );
		roofSlab( [ V3( - XE, ye, - ZE ), V3( - XE, ye, ZE ), V3( - XR, yR, 0 ) ], V3( XE - XR, yR - ye, 0 ) );
		// hip rolls
		for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) {

			const p0 = [ sx * XE, ye + 0.02, sz * ZE ], p1 = [ sx * XR, yR + 0.02, 0 ];
			if ( isThatch ) B.rod( 'thatch', [ p0[ 0 ], p0[ 1 ] - 0.05, p0[ 2 ] ], [ p1[ 0 ], p1[ 1 ] - 0.05, p1[ 2 ] ], 0.14, 0.17, { segs: 6, tint: [ 0.9, 0.88, 0.85 ], data: [ rand.next(), ( s.thatchAge ?? 0.4 ) + 0.2, 0, 0 ] } );
			else B.rod( 'roofMetal', p0, p1, 0.045, 0.045, { segs: 6, tint: roofTint, data: [ rand.next(), ( s.rust ?? 0.4 ) + 0.2, s.galv ? 1 : 0, 0 ] } );

		}

		fascia( - XE, ye, ZE - 0.016, XE, ye, ZE - 0.016 );
		fascia( - XE, ye, - ZE + 0.016, XE, ye, - ZE + 0.016 );
		fascia( XE - 0.016, ye, - ZE, XE - 0.016, ye, ZE );
		fascia( - XE + 0.016, ye, - ZE, - XE + 0.016, ye, ZE );
		if ( ! isThatch ) {

			rafterTails( d / 2, ZE, 1, yE + r0, ye, - w / 2 + 0.1, w / 2 - 0.1 );
			rafterTails( - d / 2, - ZE, - 1, yE + r0, ye, - w / 2 + 0.1, w / 2 - 0.1 );

		}

		roofTop = yR + 0.2;
		ridge = { y: yR, axis: 'x', ta, yF: ye, zf: ZE };

	}

	// thatch eave fringe (ragged strands hanging below the eave edges)
	if ( isThatch ) {

		const fringe = ( ax, az, bx, bz, yTop, outX, outZ ) => {

			const L = Math.hypot( bx - ax, bz - az );
			const n = Math.max( 4, Math.round( L / 0.05 ) );
			const part = gridPart( n, 1, ( i, j ) => {

				const tt = i / n;
				const r = Math.abs( Math.sin( i * 12.9898 + ax * 78.233 + az * 37.719 ) * 43758.5453 ) % 1;
				const hang = 0.04 + 0.16 * r * r * ( i % 2 ? 1 : 0.6 );
				const px = ax + ( bx - ax ) * tt, pz = az + ( bz - az ) * tt;
				const yy = j === 0 ? yTop - T * 0.95 - hang : yTop - T * 0.3;
				const o = j === 0 ? 0.05 : 0.0;
				return { p: [ px + outX * o, yy, pz + outZ * o ], n: [ outX, 0.2, outZ ], uv: [ j === 0 ? - hang : 0.2, tt * L ] };

			} );
			B.add( 'thatch', part, new Matrix4(), [ 0.95, 0.92, 0.88 ], [ rand.next(), ( s.thatchAge ?? 0.4 ) + 0.1, 0, 0 ] );

		};

		if ( roofType === 'gable' ) {

			const X = w / 2 + ovR, zf = d / 2 + ovE, yF = yE + r0 - ovE * ta;
			fringe( - X, zf, X, zf, yF, 0, 1 );
			fringe( X, - zf, - X, - zf, yF, 0, - 1 );

		} else if ( roofType === 'gableFront' ) {

			const Z = d / 2 + ovR, xe = w / 2 + ovE, yF = yE + r0 - ovE * ta;
			fringe( xe, Z, xe, - Z, yF, 1, 0 );
			fringe( - xe, - Z, - xe, Z, yF, - 1, 0 );

		} else {

			const XE = w / 2 + ovE, ZE = d / 2 + ovE, ye = yE + r0 - ovE * ta;
			fringe( - XE, ZE, XE, ZE, ye, 0, 1 );
			fringe( XE, - ZE, - XE, - ZE, ye, 0, - 1 );
			fringe( XE, ZE, XE, - ZE, ye, 1, 0 );
			fringe( - XE, - ZE, - XE, ZE, ye, - 1, 0 );

		}

	}

	// ------------------------------------------------------------- openings
	const winW = s.winW ?? 0.86, winH = s.winH ?? 1.2;
	const doorX = s.doorX ?? 0;
	const litWindows = [];
	const slots = ( L, avoid, spacing = 1.9 ) => {

		const n = Math.max( 1, Math.floor( ( L - 0.9 ) / spacing ) );
		const out = [];
		for ( let i = 0; i < n; i ++ ) {

			const px = - L / 2 + L * ( i + 0.5 ) / n;
			if ( avoid.every( ( q ) => Math.abs( px - q ) > 1.05 ) ) out.push( px );

		}

		return out;

	};

	const walls = [
		{ L: w, fx: 0, fz: d / 2, ry: 0, front: true },
		{ L: w, fx: 0, fz: - d / 2, ry: Math.PI },
		{ L: d, fx: w / 2, fz: 0, ry: Math.PI / 2 },
		{ L: d, fx: - w / 2, fz: 0, ry: - Math.PI / 2 },
	];
	// keep side-wall windows clear of an external chimney (wall-local x of the chimney center)
	const chimZ = ( s.roof || 'gable' ) === 'gableFront' ? - d * 0.25 : 0;

	for ( let wi = 0; wi < 4; wi ++ ) {

		const wl = walls[ wi ];
		B.pushAt( wl.fx, 0, wl.fz, wl.ry );
		for ( let sIdx = 0; sIdx < stories; sIdx ++ ) {

			const baseY = floorY + sIdx * storyH;
			let xs;
			if ( wl.front ) xs = sIdx === 0 ? slots( wl.L, [ doorX ] ) : slots( wl.L, [] );
			else if ( wi === 1 ) xs = slots( wl.L, [], 2.3 );
			else xs = slots( wl.L, wi === 2 && s.chimney === 1 ? [ - chimZ ] : ( wi === 3 && s.chimney === - 1 ? [ chimZ ] : [] ), 2.2 );
			if ( ! wl.front && s.fewWindows && xs.length > 1 ) xs = [ xs[ Math.floor( rand.next() * xs.length ) ] ];
			for ( const px of xs ) {

				const closed = rand.chance( s.closedChance ?? 0.12 );
				const lit = windowUnit( B, rand, px, baseY + 0.88, winW, winH, { ...st, closed, closedPattern: st.shutters === 'louver' ? 4 : 3 } );
				if ( lit && wl.front ) litWindows.push( B.toWorld( lit.x, lit.y, 0.35 ) );

			}

		}

		if ( wl.front ) {

			doorUnit( B, rand, doorX, floorY, st );
			if ( s.lantern !== false ) {

				const lw = wallLantern( B, doorX + 0.78, floorY + 1.95, 0.0, rand.next() );
				lights.push( { position: lw, color: WARM.clone(), intensity: 3.5, kind: 'lantern' } );

			}

		}

		B.pop();

	}

	if ( litWindows.length ) lights.push( { position: litWindows[ 0 ], color: new Color( 1.0, 0.62, 0.32 ), intensity: 1.6, kind: 'window' } );

	// ------------------------------------------------------------- porch or stoop
	const porchPaint = s.porchPaint || null;
	if ( porch ) {

		const porchY = floorY - 0.05;
		const pz0 = d / 2, pz1 = d / 2 + pd;
		const xL = pcx - pw / 2, xR = pcx + pw / 2;
		// planks
		const np = Math.max( 2, Math.floor( pd / 0.145 ) );
		for ( let i = 0; i < np; i ++ ) {

			const zc = pz0 + 0.01 + ( i + 0.5 ) * ( pd - 0.01 ) / np;
			B.box( 'wood', pcx + rand.range( - 0.012, 0.012 ), porchY - 0.02, zc, pw + 0.06, 0.04, 0.13, { grain: 0, ry: rand.range( - 0.004, 0.004 ), tint: porchPaint || [ 1, 1, 1 ], data: WOOD( rand.next(), rand.range( 0.55, 0.9 ), porchPaint ? 0.68 : 0, 0 ) } );

		}

		// rim + support posts
		B.box( 'wood', pcx, porchY - 0.15, pz1 - 0.03, pw + 0.08, 0.22, 0.06, { grain: 0, tint: rimTint, data: rimData() } );
		for ( const sx of [ xL, xR ] ) B.box( 'wood', sx + ( sx < pcx ? 0.03 : - 0.03 ), porchY - 0.15, ( pz0 + pz1 ) / 2, 0.06, 0.22, pd, { grain: 2, tint: rimTint, data: rimData() } );
		for ( const px of linspace( xL + 0.1, xR - 0.1, Math.max( 2, Math.ceil( pw / 2.2 ) + 1 ) ) ) {

			const g = gAt( px, pz1 - 0.12 );
			const top = porchY - 0.26;
			if ( top - g > 0.05 ) {

				B.box( 'wood', px, ( top + g - 0.3 ) / 2, pz1 - 0.12, 0.14, top - g + 0.3, 0.14, { grain: 1, data: WOOD( rand.next(), 0.85 ) } );
				checks.push( fr.worldPt( px, g - 0.3, pz1 - 0.12 ) );

			}

		}

		// roof height
		const pp = s.porchPitch ?? 0.26;
		const Tp = isThatch ? 0.24 : 0.06;
		let yAtt;
		if ( stories > 1 ) yAtt = floorY + storyH - 0.02;
		else if ( ! hasPorchEave ) yAtt = yE - 0.03;
		else {

			const ovF = roofType === 'hip' ? ovE : ovE;
			const eaveEdgeTop = yE + r0 - ovF * ta;
			const fasciaBot = eaveEdgeTop - ( isThatch ? T / Math.cos( a ) + 0.16 : 0.22 );
			yAtt = Math.min( yE - 0.03, fasciaBot - 0.03 + ovF * Math.tan( pp ) );

		}

		const zEnd = pz1 + 0.32;
		const yEnd = yAtt - ( zEnd - pz0 ) * Math.tan( pp );
		const beamZ = pz1 - 0.12;
		const beamTop = yAtt - ( beamZ - pz0 ) * Math.tan( pp ) - Tp / Math.cos( pp ) - 0.005;
		const beamH = 0.18;
		const postTop = beamTop - beamH;
		const roofX0 = xL - 0.22, roofX1 = xR + 0.22;
		const porchKey = isThatch ? 'thatch' : 'roofMetal';
		B.slab( porchKey, [ V3( roofX0, yEnd, zEnd ), V3( roofX1, yEnd, zEnd ), V3( roofX1, yAtt, pz0 ), V3( roofX0, yAtt, pz0 ) ], Tp, {
			up: UP, uDir: V3( 0, yAtt - yEnd, pz0 - zEnd ).normalize(), tint: roofTint, data: roofData(),
		} );
		if ( ! isThatch ) {

			B.box( 'wood', pcx, yEnd - 0.1, zEnd - 0.016, roofX1 - roofX0, 0.18, 0.032, { grain: 0, tint: st.trim, data: trimData() } );
			B.box( 'wood', pcx, yAtt - 0.02, pz0 + 0.03, roofX1 - roofX0, 0.06, 0.05, { grain: 0, tint: st.trim, data: trimData() } );

		} else {

			// ragged thatch edge along the porch roof front
			const n = Math.round( ( roofX1 - roofX0 ) / 0.07 );
			const part = gridPart( n, 1, ( i, j ) => {

				const tt = i / n;
				const r = Math.abs( Math.sin( i * 12.9898 + roofX0 * 78.233 ) * 43758.5453 ) % 1;
				const hang = 0.04 + 0.13 * r * r * ( i % 2 ? 1 : 0.6 );
				const px = roofX0 + ( roofX1 - roofX0 ) * tt;
				const yy = j === 0 ? yEnd - Tp - hang : yEnd - Tp * 0.3;
				return { p: [ px, yy, zEnd + ( j === 0 ? 0.04 : 0 ) ], n: [ 0, 0.2, 1 ], uv: [ j === 0 ? - hang : 0.2, px ] };

			} );
			B.add( 'thatch', part, new Matrix4(), [ 0.95, 0.92, 0.88 ], [ rand.next(), ( s.thatchAge ?? 0.4 ) + 0.1, 0, 0 ] );

		}

		// beam + posts with knee braces
		B.box( 'wood', pcx, beamTop - beamH / 2, beamZ, pw + 0.1, beamH, 0.12, { grain: 0, tint: st.trim, data: trimData() } );
		const postXs = linspace( xL + 0.08, xR - 0.08, Math.max( 2, Math.ceil( pw / 2.6 ) + 1 ) );
		for ( const px of postXs ) {

			B.box( 'wood', px, ( porchY + postTop ) / 2, beamZ, 0.12, postTop - porchY, 0.12, { grain: 1, tint: st.trim, data: trimData() } );
			B.box( 'wood', px, porchY + 0.05, beamZ, 0.16, 0.1, 0.16, { grain: 0, tint: st.trim, data: trimData() } );
			B.box( 'wood', px, postTop - 0.03, beamZ, 0.16, 0.06, 0.16, { grain: 0, tint: st.trim, data: trimData() } );
			for ( const sg of [ - 1, 1 ] ) {

				if ( ( px <= xL + 0.1 && sg < 0 ) || ( px >= xR - 0.1 && sg > 0 ) ) continue;
				B.beam( 'wood', [ px + sg * 0.04, postTop - 0.34, beamZ ], [ px + sg * 0.36, postTop - 0.02, beamZ ], 0.05, 0.06, { tint: st.trim, data: trimData() } );

			}

		}

		// railing with a gap for the stairs
		const stairX = porch.stairX ?? doorX;
		const railStyle = porch.rail || 'balusters';
		const railSeg = ( ax, az, bx, bz ) => {

			const L = Math.hypot( bx - ax, bz - az );
			if ( L < 0.2 ) return;
			B.beam( 'wood', [ ax, porchY + 0.86, az ], [ bx, porchY + 0.86, bz ], 0.1, 0.045, { tint: st.trim, data: trimData() } );
			B.beam( 'wood', [ ax, porchY + 0.13, az ], [ bx, porchY + 0.13, bz ], 0.07, 0.045, { tint: st.trim, data: trimData() } );
			const dx = ( bx - ax ) / L, dz = ( bz - az ) / L;
			if ( railStyle === 'balusters' ) {

				const n = Math.floor( L / 0.12 );
				for ( let i = 1; i < n; i ++ ) {

					const tt = i / n;
					B.box( 'wood', ax + dx * L * tt, porchY + 0.495, az + dz * L * tt, 0.034, 0.71, 0.034, { grain: 1, skip: 12, tint: st.trim, data: trimData() } );

				}

			} else {

				const nb = Math.max( 1, Math.round( L / 1.1 ) );
				for ( let i = 0; i < nb; i ++ ) {

					const t0 = i / nb, t1 = ( i + 1 ) / nb;
					const p0 = [ ax + dx * L * t0, az + dz * L * t0 ], p1 = [ ax + dx * L * t1, az + dz * L * t1 ];
					B.beam( 'wood', [ p0[ 0 ], porchY + 0.16, p0[ 1 ] ], [ p1[ 0 ], porchY + 0.83, p1[ 1 ] ], 0.035, 0.07, { tint: st.trim, data: trimData() } );
					B.beam( 'wood', [ p0[ 0 ], porchY + 0.83, p0[ 1 ] ], [ p1[ 0 ], porchY + 0.16, p1[ 1 ] ], 0.03, 0.07, { tint: st.trim, data: trimData() } );

				}

			}

			fr.addBoxL( ( ax + bx ) / 2, porchY + 0.55, ( az + bz ) / 2, Math.abs( dx ) > 0.5 ? L / 2 : 0.06, 0.55, Math.abs( dx ) > 0.5 ? 0.06 : L / 2, { tag: 'porchRail' } );

		};

		const gapL = stairX - 0.68, gapR = stairX + 0.68;
		if ( s.railNet && gapL - xL > 1.0 ) {

			// a fishing net thrown over the railing to dry
			const nx0 = xL + 0.2, nx1 = gapL - 0.12;
			const L = nx1 - nx0;
			const netPart = gridPart( 10, 8, ( i, j ) => {

				const u = i / 10, v = j / 8;
				const xx = nx0 + u * L;
				const fold = Math.sin( u * 17 + v * 2 ) * 0.035;
				// v: 0 inside bottom -> over the rail -> 1 outside bottom
				const inside = v < 0.35;
				const tt = inside ? ( 0.35 - v ) / 0.35 : ( v - 0.35 ) / 0.65;
				const yy = porchY + 0.9 - tt * ( inside ? 0.35 : 0.78 ) - Math.sin( u * Math.PI ) * 0.06 * tt;
				const zz = beamZ + ( inside ? - 0.05 - tt * 0.05 : 0.06 + tt * 0.1 ) + fold * tt;
				return { p: [ xx, yy, zz ], n: [ 0, 0.3, inside ? - 1 : 1 ], uv: [ u * L, v * 1.2 ] };

			} );
			const ns = rand.next();
			B.add( 'net', netPart, new Matrix4(), s.railNet, ( px, py ) => [ ns, Math.min( 1, Math.max( 0, porchY + 0.9 - py ) ) * 0.5, 0.04, 0 ] );

		}

		railSeg( xL + 0.08, beamZ, gapL, beamZ );
		railSeg( gapR, beamZ, xR - 0.08, beamZ );
		railSeg( xL + 0.08, pz0 + 0.08, xL + 0.08, beamZ );
		railSeg( xR - 0.08, pz0 + 0.08, xR - 0.08, beamZ );
		for ( const gx of [ gapL, gapR ] ) {

			B.box( 'wood', gx, porchY + 0.5, beamZ, 0.1, 1.0, 0.1, { grain: 1, tint: st.trim, data: trimData() } );

		}

		const sr = stairRun( ctx, fr, stairX, pz1, porchY, 1.2, { ...st, trim: st.trim } );
		// porch floor collider
		const gP = Math.min( gMin, sr.g );
		fr.addBoxL( pcx, ( porchY + gP - 0.5 ) / 2, ( pz0 + pz1 ) / 2, pw / 2, ( porchY - gP + 0.5 ) / 2, pd / 2, { walkable: true, solid: true, tag: 'porch' } );
		roofTop = Math.max( roofTop, yAtt );

		// porch life: a chair or bench, hanging buoys, potted things
		if ( s.porchBench !== false ) {

			const bx = stairX > pcx ? xL + 1.1 : xR - 1.1;
			benchLow( B, rand, bx, porchY, pz0 + 0.45, st );

		}

	} else {

		// front stoop with steps
		const stoopY = floorY - 0.04;
		const sw = 1.5, sd = 1.0;
		const np = 7;
		for ( let i = 0; i < np; i ++ ) B.box( 'wood', doorX, stoopY - 0.02, d / 2 + 0.02 + ( i + 0.5 ) * sd / np, sw, 0.04, sd / np - 0.012, { grain: 0, data: WOOD( rand.next(), 0.8 ) } );
		const gS = gAt( doorX, d / 2 + sd );
		for ( const sx of [ - 1, 1 ] ) {

			B.box( 'wood', doorX + sx * ( sw / 2 - 0.06 ), ( stoopY + gS - 0.3 ) / 2, d / 2 + sd - 0.06, 0.12, stoopY - gS + 0.3, 0.12, { grain: 1, data: WOOD( rand.next(), 0.85 ) } );
			checks.push( fr.worldPt( doorX + sx * ( sw / 2 - 0.06 ), gS - 0.3, d / 2 + sd - 0.06 ) );

		}

		const sr = stairRun( ctx, fr, doorX, d / 2 + sd, stoopY, 1.1, st );
		fr.addBoxL( doorX, ( stoopY + Math.min( gS, sr.g ) - 0.4 ) / 2, d / 2 + sd / 2, sw / 2, ( stoopY - Math.min( gS, sr.g ) + 0.4 ) / 2, sd / 2, { walkable: true, solid: true, tag: 'stoop' } );
		// small hood over the door
		const hy = floorY + 2.5;
		B.slab( roofKey, [ V3( doorX - 0.85, hy - 0.22, d / 2 + 0.75 ), V3( doorX + 0.85, hy - 0.22, d / 2 + 0.75 ), V3( doorX + 0.85, hy, d / 2 ), V3( doorX - 0.85, hy, d / 2 ) ], isThatch ? 0.14 : 0.04, {
			up: UP, uDir: V3( 0, 0.22, - 0.75 ).normalize(), tint: roofTint, data: roofData(),
		} );
		for ( const sx of [ - 1, 1 ] ) B.beam( 'wood', [ doorX + sx * 0.75, hy - 0.5, d / 2 + 0.02 ], [ doorX + sx * 0.75, hy - 0.2, d / 2 + 0.65 ], 0.05, 0.07, { tint: st.trim, data: trimData() } );

	}

	// ------------------------------------------------------------- extras
	if ( s.stovepipe && ridge ) {

		const px = ridge.axis === 'x' ? w * 0.22 : - w * 0.22, pz = ridge.axis === 'x' ? - d * 0.22 : d * 0.18;
		const surf = ridge.axis === 'x' ? ridge.y - Math.abs( pz ) * ta : ridge.y - Math.abs( px ) * ta;
		const hd = HARD( rand.next(), 0.75, 0.6, 0.55 );
		B.cyl( 'hard', px, surf - 0.3, pz, 0.08, 0.08, ridge.y - surf + 1.0, { segs: 10, capTop: false, tint: lin( 0x3a3632 ), data: hd } );
		B.cyl( 'hard', px, ridge.y + 0.72, pz, 0.02, 0.2, 0.14, { segs: 10, capBot: true, tint: lin( 0x3a3632 ), data: hd } );
		B.cyl( 'hard', px, surf - 0.02, pz, 0.1, 0.2, 0.08, { segs: 10, tint: lin( 0x3a3632 ), data: hd } );

	}

	if ( s.chimney ) {

		const sx = s.chimney;
		const cxl = sx * ( w / 2 + 0.36 ), czl = roofType === 'gableFront' ? - d * 0.25 : 0;
		const g = gAt( cxl, czl );
		const top = roofType === 'gable' ? ( ridge.y + 0.7 ) : ( ridge.y + 0.3 );
		const hh = top - ( g - 0.3 );
		B.box( 'stone', cxl, g - 0.3 + hh / 2, czl, 0.72, hh, 0.82, { grain: 0, tint: lin( 0xd8d0c0 ), data: [ rand.next(), 2, 0, 0 ] } );
		B.box( 'stone', cxl, top + 0.04, czl, 0.84, 0.08, 0.94, { grain: 0, tint: lin( 0xc8c0b0 ), data: [ rand.next(), 0, 0, 0 ] } );
		B.cyl( 'stone', cxl, top + 0.08, czl, 0.1, 0.12, 0.3, { segs: 8, tint: lin( 0xa86a4a ), data: [ rand.next(), 1, 0, 0 ] } );
		checks.push( fr.worldPt( cxl, g - 0.3, czl ) );
		fr.addBoxL( cxl, g + hh / 2 - 0.3, czl, 0.36, hh / 2, 0.41, { tag: 'chimney' } );

	}

	if ( s.antenna && ridge ) {

		const ax = ridge.axis === 'x' ? - w * 0.3 : 0, az = ridge.axis === 'x' ? 0 : - d * 0.3;
		const hd = HARD( rand.next(), 0.5, 0.8, 0.4 );
		B.rod( 'hard', [ ax, ridge.y - 0.1, az ], [ ax, ridge.y + 2.4, az ], 0.025, 0.02, { segs: 6, tint: C.galv, data: hd } );
		for ( const [ hy, len ] of [ [ 2.2, 1.2 ], [ 1.9, 1.0 ], [ 1.6, 0.8 ] ] ) {

			B.rod( 'hard', [ ax, ridge.y + hy, az - len / 2 ], [ ax, ridge.y + hy, az + len / 2 ], 0.008, 0.008, { segs: 4, tint: C.galv, data: hd } );

		}

		B.rod( 'hard', [ ax, ridge.y + 2.25, az ], [ ax + 0.9, ridge.y + 2.25, az ], 0.012, 0.012, { segs: 4, tint: C.galv, data: hd } );

	}

	if ( s.gutter && ! isThatch && ridge && ridge.axis === 'x' ) {

		const zf = ridge.zf + 0.06, yg = ridge.yF - 0.12;
		const X = w / 2 + ovR;
		const hd = HARD( rand.next(), 0.55, 0.8, 0.4 );
		B.rod( 'hard', [ - X + 0.1, yg, - zf ], [ X - 0.1, yg, - zf ], 0.06, 0.06, { segs: 8, capTop: true, tint: C.galv, data: hd } );
		const dx = X - 0.25;
		B.rod( 'hard', [ dx, yg, - zf ], [ dx, gAt( dx, - zf ) + 0.95, - zf ], 0.04, 0.04, { segs: 6, tint: C.galv, data: hd } );
		const bp = toW( dx, - zf - 0.05 );
		ctx.inst.add( 'barrel', bp.x, gAt( dx, - zf - 0.05 ) - 0.02, bp.z, rand.range( 0, 6 ), [ 0.9, 0.85, 0.8 ] );
		colliders.addCylinder( bp.x, bp.z, 0.32, gAt( dx, - zf ) - 0.1, gAt( dx, - zf ) + 0.9, { tag: 'barrel' } );

	}

	// back lean-to annex (kitchen / store room) with its own shed roof
	if ( s.annex ) {

		const an = s.annex;
		const aw = Math.min( w - 0.6, an.w ?? w * 0.62 ), ad = annexD, ax = an.x ?? 0;
		const za0 = - d / 2, za1 = - d / 2 - ad;
		const pa = 0.3, Ta = isThatch ? 0.22 : 0.05;
		let yAtt;
		if ( stories > 1 ) yAtt = floorY + storyH - 0.02;
		else if ( roofType === 'gableFront' ) yAtt = yE - 0.03;
		else {

			const eaveEdgeTop = yE + r0 - ovE * ta;
			const fasciaBot = eaveEdgeTop - ( isThatch ? T / Math.cos( a ) + 0.16 : 0.22 );
			yAtt = Math.min( yE - 0.03, fasciaBot - 0.03 + ovE * Math.tan( pa ) );

		}

		const zEnd = za1 - 0.3;
		const yEnd = yAtt - ( za0 - zEnd ) * Math.tan( pa );
		const cutV = Ta / Math.cos( pa ) + 0.01;
		const yBackTop = yAtt - ( za0 - za1 ) * Math.tan( pa ) - cutV;
		const Ha = yBackTop - floorY;
		const aColor = an.wall || s.wall;
		const aPaint = Math.max( 0.3, st.paint - 0.12 );
		const aData = () => [ rand.next(), aPaint, s.siding ?? 1, Math.min( 1, st.weather + 0.1 ) ];
		B.box( 'wood', ax, floorY + Ha / 2, za1 + t / 2, aw, Ha, t, { grain: 0, tint: aColor, data: aData() } );
		for ( const sx of [ - 1, 1 ] ) {

			const xo = ax + sx * aw / 2;
			const pts = [ V3( xo, floorY, za0 - 0.01 ), V3( xo, floorY, za1 ), V3( xo, yBackTop, za1 ), V3( xo, yAtt - cutV, za0 - 0.01 ) ];
			B.slab( 'wood', pts, t, { up: V3( sx, 0, 0 ), uDir: V3( 0, 0, - sx ), tint: aColor, data: aData() } );
			B.box( 'wood', xo - sx * 0.05, floorY + Ha / 2, za1 + 0.05, 0.13, Ha + 0.01, 0.13, { grain: 1, tint: st.trim, data: trimData() } );
			// back corner posts down to the ground
			const lx = ax + sx * ( aw / 2 - 0.12 ), lz = za1 + 0.12;
			const g = gAt( lx, lz );
			B.box( 'wood', lx, ( g - 0.3 + floorY - rimH ) / 2, lz, 0.15, floorY - rimH - g + 0.3, 0.15, { grain: 1, data: WOOD( rand.next(), 0.85 ) } );
			checks.push( fr.worldPt( lx, g - 0.3, lz ) );
			B.box( 'wood', xo + sx * 0.02, rimY, ( za0 + za1 ) / 2, 0.06, rimH, ad, { grain: 2, tint: rimTint, data: rimData() } );

		}

		B.box( 'wood', ax, rimY, za1 - 0.02, aw + 0.08, rimH, 0.06, { grain: 0, tint: rimTint, data: rimData() } );
		B.box( 'wood', ax, yBackTop - 0.08, za1 - 0.012, aw, 0.16, 0.025, { grain: 0, tint: st.trim, data: trimData() } );
		const rx0 = ax - aw / 2 - 0.22, rx1 = ax + aw / 2 + 0.22;
		B.slab( roofKey, [ V3( rx0, yEnd, zEnd ), V3( rx1, yEnd, zEnd ), V3( rx1, yAtt, za0 ), V3( rx0, yAtt, za0 ) ], Ta, {
			up: UP, uDir: V3( 0, yAtt - yEnd, za0 - zEnd ).normalize(), tint: roofTint, data: roofData(),
		} );
		if ( ! isThatch ) B.box( 'wood', ax, yEnd - 0.09, zEnd + 0.016, rx1 - rx0, 0.16, 0.03, { grain: 0, tint: st.trim, data: trimData() } );
		B.pushAt( ax, 0, za1, Math.PI );
		windowUnit( B, rand, 0, floorY + 1.0, 0.7, 0.85, { ...st, closed: rand.chance( 0.25 ), closedPattern: 3 } );
		B.pop();
		fr.addBoxL( ax, ( gMin - 0.3 + yAtt ) / 2, ( za0 + za1 ) / 2, aw / 2 + 0.05, ( yAtt - gMin + 0.3 ) / 2, ad / 2, { tag: 'house' } );

	}

	if ( s.buoys ) {

		// fishing floats hung on the side wall
		const side = s.buoys;
		B.pushAt( side * ( w / 2 + 0.02 ), 0, 0, side * Math.PI / 2 );
		buoyString( B, [ - d / 2 + 0.5, floorY + 2.3, 0.05 ], [ d / 2 - 0.9, floorY + 2.3, 0.05 ], Math.max( 3, Math.floor( d / 0.8 ) ), rand, 0.3 );
		B.pop();

	}

	B.pop();

	// extras placed in world space
	if ( s.tank ) {

		const tp = toW( s.tank * ( w / 2 + 1.25 ), - d / 4 );
		const g = terrain.heightAt( tp.x, tp.z );
		waterTank( B, tp.x, g, tp.z, rand.next(), rand.chance( 0.6 ) );
		colliders.addBox( _v.set( tp.x, g + 1.5, tp.z ), _h.set( 0.75, 1.5, 0.75 ), 0, { tag: 'tank' } );
		checks.push( { x: tp.x, y: g - 0.2, z: tp.z } );

	}

	if ( s.woodpile ) {

		const lx = - s.woodpile * ( w / 2 + 0.45 ), lz = - d / 4;
		const wp = toW( lx, lz );
		woodpile( B, wp.x, terrain.heightAt( wp.x, wp.z ), wp.z, yaw + Math.PI / 2, rand );
		colliders.addBox( _v.set( wp.x, terrain.heightAt( wp.x, wp.z ) + 0.3, wp.z ), _h.set( 0.3, 0.3, 0.6 ), yaw, { tag: 'woodpile' } );

	}

	// main body collider
	const bodyBot = gMin - 0.3;
	fr.addBoxL( 0, ( bodyBot + roofTop ) / 2, 0, w / 2 + 0.06, ( roofTop - bodyBot ) / 2, d / 2 + 0.06, { tag: 'house' } );

	return {
		floorY, roofTop,
		footprint: { x, z, r: Math.hypot( w, d + Math.max( pd, annexD ) * 2 ) / 2 + 0.8, kind: 'building' },
	};

}

function benchLow( B, rand, x, y, z, st ) {

	const wd = () => WOOD( rand.next(), 0.8, st.trimPaint * 0.8, 0 );
	for ( let i = 0; i < 2; i ++ ) B.box( 'wood', x, y + 0.43, z - 0.06 + i * 0.13, 1.3, 0.035, 0.11, { grain: 0, tint: st.accent, data: wd() } );
	for ( const sx of [ - 0.55, 0.55 ] ) B.box( 'wood', x + sx, y + 0.21, z, 0.06, 0.42, 0.3, { grain: 1, tint: st.accent, data: wd() } );
	B.box( 'wood', x, y + 0.72, z - 0.17, 1.3, 0.12, 0.03, { grain: 0, rx: - 0.12, tint: st.accent, data: wd() } );
	for ( const sx of [ - 0.55, 0.55 ] ) B.box( 'wood', x + sx, y + 0.6, z - 0.15, 0.05, 0.36, 0.03, { grain: 1, rx: - 0.12, tint: st.accent, data: wd() } );

}

// ---------------------------------------------------------------------------
// Open-fronted boathouse on the beach (local +z = open side toward the sea)

export function buildBoathouse( ctx, s ) {

	const { B, terrain, colliders, rand, lights, checks } = ctx;
	const { x, z, yaw } = s;
	const w = s.w ?? 5.4, d = s.d ?? 7.2;
	const { toW, gAt } = frameFns( terrain, x, z, yaw );
	const addBoxL = ( lx, ly, lz, hx, hy, hz, opts ) => {

		const p = toW( lx, lz );
		colliders.addBox( _v.set( p.x, ly, p.z ), _h.set( hx, hy, hz ), yaw, opts );

	};

	let gMin = Infinity, gMax = - Infinity;
	for ( let i = 0; i <= 4; i ++ ) for ( let j = 0; j <= 4; j ++ ) {

		const g = gAt( ( i / 4 - 0.5 ) * w, ( j / 4 - 0.5 ) * d );
		gMin = Math.min( gMin, g ); gMax = Math.max( gMax, g );

	}

	const base = gMax;
	const yE = base + 2.7;
	const wall = s.wall || lin( 0x9fb9b0 );
	const paint = s.paint ?? 0.55;
	const wdat = ( pat ) => [ rand.next(), paint, pat, 0.8 ];
	B.pushAt( x, 0, z, yaw );

	// posts
	const postXs = [ - w / 2 + 0.09, w / 2 - 0.09 ];
	const postZs = linspace( - d / 2 + 0.09, d / 2 - 0.09, 4 );
	for ( const px of postXs ) for ( const pz of postZs ) {

		const g = gAt( px, pz );
		B.box( 'wood', px, ( g - 0.5 + yE ) / 2, pz, 0.18, yE - g + 0.5, 0.18, { grain: 1, data: WOOD( rand.next(), 0.9 ) } );
		checks.push( { ...toW( px, pz ), y: g - 0.5 } );

	}

	// walls: back + sides (board and batten, faded paint), open front
	const wallBot = gMin - 0.15;
	const hW = yE - wallBot;
	B.box( 'wood', 0, wallBot + hW / 2, - d / 2 + 0.05, w, hW, 0.08, { grain: 0, tint: wall, data: wdat( 2 ) } );
	for ( const sx of [ - 1, 1 ] ) B.box( 'wood', sx * ( w / 2 - 0.05 ), wallBot + hW / 2, 0, 0.08, hW, d - 0.1, { grain: 2, tint: wall, data: wdat( 2 ) } );
	addBoxL( 0, wallBot + hW / 2, - d / 2 + 0.05, w / 2, hW / 2, 0.08, { tag: 'boathouse' } );
	for ( const sx of [ - 1, 1 ] ) addBoxL( sx * ( w / 2 - 0.05 ), wallBot + hW / 2, 0, 0.08, hW / 2, d / 2, { tag: 'boathouse' } );
	// header over the opening
	B.box( 'wood', 0, yE - 0.14, d / 2 - 0.09, w, 0.28, 0.16, { grain: 0, data: WOOD( rand.next(), 0.85 ) } );

	// gable roof, ridge along z (toward the sea)
	const a = 0.5, ta = Math.tan( a ), r0 = 0.1;
	const yR = yE + r0 + ( w / 2 ) * ta;
	const ov = 0.4, Z = d / 2 + 0.45;
	const xe = w / 2 + ov, yF = yE + r0 - ov * ta;
	const rd = () => [ rand.next(), 0.75, 0, 0 ];
	const rt = s.roofColor || lin( 0x6d7f86 );
	B.slab( 'roofMetal', [ V3( xe, yF, Z ), V3( xe, yF, - Z ), V3( 0, yR, - Z ), V3( 0, yR, Z ) ], 0.05, { up: UP, uDir: V3( - xe, yR - yF, 0 ).normalize(), tint: rt, data: rd() } );
	B.slab( 'roofMetal', [ V3( - xe, yF, - Z ), V3( - xe, yF, Z ), V3( 0, yR, Z ), V3( 0, yR, - Z ) ], 0.05, { up: UP, uDir: V3( xe, yR - yF, 0 ).normalize(), tint: rt, data: rd() } );
	for ( const sz of [ - 1, 1 ] ) {

		B.part( 'wood', gableEndPart( w, r0 - 0.03, r0 + ( w / 2 ) * ta - 0.03, 0.08 ), 0, yE, sz * ( d / 2 - 0.05 ), { ry: sz > 0 ? 0 : Math.PI, tint: wall, data: wdat( 2 ) } );

	}

	// ridge beam + rafters (visible from inside)
	B.box( 'wood', 0, yR - 0.14, 0, 0.1, 0.18, d + 0.8, { grain: 2, data: WOOD( rand.next(), 0.8 ) } );
	for ( const pz of linspace( - d / 2 + 0.3, d / 2 - 0.3, 5 ) ) {

		for ( const sx of [ - 1, 1 ] ) B.beam( 'wood', [ 0, yR - 0.12, pz ], [ sx * ( w / 2 + ov - 0.05 ), yF - 0.1, pz ], 0.05, 0.12, { data: WOOD( rand.next(), 0.75 ) } );
		B.box( 'wood', 0, yE - 0.05, pz, w - 0.1, 0.1, 0.07, { grain: 0, data: WOOD( rand.next(), 0.8 ) } );

	}

	// inside: a rowboat on a cradle, oars on the wall, nets, workbench, lantern
	const gIn = gAt( 0.3, 0 );
	rowboat( B, 0.35, gIn + 0.28, 0.1, 0, { seed: rand.next(), hull: lin( 0xd9d2bf ), bottom: lin( 0x2f5f7a ), trim: lin( 0x2f5f7a ), length: 4.2 } );
	for ( const pz of [ - 1.1, 1.2 ] ) B.box( 'wood', 0.35, gIn + 0.12, pz, 1.1, 0.24, 0.14, { grain: 0, data: WOOD( rand.next(), 0.9 ) } );
	addBoxL( 0.35, gIn + 0.5, 0.1, 0.8, 0.5, 2.2, { tag: 'boat' } );
	oar( B, [ - w / 2 + 0.12, gAt( - w / 2 + 0.2, - 1.5 ) + 0.4, - 1.6 ], [ - w / 2 + 0.12, gAt( - w / 2 + 0.2, - 1.5 ) + 2.55, - 1.35 ], rand.next(), lin( 0xc23b2e ) );
	oar( B, [ - w / 2 + 0.12, gAt( - w / 2 + 0.2, - 1.0 ) + 0.4, - 0.9 ], [ - w / 2 + 0.12, gAt( - w / 2 + 0.2, - 1.0 ) + 2.55, - 0.7 ], rand.next(), lin( 0xc23b2e ) );
	// workbench along the right wall
	const bx = w / 2 - 0.45;
	const gB = gAt( bx, - 1.5 );
	for ( let i = 0; i < 3; i ++ ) B.box( 'wood', bx - 0.2 + i * 0.2, gB + 0.9, - 1.5, 0.19, 0.05, 2.0, { grain: 2, data: WOOD( rand.next(), 0.7 ) } );
	for ( const pz of [ - 2.4, - 0.6 ] ) for ( const px of [ bx - 0.25, bx + 0.25 ] ) B.box( 'wood', px, gB + 0.43, pz, 0.07, 0.9, 0.07, { grain: 1, data: WOOD( rand.next(), 0.8 ) } );
	bucket( B, bx, gB + 0.925, - 2.1, lin( 0xd8d8d0 ), rand.next() );
	fish( B, bx, gB + 0.925, - 1.2, { species: 'mullet', len: 0.4, ry: 1.9, sag: 0.15, jaw: 0.2, wet: 0.6, cloudy: 0.6, seed: rand.next() } );
	addBoxL( bx, gB + 0.45, - 1.5, 0.35, 0.45, 1.0, { tag: 'bench' } );
	// net hanging on the left wall
	const netPart = gridPart( 10, 8, ( i, j ) => {

		const u = i / 10, v = j / 8;
		const pz = - 0.2 + u * 2.4;
		const sag = Math.sin( u * Math.PI ) * 0.35 * v;
		return { p: [ - w / 2 + 0.16 + Math.sin( u * 12 + v * 3 ) * 0.03, yE - 0.35 - v * 1.6 + sag * 0.3, pz + Math.sin( v * 5 ) * 0.05 ], n: [ 1, 0, 0 ], uv: [ u * 2.4, v * 1.6 ] };

	} );
	B.add( 'net', netPart, new Matrix4(), lin( 0x4f7a6a ), ( px, py ) => [ 0.3, Math.min( 1, Math.max( 0, ( yE - 0.35 - py ) / 1.6 ) ) * 0.4, 0.04, 0 ] );
	const lp = lantern( B, 0, yR - 0.25, 0.8, rand.next() );
	lights.push( { position: B.toWorld( lp[ 0 ], lp[ 1 ], lp[ 2 ] ), color: WARM.clone(), intensity: 3, kind: 'lantern' } );

	// slipway rails down toward the water
	for ( const sx of [ - 0.55, 1.25 ] ) {

		const zA = d / 2 - 0.3, zB = d / 2 + 6.5;
		const gA = gAt( sx, zA ), gBv = gAt( sx, zB );
		B.beam( 'wood', [ sx, gA + 0.04, zA ], [ sx, gBv + 0.02, zB ], 0.14, 0.12, { data: WOOD( rand.next(), 0.95 ) } );
		for ( const pz of linspace( zA + 0.5, zB - 0.3, 5 ) ) {

			const gg = gAt( sx, pz );
			B.box( 'wood', sx + 0.35, gg - 0.02, pz, 1.1, 0.09, 0.16, { grain: 0, data: WOOD( rand.next(), 0.95 ) } );

		}

	}

	B.pop();
	flagPole( B, toW( - w / 2 - 0.6, d / 2 - 0.3 ).x, gAt( - w / 2 - 0.6, d / 2 - 0.3 ), toW( - w / 2 - 0.6, d / 2 - 0.3 ).z, 5.5, lin( 0x2f6fb0 ), rand.next() );
	{

		const p = toW( - w / 2 - 0.6, d / 2 - 0.3 );
		colliders.addCylinder( p.x, p.z, 0.08, gAt( - w / 2 - 0.6, d / 2 - 0.3 ) - 0.3, gAt( - w / 2 - 0.6, d / 2 - 0.3 ) + 5.5, { tag: 'flagpole' } );

	}

	return { footprint: { x, z, r: Math.hypot( w, d ) / 2 + 1, kind: 'building' } };

}

// ---------------------------------------------------------------------------
// Market stall with a thatched roof (local +z = customer side)

export function buildMarketStall( ctx, s ) {

	const { B, terrain, colliders, rand, lights, checks } = ctx;
	const { x, z, yaw } = s;
	const w = 3.4, d = 2.4;
	const { toW, gAt } = frameFns( terrain, x, z, yaw );
	const addBoxL = ( lx, ly, lz, hx, hy, hz, opts ) => {

		const p = toW( lx, lz );
		colliders.addBox( _v.set( p.x, ly, p.z ), _h.set( hx, hy, hz ), yaw, opts );

	};

	B.pushAt( x, 0, z, yaw );
	const g0 = gAt( 0, 0 );
	const top = g0 + 2.55;
	for ( const px of [ - w / 2, w / 2 ] ) for ( const pz of [ - d / 2, d / 2 ] ) {

		const g = gAt( px, pz );
		B.cyl( 'wood', px, g - 0.4, pz, 0.065, 0.075, top - g + 0.45, { segs: 7, data: WOOD( rand.next(), 0.9 ) } );
		const p = toW( px, pz );
		colliders.addCylinder( p.x, p.z, 0.1, g - 0.4, top, { tag: 'stall' } );
		checks.push( { x: p.x, y: g - 0.4, z: p.z } );

	}

	for ( const pz of [ - d / 2, d / 2 ] ) B.rod( 'wood', [ - w / 2 - 0.2, top, pz ], [ w / 2 + 0.2, top, pz ], 0.06, 0.06, { segs: 6, data: WOOD( rand.next(), 0.85 ) } );
	// hip thatch roof
	const ov = 0.5, a = 0.62, ta = Math.tan( a );
	const XE = w / 2 + ov, ZE = d / 2 + ov, XR = ( w - d ) / 2;
	const ye = top + 0.08, yR = ye + ZE * ta;
	const td = () => [ rand.next(), 0.5, 0, 0 ];
	const T = 0.2;
	B.slab( 'thatch', [ V3( - XE, ye, ZE ), V3( XE, ye, ZE ), V3( XR, yR, 0 ), V3( - XR, yR, 0 ) ], T, { up: UP, uDir: V3( 0, yR - ye, - ZE ).normalize(), data: td() } );
	B.slab( 'thatch', [ V3( XE, ye, - ZE ), V3( - XE, ye, - ZE ), V3( - XR, yR, 0 ), V3( XR, yR, 0 ) ], T, { up: UP, uDir: V3( 0, yR - ye, ZE ).normalize(), data: td() } );
	B.slab( 'thatch', [ V3( XE, ye, ZE ), V3( XE, ye, - ZE ), V3( XR, yR, 0 ) ], T, { up: UP, uDir: V3( - XE + XR, yR - ye, 0 ).normalize(), data: td() } );
	B.slab( 'thatch', [ V3( - XE, ye, - ZE ), V3( - XE, ye, ZE ), V3( - XR, yR, 0 ) ], T, { up: UP, uDir: V3( XE - XR, yR - ye, 0 ).normalize(), data: td() } );
	B.rod( 'thatch', [ - XR - 0.05, yR - 0.04, 0 ], [ XR + 0.05, yR - 0.04, 0 ], 0.15, 0.15, { segs: 7, data: [ rand.next(), 0.7, 0, 0 ] } );

	// counter with fish baskets
	const cy = g0 + 0.92;
	for ( let i = 0; i < 4; i ++ ) B.box( 'wood', 0, cy, d / 2 - 0.55 + i * 0.13 - 0.2, w - 0.2, 0.045, 0.12, { grain: 0, data: WOOD( rand.next(), 0.75 ) } );
	for ( const px of [ - w / 2 + 0.25, w / 2 - 0.25 ] ) for ( const pz of [ d / 2 - 0.3, d / 2 - 0.85 ] ) B.box( 'wood', px, g0 + 0.45, pz, 0.07, 0.9, 0.07, { grain: 1, data: WOOD( rand.next(), 0.8 ) } );
	B.box( 'wood', 0, g0 + 0.5, d / 2 - 0.26, w - 0.3, 0.6, 0.03, { grain: 0, tint: lin( 0x5aa7a0 ), data: [ rand.next(), 0.55, 3, 0.7 ] } );
	addBoxL( 0, g0 + 0.5, d / 2 - 0.55, w / 2 - 0.05, 0.5, 0.35, { tag: 'stall' } );
	// the fish displays draw from their own random sequence (the village's stays as it was)
	const fr = new Rand( mulberry32( Math.floor( rand.next() * 4294967296 ) ) );
	for ( let i = 1; i < 58; i ++ ) rand.next();
	// basins: fish on crushed ice or banana leaves, lying on each other, curled; lobsters
	const basins = [
		{ bx: - 1.05, bed: 'ice', fish: [ [ 'redSnapper', 0.4 ], [ 'redSnapper', 0.36 ], [ 'yellowtail', 0.36 ], [ 'redSnapper', 0.38 ], [ 'yellowtail', 0.34 ] ] },
		{ bx: 0.0, bed: 'leaf', fish: [ [ 'parrot', 0.42 ], [ 'grunt', 0.3 ], [ 'grunt', 0.28 ], [ 'parrot', 0.38 ], [ 'grunt', 0.3 ] ] },
		{ bx: 1.05, bed: 'ice', fish: [ [ 'jack', 0.4 ], [ 'mullet', 0.36 ], [ 'jack', 0.38 ] ], lobsters: 2 },
	];
	const bz = d / 2 - 0.58;
	for ( const b of basins ) {

		const { bx } = b;
		B.lathe( 'wood', bx, cy + 0.02, bz, [ [ 0, 0 ], [ 0.21, 0 ], [ 0.21, 0.0 ], [ 0.3, 0.16 ], [ 0.315, 0.17 ], [ 0.29, 0.165 ], [ 0.2, 0.03 ], [ 0, 0.03 ] ], { segs: 14, tint: lin( 0xc9a66a ), data: WOOD( fr.next(), 0.2, 0, 5 ) } );
		// basin floor at cy + 0.05; inner radius 0.2 there, 0.29 at the rim (cy + 0.19)
		const floor = cy + 0.05;
		let lift = floor;
		if ( b.bed === 'ice' ) {

			iceBed( B, bx, cy + 0.12, bz, 0.25, fr.next() );
			lift = cy + 0.15;

		} else {

			// leaves lining the basin, their tips over the rim
			for ( let k = 0; k < 4; k ++ ) {

				const a = k * Math.PI / 2 + fr.range( - 0.3, 0.3 );
				bananaLeaf( B, bx + Math.cos( a ) * 0.02, floor + 0.004 + k * 0.002, bz + Math.sin( a ) * 0.02, - a, 0.36, fr.next(), 0.5 );

			}

			lift = floor + 0.02;

		}

		// fish in layers, heads alternating, bodies curved to the basin, tails over the rim
		b.fish.forEach( ( [ species, len ], i ) => {

			const a = i * 2.4 + fr.range( - 0.4, 0.4 );
			const r = fr.range( 0.0, 0.07 );
			fish( B, bx + Math.cos( a ) * r, lift + Math.floor( i / 2 ) * 0.04, bz + Math.sin( a ) * r, {
				species, len, ry: a + ( i % 2 ? Math.PI : 0 ) + fr.range( - 0.3, 0.3 ), rx: fr.range( - 0.12, 0.12 ), rz: fr.range( - 0.1, 0.1 ),
				flip: fr.chance( 0.3 ), sag: fr.range( 0.35, 0.8 ) * ( fr.chance( 0.5 ) ? 1 : - 1 ), curl: fr.range( - 0.25, 0.15 ),
				jaw: fr.range( 0.15, 0.5 ), cloudy: fr.range( 0.2, 0.6 ), blood: fr.range( 0.3, 1 ), seed: fr.next(),
			} );

		} );
		for ( let k = 0; k < ( b.lobsters || 0 ); k ++ ) {

			const a = k * Math.PI + 0.6;
			lobster( B, bx + Math.cos( a ) * 0.09, lift + 0.07, bz + Math.sin( a ) * 0.1, a + Math.PI * 0.5, 0.26, fr.next(), fr.range( - 0.15, 0.15 ) );

		}

	}

	// small fry on banana leaves between the basins
	for ( const lx of [ - 0.52, 0.52 ] ) {

		bananaLeaf( B, lx - 0.22, cy + 0.025, bz - 0.02, fr.range( - 0.12, 0.12 ), 0.44, fr.next() );
		for ( let k = 0; k < 3; k ++ ) {

			fish( B, lx + fr.range( - 0.04, 0.04 ), cy + 0.035 + k * 0.012, bz - 0.06 + k * 0.05, {
				species: fr.pick( [ 'grunt', 'yellowtail', 'mullet' ] ), len: fr.range( 0.2, 0.26 ), ry: fr.range( - 0.4, 0.4 ) + ( k % 2 ? Math.PI : 0 ),
				sag: fr.range( - 0.4, 0.4 ), jaw: fr.range( 0.1, 0.4 ), seed: fr.next(),
			} );

		}

	}

	// fish hanging from the front beam: by the tail on twine, or on S-hooks through the gills;
	// limp (slightly curled and sagging), mouths open
	const hung = [
		[ - 1.42, 'mahi', 0.9, 'tail' ], [ - 0.9, 'redSnapper', 0.46, 'gill' ], [ - 0.45, 'grouper', 0.62, 'tail' ],
		[ 0.05, 'barracuda', 0.95, 'tail' ], [ 0.52, 'tuna', 0.58, 'tail' ], [ 0.95, 'redSnapper', 0.42, 'gill' ], [ 1.4, 'yellowtail', 0.4, 'gill' ],
	];
	for ( const [ px, species, len, how ] of hung ) {

		const opts = {
			species, len, pose: how, ry: fr.range( - 0.15, 0.15 ), sag: fr.range( - 0.2, 0.2 ), curl: fr.range( - 0.25, 0.25 ),
			jaw: how === 'tail' ? fr.range( 0.35, 0.6 ) : fr.range( 0.1, 0.3 ), cloudy: fr.range( 0.2, 0.5 ), blood: fr.range( 0.4, 1 ), seed: fr.next(),
		};
		if ( how === 'tail' ) {

			const y = top - 0.2 - fr.range( 0, 0.08 );
			fishTwine( B, [ px, top - 0.05, d / 2 ], [ px, y, d / 2 ], fr.next(), 0.012 + len * 0.01 );
			fish( B, px, y, d / 2, opts );

		} else {

			const y = sHook( B, px, top, d / 2, 0.06, fr.next() );
			fish( B, px, y, d / 2, opts );

		}

	}

	const lp = lantern( B, 0, top - 0.02, - d / 2, rand.next() );
	lights.push( { position: B.toWorld( lp[ 0 ], lp[ 1 ], lp[ 2 ] ), color: WARM.clone(), intensity: 3, kind: 'lantern' } );
	B.pop();

	for ( const [ lx, lz ] of [ [ - 1.3, - 0.4 ], [ - 0.7, - 0.6 ], [ 1.2, - 0.5 ] ] ) {

		const p = toW( lx, lz );
		ctx.inst.add( 'crate', p.x, gAt( lx, lz ), p.z, yaw + rand.range( - 0.3, 0.3 ), [ rand.range( 0.85, 1.05 ), 0.95, 0.9 ] );

	}

	return { footprint: { x, z, r: Math.hypot( w, d ) / 2 + 1.2, kind: 'building' } };

}

// ---------------------------------------------------------------------------
// Small lean-to garden / tool shed (local +z = door side)

export function buildShed( ctx, s ) {

	const { B, terrain, colliders, rand, checks } = ctx;
	const { x, z, yaw } = s;
	const w = s.w ?? 1.9, d = s.d ?? 1.7;
	const { toW, gAt } = frameFns( terrain, x, z, yaw );
	let gMin = Infinity, gMax = - Infinity;
	for ( const [ cx, cz ] of [ [ - 1, - 1 ], [ 1, - 1 ], [ 1, 1 ], [ - 1, 1 ], [ 0, 0 ] ] ) {

		const g = gAt( cx * w / 2, cz * d / 2 );
		gMin = Math.min( gMin, g ); gMax = Math.max( gMax, g );

	}

	const base = gMax + 0.22;
	const hF = 2.3, hB = 1.95, t = 0.05;
	const col = s.wall || lin( 0x9aa7a0 );
	const paint = s.paint ?? 0.45;
	const wd = ( pat ) => [ rand.next(), paint, pat, 0.9 ];
	B.pushAt( x, 0, z, yaw );
	for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) {

		const px = sx * ( w / 2 - 0.05 ), pz = sz * ( d / 2 - 0.05 );
		const g = gAt( px, pz );
		const top = base + ( sz > 0 ? hF : hB );
		B.box( 'wood', px, ( g - 0.3 + top ) / 2, pz, 0.1, top - g + 0.3, 0.1, { grain: 1, data: WOOD( rand.next(), 0.9 ) } );
		checks.push( { ...toW( px, pz ), y: g - 0.3 } );

	}

	const skirt = base - gMin + 0.1;
	B.box( 'wood', 0, base - skirt / 2 + hF / 2, d / 2 - t / 2, w, hF + skirt, t, { grain: 0, tint: col, data: wd( 2 ) } );
	B.box( 'wood', 0, base - skirt / 2 + hB / 2, - d / 2 + t / 2, w, hB + skirt, t, { grain: 0, tint: col, data: wd( 2 ) } );
	for ( const sx of [ - 1, 1 ] ) {

		const xo = sx * w / 2;
		const pts = [ V3( xo, base - skirt, d / 2 - t ), V3( xo, base - skirt, - d / 2 + t ), V3( xo, base + hB, - d / 2 + t ), V3( xo, base + hF, d / 2 - t ) ];
		B.slab( 'wood', pts, t, { up: V3( sx, 0, 0 ), uDir: V3( 0, 0, - sx ), tint: col, data: wd( 2 ) } );

	}

	// plank door with Z brace + hinges
	const dc = s.door || lin( 0x2d7f7a );
	B.box( 'wood', 0.15, base + 0.92, d / 2 + 0.012, 0.8, 1.8, 0.03, { grain: 1, tint: dc, data: [ rand.next(), 0.55, 3, 0.8 ] } );
	B.beam( 'wood', [ - 0.2, base + 0.25, d / 2 + 0.035 ], [ 0.5, base + 1.55, d / 2 + 0.035 ], 0.02, 0.1, { tint: dc, data: [ rand.next(), 0.55, 0, 0.8 ] } );
	for ( const hy of [ 0.3, 1.5 ] ) B.box( 'hard', - 0.13, base + hy, d / 2 + 0.03, 0.25, 0.04, 0.01, { tint: C.iron, data: HARD( rand.next(), 0.8, 0.5, 0.6 ) } );
	// shed roof
	const rf = [ V3( - w / 2 - 0.2, base + hB + 0.02, - d / 2 - 0.25 ), V3( w / 2 + 0.2, base + hB + 0.02, - d / 2 - 0.25 ), V3( w / 2 + 0.2, base + hF + 0.08, d / 2 + 0.3 ), V3( - w / 2 - 0.2, base + hF + 0.08, d / 2 + 0.3 ) ];
	B.slab( 'roofMetal', rf, 0.04, { up: UP, uDir: V3( 0, hF - hB, d + 0.55 ).normalize(), tint: s.roof || lin( 0x8a5a40 ), data: [ rand.next(), 0.8, s.galv ? 1 : 0, 0 ] } );
	B.pop();
	const c = toW( 0, 0 );
	colliders.addBox( _v.set( c.x, ( gMin - 0.3 + base + hF ) / 2, c.z ), _h.set( w / 2 + 0.05, ( base + hF - gMin + 0.3 ) / 2, d / 2 + 0.05 ), yaw, { tag: 'shed' } );
	return { floorY: base, roofTop: base + hF + 0.1, footprint: { x, z, r: Math.hypot( w, d ) / 2 + 0.6, kind: 'building' } };

}
