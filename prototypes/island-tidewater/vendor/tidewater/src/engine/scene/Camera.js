// Cameras (three.js-compatible API). Projections target WebGPU clip space with
// REVERSED depth by default: NDC z = 1 at the near plane, 0 at the far plane.
// Set `reversedDepth = false` for the conventional [0 near, 1 far] mapping.

import { Object3D } from './Object3D.js';
import { Matrix4, WebGPUCoordinateSystem } from '../math/Matrix4.js';
import { Vector2 } from '../math/Vector2.js';
import { Vector3 } from '../math/Vector3.js';
import { DEG2RAD, RAD2DEG } from '../math/MathUtils.js';

const _v = /*@__PURE__*/ new Vector3();
const _minTarget = /*@__PURE__*/ new Vector2();
const _maxTarget = /*@__PURE__*/ new Vector2();

export class Camera extends Object3D {

	constructor() {

		super();
		this.type = 'Camera';
		this.matrixWorldInverse = new Matrix4();
		this.projectionMatrix = new Matrix4();
		this.projectionMatrixInverse = new Matrix4();
		this.coordinateSystem = WebGPUCoordinateSystem;
		this.reversedDepth = true;

	}

	copy( source, recursive ) {

		super.copy( source, recursive );
		this.matrixWorldInverse.copy( source.matrixWorldInverse );
		this.projectionMatrix.copy( source.projectionMatrix );
		this.projectionMatrixInverse.copy( source.projectionMatrixInverse );
		this.coordinateSystem = source.coordinateSystem;
		this.reversedDepth = source.reversedDepth;
		return this;

	}

	// Cameras look down local -Z.
	getWorldDirection( t ) { return super.getWorldDirection( t ).negate(); }

	updateMatrixWorld( force ) {

		super.updateMatrixWorld( force );
		this.matrixWorldInverse.copy( this.matrixWorld ).invert();

	}

	updateWorldMatrix( updateParents, updateChildren ) {

		super.updateWorldMatrix( updateParents, updateChildren );
		this.matrixWorldInverse.copy( this.matrixWorld ).invert();

	}

	clone() { return new this.constructor().copy( this ); }

}

Camera.prototype.isCamera = true;

function setView( cam, fullWidth, fullHeight, x, y, width, height ) {

	if ( cam.view === null ) cam.view = { enabled: true, fullWidth: 1, fullHeight: 1, offsetX: 0, offsetY: 0, width: 1, height: 1 };
	const v = cam.view;
	v.enabled = true;
	v.fullWidth = fullWidth; v.fullHeight = fullHeight;
	v.offsetX = x; v.offsetY = y;
	v.width = width; v.height = height;
	cam.updateProjectionMatrix();

}

export class PerspectiveCamera extends Camera {

	constructor( fov = 50, aspect = 1, near = 0.1, far = 2000 ) {

		super();
		this.type = 'PerspectiveCamera';
		this.fov = fov;
		this.zoom = 1;
		this.near = near;
		this.far = far;
		this.infiniteFar = false; // when true the far plane is at infinity (depth -> 0)
		this.focus = 10;
		this.aspect = aspect;
		this.view = null;
		this.filmGauge = 35;
		this.filmOffset = 0;
		this.updateProjectionMatrix();

	}

	copy( source, recursive ) {

		super.copy( source, recursive );
		this.fov = source.fov;
		this.zoom = source.zoom;
		this.near = source.near;
		this.far = source.far;
		this.infiniteFar = source.infiniteFar;
		this.focus = source.focus;
		this.aspect = source.aspect;
		this.view = source.view === null ? null : Object.assign( {}, source.view );
		this.filmGauge = source.filmGauge;
		this.filmOffset = source.filmOffset;
		return this;

	}

	setFocalLength( focalLength ) {

		const vExtentSlope = 0.5 * this.getFilmHeight() / focalLength;
		this.fov = RAD2DEG * 2 * Math.atan( vExtentSlope );
		this.updateProjectionMatrix();

	}

	getFocalLength() { return 0.5 * this.getFilmHeight() / Math.tan( DEG2RAD * 0.5 * this.fov ); }
	getEffectiveFOV() { return RAD2DEG * 2 * Math.atan( Math.tan( DEG2RAD * 0.5 * this.fov ) / this.zoom ); }
	getFilmWidth() { return this.filmGauge * Math.min( this.aspect, 1 ); }
	getFilmHeight() { return this.filmGauge / Math.max( this.aspect, 1 ); }

	// View-plane rectangle at `distance` in front of the camera.
	getViewBounds( distance, minTarget, maxTarget ) {

		_v.set( - 1, - 1, 0.5 ).applyMatrix4( this.projectionMatrixInverse );
		minTarget.set( _v.x, _v.y ).multiplyScalar( - distance / _v.z );
		_v.set( 1, 1, 0.5 ).applyMatrix4( this.projectionMatrixInverse );
		maxTarget.set( _v.x, _v.y ).multiplyScalar( - distance / _v.z );

	}

	getViewSize( distance, target ) {

		this.getViewBounds( distance, _minTarget, _maxTarget );
		return target.subVectors( _maxTarget, _minTarget );

	}

	// Sub-rectangle of a larger virtual viewport (tiling, TAA jitter with
	// fractional offsets). Units are arbitrary but consistent (usually pixels).
	setViewOffset( fullWidth, fullHeight, x, y, width, height ) {

		this.aspect = fullWidth / fullHeight;
		setView( this, fullWidth, fullHeight, x, y, width, height );

	}

	clearViewOffset() {

		if ( this.view !== null ) this.view.enabled = false;
		this.updateProjectionMatrix();

	}

	updateProjectionMatrix() {

		const near = this.near;
		let top = near * Math.tan( DEG2RAD * 0.5 * this.fov ) / this.zoom;
		let height = 2 * top, width = this.aspect * height, left = - 0.5 * width;
		const view = this.view;

		if ( view !== null && view.enabled ) {

			const fw = view.fullWidth, fh = view.fullHeight;
			left += view.offsetX * width / fw;
			top -= view.offsetY * height / fh;
			width *= view.width / fw;
			height *= view.height / fh;

		}

		const skew = this.filmOffset;
		if ( skew !== 0 ) left += near * skew / this.getFilmWidth();

		const far = this.infiniteFar ? Infinity : this.far;
		this.projectionMatrix.makePerspective( left, left + width, top, top - height, near, far, this.coordinateSystem, this.reversedDepth );
		this.projectionMatrixInverse.copy( this.projectionMatrix ).invert();

	}

}

PerspectiveCamera.prototype.isPerspectiveCamera = true;

export class OrthographicCamera extends Camera {

	constructor( left = - 1, right = 1, top = 1, bottom = - 1, near = 0.1, far = 2000 ) {

		super();
		this.type = 'OrthographicCamera';
		this.zoom = 1;
		this.view = null;
		this.left = left;
		this.right = right;
		this.top = top;
		this.bottom = bottom;
		this.near = near;
		this.far = far;
		this.updateProjectionMatrix();

	}

	copy( source, recursive ) {

		super.copy( source, recursive );
		this.left = source.left;
		this.right = source.right;
		this.top = source.top;
		this.bottom = source.bottom;
		this.near = source.near;
		this.far = source.far;
		this.zoom = source.zoom;
		this.view = source.view === null ? null : Object.assign( {}, source.view );
		return this;

	}

	setViewOffset( fullWidth, fullHeight, x, y, width, height ) { setView( this, fullWidth, fullHeight, x, y, width, height ); }

	clearViewOffset() {

		if ( this.view !== null ) this.view.enabled = false;
		this.updateProjectionMatrix();

	}

	updateProjectionMatrix() {

		const dx = ( this.right - this.left ) / ( 2 * this.zoom );
		const dy = ( this.top - this.bottom ) / ( 2 * this.zoom );
		const cx = ( this.right + this.left ) / 2, cy = ( this.top + this.bottom ) / 2;
		let left = cx - dx, right = cx + dx, top = cy + dy, bottom = cy - dy;
		const view = this.view;

		if ( view !== null && view.enabled ) {

			const sw = ( this.right - this.left ) / view.fullWidth / this.zoom;
			const sh = ( this.top - this.bottom ) / view.fullHeight / this.zoom;
			left += sw * view.offsetX;
			right = left + sw * view.width;
			top -= sh * view.offsetY;
			bottom = top - sh * view.height;

		}

		this.projectionMatrix.makeOrthographic( left, right, top, bottom, this.near, this.far, this.coordinateSystem, this.reversedDepth );
		this.projectionMatrixInverse.copy( this.projectionMatrix ).invert();

	}

}

OrthographicCamera.prototype.isOrthographicCamera = true;
