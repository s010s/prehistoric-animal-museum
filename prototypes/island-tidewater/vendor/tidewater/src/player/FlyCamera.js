import * as THREE from '../engine/index.js';

// Free-fly debug camera: drag (or pointer lock) to look, WASD + QE to move, Shift = fast.
export class FlyCamera {

	constructor( camera, dom, input ) {

		this.camera = camera;
		this.dom = dom;
		this.input = input;
		this.yaw = 0;
		this.pitch = 0;
		this.speed = 8;
		this.enabled = true;
		this.velocity = new THREE.Vector3();
		this._fwd = new THREE.Vector3();
		this._right = new THREE.Vector3();

	}

	setPose( position, yaw, pitch ) {

		this.camera.position.copy( position );
		this.yaw = yaw;
		this.pitch = pitch;
		this.apply();

	}

	apply() {

		this.camera.rotation.set( this.pitch, this.yaw, 0, 'YXZ' );

	}

	update( dt ) {

		if ( ! this.enabled ) return;
		const inp = this.input;
		const look = inp.consumeLook();
		this.yaw -= look.x * 0.0022;
		this.pitch -= look.y * 0.0022;
		this.pitch = Math.max( - 1.55, Math.min( 1.55, this.pitch ) );
		this.apply();

		const fast = inp.down( 'ShiftLeft' ) || inp.down( 'ShiftRight' );
		const speed = this.speed * ( fast ? 6 : 1 );
		this.camera.getWorldDirection( this._fwd );
		this._right.crossVectors( this._fwd, this.camera.up ).normalize();
		const move = new THREE.Vector3();
		if ( inp.down( 'KeyW' ) ) move.add( this._fwd );
		if ( inp.down( 'KeyS' ) ) move.sub( this._fwd );
		if ( inp.down( 'KeyD' ) ) move.add( this._right );
		if ( inp.down( 'KeyA' ) ) move.sub( this._right );
		if ( inp.down( 'KeyE' ) || inp.down( 'Space' ) ) move.y += 1;
		if ( inp.down( 'KeyQ' ) || inp.down( 'KeyC' ) ) move.y -= 1;
		if ( move.lengthSq() > 0 ) move.normalize().multiplyScalar( speed );
		this.velocity.lerp( move, 1 - Math.exp( - dt * 8 ) );
		this.camera.position.addScaledVector( this.velocity, dt );

	}

}
