// Scene-graph node (three.js Object3D-compatible). `rotation` (Euler) and
// `quaternion` stay in sync; `matrix` is composed from position / quaternion /
// scale when matrixAutoUpdate is set.

import { EventDispatcher } from '../core/EventDispatcher.js';
import { Vector3 } from '../math/Vector3.js';
import { Quaternion } from '../math/Quaternion.js';
import { Euler } from '../math/Euler.js';
import { Matrix3 } from '../math/Matrix3.js';
import { Matrix4 } from '../math/Matrix4.js';
import { generateUUID } from '../math/MathUtils.js';
import { Layers } from './Layers.js';

let _id = 0;

const _v1 = /*@__PURE__*/ new Vector3();
const _q1 = /*@__PURE__*/ new Quaternion();
const _m1 = /*@__PURE__*/ new Matrix4();
const _target = /*@__PURE__*/ new Vector3();
const _position = /*@__PURE__*/ new Vector3();
const _scale = /*@__PURE__*/ new Vector3();
const _quaternion = /*@__PURE__*/ new Quaternion();
const _xAxis = /*@__PURE__*/ new Vector3( 1, 0, 0 );
const _yAxis = /*@__PURE__*/ new Vector3( 0, 1, 0 );
const _zAxis = /*@__PURE__*/ new Vector3( 0, 0, 1 );

const _addedEvent = { type: 'added' };
const _removedEvent = { type: 'removed' };
const _childAddedEvent = { type: 'childadded', child: null };
const _childRemovedEvent = { type: 'childremoved', child: null };

export class Object3D extends EventDispatcher {

	constructor() {

		super();

		Object.defineProperty( this, 'id', { value: _id ++ } );
		this.uuid = generateUUID();
		this.name = '';
		this.type = 'Object3D';
		this.parent = null;
		this.children = [];
		this.up = Object3D.DEFAULT_UP.clone();

		const position = new Vector3();
		const rotation = new Euler();
		const quaternion = new Quaternion();
		const scale = new Vector3( 1, 1, 1 );
		rotation._onChange( () => quaternion.setFromEuler( rotation, false ) );
		quaternion._onChange( () => rotation.setFromQuaternion( quaternion, undefined, false ) );

		Object.defineProperties( this, {
			position: { configurable: true, enumerable: true, value: position },
			rotation: { configurable: true, enumerable: true, value: rotation },
			quaternion: { configurable: true, enumerable: true, value: quaternion },
			scale: { configurable: true, enumerable: true, value: scale },
			modelViewMatrix: { value: new Matrix4() },
			normalMatrix: { value: new Matrix3() },
		} );

		this.matrix = new Matrix4();
		this.matrixWorld = new Matrix4();
		this.matrixAutoUpdate = Object3D.DEFAULT_MATRIX_AUTO_UPDATE;
		this.matrixWorldAutoUpdate = Object3D.DEFAULT_MATRIX_WORLD_AUTO_UPDATE;
		this.matrixWorldNeedsUpdate = false;
		this.layers = new Layers();
		this.visible = true;
		this.castShadow = false;
		this.receiveShadow = false;
		this.frustumCulled = true;
		this.renderOrder = 0;
		this.userData = {};

	}

	// Hooks the renderer may call around a draw; no-ops by default.
	onBeforeRender( /* renderer, scene, camera, geometry, material, group */ ) {}
	onAfterRender( /* renderer, scene, camera, geometry, material, group */ ) {}
	onBeforeShadow() {}
	onAfterShadow() {}

	// Emits 'dispose'; geometry / material are not touched (three.js semantics).
	dispose() { this.dispatchEvent( { type: 'dispose' } ); }

	applyMatrix4( m ) {

		if ( this.matrixAutoUpdate ) this.updateMatrix();
		this.matrix.premultiply( m );
		this.matrix.decompose( this.position, this.quaternion, this.scale );
		return this;

	}

	applyQuaternion( q ) { this.quaternion.premultiply( q ); return this; }
	setRotationFromAxisAngle( axis, angle ) { this.quaternion.setFromAxisAngle( axis, angle ); }
	setRotationFromEuler( e ) { this.quaternion.setFromEuler( e, true ); }
	setRotationFromMatrix( m ) { this.quaternion.setFromRotationMatrix( m ); }
	setRotationFromQuaternion( q ) { this.quaternion.copy( q ); }

	rotateOnAxis( axis, angle ) { _q1.setFromAxisAngle( axis, angle ); this.quaternion.multiply( _q1 ); return this; }
	rotateOnWorldAxis( axis, angle ) { _q1.setFromAxisAngle( axis, angle ); this.quaternion.premultiply( _q1 ); return this; }
	rotateX( a ) { return this.rotateOnAxis( _xAxis, a ); }
	rotateY( a ) { return this.rotateOnAxis( _yAxis, a ); }
	rotateZ( a ) { return this.rotateOnAxis( _zAxis, a ); }

	translateOnAxis( axis, d ) { _v1.copy( axis ).applyQuaternion( this.quaternion ); this.position.add( _v1.multiplyScalar( d ) ); return this; }
	translateX( d ) { return this.translateOnAxis( _xAxis, d ); }
	translateY( d ) { return this.translateOnAxis( _yAxis, d ); }
	translateZ( d ) { return this.translateOnAxis( _zAxis, d ); }

	localToWorld( v ) { this.updateWorldMatrix( true, false ); return v.applyMatrix4( this.matrixWorld ); }
	worldToLocal( v ) { this.updateWorldMatrix( true, false ); return v.applyMatrix4( _m1.copy( this.matrixWorld ).invert() ); }

	// Orients local +Z toward the target (cameras and lights: -Z).
	lookAt( x, y, z ) {

		if ( x.isVector3 ) _target.copy( x ); else _target.set( x, y, z );
		const parent = this.parent;
		this.updateWorldMatrix( true, false );
		_position.setFromMatrixPosition( this.matrixWorld );

		if ( this.isCamera || this.isLight ) _m1.lookAt( _position, _target, this.up );
		else _m1.lookAt( _target, _position, this.up );

		this.quaternion.setFromRotationMatrix( _m1 );

		if ( parent ) {

			_m1.extractRotation( parent.matrixWorld );
			_q1.setFromRotationMatrix( _m1 );
			this.quaternion.premultiply( _q1.invert() );

		}

	}

	add( object ) {

		if ( arguments.length > 1 ) {

			for ( let i = 0; i < arguments.length; i ++ ) this.add( arguments[ i ] );
			return this;

		}

		if ( object === this ) return this;
		if ( object && object.isObject3D ) {

			object.removeFromParent();
			object.parent = this;
			this.children.push( object );
			object.dispatchEvent( _addedEvent );
			_childAddedEvent.child = object;
			this.dispatchEvent( _childAddedEvent );
			_childAddedEvent.child = null;

		}

		return this;

	}

	remove( object ) {

		if ( arguments.length > 1 ) {

			for ( let i = 0; i < arguments.length; i ++ ) this.remove( arguments[ i ] );
			return this;

		}

		const i = this.children.indexOf( object );
		if ( i !== - 1 ) {

			object.parent = null;
			this.children.splice( i, 1 );
			object.dispatchEvent( _removedEvent );
			_childRemovedEvent.child = object;
			this.dispatchEvent( _childRemovedEvent );
			_childRemovedEvent.child = null;

		}

		return this;

	}

	removeFromParent() { if ( this.parent !== null ) this.parent.remove( this ); return this; }
	clear() { return this.remove( ...this.children ); }

	// Reparent while keeping the world transform.
	attach( object ) {

		this.updateWorldMatrix( true, false );
		_m1.copy( this.matrixWorld ).invert();
		if ( object.parent !== null ) {

			object.parent.updateWorldMatrix( true, false );
			_m1.multiply( object.parent.matrixWorld );

		}

		object.applyMatrix4( _m1 );
		object.removeFromParent();
		object.parent = this;
		this.children.push( object );
		object.updateWorldMatrix( false, true );
		object.dispatchEvent( _addedEvent );
		return this;

	}

	getObjectById( id ) { return this.getObjectByProperty( 'id', id ); }
	getObjectByName( name ) { return this.getObjectByProperty( 'name', name ); }

	getObjectByProperty( name, value ) {

		if ( this[ name ] === value ) return this;
		for ( const c of this.children ) {

			const o = c.getObjectByProperty( name, value );
			if ( o !== undefined ) return o;

		}

		return undefined;

	}

	getObjectsByProperty( name, value, result = [] ) {

		if ( this[ name ] === value ) result.push( this );
		for ( const c of this.children ) c.getObjectsByProperty( name, value, result );
		return result;

	}

	getWorldPosition( t ) { this.updateWorldMatrix( true, false ); return t.setFromMatrixPosition( this.matrixWorld ); }
	getWorldQuaternion( t ) { this.updateWorldMatrix( true, false ); this.matrixWorld.decompose( _position, t, _scale ); return t; }
	getWorldScale( t ) { this.updateWorldMatrix( true, false ); this.matrixWorld.decompose( _position, _quaternion, t ); return t; }

	getWorldDirection( t ) {

		this.updateWorldMatrix( true, false );
		const e = this.matrixWorld.elements;
		return t.set( e[ 8 ], e[ 9 ], e[ 10 ] ).normalize();

	}

	traverse( cb ) {

		cb( this );
		const c = this.children;
		for ( let i = 0, l = c.length; i < l; i ++ ) c[ i ].traverse( cb );

	}

	traverseVisible( cb ) {

		if ( this.visible === false ) return;
		cb( this );
		const c = this.children;
		for ( let i = 0, l = c.length; i < l; i ++ ) c[ i ].traverseVisible( cb );

	}

	traverseAncestors( cb ) {

		const p = this.parent;
		if ( p !== null ) { cb( p ); p.traverseAncestors( cb ); }

	}

	updateMatrix() {

		this.matrix.compose( this.position, this.quaternion, this.scale );
		this.matrixWorldNeedsUpdate = true;

	}

	updateMatrixWorld( force ) {

		if ( this.matrixAutoUpdate ) this.updateMatrix();

		if ( this.matrixWorldNeedsUpdate || force ) {

			if ( this.matrixWorldAutoUpdate === true ) {

				if ( this.parent === null ) this.matrixWorld.copy( this.matrix );
				else this.matrixWorld.multiplyMatrices( this.parent.matrixWorld, this.matrix );

			}

			this.matrixWorldNeedsUpdate = false;
			force = true;

		}

		const c = this.children;
		for ( let i = 0, l = c.length; i < l; i ++ ) {

			const child = c[ i ];
			if ( child.matrixWorldAutoUpdate === true || force === true ) child.updateMatrixWorld( force );

		}

	}

	updateWorldMatrix( updateParents, updateChildren ) {

		const parent = this.parent;
		if ( updateParents === true && parent !== null ) parent.updateWorldMatrix( true, false );
		if ( this.matrixAutoUpdate ) this.updateMatrix();

		if ( this.matrixWorldAutoUpdate === true ) {

			if ( parent === null ) this.matrixWorld.copy( this.matrix );
			else this.matrixWorld.multiplyMatrices( parent.matrixWorld, this.matrix );

		}

		if ( updateChildren === true ) {

			const c = this.children;
			for ( let i = 0, l = c.length; i < l; i ++ ) if ( c[ i ].matrixWorldAutoUpdate === true ) c[ i ].updateWorldMatrix( false, true );

		}

	}

	clone( recursive ) { return new this.constructor().copy( this, recursive ); }

	copy( source, recursive = true ) {

		this.name = source.name;
		this.up.copy( source.up );
		this.position.copy( source.position );
		this.rotation.order = source.rotation.order;
		this.quaternion.copy( source.quaternion );
		this.scale.copy( source.scale );
		this.matrix.copy( source.matrix );
		this.matrixWorld.copy( source.matrixWorld );
		this.matrixAutoUpdate = source.matrixAutoUpdate;
		this.matrixWorldAutoUpdate = source.matrixWorldAutoUpdate;
		this.matrixWorldNeedsUpdate = source.matrixWorldNeedsUpdate;
		this.layers.mask = source.layers.mask;
		this.visible = source.visible;
		this.castShadow = source.castShadow;
		this.receiveShadow = source.receiveShadow;
		this.frustumCulled = source.frustumCulled;
		this.renderOrder = source.renderOrder;
		if ( source.onBeforeRender !== Object3D.prototype.onBeforeRender ) this.onBeforeRender = source.onBeforeRender;
		this.userData = JSON.parse( JSON.stringify( source.userData ) );
		if ( recursive === true ) for ( const c of source.children ) this.add( c.clone() );
		return this;

	}

}

Object3D.DEFAULT_UP = /*@__PURE__*/ new Vector3( 0, 1, 0 );
Object3D.DEFAULT_MATRIX_AUTO_UPDATE = true;
Object3D.DEFAULT_MATRIX_WORLD_AUTO_UPDATE = true;
Object3D.prototype.isObject3D = true;
