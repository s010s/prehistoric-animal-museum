// Indexed / non-indexed vertex data (three.js BufferGeometry-compatible).
// dispose() emits a 'dispose' event so the renderer can free GPU buffers.

import { EventDispatcher } from '../core/EventDispatcher.js';
import { Vector3 } from '../math/Vector3.js';
import { Vector2 } from '../math/Vector2.js';
import { Matrix3 } from '../math/Matrix3.js';
import { Matrix4 } from '../math/Matrix4.js';
import { Quaternion } from '../math/Quaternion.js';
import { Box3 } from '../math/Box3.js';
import { Sphere } from '../math/Sphere.js';
import { generateUUID } from '../math/MathUtils.js';
import { BufferAttribute, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute } from './BufferAttribute.js';

let _id = 0;
const _m1 = /*@__PURE__*/ new Matrix4();
const _m3 = /*@__PURE__*/ new Matrix3();
const _q = /*@__PURE__*/ new Quaternion();
const _box = /*@__PURE__*/ new Box3();
const _v = /*@__PURE__*/ new Vector3();
const _offset = /*@__PURE__*/ new Vector3();

export function arrayNeedsUint32( a ) {

	for ( let i = a.length - 1; i >= 0; -- i ) if ( a[ i ] >= 65535 ) return true;
	return false;

}

export class BufferGeometry extends EventDispatcher {

	constructor() {

		super();
		Object.defineProperty( this, 'id', { value: _id ++ } );
		this.uuid = generateUUID();
		this.name = '';
		this.type = 'BufferGeometry';
		this.index = null;
		this.indirect = null;
		this.indirectOffset = 0;
		this.attributes = {};
		this.morphAttributes = {};
		this.morphTargetsRelative = false;
		this.groups = [];
		this.boundingBox = null;
		this.boundingSphere = null;
		this.drawRange = { start: 0, count: Infinity };
		this.userData = {};

	}

	getIndex() { return this.index; }

	setIndex( index ) {

		if ( Array.isArray( index ) ) this.index = new ( arrayNeedsUint32( index ) ? Uint32BufferAttribute : Uint16BufferAttribute )( index, 1 );
		else this.index = index;
		return this;

	}

	setIndirect( indirect, offset = 0 ) { this.indirect = indirect; this.indirectOffset = offset; return this; }
	getIndirect() { return this.indirect; }
	getAttribute( name ) { return this.attributes[ name ]; }
	setAttribute( name, attr ) { this.attributes[ name ] = attr; this.attributesVersion = ( this.attributesVersion || 0 ) + 1; return this; }
	deleteAttribute( name ) { delete this.attributes[ name ]; this.attributesVersion = ( this.attributesVersion || 0 ) + 1; return this; }
	hasAttribute( name ) { return this.attributes[ name ] !== undefined; }
	addGroup( start, count, materialIndex = 0 ) { this.groups.push( { start, count, materialIndex } ); }
	clearGroups() { this.groups = []; }
	setDrawRange( start, count ) { this.drawRange.start = start; this.drawRange.count = count; }

	applyMatrix4( m ) {

		const pos = this.attributes.position;
		if ( pos !== undefined ) { pos.applyMatrix4( m ); pos.needsUpdate = true; }

		const nrm = this.attributes.normal;
		if ( nrm !== undefined ) { nrm.applyNormalMatrix( _m3.getNormalMatrix( m ) ); nrm.needsUpdate = true; }

		const tan = this.attributes.tangent;
		if ( tan !== undefined ) { tan.transformDirection( m ); tan.needsUpdate = true; }

		if ( this.boundingBox !== null ) this.computeBoundingBox();
		if ( this.boundingSphere !== null ) this.computeBoundingSphere();
		return this;

	}

	applyQuaternion( q ) { return this.applyMatrix4( _m1.makeRotationFromQuaternion( q ) ); }
	rotateX( a ) { return this.applyMatrix4( _m1.makeRotationX( a ) ); }
	rotateY( a ) { return this.applyMatrix4( _m1.makeRotationY( a ) ); }
	rotateZ( a ) { return this.applyMatrix4( _m1.makeRotationZ( a ) ); }
	translate( x, y, z ) { return this.applyMatrix4( _m1.makeTranslation( x, y, z ) ); }
	scale( x, y, z ) { return this.applyMatrix4( _m1.makeScale( x, y, z ) ); }

	lookAt( v ) {

		_m1.lookAt( v, _v.set( 0, 0, 0 ), new Vector3( 0, 1, 0 ) );
		_q.setFromRotationMatrix( _m1 );
		return this.applyQuaternion( _q );

	}

	center() {

		this.computeBoundingBox();
		this.boundingBox.getCenter( _offset ).negate();
		return this.translate( _offset.x, _offset.y, _offset.z );

	}

	setFromPoints( points ) {

		const a = [];
		for ( const p of points ) a.push( p.x, p.y, p.z || 0 );
		return this.setAttribute( 'position', new Float32BufferAttribute( a, 3 ) );

	}

	computeBoundingBox() {

		if ( this.boundingBox === null ) this.boundingBox = new Box3();
		const pos = this.attributes.position;
		if ( pos === undefined ) { this.boundingBox.makeEmpty(); return; }
		this.boundingBox.setFromBufferAttribute( pos );

	}

	computeBoundingSphere() {

		if ( this.boundingSphere === null ) this.boundingSphere = new Sphere();
		const pos = this.attributes.position;
		if ( pos === undefined ) { this.boundingSphere.makeEmpty(); return; }
		const c = this.boundingSphere.center;
		_box.setFromBufferAttribute( pos ).getCenter( c );
		let r2 = 0;
		for ( let i = 0; i < pos.count; i ++ ) r2 = Math.max( r2, c.distanceToSquared( _v.fromBufferAttribute( pos, i ) ) );
		this.boundingSphere.radius = Math.sqrt( r2 );

	}

	// Per-vertex tangents (xyz + handedness w) from position / normal / uv; needs an index.
	computeTangents() {

		const index = this.index, pos = this.attributes.position, nrm = this.attributes.normal, uv = this.attributes.uv;
		if ( index === null || pos === undefined || nrm === undefined || uv === undefined ) {

			console.error( 'BufferGeometry.computeTangents(): missing required attributes (index, position, normal or uv)' );
			return;

		}

		const n = pos.count;
		if ( this.hasAttribute( 'tangent' ) === false ) this.setAttribute( 'tangent', new BufferAttribute( new Float32Array( 4 * n ), 4 ) );
		const tangent = this.getAttribute( 'tangent' );
		const tan1 = [], tan2 = [];
		for ( let i = 0; i < n; i ++ ) { tan1[ i ] = new Vector3(); tan2[ i ] = new Vector3(); }

		const vA = new Vector3(), vB = new Vector3(), vC = new Vector3();
		const uA = new Vector2(), uB = new Vector2(), uC = new Vector2();
		const sdir = new Vector3(), tdir = new Vector3();

		const tri = ( a, b, c ) => {

			vA.fromBufferAttribute( pos, a ); vB.fromBufferAttribute( pos, b ); vC.fromBufferAttribute( pos, c );
			uA.fromBufferAttribute( uv, a ); uB.fromBufferAttribute( uv, b ); uC.fromBufferAttribute( uv, c );
			vB.sub( vA ); vC.sub( vA ); uB.sub( uA ); uC.sub( uA );
			const r = 1.0 / ( uB.x * uC.y - uC.x * uB.y );
			if ( ! isFinite( r ) ) return;
			sdir.copy( vB ).multiplyScalar( uC.y ).addScaledVector( vC, - uB.y ).multiplyScalar( r );
			tdir.copy( vC ).multiplyScalar( uB.x ).addScaledVector( vB, - uC.x ).multiplyScalar( r );
			tan1[ a ].add( sdir ); tan1[ b ].add( sdir ); tan1[ c ].add( sdir );
			tan2[ a ].add( tdir ); tan2[ b ].add( tdir ); tan2[ c ].add( tdir );

		};

		const groups = this.groups.length ? this.groups : [ { start: 0, count: index.count } ];
		for ( const g of groups ) for ( let j = g.start; j < g.start + g.count; j += 3 ) tri( index.getX( j ), index.getX( j + 1 ), index.getX( j + 2 ) );

		const t = new Vector3(), nv = new Vector3(), n2 = new Vector3(), c = new Vector3();
		const vert = ( v ) => {

			nv.fromBufferAttribute( nrm, v );
			n2.copy( nv );
			const t1 = tan1[ v ];
			t.copy( t1 ).sub( nv.multiplyScalar( nv.dot( t1 ) ) ).normalize();
			c.crossVectors( n2, t1 );
			const w = c.dot( tan2[ v ] ) < 0 ? - 1 : 1;
			tangent.setXYZW( v, t.x, t.y, t.z, w );

		};

		for ( const g of groups ) for ( let j = g.start; j < g.start + g.count; j ++ ) vert( index.getX( j ) );

	}

	// Area-weighted smooth normals (indexed) or flat face normals (non-indexed).
	computeVertexNormals() {

		const index = this.index, pos = this.getAttribute( 'position' );
		if ( pos === undefined ) return;

		let nrm = this.getAttribute( 'normal' );
		if ( nrm === undefined || nrm.count !== pos.count ) {

			nrm = new BufferAttribute( new Float32Array( pos.count * 3 ), 3 );
			this.setAttribute( 'normal', nrm );

		} else {

			for ( let i = 0; i < nrm.count; i ++ ) nrm.setXYZ( i, 0, 0, 0 );

		}

		const pA = new Vector3(), pB = new Vector3(), pC = new Vector3();
		const cb = new Vector3(), ab = new Vector3();
		const nA = new Vector3(), nB = new Vector3(), nC = new Vector3();

		if ( index ) {

			for ( let i = 0, il = index.count; i < il; i += 3 ) {

				const vA = index.getX( i ), vB = index.getX( i + 1 ), vC = index.getX( i + 2 );
				pA.fromBufferAttribute( pos, vA ); pB.fromBufferAttribute( pos, vB ); pC.fromBufferAttribute( pos, vC );
				cb.subVectors( pC, pB ); ab.subVectors( pA, pB ); cb.cross( ab );
				nA.fromBufferAttribute( nrm, vA ); nB.fromBufferAttribute( nrm, vB ); nC.fromBufferAttribute( nrm, vC );
				nA.add( cb ); nB.add( cb ); nC.add( cb );
				nrm.setXYZ( vA, nA.x, nA.y, nA.z ); nrm.setXYZ( vB, nB.x, nB.y, nB.z ); nrm.setXYZ( vC, nC.x, nC.y, nC.z );

			}

		} else {

			for ( let i = 0, il = pos.count; i < il; i += 3 ) {

				pA.fromBufferAttribute( pos, i ); pB.fromBufferAttribute( pos, i + 1 ); pC.fromBufferAttribute( pos, i + 2 );
				cb.subVectors( pC, pB ); ab.subVectors( pA, pB ); cb.cross( ab );
				nrm.setXYZ( i, cb.x, cb.y, cb.z ); nrm.setXYZ( i + 1, cb.x, cb.y, cb.z ); nrm.setXYZ( i + 2, cb.x, cb.y, cb.z );

			}

		}

		this.normalizeNormals();
		nrm.needsUpdate = true;

	}

	normalizeNormals() {

		const n = this.attributes.normal;
		for ( let i = 0, il = n.count; i < il; i ++ ) {

			_v.fromBufferAttribute( n, i ).normalize();
			n.setXYZ( i, _v.x, _v.y, _v.z );

		}

	}

	toNonIndexed() {

		if ( this.index === null ) {

			console.warn( 'BufferGeometry.toNonIndexed(): geometry is already non-indexed.' );
			return this;

		}

		const g = new BufferGeometry(), idx = this.index;

		const expand = ( attr ) => {

			const size = attr.itemSize, out = new attr.array.constructor( idx.count * size );
			for ( let i = 0; i < idx.count; i ++ ) {

				const s = idx.getX( i );
				for ( let c = 0; c < size; c ++ ) out[ i * size + c ] = attr.array[ attr._idx( s, c ) ];

			}

			return new BufferAttribute( out, size, attr.normalized );

		};

		for ( const name in this.attributes ) g.setAttribute( name, expand( this.attributes[ name ] ) );
		for ( const name in this.morphAttributes ) g.morphAttributes[ name ] = this.morphAttributes[ name ].map( expand );
		g.morphTargetsRelative = this.morphTargetsRelative;
		for ( const gr of this.groups ) g.addGroup( gr.start, gr.count, gr.materialIndex );
		return g;

	}

	clone() { return new BufferGeometry().copy( this ); }

	copy( src ) {

		this.index = null;
		this.attributes = {};
		this.morphAttributes = {};
		this.groups = [];
		this.boundingBox = null;
		this.boundingSphere = null;
		this.name = src.name;
		if ( src.index !== null ) this.setIndex( src.index.clone() );
		for ( const name in src.attributes ) this.setAttribute( name, src.attributes[ name ].clone() );
		for ( const name in src.morphAttributes ) this.morphAttributes[ name ] = src.morphAttributes[ name ].map( ( a ) => a.clone() );
		this.morphTargetsRelative = src.morphTargetsRelative;
		for ( const g of src.groups ) this.addGroup( g.start, g.count, g.materialIndex );
		if ( src.boundingBox !== null ) this.boundingBox = src.boundingBox.clone();
		if ( src.boundingSphere !== null ) this.boundingSphere = src.boundingSphere.clone();
		this.drawRange.start = src.drawRange.start;
		this.drawRange.count = src.drawRange.count;
		this.userData = src.userData;
		return this;

	}

	dispose() { this.dispatchEvent( { type: 'dispose' } ); }

}

BufferGeometry.prototype.isBufferGeometry = true;

export class InstancedBufferGeometry extends BufferGeometry {

	constructor() {

		super();
		this.type = 'InstancedBufferGeometry';
		this.instanceCount = Infinity;

	}

	copy( src ) { super.copy( src ); this.instanceCount = src.instanceCount; return this; }
	clone() { return new InstancedBufferGeometry().copy( this ); }

}

InstancedBufferGeometry.prototype.isInstancedBufferGeometry = true;
