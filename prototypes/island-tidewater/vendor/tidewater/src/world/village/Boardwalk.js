import { CatmullRomCurve3, Color, Vector3 } from '../../engine/index.js';
import { WOOD, pathLight } from '../Props.js';

// Raised timber boardwalk following a smooth curve over the terrain.
// pts: [[x, z], ...] world control points. Returns the sampled centerline (for layout checks).

const _v = new Vector3();
const _h = new Vector3();

export function buildBoardwalk( ctx, pts, opts = {} ) {

	const { B, terrain, colliders, rand, lights, checks } = ctx;
	const width = opts.width ?? 1.8;
	const lift = opts.lift ?? 0.26;
	const curve = new CatmullRomCurve3( pts.map( ( p ) => new Vector3( p[ 0 ], 0, p[ 1 ] ) ), false, 'centripetal' );
	const L = curve.getLength();
	const pitch = 0.2;
	const n = Math.floor( L / pitch );

	const S = [];
	for ( let i = 0; i <= n; i ++ ) {

		const t = i / n;
		const p = curve.getPointAt( t );
		const tan = curve.getTangentAt( t );
		tan.y = 0;
		tan.normalize();
		const nx = - tan.z, nz = tan.x;
		let g = - Infinity, gLow = Infinity;
		for ( const o of [ - width / 2 - 0.1, - width / 4, 0, width / 4, width / 2 + 0.1 ] ) {

			const h = terrain.heightAt( p.x + nx * o, p.z + nz * o );
			g = Math.max( g, h );
			gLow = Math.min( gLow, h );

		}

		S.push( { p, tan, nx, nz, g, gLow, yaw: Math.atan2( tan.x, tan.z ) } );

	}

	// deck profile: local max of the ground, smoothed, never closer than 12 cm to the ground
	const raw = S.map( ( s, i ) => {

		let m = - Infinity;
		for ( let k = Math.max( 0, i - 4 ); k <= Math.min( n, i + 4 ); k ++ ) m = Math.max( m, S[ k ].g );
		return m + lift;

	} );
	let deck = raw.slice();
	for ( let pass = 0; pass < 3; pass ++ ) {

		const nd = deck.slice();
		for ( let i = 0; i <= n; i ++ ) {

			let sum = 0, c = 0;
			for ( let k = Math.max( 0, i - 6 ); k <= Math.min( n, i + 6 ); k ++ ) {

				sum += deck[ k ];
				c ++;

			}

			nd[ i ] = Math.max( sum / c, S[ i ].g + 0.12 );

		}

		deck = nd;

	}

	if ( opts.startY !== undefined ) {

		for ( let i = 0; i <= Math.min( n, 12 ); i ++ ) {

			const k = i / 12;
			deck[ i ] = Math.max( S[ i ].g + 0.1, opts.startY * ( 1 - k ) + deck[ i ] * k );

		}

	}

	// planks
	for ( let i = 0; i <= n; i ++ ) {

		const s = S[ i ];
		const a = deck[ Math.max( 0, i - 1 ) ], b = deck[ Math.min( n, i + 1 ) ];
		const slope = ( b - a ) / ( pitch * ( Math.min( n, i + 1 ) - Math.max( 0, i - 1 ) ) );
		const newer = rand.chance( 0.05 );
		B.box( 'wood', s.p.x + rand.range( - 0.02, 0.02 ) * s.nx, deck[ i ] - 0.021 - rand.range( 0, 0.005 ), s.p.z + rand.range( - 0.02, 0.02 ) * s.nz, width + rand.range( - 0.04, 0.03 ), 0.042, 0.182, {
			grain: 0, skip: 8, ry: s.yaw + rand.range( - 0.01, 0.01 ), rx: - Math.atan( slope ),
			tint: newer ? [ 1.06, 1.0, 0.93 ] : ( ( k, w ) => [ k * ( 1 + w ), k, k * ( 1 - w ) ] )( rand.range( 0.86, 1.08 ), rand.range( - 0.01, 0.04 ) ),
			data: WOOD( rand.next(), newer ? 0.35 : rand.range( 0.6, 1.0 ), 0, 7 ),
		} );

	}

	// stringers + posts
	const seg = 6; // samples per stringer piece (1.2 m)
	for ( let i = 0; i < n; i += seg ) {

		const j = Math.min( n, i + seg );
		for ( const o of [ - width / 2 + 0.18, width / 2 - 0.18 ] ) {

			const a = S[ i ], b = S[ j ];
			B.beam( 'wood', [ a.p.x + a.nx * o, deck[ i ] - 0.042 - 0.07, a.p.z + a.nz * o ], [ b.p.x + b.nx * o, deck[ j ] - 0.042 - 0.07, b.p.z + b.nz * o ], 0.08, 0.14, { extend: 0.06, data: WOOD( rand.next(), 0.85 ) } );

		}

	}

	for ( let i = 0; i <= n; i += 9 ) {

		const s = S[ i ];
		for ( const o of [ - width / 2 + 0.18, width / 2 - 0.18 ] ) {

			const px = s.p.x + s.nx * o, pz = s.p.z + s.nz * o;
			const g = terrain.heightAt( px, pz );
			const top = deck[ i ] - 0.18;
			if ( top - g > - 0.05 ) {

				B.box( 'wood', px, ( top + g - 0.3 ) / 2, pz, 0.11, top - g + 0.3, 0.11, { grain: 1, ry: s.yaw, data: WOOD( rand.next(), 0.9 ) } );
				checks.push( { x: px, y: g - 0.3, z: pz } );

			}

		}

	}

	// edge kick boards for a finished look
	for ( let i = 0; i < n; i += seg ) {

		const j = Math.min( n, i + seg );
		for ( const sgn of [ - 1, 1 ] ) {

			const o = sgn * ( width / 2 + 0.01 );
			const a = S[ i ], b = S[ j ];
			B.beam( 'wood', [ a.p.x + a.nx * o, deck[ i ] - 0.1, a.p.z + a.nz * o ], [ b.p.x + b.nx * o, deck[ j ] - 0.1, b.p.z + b.nz * o ], 0.03, 0.12, { extend: 0.03, data: WOOD( rand.next(), 0.8 ) } );

		}

	}

	// walkable colliders (1 m long pieces)
	const cs = 5;
	for ( let i = 0; i < n; i += cs ) {

		const j = Math.min( n, i + cs );
		const a = S[ i ], b = S[ j ];
		let top = - Infinity, gl = Infinity;
		for ( let k = i; k <= j; k ++ ) {

			top = Math.max( top, deck[ k ] );
			gl = Math.min( gl, S[ k ].gLow );

		}

		const cx = ( a.p.x + b.p.x ) / 2, cz = ( a.p.z + b.p.z ) / 2;
		const len = Math.hypot( b.p.x - a.p.x, b.p.z - a.p.z );
		const bot = gl - 0.3;
		colliders.addBox( _v.set( cx, ( top + bot ) / 2, cz ), _h.set( width / 2, ( top - bot ) / 2, len / 2 + 0.02 ), Math.atan2( b.p.x - a.p.x, b.p.z - a.p.z ), { walkable: true, solid: true, tag: 'boardwalk' } );

	}

	// path lights
	const every = opts.lightEvery ?? 60;
	let side = 1;
	for ( let i = Math.floor( every * 0.4 ); i < n - 10; i += every ) {

		const s = S[ i ];
		const o = side * ( width / 2 + 0.2 );
		const px = s.p.x + s.nx * o, pz = s.p.z + s.nz * o;
		const g = terrain.heightAt( px, pz );
		const w = pathLight( B, px, g - 0.25, pz, rand.next() );
		lights.push( { position: w, color: new Color( 1.0, 0.7, 0.4 ), intensity: 2.5, kind: 'pathLight' } );
		colliders.addCylinder( px, pz, 0.1, g - 0.25, g + 0.95, { tag: 'pathLight' } );
		checks.push( { x: px, y: g - 0.25, z: pz } );
		side = - side;

	}

	return { samples: S, deck, length: L, width };

}
