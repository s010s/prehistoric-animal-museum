import * as THREE from '../../engine/index.js';
import { StorageBuffer } from '../../engine/gpu/Texture.js';
import { ShaderModule } from '../../engine/gpu/Shader.js';

// Shared pieces of the wildlife renderers and simulations.

export const TAU = Math.PI * 2;

export const clamp = ( x, a, b ) => x < a ? a : x > b ? b : x;
export const lerp = ( a, b, t ) => a + ( b - a ) * t;
export const smooth = ( a, b, x ) => {

	const t = clamp( ( x - a ) / ( b - a ), 0, 1 );
	return t * t * ( 3 - 2 * t );

};

// shortest signed angle a - b
export const angleDiff = ( a, b ) => {

	let d = ( a - b ) % TAU;
	if ( d > Math.PI ) d -= TAU;
	else if ( d < - Math.PI ) d += TAU;
	return d;

};

// exponential approach factor for a rate (1/s)
export const approach = ( rate, dt ) => 1 - Math.exp( - rate * dt );

// WGSL: rotate v by the unit quaternion q ( fn rotateQ( q: vec4f, v: vec3f ) -> vec3f )
export const kitModule = new ShaderModule( {
	name: 'wildlifeKit',
	code: /* wgsl */`
fn rotateQ( q: vec4f, v: vec3f ) -> vec3f { return v + cross( q.xyz, cross( q.xyz, v ) + v * q.w ) * 2.0; }
`,
} );

// Motion vectors for animated instances: the camera motion (as for static geometry) plus the
// object's own motion. The three.js version added the object's own motion under the current
// camera to the static (camera) velocity; the engine's mesh shader projects the previous world
// position with the previous camera, which is the same to first order. Vertex snippets set the
// world position directly and hand the previous one:
//   v.useWorld = true; v.worldPos = world; v.worldNormal = n; v.prevWorldPos = world - delta;

// ---------------------------------------------------------------- CPU quaternions (plain arrays)

// q = [ x, y, z, w ]
export function qAxis( out, ax, ay, az, angle ) {

	const s = Math.sin( angle / 2 );
	out[ 0 ] = ax * s; out[ 1 ] = ay * s; out[ 2 ] = az * s; out[ 3 ] = Math.cos( angle / 2 );
	return out;

}

// out = a * b
export function qMul( out, a, b ) {

	const ax = a[ 0 ], ay = a[ 1 ], az = a[ 2 ], aw = a[ 3 ];
	const bx = b[ 0 ], by = b[ 1 ], bz = b[ 2 ], bw = b[ 3 ];
	out[ 0 ] = ax * bw + aw * bx + ay * bz - az * by;
	out[ 1 ] = ay * bw + aw * by + az * bx - ax * bz;
	out[ 2 ] = az * bw + aw * bz + ax * by - ay * bx;
	out[ 3 ] = aw * bw - ax * bx - ay * by - az * bz;
	return out;

}

// rotation from yaw (about y), pitch (about the rotated x: nose up > 0) and roll (about the
// rotated z: right wing down > 0), for a body whose forward axis is +z
const _qa = [ 0, 0, 0, 1 ], _qb = [ 0, 0, 0, 1 ];
export function qYawPitchRoll( out, yaw, pitch, roll ) {

	qAxis( out, 0, 1, 0, yaw );
	qMul( out, out, qAxis( _qa, 1, 0, 0, - pitch ) );
	return qMul( out, out, qAxis( _qb, 0, 0, 1, roll ) );

}

// rotate the vector (x, y, z) by q into out ([ x, y, z ])
export function qRotate( out, q, x, y, z ) {

	const qx = q[ 0 ], qy = q[ 1 ], qz = q[ 2 ], qw = q[ 3 ];
	const tx = 2 * ( qy * z - qz * y ), ty = 2 * ( qz * x - qx * z ), tz = 2 * ( qx * y - qy * x );
	out[ 0 ] = x + qw * tx + qy * tz - qz * ty;
	out[ 1 ] = y + qw * ty + qz * tx - qx * tz;
	out[ 2 ] = z + qw * tz + qx * ty - qy * tx;
	return out;

}

// quaternion that turns the +y axis onto the unit vector n and faces +z along the heading yaw
// (ground-aligned bodies)
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
export function qGround( out, yaw, nx, ny, nz ) {

	_y.set( nx, ny, nz );
	_z.set( Math.sin( yaw ), 0, Math.cos( yaw ) );
	_x.crossVectors( _y, _z ).normalize();
	_z.crossVectors( _x, _y );
	_m.makeBasis( _x, _y, _z );
	_q.setFromRotationMatrix( _m );
	out[ 0 ] = _q.x; out[ 1 ] = _q.y; out[ 2 ] = _q.z; out[ 3 ] = _q.w;
	return out;

}

// ---------------------------------------------------------------- instance records

// Per-instance data of an instanced template: `stride` vec4 per instance in a storage buffer
// (written on the CPU every frame, only the used part is uploaded).
export class InstanceRecords {

	constructor( name, max, stride ) {

		this.max = max;
		this.stride = stride;
		this.name = name;
		this.data = new Float32Array( max * stride * 4 );
		this.buffer = new StorageBuffer( { label: name, count: max * stride, type: 'vec4f' } );
		this.count = 0;

	}

	// WGSL expression: the k-th vec4 of the current instance (in a vertex snippet; the material
	// binds `storage: { [ name ]: records.buffer }`)
	field( k ) {

		return `${ this.name }[ v.instance * ${ this.stride }u + ${ k }u ]`;

	}

	begin() {

		this.count = 0;

	}

	// float offset of a new record (or -1 when full)
	push() {

		if ( this.count >= this.max ) return - 1;
		return ( this.count ++ ) * this.stride * 4;

	}

	commit() {

		this.buffer.write( this.data.subarray( 0, Math.max( 1, this.count ) * this.stride * 4 ) );

	}

}

// Instanced mesh drawing `records.count` instances; with a csm (SunShadows), shadows are cast into
// the near cascade only (the far cascades never see these small things).
export function instancedMesh( name, geometry, material, records, { csm = null, castShadow = false } = {} ) {

	const g = new THREE.BufferGeometry();
	g.index = geometry.index;
	for ( const k in geometry.attributes ) g.setAttribute( k, geometry.attributes[ k ] );
	g.instanceCount = 0;
	g.boundingSphere = new THREE.Sphere( new THREE.Vector3(), 1e5 );
	const mesh = new THREE.Mesh( g, material );
	mesh.name = name;
	mesh.frustumCulled = false;
	mesh.matrixAutoUpdate = false;
	mesh.castShadow = castShadow;
	mesh.receiveShadow = true;
	mesh.onBeforeRender = ( renderer, scene, camera ) => {

		let n = records.count;
		if ( csm && csm.cascades && camera ) {

			const i = csm.cascades.findIndex( ( c ) => c.camera === camera );
			if ( i > 0 ) n = 0;

		}

		g.instanceCount = n;

	};

	return mesh;

}
