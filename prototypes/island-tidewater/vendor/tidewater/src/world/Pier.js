import { Color, Vector3 } from '../engine/index.js';
import { WORLD } from './WorldLayout.js';
import {
	WOOD, HARD, C, lin, bollard, cleat, tireFender, ropeCoil, ropeLoop, lifeRing, lampPost,
	bench, cleaningTable, buoyString, bucket, lantern,
} from './Props.js';

// Timber pier with a T-shaped head. Everything is procedural geometry written into a
// GeoBuilder; colliders are registered for decks, steps, rails, piles and props.
//
// Deck top is exactly WORLD.pier.deckHeight everywhere (colliders tagged 'pierDeck').

const P = WORLD.pier;

const ARCH_H = 2.75; // entrance arch beam height above the deck

export const PIER = {
	x: P.x,
	zStart: P.zStart,
	zEnd: P.zEnd,
	deck: P.deckHeight,
	width: P.width,
	halfW: P.width / 2,
	headZ0: P.zEnd - P.headDepth,
	headX0: P.x - P.headWidth / 2,
	headX1: P.x + P.headWidth / 2,
	plankT: 0.055,
	pileR: 0.15,
	pileOff: P.width / 2 + 0.17,
	stringerH: 0.22,
	capH: 0.26,
};

const _v = new Vector3();
const _h = new Vector3();

export function buildPier( { B, terrain, colliders, rand, lights, inst, signB = null, hang = null } ) {

	const X = PIER.x, DK = PIER.deck, halfW = PIER.halfW;
	const z0 = PIER.zStart, zH = PIER.headZ0, z1 = PIER.zEnd;
	const hx0 = PIER.headX0, hx1 = PIER.headX1;
	const plankT = PIER.plankT;
	const stringerTop = DK - plankT;
	const capTop = stringerTop - PIER.stringerH;
	const capBot = capTop - PIER.capH;
	const ground = ( x, z ) => terrain.heightAt( x, z );
	const pierWood = ( w0 = 0.6, w1 = 0.95 ) => WOOD( rand.next(), rand.range( w0, w1 ), 0, 0 );
	// timber tone per piece: most boards close to the average, some dark (water-stained, oily) or
	// pale (sun-bleached, recently planed) - an old pier is a patchwork of repairs
	const tone = () => {

		let k = rand.range( 0.84, 1.1 );
		const r = rand.next();
		if ( r < 0.1 ) k *= rand.range( 0.7, 0.82 );
		else if ( r > 0.94 ) k *= rand.range( 1.1, 1.2 );
		const w = rand.range( - 0.02, 0.06 );
		return [ k * ( 1 + w ), k, k * ( 1 - w * 1.2 ) ];

	};
	// a replacement board: fresh, warm, not yet silvered
	const freshTone = () => [ rand.range( 1.04, 1.1 ), rand.range( 0.98, 1.02 ), rand.range( 0.9, 0.95 ) ];
	const info = { lamps: [], bollards: [], hung: [] };

	const addBox = ( cx, cy, cz, hx, hy, hz, opts ) => colliders.addBox( _v.set( cx, cy, cz ), _h.set( hx, hy, hz ), 0, opts );

	// ------------------------------------------------------------------ piles
	const pile = ( px, pz, top, opts = {} ) => {

		const g = ground( px, pz );
		const bottom = g - 1.5;
		const r = opts.r ?? PIER.pileR * rand.range( 0.84, 1.16 );
		const post = top > DK;
		const h = top - bottom;
		// driven piles wander: posts that carry a rail lean less
		const tilt = post ? 0.008 : 0.028;
		const data = WOOD( rand.next(), rand.range( 0.8, 1.0 ), 0, 0 );
		const rx = rand.range( - tilt, tilt ), rz = rand.range( - tilt, tilt );
		B.cyl( 'wood', px, bottom, pz, r * rand.range( 0.86, 0.95 ), r * 1.06, h, {
			segs: 10, capTop: ! post || !! opts.flatTop, rx, rz, tint: tone(), data,
		} );
		const wl = 0.0; // mean sea level
		// sistered repair: a shorter, thinner pile bolted alongside a rotten one
		if ( ! post && rand.chance( 0.18 ) && top - g > 2.5 ) {

			const a = rand.range( 0, Math.PI * 2 ), d = r + 0.08;
			const sx = px + Math.cos( a ) * d, sz = pz + Math.sin( a ) * d;
			const sb = Math.max( g - 0.5, bottom ), st = top - rand.range( 0.05, 0.4 );
			B.cyl( 'wood', sx, sb, sz, 0.075, 0.085, st - sb, { segs: 7, rx: rand.range( - 0.01, 0.01 ), rz: rand.range( - 0.01, 0.01 ), tint: freshTone(), data: WOOD( rand.next(), rand.range( 0.2, 0.45 ), 0, 0 ) } );
			for ( const by of [ wl + 0.6, st - 0.3 ] ) {

				if ( by < sb + 0.2 ) continue;
				B.cyl( 'hard', ( px + sx ) / 2, by, ( pz + sz ) / 2, 0.012, 0.012, d + 0.1, { segs: 5, rx: Math.PI / 2, ry: - a + Math.PI / 2, tint: C.iron, data: HARD( rand.next(), 0.95, 0.4, 0.7 ) } );

			}

		}

		// old mooring rope wrapped round a pile above the water, or a tyre slipped over it
		if ( ! post && rand.chance( 0.1 ) ) {

			const y = wl + rand.range( 0.7, 1.4 );
			for ( let k = 0; k < 3; k ++ ) B.torus( 'rope', px, y + k * 0.035, pz, r + 0.02, 0.018, { rx: rand.range( - 0.08, 0.08 ), radial: 5, tubular: 14, tint: rand.chance( 0.5 ) ? C.rope : C.ropeDark, data: [ rand.next(), 0.8, 0, 0 ] } );

		} else if ( ! post && rand.chance( 0.05 ) ) {

			B.torus( 'hard', px, wl + rand.range( 0.3, 0.9 ), pz, r + 0.2, 0.1, { rx: rand.range( - 0.25, 0.25 ), rz: rand.range( - 0.2, 0.2 ), radial: 6, tubular: 14, tint: C.rubber, data: HARD( rand.next(), 0, 0, 0.85 ) } );

		}
		if ( post && ! opts.flatTop ) {

			B.cyl( 'wood', px, top, pz, r * 0.5, r * 0.93, 0.07, { segs: 10, tint: tone(), data } );

		}

		colliders.addCylinder( px, pz, r + 0.02, bottom, top, { tag: 'pile' } );
		return { bottom, g };

	};

	const bolt = ( x, y, z, dir ) => {

		B.cyl( 'hard', x, y, z, 0.022, 0.026, 0.022, { segs: 5, rx: dir * Math.PI / 2, tint: C.iron, data: HARD( rand.next(), 0.85, 0.4, 0.6 ) } );

	};

	// double cap beam (one on each face of a pile row) running along x at z = bz
	const capRow = ( bz, xa, xb, pileXs ) => {

		const off = PIER.pileR + 0.05;
		for ( const s of [ - 1, 1 ] ) {

			B.box( 'wood', ( xa + xb ) / 2, capBot + PIER.capH / 2, bz + s * off, xb - xa, PIER.capH, 0.09, { grain: 0, tint: tone(), data: pierWood( 0.7, 0.95 ) } );
			for ( const px of pileXs ) bolt( px, capBot + PIER.capH / 2, bz + s * ( off + 0.045 ), s );

		}

		// cap beams are solid obstacles for anyone walking / swimming beneath the deck
		addBox( ( xa + xb ) / 2, capBot + PIER.capH / 2, bz, ( xb - xa ) / 2, PIER.capH / 2, off + 0.05, { tag: 'pierCap' } );

	};

	const xBrace = ( xa, xb, bz, clearBottom ) => {

		const yTop = capBot - 0.12;
		const yBot = Math.max( clearBottom + 0.35, yTop - 4.2 );
		if ( yTop - yBot < 0.9 ) return;
		const off = PIER.pileR + 0.035;
		// bays differ: one brace lost to a storm, braces replaced at slightly different heights
		const r = rand.next();
		const j = () => rand.range( - 0.18, 0.18 );
		const piece = () => rand.chance( 0.2 ) ? { tint: freshTone(), data: WOOD( rand.next(), rand.range( 0.25, 0.5 ), 0, 0 ) } : { tint: tone(), data: pierWood( 0.8, 1 ) };
		if ( r > 0.12 ) B.beam( 'wood', [ xa, yTop + j(), bz + off ], [ xb, yBot + j(), bz + off ], 0.05, rand.range( 0.17, 0.22 ), piece() );
		if ( r < 0.84 ) B.beam( 'wood', [ xa, yBot + j(), bz - off ], [ xb, yTop + j(), bz - off ], 0.05, rand.range( 0.17, 0.22 ), piece() );
		// a horizontal waler here and there
		if ( rand.chance( 0.25 ) ) B.beam( 'wood', [ xa - 0.1, yBot + 0.3, bz + off + 0.05 ], [ xb + 0.1, yBot + 0.3 + rand.range( - 0.06, 0.06 ), bz + off + 0.05 ], 0.05, 0.18, { tint: tone(), data: pierWood( 0.85, 1 ) } );

	};

	// ------------------------------------------------------------------ walkway bents
	const bentZ = [];
	const zb0 = z0 + 0.35, zbN = zH + 0.25;
	const nB = Math.round( ( zbN - zb0 ) / 3.0 );
	for ( let i = 0; i <= nB; i ++ ) bentZ.push( zb0 + i * ( zbN - zb0 ) / nB );
	const lastBent = bentZ.length - 1;

	const gapBays = { '-1': [ 9, 10, 20 ], '1': [ 14, 15, 26 ] };
	const railBay = ( side, i ) => i >= 1 && i < lastBent && ! gapBays[ side ].includes( i );

	for ( let bi = 0; bi < bentZ.length; bi ++ ) {

		const bz = bentZ[ bi ];
		for ( const side of [ - 1, 1 ] ) {

			const px = X + side * PIER.pileOff;
			const needPost = railBay( side, bi ) || railBay( side, bi - 1 ) || bi === 0 || bi === lastBent;
			let top = capTop;
			if ( needPost ) top = DK + ( bi === 0 ? ARCH_H + 0.25 : 0.95 );
			else if ( bi % 3 === 1 ) top = DK + 0.45;
			pile( px, bz, top, { flatTop: needPost && bi !== 0, r: bi === 0 ? 0.17 : undefined } );

		}

		if ( bi !== lastBent ) {

			const xa = X - PIER.pileOff - 0.3, xb = X + PIER.pileOff + 0.3;
			capRow( bz, xa, xb, [ X - PIER.pileOff, X + PIER.pileOff ] );
			const gMin = Math.min( ground( X - PIER.pileOff, bz ), ground( X + PIER.pileOff, bz ) );
			xBrace( X - PIER.pileOff, X + PIER.pileOff, bz, gMin );

		}

		// longitudinal sway bracing on alternate bays
		if ( bi < lastBent && bi % 2 === 0 ) {

			const bz2 = bentZ[ bi + 1 ];
			for ( const side of [ - 1, 1 ] ) {

				const xo = X + side * ( PIER.pileOff + PIER.pileR + 0.03 );
				const g = Math.max( ground( X + side * PIER.pileOff, bz ), ground( X + side * PIER.pileOff, bz2 ) );
				const yTop = capBot - 0.2, yBot = Math.max( g + 0.4, yTop - 3.2 );
				if ( yTop - yBot > 0.9 && rand.chance( 0.85 ) ) {

					const flip = rand.chance( 0.3 );
					B.beam( 'wood', [ xo, flip ? yBot : yTop, bz + 0.25 + rand.range( 0, 0.2 ) ], [ xo, flip ? yTop : yBot, bz2 - 0.25 - rand.range( 0, 0.2 ) ], 0.05, rand.range( 0.17, 0.22 ), { tint: tone(), data: pierWood( 0.8, 1 ) } );

				}

			}

		}

	}

	// stringers per bay (4 lines), extend onto the head's north cap row
	const stringerXs = [ - 1.2, - 0.42, 0.42, 1.2 ];
	for ( let bi = 0; bi < lastBent; bi ++ ) {

		const za = bi === 0 ? z0 + 0.02 : bentZ[ bi ];
		const zb = bentZ[ bi + 1 ];
		for ( const sx of stringerXs ) {

			B.box( 'wood', X + sx, stringerTop - PIER.stringerH / 2, ( za + zb ) / 2, 0.1, PIER.stringerH, zb - za + 0.04, { grain: 2, tint: tone(), data: pierWood( 0.7, 0.95 ) } );

		}

	}

	// One deck board centred on (cx, zc), length L along x. Old decking is irregular: boards shrink,
	// cup and twist, ends don't line up, some have been replaced with fresh timber, some are split
	// and a very few are gone. Walkway boards get a worn path down the middle (passed to the wood
	// material as paint = -( 1 + path centre u ), see VillageMaterials).
	function plank( cx, zc, L, head ) {

		if ( rand.chance( head ? 0.006 : 0.012 ) ) return; // missing board
		const newer = rand.chance( 0.07 );
		const wth = newer ? rand.range( 0.25, 0.45 ) : rand.range( 0.55, 1.0 );
		const t = newer ? freshTone() : tone();
		// boards nearly fill the 0.215 m pitch (gaps ~0.5-2.5 cm): wider gaps turned the distant deck
		// into rows of sub-pixel dark lines that no anti-aliasing kept steady
		const wdt = rand.range( 0.198, 0.206 );
		const yOff = rand.range( 0, 0.014 ) + ( rand.chance( 0.08 ) ? rand.range( 0.006, 0.016 ) : 0 );
		const e0 = rand.range( - 0.06, 0.05 ), e1 = rand.range( - 0.05, 0.06 );
		const xa = cx - L / 2 + e0, xb = cx + L / 2 + e1;
		const opts = () => ( {
			grain: 0, ry: rand.range( - 0.012, 0.012 ), rx: rand.range( - 0.022, 0.022 ), rz: rand.range( - 0.006, 0.006 ), tint: t,
		} );
		const walk = ( u0 ) => head ? 0 : - ( 1 + ( X - u0 ) ); // path centre along this piece
		const zj = zc + rand.range( - 0.004, 0.004 );
		if ( ! newer && rand.chance( 0.05 ) ) {

			// split board: two pieces with a ragged gap
			const xs = rand.range( xa + 0.4, xb - 0.4 );
			B.box( 'wood', ( xa + xs - 0.01 ) / 2, DK - plankT / 2 - yOff, zj, xs - xa - 0.01, plankT, wdt, { ...opts(), data: WOOD( rand.next(), wth, walk( xa ), 7 ) } );
			B.box( 'wood', ( xs + 0.012 + xb ) / 2, DK - plankT / 2 - yOff - 0.004, zj + rand.range( - 0.004, 0.004 ), xb - xs - 0.012, plankT, wdt * rand.range( 0.92, 1 ), { ...opts(), data: WOOD( rand.next(), wth, walk( xs + 0.012 ), 7 ) } );
			return;

		}

		B.box( 'wood', ( xa + xb ) / 2, DK - plankT / 2 - yOff, zj, xb - xa, plankT, wdt, { ...opts(), data: WOOD( rand.next(), wth, walk( xa ), 7 ) } );

	}

	// deck planks (walkway)
	const pitch = 0.215;
	const nPl = Math.floor( ( zH - z0 ) / pitch );
	for ( let i = 0; i < nPl; i ++ ) {

		const zc = z0 + ( i + 0.5 ) * ( zH - z0 ) / nPl;
		plank( X, zc, PIER.width, false );

	}

	// walkway deck collider
	addBox( X, DK - 0.04, ( z0 + zH ) / 2, halfW, 0.04, ( zH - z0 ) / 2, { walkable: true, solid: true, tag: 'pierDeck' } );

	// ------------------------------------------------------------------ railings (walkway)
	const railTop = DK + 0.95;
	for ( let bi = 0; bi < lastBent; bi ++ ) {

		for ( const side of [ - 1, 1 ] ) {

			if ( ! railBay( side, bi ) ) continue;
			const za = bentZ[ bi ], zb = bentZ[ bi + 1 ];
			const px = X + side * PIER.pileOff;
			const len = zb - za;
			const fresh = rand.chance( 0.12 );
			B.box( 'wood', px + rand.range( - 0.01, 0.01 ), railTop + 0.022 + rand.range( - 0.012, 0.01 ), ( za + zb ) / 2, 0.2, 0.045, len + 0.16, {
				grain: 2, rx: rand.range( - 0.006, 0.006 ), rz: rand.range( - 0.01, 0.01 ), tint: fresh ? freshTone() : tone(), data: fresh ? WOOD( rand.next(), 0.3, 0, 0 ) : pierWood( 0.7, 1 ),
			} );
			const mx = px - side * ( PIER.pileR + 0.03 );
			// the mid rail: a few have come off one end and hang, one or two are gone
			const mr = rand.next();
			if ( mr > 0.04 ) {

				const drop = mr < 0.1 ? rand.range( 0.15, 0.35 ) : 0;
				const dropA = rand.chance( 0.5 );
				B.beam( 'wood', [ mx, DK + 0.48 + rand.range( - 0.012, 0.012 ) - ( dropA ? drop : 0 ), za - 0.05 ], [ mx, DK + 0.48 + rand.range( - 0.012, 0.012 ) - ( dropA ? 0 : drop ), zb + 0.05 ], 0.05, 0.14, { tint: tone(), data: pierWood( 0.7, 1 ) } );

			}
			addBox( px, DK + 0.55, ( za + zb ) / 2, 0.09, 0.55, len / 2, { tag: 'pierRail' } );

		}

	}

	// lamp posts along the walkway (inside the rail, arm over the deck)
	for ( const [ bi, side ] of [ [ 3, - 1 ], [ 8, 1 ], [ 13, - 1 ], [ 18, 1 ], [ 23, - 1 ], [ 28, 1 ] ] ) {

		if ( bi >= lastBent ) continue;
		const lx = X + side * ( halfW - 0.1 ), lz = bentZ[ bi ] + 0.32;
		const w = hang ? hungLampPost( B, hang, info, lx, DK, lz, - side * Math.PI / 2, 3.1, rand.next() ) : lampPost( B, lx, DK, lz, - side * Math.PI / 2, 3.1, rand.next() );
		lights.push( { position: w, color: new Color( 1.0, 0.72, 0.42 ), intensity: 5, kind: 'lantern' } );
		info.lamps.push( w );
		colliders.addCylinder( lx, lz, 0.1, DK, DK + 3.2, { tag: 'lampPost' } );

	}

	// ------------------------------------------------------------------ entrance arch with a painted fish sign
	{

		const az = bentZ[ 0 ];
		const by = DK + ARCH_H;
		const wd = () => WOOD( rand.next(), 0.7, 0.6, 0 );
		const white = lin( 0xefe9dc ), teal = lin( 0x2f8f8c ), coral = lin( 0xe07a5f );
		B.box( 'wood', X, by, az, PIER.width + 1.1, 0.24, 0.16, { grain: 0, tint: white, data: wd() } );
		B.box( 'wood', X, by + 0.2, az, PIER.width + 1.35, 0.06, 0.22, { grain: 0, tint: white, data: wd() } );
		for ( const s of [ - 1, 1 ] ) {

			B.beam( 'wood', [ X + s * ( PIER.pileOff - 0.12 ), by - 0.62, az ], [ X + s * ( PIER.pileOff - 0.62 ), by - 0.1, az ], 0.1, 0.09, { tint: white, data: wd() } );

		}

		// sign board hung under the beam on two short chains (built into its own builder when given:
		// the village swings it in the wind about the tops of the chains, info.signPivot)
		const S = signB || B;
		const sy = by - 0.52;
		info.signPivot = new Vector3( X, by - 0.12, az + 0.02 );
		S.box( 'wood', X, sy, az + 0.02, 1.9, 0.52, 0.05, { grain: 0, tint: teal, data: WOOD( rand.next(), 0.6, 0.72, 6 ) } );
		S.box( 'wood', X, sy, az + 0.02, 1.98, 0.6, 0.03, { grain: 0, tint: white, data: wd() } );
		for ( const s of [ - 0.7, 0.7 ] ) S.rod( 'hard', [ X + s, sy + 0.26, az + 0.02 ], [ X + s, by - 0.12, az + 0.02 ], 0.008, 0.008, { segs: 4, tint: C.iron, data: HARD( rand.next(), 0.6, 0.6, 0.5 ) } );
		// fish silhouette (both faces)
		for ( const f of [ 1, - 1 ] ) {

			const zf = az + 0.02 + f * 0.032;
			const body = [];
			for ( let i = 0; i < 14; i ++ ) {

				const a = i / 14 * Math.PI * 2;
				body.push( new Vector3( X - 0.1 + Math.cos( a ) * 0.5, sy + Math.sin( a ) * 0.17, zf ) );

			}

			S.slab( 'wood', body, 0.01, { up: new Vector3( 0, 0, f ), uDir: new Vector3( 1, 0, 0 ), tint: coral, data: WOOD( rand.next(), 0.6, 0.75, 0 ) } );
			S.slab( 'wood', [ new Vector3( X + 0.36, sy, zf ), new Vector3( X + 0.72, sy + 0.2, zf ), new Vector3( X + 0.66, sy, zf ), new Vector3( X + 0.72, sy - 0.2, zf ) ].slice( 0, 3 ), 0.01, { up: new Vector3( 0, 0, f ), tint: coral, data: WOOD( rand.next(), 0.6, 0.75, 0 ) } );
			S.slab( 'wood', [ new Vector3( X + 0.36, sy, zf ), new Vector3( X + 0.66, sy, zf ), new Vector3( X + 0.72, sy - 0.2, zf ) ], 0.01, { up: new Vector3( 0, 0, f ), tint: coral, data: WOOD( rand.next(), 0.6, 0.75, 0 ) } );
			S.cyl( 'hard', X - 0.42, sy + 0.04, zf + f * 0.006, 0.035, 0.035, 0.008, { segs: 8, rx: f * Math.PI / 2, tint: C.black, data: HARD( rand.next(), 0, 0, 0.4 ) } );

		}

		// lanterns hanging from the beam next to each post
		for ( const s of [ - 1, 1 ] ) {

			// outside the posts on the landward side, under the beam's overhang
			const hx = X + s * ( PIER.pileOff + 0.3 ), hz = az - 0.07;
			let pos;
			if ( hang ) {

				B.torus( 'hard', hx, by - 0.125, hz, 0.02, 0.005, { rx: Math.PI / 2, radial: 3, tubular: 6, tint: C.iron, data: HARD( 0.5, 0.35, 0.5, 0.45 ) } );
				pos = hangLantern( hang, info, new Vector3( hx, by - 0.12, hz ), rand.next(), 0.9, 0.1 );

			} else {

				const c = lantern( B, hx, by - 0.12, hz, rand.next(), 0.9 );
				pos = new Vector3( c[ 0 ], c[ 1 ], c[ 2 ] );

			}

			lights.push( { position: pos, color: new Color( 1.0, 0.72, 0.42 ), intensity: 4, kind: 'lantern' } );

		}

		addBox( X, by, az, PIER.width / 2 + 0.6, 0.15, 0.1, { tag: 'pierArch' } );

	}

	// ------------------------------------------------------------------ landward steps
	{

		const gs = ground( X, z0 - 0.7 );
		const rise = DK - gs;
		const nR = Math.max( 2, Math.ceil( rise / 0.22 ) );
		const rh = rise / nR;
		const tread = 0.32;
		const run = ( nR - 1 ) * tread;
		for ( let k = 1; k < nR; k ++ ) {

			const top = DK - k * rh;
			const zc = z0 - ( k - 0.5 ) * tread;
			for ( const dz of [ - 0.078, 0.078 ] ) {

				B.box( 'wood', X, top - 0.024, zc + dz, PIER.width - 0.1, 0.048, 0.15, { grain: 0, tint: tone(), data: pierWood( 0.5, 0.9 ) } );

			}

			const gb = ground( X, zc );
			addBox( X, ( top + gb - 0.4 ) / 2, zc, halfW, ( top - gb + 0.4 ) / 2, tread / 2 + 0.005, { walkable: true, solid: true, tag: 'pierStep' } );

		}

		for ( const side of [ - 1, 1 ] ) {

			const sx = X + side * ( halfW - 0.04 );
			const gEnd = ground( sx, z0 - run - 0.2 );
			B.beam( 'wood', [ sx, DK - 0.12, z0 + 0.15 ], [ sx, gEnd - 0.05, z0 - run - 0.25 ], 0.07, 0.26, { tint: tone(), data: pierWood( 0.7, 0.95 ) } );

		}

		info.stepFoot = new Vector3( X, ground( X, z0 - run - 0.3 ), z0 - run - 0.3 );

	}

	// ------------------------------------------------------------------ T-head
	const rowsZ = [ zH + 0.25, ( zH + z1 ) / 2, z1 - 0.25 ];
	const colsX = [];
	for ( let k = 0; k < 5; k ++ ) colsX.push( hx0 + 0.3 + k * ( hx1 - hx0 - 0.6 ) / 4 );

	for ( let r = 0; r < 3; r ++ ) {

		const rz = rowsZ[ r ];
		const xs = [];
		for ( let k = 0; k < 5; k ++ ) {

			const px = colsX[ k ];
			if ( r === 0 && k === 2 ) continue; // walkway piles stand here
			const perimeter = r === 0 || r === 2 || k === 0;
			const post = perimeter && ! ( k === 4 && r === 1 );
			pile( px, rz, post ? DK + 0.95 : capTop, { flatTop: post } );
			xs.push( px );

		}

		if ( r === 0 ) xs.push( X - PIER.pileOff, X + PIER.pileOff );
		capRow( rz, hx0 - 0.08, hx1 + 0.08, xs );
		for ( let k = 0; k < 4; k ++ ) {

			if ( r === 0 && ( k === 1 || k === 2 ) ) continue;
			const gMin = Math.min( ground( colsX[ k ], rz ), ground( colsX[ k + 1 ], rz ) );
			xBrace( colsX[ k ], colsX[ k + 1 ], rz, gMin );

		}

	}

	// head stringers along z
	for ( let sx = hx0 + 0.25; sx < hx1 - 0.1; sx += 0.78 ) {

		B.box( 'wood', sx, stringerTop - PIER.stringerH / 2, ( zH + z1 ) / 2, 0.1, PIER.stringerH, z1 - zH - 0.05, { grain: 2, tint: tone(), data: pierWood( 0.7, 0.95 ) } );

	}

	// head planks (along x, staggered butt joints)
	const nRows = Math.floor( ( z1 - zH ) / pitch );
	for ( let r = 0; r < nRows; r ++ ) {

		const zc = zH + ( r + 0.5 ) * ( z1 - zH ) / nRows;
		const joints = [ hx0 ];
		let jx = hx0 + 2.1 + ( r % 3 ) * 1.45;
		while ( jx < hx1 - 1.2 ) {

			joints.push( jx );
			jx += 4.35;

		}

		joints.push( hx1 );
		for ( let j = 0; j < joints.length - 1; j ++ ) {

			const xa = joints[ j ] + 0.004, xb = joints[ j + 1 ] - 0.004;
			plank( ( xa + xb ) / 2, zc, xb - xa - 0.1, true );

		}

	}

	addBox( X, DK - 0.04, ( zH + z1 ) / 2, ( hx1 - hx0 ) / 2, 0.04, ( z1 - zH ) / 2, { walkable: true, solid: true, tag: 'pierDeck' } );

	// head railings: south edge, west edge, north edge (both sides of the walkway)
	const railRun = ( ax, az, bx, bz ) => {

		const len = Math.hypot( bx - ax, bz - az );
		const alongX = Math.abs( bx - ax ) > Math.abs( bz - az );
		const cx = ( ax + bx ) / 2, cz = ( az + bz ) / 2;
		B.box( 'wood', cx, railTop + 0.022, cz, alongX ? len + 0.16 : 0.2, 0.045, alongX ? 0.2 : len + 0.16, { grain: alongX ? 0 : 2, tint: tone(), data: pierWood( 0.65, 0.9 ) } );
		B.box( 'wood', cx, DK + 0.48, cz, alongX ? len : 0.05, 0.14, alongX ? 0.05 : len, { grain: alongX ? 0 : 2, tint: tone(), data: pierWood( 0.65, 0.95 ) } );
		addBox( cx, DK + 0.55, cz, alongX ? len / 2 : 0.09, 0.55, alongX ? 0.09 : len / 2, { tag: 'pierRail' } );

	};

	for ( let k = 0; k < 4; k ++ ) railRun( colsX[ k ], rowsZ[ 2 ], colsX[ k + 1 ], rowsZ[ 2 ] );
	railRun( colsX[ 0 ], rowsZ[ 0 ], colsX[ 0 ], rowsZ[ 1 ] );
	railRun( colsX[ 0 ], rowsZ[ 1 ], colsX[ 0 ], rowsZ[ 2 ] );
	railRun( colsX[ 0 ], rowsZ[ 0 ], colsX[ 1 ], rowsZ[ 0 ] );
	railRun( colsX[ 1 ], rowsZ[ 0 ], X - PIER.pileOff, rowsZ[ 0 ] );
	railRun( X + PIER.pileOff, rowsZ[ 0 ], colsX[ 3 ], rowsZ[ 0 ] );
	railRun( colsX[ 3 ], rowsZ[ 0 ], colsX[ 4 ], rowsZ[ 0 ] );

	// ------------------------------------------------------------------ T-head outfitting
	const edgeX = hx1; // boat side (east)
	// mooring bollards + cleat, with rope loops
	for ( const bz of [ 34.3, 38.7 ] ) {

		const bx = edgeX - 0.45;
		bollard( B, bx, DK, bz, rand.next() );
		ropeLoop( B, bx, DK + 0.36, bz, 0.155, null, rand.next() );
		ropeCoil( B, bx - 0.75, DK, bz + ( bz < 36 ? 0.35 : - 0.35 ), 0.08, 0.3, 4, rand.next() );
		colliders.addCylinder( bx, bz, 0.22, DK, DK + 0.5, { tag: 'bollard' } );
		info.bollards.push( new Vector3( bx, DK + 0.45, bz ) );

	}

	cleat( B, edgeX - 0.22, DK, 36.5, Math.PI / 2, rand.next() );
	info.bollards.push( new Vector3( edgeX - 0.22, DK + 0.1, 36.5 ) );

	// tyre fenders on the berthing face
	for ( const fz of [ 33.75, 36.0, 37.35, 39.25 ] ) tireFender( B, edgeX, DK - 0.04, fz, 0, rand.range( 0.65, 0.85 ), rand.next() );

	// ladder down into the water on the boat side
	{

		const lz = 35.1, lx = edgeX + 0.07;
		const yb = - 2.2, yt = DK + 0.85;
		const t = C.galv, d = HARD( rand.next(), 0.45, 0.85, 0.4 );
		for ( const s of [ - 1, 1 ] ) {

			const rzs = lz + s * 0.24;
			B.rod( 'hard', [ lx, yb, rzs ], [ lx, yt - 0.15, rzs ], 0.024, 0.024, { segs: 7, tint: t, data: d } );
			const arc = [];
			for ( let i = 0; i <= 6; i ++ ) {

				const a = i / 6 * Math.PI;
				arc.push( new Vector3( lx - 0.25 + Math.cos( a ) * 0.25, yt - 0.15 + Math.sin( a ) * 0.15, rzs ) );

			}

			B.tube( 'hard', arc, 0.024, { radial: 6, tint: t, data: d } );
			B.rod( 'hard', [ lx - 0.5, yt - 0.15, rzs ], [ lx - 0.5, DK, rzs ], 0.024, 0.024, { segs: 7, tint: t, data: d } );
			B.box( 'hard', lx - 0.5, DK + 0.004, rzs, 0.12, 0.008, 0.12, { tint: t, data: d } );
			B.box( 'hard', lx - 0.1, capBot + 0.12, rzs, 0.2, 0.05, 0.03, { tint: t, data: d } );

		}

		const rungTops = [];
		for ( let y = yb + 0.25; y < DK - 0.1; y += 0.3 ) {

			B.rod( 'hard', [ lx, y, lz - 0.24 ], [ lx, y, lz + 0.24 ], 0.018, 0.018, { segs: 6, tint: t, data: d } );
			rungTops.push( y );

		}

		// walkable "stair" boxes so a swimmer can climb out (and walk down from the deck)
		for ( const y of rungTops ) {

			if ( y < - 0.4 ) continue;
			colliders.addBox( _v.set( lx + 0.25, y - 0.15, lz ), _h.set( 0.27, 0.15, 0.3 ), 0, { walkable: true, solid: false, tag: 'ladder' } );

		}

		info.ladder = new Vector3( lx, DK, lz );

	}

	// south edge: bench facing the sea, life ring, fish cleaning table, fishing rods
	bench( B, 52.4, DK, z1 - 0.95, 0, 1.7, rand.next() );
	addBox( 52.4, DK + 0.45, z1 - 1.0, 0.85, 0.45, 0.3, { tag: 'bench' } );
	lifeRing( B, 55.8, DK + 0.58, rowsZ[ 2 ] + 0.12, 0, rand.next() );
	cleaningTable( B, 58.3, DK, z1 - 0.9, 0, rand.next() );
	addBox( 58.3, DK + 0.45, z1 - 0.9, 0.7, 0.45, 0.35, { tag: 'table' } );
	bucket( B, 59.3, DK, z1 - 0.75, C.blue, rand.next() );
	for ( const [ rx, lean ] of [ [ 56.55, 0.35 ], [ 56.9, 0.28 ] ] ) {

		const base = [ rx, DK + 0.01, rowsZ[ 2 ] - 0.25 ];
		const tip = [ rx + 0.25, DK + 2.6, rowsZ[ 2 ] + 2.6 * Math.tan( lean ) ];
		B.rod( 'hard', base, tip, 0.016, 0.005, { segs: 5, tint: lin( 0x2a2a2a ), data: HARD( rand.next(), 0, 0.3, 0.35 ) } );
		B.cyl( 'hard', rx + 0.02, DK + 0.35, rowsZ[ 2 ] - 0.18, 0.04, 0.04, 0.05, { segs: 8, rz: Math.PI / 2, capBot: true, tint: C.galv, data: HARD( rand.next(), 0, 0.8, 0.35 ) } );

	}

	// deck clutter (instanced crates / traps / barrels)
	const crate = ( x, y, z, ry ) => inst.add( 'crate', x, y, z, ry, [ rand.range( 0.85, 1.1 ), rand.range( 0.85, 1.05 ), rand.range( 0.82, 1.0 ) ] );
	crate( 49.25, DK, 34.35, 0.05 );
	crate( 49.25, DK, 34.8, - 0.04 );
	crate( 49.95, DK, 34.55, 1.57 );
	crate( 49.3, DK + 0.4, 34.55, 0.2 );
	addBox( 49.55, DK + 0.4, 34.6, 0.55, 0.4, 0.45, { tag: 'crates' } );

	const trap = ( x, y, z, ry ) => inst.add( 'trap', x, y, z, ry, [ rand.range( 0.85, 1.05 ), rand.range( 0.85, 1.0 ), rand.range( 0.8, 0.95 ) ] );
	trap( 50.1, DK, 38.55, 0.02 );
	trap( 50.1, DK, 39.1, - 0.03 );
	trap( 51.05, DK, 38.6, 0.05 );
	trap( 50.3, DK + 0.31, 38.8, 0.12 );
	trap( 50.5, DK + 0.31, 38.75, 1.2 );
	addBox( 50.55, DK + 0.35, 38.8, 0.75, 0.35, 0.5, { tag: 'traps' } );

	inst.add( 'barrel', 48.75, DK, 36.1, 0.3, [ 0.9, 0.85, 0.8 ] );
	inst.add( 'barrel', 49.4, DK, 36.75, 1.1, [ 1.05, 1.0, 0.95 ] );
	colliders.addCylinder( 48.75, 36.1, 0.32, DK, DK + 0.9, { tag: 'barrel' } );
	colliders.addCylinder( 49.4, 36.75, 0.32, DK, DK + 0.9, { tag: 'barrel' } );

	// floats hanging on the west rail
	buoyString( B, [ hx0 + 0.12, railTop + 0.02, 34.0 ], [ hx0 + 0.12, railTop + 0.02, 35.9 ], 4, rand, 0.22 );
	buoyString( B, [ hx0 + 0.12, railTop + 0.02, 37.1 ], [ hx0 + 0.12, railTop + 0.02, 38.9 ], 3, rand, 0.18 );

	// head lamps
	for ( const [ lx, lz, yaw ] of [ [ hx0 + 0.55, z1 - 0.55, 3 * Math.PI / 4 ], [ hx1 - 0.6, z1 - 0.55, - 3 * Math.PI / 4 ], [ hx0 + 0.55, zH + 0.6, Math.PI / 4 ] ] ) {

		const w = hang ? hungLampPost( B, hang, info, lx, DK, lz, yaw, 3.1, rand.next() ) : lampPost( B, lx, DK, lz, yaw, 3.1, rand.next() );
		lights.push( { position: w, color: new Color( 1.0, 0.72, 0.42 ), intensity: 5, kind: 'lantern' } );
		info.lamps.push( w );
		colliders.addCylinder( lx, lz, 0.1, DK, DK + 3.2, { tag: 'lampPost' } );

	}

	// a few things along the walkway: gear left where it was last used
	bucket( B, X + 0.9, DK, - 21.3, C.white, rand.next() );
	bucket( B, X - 0.95, DK, 12.6, C.orange, rand.next() );
	ropeCoil( B, X + 0.85, DK, - 33.0, 0.07, 0.24, 3, rand.next(), C.ropeDark );
	ropeCoil( B, X - 0.85, DK, 21.5, 0.06, 0.22, 4, rand.next() );
	for ( const [ cz, side ] of [ [ - 47.3, 1 ], [ - 15.4, - 1 ], [ 27.8, 1 ] ] ) {

		// a cleat on the deck edge with a line still made fast, trailing over the side
		const cx = X + side * ( halfW - 0.18 );
		cleat( B, cx, DK, cz, 0, rand.next() );
		ropeLoop( B, cx, DK + 0.06, cz, 0.08, [ X + side * ( halfW + 0.35 ), DK - 1.4, cz + rand.range( - 0.4, 0.4 ) ], rand.next() );

	}

	inst.add( 'crate', X - 0.95, DK, - 3.1, 1.4, [ 0.9, 0.85, 0.8 ] );
	inst.add( 'crate', X - 0.92, DK + 0.4, - 3.05, 1.2, [ 1.0, 0.95, 0.9 ] );
	colliders.addBox( _v.set( X - 0.95, DK + 0.4, - 3.1 ), _h.set( 0.3, 0.4, 0.35 ), 0, { tag: 'crate' } );
	inst.add( 'trap', X + 0.8, DK, 30.4, 0.05, [ 0.9, 0.9, 0.85 ] );
	colliders.addBox( _v.set( X + 0.8, DK + 0.25, 30.4 ), _h.set( 0.48, 0.3, 0.28 ), 0.05, { tag: 'trap' } );
	ropeCoil( B, X - 0.8, DK, 4.5, 0.07, 0.26, 4, rand.next(), C.ropeBlue );
	inst.add( 'crate', X + 0.95, DK, - 40.2, 0.1, [ 1, 0.95, 0.9 ] );
	colliders.addBox( _v.set( X + 0.95, DK + 0.2, - 40.2 ), _h.set( 0.33, 0.2, 0.24 ), 0.1, { tag: 'crate' } );

	return info;

}

// Lamp post (as Props.lampPost) whose lantern hangs from the end of the arm on a short chain, built
// into its own builder (hang()) so the village can swing it in the wind. Returns the lantern centre
// (a live vector: the village moves it with the swing, the light follows).
function hungLampPost( B, hang, info, x, y, z, armYaw, h, seed ) {

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
	// eye bolt under the arm end
	B.torus( 'hard', 0, ay - 0.03, 0.6, 0.014, 0.004, { ry: Math.PI / 2, radial: 3, tubular: 6, tint: t, data: d } );
	const hook = B.toWorld( 0, ay - 0.04, 0.6 );
	B.pop();
	return hangLantern( hang, info, hook, seed, 1, 0.16 );

}

// chain of `chain` metres from `hook` (world) and a lantern under it, into a new builder
function hangLantern( hang, info, hook, seed, scale, chain ) {

	const LB = hang();
	const t = C.iron, d = HARD( seed, 0.3, 0.55, 0.45 );
	const pitch = 0.03;
	const n = Math.max( 2, Math.round( chain / pitch ) );
	for ( let i = 0; i < n; i ++ ) {

		// interlocking links, alternately turned 90 degrees
		LB.torus( 'hard', hook.x, hook.y - 0.012 - i * pitch, hook.z, 0.012, 0.0032, { ry: i % 2 ? Math.PI / 2 : 0, radial: 3, tubular: 6, tint: t, data: d } );

	}

	const c = lantern( LB, hook.x, hook.y - n * pitch, hook.z, seed, scale );
	const center = new Vector3( c[ 0 ], c[ 1 ], c[ 2 ] );
	info.hung.push( { B: LB, pivot: hook.clone(), rest: center.clone(), live: center } );
	return center;

}
