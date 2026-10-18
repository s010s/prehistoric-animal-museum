import { Matrix4, Vector3 } from '../../engine/index.js';
import { lathe, fanCap, gridSurface, orientTowards, prepare, mergePrepared, cylinder } from './GeoKit.js';
import { PALETTE } from './HullBuilder.js';

const V = ( x, y, z ) => new Vector3( x, y, z );

// Propeller hub centre (boat frame) and rudder stock pivot.
export const PROP = { position: V( 0, - 0.53, - 3.3 ), radius: 0.21, blades: 4, pitch: 0.42 };
export const RUDDER = { pivot: V( 0, - 0.52, - 3.58 ), top: - 0.33, bottom: - 0.72, lead: 0.08, trail: - 0.27, maxAngle: 0.61 };

const BRONZE = { color: 0xc8905a, rough: 0.3, metal: 1 };

// Four-blade right-handed propeller. Local frame: shaft axis +Z (forward); a positive
// rotation about +Z (clockwise seen from astern) drives the boat ahead.
export function propellerGeometry() {

	const { radius: R, blades, pitch: P } = PROP;
	const list = [];

	const hub = lathe( [ [ 0, - 0.09 ], [ 0.015, - 0.085 ], [ 0.03, - 0.068 ], [ 0.043, - 0.04 ], [ 0.048, 0.0 ], [ 0.047, 0.04 ], [ 0.042, 0.06 ], [ 0, 0.06 ] ], 18 );
	hub.applyMatrix4( new Matrix4().makeRotationX( Math.PI / 2 ) );
	list.push( prepare( hub, BRONZE ) );

	const rh = 0.042;
	const NR = 9, NC = 9;
	for ( let b = 0; b < blades; b ++ ) {

		const theta0 = b * Math.PI * 2 / blades;
		const mid = [];
		for ( let i = 0; i < NR; i ++ ) {

			const rho = i / ( NR - 1 );
			const r = rh + ( R - rh ) * rho;
			const chord = 0.15 * Math.sqrt( Math.max( 0, 1 - Math.pow( rho, 2.4 ) ) ) * ( 0.62 + 0.38 * Math.sin( Math.PI * Math.min( 1, rho * 1.4 ) ) ) + 0.002;
			const phi = Math.atan2( P, 2 * Math.PI * r );
			const skew = 0.32 * rho * rho;
			const row = [];
			for ( let k = 0; k < NC; k ++ ) {

				const c = - 1 + 2 * k / ( NC - 1 );
				const s = c * chord * 0.5;
				const th = theta0 - skew + s * Math.cos( phi ) / r;
				row.push( V( Math.cos( th ) * r, Math.sin( th ) * r, s * Math.sin( phi ) ) );

			}

			mid.push( row );

		}

		// thickness along the local surface normal, vanishing at the edges and tip
		const face = [], back = [];
		for ( let i = 0; i < NR; i ++ ) {

			const rho = i / ( NR - 1 );
			const fr = [], br = [];
			for ( let k = 0; k < NC; k ++ ) {

				const c = - 1 + 2 * k / ( NC - 1 );
				const du = mid[ Math.min( NR - 1, i + 1 ) ][ k ].clone().sub( mid[ Math.max( 0, i - 1 ) ][ k ] );
				const dv = mid[ i ][ Math.min( NC - 1, k + 1 ) ].clone().sub( mid[ i ][ Math.max( 0, k - 1 ) ] );
				const n = du.cross( dv ).normalize();
				const t = 0.013 * ( 1 - 0.8 * rho ) * Math.sqrt( Math.max( 0, 1 - c * c ) ) * ( 1 - Math.pow( rho, 8 ) );
				fr.push( mid[ i ][ k ].clone().addScaledVector( n, t * 0.5 ) );
				br.push( mid[ i ][ k ].clone().addScaledVector( n, - t * 0.5 ) );

			}

			face.push( fr ); back.push( br );

		}

		const gf = gridSurface( face );
		const gb = gridSurface( back, { flip: true } );
		// make sure each side faces away from the other
		const probe = face[ 4 ][ 4 ].clone().sub( back[ 4 ][ 4 ] );
		orientTowards( gf, probe );
		orientTowards( gb, probe.clone().negate() );
		gf.computeVertexNormals();
		gb.computeVertexNormals();
		list.push( prepare( gf, BRONZE ), prepare( gb, BRONZE ) );

	}

	return mergePrepared( list );

}

// Balanced spade rudder on a stock; local origin on the stock axis at mid blade.
export function rudderGeometry() {

	const { pivot, top, bottom, lead, trail } = RUDDER;
	const yTop = top - pivot.y, yBot = bottom - pivot.y;
	const foil = ( chordScale, y ) => {

		const c = ( lead - trail ) * chordScale;
		const z0 = lead * chordScale;
		const pts = [];
		const N = 12;
		for ( let i = 0; i <= N; i ++ ) {

			const x = 1 - Math.cos( Math.PI * i / N ) * 0.5 - 0.5; // cosine spacing 0..1
			const yt = 5 * 0.14 * ( 0.2969 * Math.sqrt( x ) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4 );
			pts.push( [ z0 - x * c, yt * c ] );

		}

		const loop = [];
		for ( let i = 0; i <= N; i ++ ) loop.push( V( pts[ i ][ 1 ], y, pts[ i ][ 0 ] ) );
		for ( let i = N - 1; i >= 1; i -- ) loop.push( V( - pts[ i ][ 1 ], y, pts[ i ][ 0 ] ) );
		return loop;

	};

	const bottomLoop = foil( 0.92, yBot ), topLoop = foil( 1.0, yTop );
	const rows = [ bottomLoop.concat( [ bottomLoop[ 0 ].clone() ] ), topLoop.concat( [ topLoop[ 0 ].clone() ] ) ];
	const side = gridSurface( rows );
	// normals must point away from the stock axis
	const p = side.attributes.position, n = side.attributes.normal;
	let dot = 0;
	const a = V( 0, 0, 0 ), b = V( 0, 0, 0 );
	for ( let i = 0; i < p.count; i ++ ) {

		a.fromBufferAttribute( p, i ); b.fromBufferAttribute( n, i );
		dot += b.x * a.x;

	}

	if ( dot < 0 ) {

		const idx = Array.from( side.index.array );
		for ( let i = 0; i < idx.length; i += 3 ) {

			const t = idx[ i + 1 ]; idx[ i + 1 ] = idx[ i + 2 ]; idx[ i + 2 ] = t;

		}

		side.setIndex( idx );
		side.computeVertexNormals();

	}

	const opts = { color: PALETTE.antifouling, rough: 0.75 };
	const list = [ prepare( side, opts ), prepare( fanCap( bottomLoop, V( 0, - 1, 0 ) ), opts ), prepare( fanCap( topLoop, V( 0, 1, 0 ) ), opts ) ];
	const stock = cylinder( 0.022, 0.022, 0.3, 10 );
	stock.translate( 0, yTop + 0.15, 0 );
	list.push( prepare( stock, BRONZE ) );
	const heel = cylinder( 0.012, 0.012, 0.05, 8 );
	heel.translate( 0, yBot - 0.015, 0 );
	list.push( prepare( heel, BRONZE ) );
	return mergePrepared( list );

}
