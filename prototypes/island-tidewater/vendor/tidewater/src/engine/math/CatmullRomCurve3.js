// Curve base + Catmull-Rom spline (three.js Curve / CatmullRomCurve3-compatible:
// same parameterization, arc-length table (200 divisions) and Frenet frames).

import { Vector3 } from './Vector3.js';
import { Matrix4 } from './Matrix4.js';

export class Curve {

	constructor() {

		this.arcLengthDivisions = 200;
		this.needsUpdate = false;
		this.cacheArcLengths = null;

	}

	clone() { return new this.constructor().copy( this ); }
	copy( src ) { this.arcLengthDivisions = src.arcLengthDivisions; return this; }

	getPoint( /* t, target */ ) { throw new Error( 'Curve.getPoint() not implemented' ); }
	getPointAt( u, target ) { return this.getPoint( this.getUtoTmapping( u ), target ); }

	getPoints( divisions = 5 ) {

		const pts = [];
		for ( let d = 0; d <= divisions; d ++ ) pts.push( this.getPoint( d / divisions ) );
		return pts;

	}

	getSpacedPoints( divisions = 5 ) {

		const pts = [];
		for ( let d = 0; d <= divisions; d ++ ) pts.push( this.getPointAt( d / divisions ) );
		return pts;

	}

	getLength() { const l = this.getLengths(); return l[ l.length - 1 ]; }

	getLengths( divisions = this.arcLengthDivisions ) {

		if ( this.cacheArcLengths && this.cacheArcLengths.length === divisions + 1 && ! this.needsUpdate ) return this.cacheArcLengths;
		this.needsUpdate = false;
		const cache = [ 0 ];
		let last = this.getPoint( 0 ), sum = 0;

		for ( let p = 1; p <= divisions; p ++ ) {

			const cur = this.getPoint( p / divisions );
			sum += cur.distanceTo( last );
			cache.push( sum );
			last = cur;

		}

		this.cacheArcLengths = cache;
		return cache;

	}

	updateArcLengths() { this.needsUpdate = true; this.getLengths(); }

	// Arc-length fraction u (or absolute `distance`) -> curve parameter t.
	getUtoTmapping( u, distance = null ) {

		const L = this.getLengths(), n = L.length;
		const target = distance !== null ? distance : u * L[ n - 1 ];
		let lo = 0, hi = n - 1;

		while ( lo <= hi ) {

			const i = Math.floor( lo + ( hi - lo ) / 2 );
			const c = L[ i ] - target;
			if ( c < 0 ) lo = i + 1;
			else if ( c > 0 ) hi = i - 1;
			else { hi = i; break; }

		}

		const i = hi;
		if ( L[ i ] === target ) return i / ( n - 1 );
		const before = L[ i ], after = L[ i + 1 ];
		return ( i + ( target - before ) / ( after - before ) ) / ( n - 1 );

	}

	getTangent( t, target = new Vector3() ) {

		const delta = 0.0001;
		const t1 = Math.max( 0, t - delta ), t2 = Math.min( 1, t + delta );
		const a = this.getPoint( t1 ), b = this.getPoint( t2 );
		return target.copy( b ).sub( a ).normalize();

	}

	getTangentAt( u, target ) { return this.getTangent( this.getUtoTmapping( u ), target ); }

	// Parallel-transport frames (rotation-minimizing), as used by TubeGeometry.
	computeFrenetFrames( segments, closed ) {

		const normal = new Vector3(), tangents = [], normals = [], binormals = [];
		const vec = new Vector3(), mat = new Matrix4();

		for ( let i = 0; i <= segments; i ++ ) tangents[ i ] = this.getTangentAt( i / segments, new Vector3() );

		normals[ 0 ] = new Vector3();
		binormals[ 0 ] = new Vector3();
		let min = Number.MAX_VALUE;
		const tx = Math.abs( tangents[ 0 ].x ), ty = Math.abs( tangents[ 0 ].y ), tz = Math.abs( tangents[ 0 ].z );
		if ( tx <= min ) { min = tx; normal.set( 1, 0, 0 ); }
		if ( ty <= min ) { min = ty; normal.set( 0, 1, 0 ); }
		if ( tz <= min ) normal.set( 0, 0, 1 );
		vec.crossVectors( tangents[ 0 ], normal ).normalize();
		normals[ 0 ].crossVectors( tangents[ 0 ], vec );
		binormals[ 0 ].crossVectors( tangents[ 0 ], normals[ 0 ] );

		for ( let i = 1; i <= segments; i ++ ) {

			normals[ i ] = normals[ i - 1 ].clone();
			binormals[ i ] = binormals[ i - 1 ].clone();
			vec.crossVectors( tangents[ i - 1 ], tangents[ i ] );

			if ( vec.length() > Number.EPSILON ) {

				vec.normalize();
				const theta = Math.acos( Math.max( - 1, Math.min( 1, tangents[ i - 1 ].dot( tangents[ i ] ) ) ) );
				normals[ i ].applyMatrix4( mat.makeRotationAxis( vec, theta ) );

			}

			binormals[ i ].crossVectors( tangents[ i ], normals[ i ] );

		}

		if ( closed === true ) {

			let theta = Math.acos( Math.max( - 1, Math.min( 1, normals[ 0 ].dot( normals[ segments ] ) ) ) ) / segments;
			if ( tangents[ 0 ].dot( vec.crossVectors( normals[ 0 ], normals[ segments ] ) ) > 0 ) theta = - theta;

			for ( let i = 1; i <= segments; i ++ ) {

				normals[ i ].applyMatrix4( mat.makeRotationAxis( tangents[ i ], theta * i ) );
				binormals[ i ].crossVectors( tangents[ i ], normals[ i ] );

			}

		}

		return { tangents, normals, binormals };

	}

}

// Cubic c0 + c1 t + c2 t^2 + c3 t^3 from Hermite endpoints / tangents.
function hermite( out, x0, x1, t0, t1 ) {

	out[ 0 ] = x0;
	out[ 1 ] = t0;
	out[ 2 ] = - 3 * x0 + 3 * x1 - 2 * t0 - t1;
	out[ 3 ] = 2 * x0 - 2 * x1 + t0 + t1;

}

function uniformCR( out, x0, x1, x2, x3, tension ) {

	hermite( out, x1, x2, tension * ( x2 - x0 ), tension * ( x3 - x1 ) );

}

function nonuniformCR( out, x0, x1, x2, x3, dt0, dt1, dt2 ) {

	let t1 = ( x1 - x0 ) / dt0 - ( x2 - x0 ) / ( dt0 + dt1 ) + ( x2 - x1 ) / dt1;
	let t2 = ( x2 - x1 ) / dt1 - ( x3 - x1 ) / ( dt1 + dt2 ) + ( x3 - x2 ) / dt2;
	t1 *= dt1;
	t2 *= dt1;
	hermite( out, x1, x2, t1, t2 );

}

const evalPoly = ( c, t ) => c[ 0 ] + t * ( c[ 1 ] + t * ( c[ 2 ] + t * c[ 3 ] ) );

const _px = [ 0, 0, 0, 0 ], _py = [ 0, 0, 0, 0 ], _pz = [ 0, 0, 0, 0 ];
const _t0 = /*@__PURE__*/ new Vector3(), _t3 = /*@__PURE__*/ new Vector3();

export class CatmullRomCurve3 extends Curve {

	constructor( points = [], closed = false, curveType = 'centripetal', tension = 0.5 ) {

		super();
		this.type = 'CatmullRomCurve3';
		this.points = points;
		this.closed = closed;
		this.curveType = curveType;
		this.tension = tension;

	}

	getPoint( t, target = new Vector3() ) {

		const pts = this.points, l = pts.length;
		const p = ( l - ( this.closed ? 0 : 1 ) ) * t;
		let i = Math.floor( p ), w = p - i;

		if ( this.closed ) i += i > 0 ? 0 : ( Math.floor( Math.abs( i ) / l ) + 1 ) * l;
		else if ( w === 0 && i === l - 1 ) { i = l - 2; w = 1; }

		let p0, p3;
		if ( this.closed || i > 0 ) p0 = pts[ ( i - 1 ) % l ];
		else p0 = _t0.subVectors( pts[ 0 ], pts[ 1 ] ).add( pts[ 0 ] );
		const p1 = pts[ i % l ], p2 = pts[ ( i + 1 ) % l ];
		if ( this.closed || i + 2 < l ) p3 = pts[ ( i + 2 ) % l ];
		else p3 = _t3.subVectors( pts[ l - 1 ], pts[ l - 2 ] ).add( pts[ l - 1 ] );

		if ( this.curveType === 'centripetal' || this.curveType === 'chordal' ) {

			const pw = this.curveType === 'chordal' ? 0.5 : 0.25;
			let dt0 = Math.pow( p0.distanceToSquared( p1 ), pw );
			let dt1 = Math.pow( p1.distanceToSquared( p2 ), pw );
			let dt2 = Math.pow( p2.distanceToSquared( p3 ), pw );
			if ( dt1 < 1e-4 ) dt1 = 1.0;
			if ( dt0 < 1e-4 ) dt0 = dt1;
			if ( dt2 < 1e-4 ) dt2 = dt1;
			nonuniformCR( _px, p0.x, p1.x, p2.x, p3.x, dt0, dt1, dt2 );
			nonuniformCR( _py, p0.y, p1.y, p2.y, p3.y, dt0, dt1, dt2 );
			nonuniformCR( _pz, p0.z, p1.z, p2.z, p3.z, dt0, dt1, dt2 );

		} else {

			uniformCR( _px, p0.x, p1.x, p2.x, p3.x, this.tension );
			uniformCR( _py, p0.y, p1.y, p2.y, p3.y, this.tension );
			uniformCR( _pz, p0.z, p1.z, p2.z, p3.z, this.tension );

		}

		return target.set( evalPoly( _px, w ), evalPoly( _py, w ), evalPoly( _pz, w ) );

	}

	copy( src ) {

		super.copy( src );
		this.points = src.points.map( ( p ) => p.clone() );
		this.closed = src.closed;
		this.curveType = src.curveType;
		this.tension = src.tension;
		return this;

	}

	clone() { return new CatmullRomCurve3().copy( this ); }

}

CatmullRomCurve3.prototype.isCatmullRomCurve3 = true;
