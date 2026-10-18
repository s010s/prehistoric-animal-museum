import { Matrix4 } from '../engine/math/index.js';

// Motion vectors for geometry that doesn't move in the world (only the camera does).
// three's velocity node tracked previous instance matrices with an extra vertex buffer, which
// pushed heavily instanced materials (vegetation) past the 8 vertex buffer limit. Static
// instances don't need it: reproject the world position with last frame's camera instead.
// In the engine this is a per-object flag (MeshRenderer: previous model matrix = current), and the
// camera matrices live in the frame uniforms (frame.viewProjNoJitter / frame.prevViewProjNoJitter,
// written by PostFX.beginFrame). The WGSL equivalent of the former `staticVelocity` node is
// STATIC_VELOCITY_WGSL (uv-space motion, current - previous, y down: the velocity target convention).

export const STATIC_VELOCITY_WGSL = /* wgsl */`
fn staticVelocity( P: vec3f ) -> vec2f {
	let c = frame.viewProjNoJitter * vec4f( P, 1.0 );
	let q = frame.prevViewProjNoJitter * vec4f( P, 1.0 );
	return ( c.xy / c.w - q.xy / q.w ) * vec2f( 0.5, -0.5 );
}
`;

// last frame's unjittered view-projection (CPU mirror, for systems that reproject on the CPU side)
export const prevViewProj = { value: new Matrix4() };
const currViewProj = new Matrix4();
const _m = new Matrix4();
let _hasPrev = false;

// Call once per frame before the (jittered) scene render, with the unjittered camera. The frame
// uniforms are written by PostFX.beginFrame; this keeps the CPU mirror above.
export function updateCameraVelocity( camera ) {

	camera.updateMatrixWorld();
	if ( camera.matrixWorldInverse ) camera.matrixWorldInverse.copy( camera.matrixWorld ).invert();
	_m.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
	if ( _hasPrev ) prevViewProj.value.copy( currViewProj );
	else prevViewProj.value.copy( _m );
	currViewProj.copy( _m );
	_hasPrev = true;

}

// Use the static velocity for every mesh under root.
export function useStaticVelocity( root ) {

	root.traverse( ( o ) => {

		o.staticVelocity = true;

	} );

}
