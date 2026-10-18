import * as THREE from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';
import { LAYERS } from '../../core/SceneRenderer.js';
import { InstanceRecords, instancedMesh } from './Kit.js';

// Soft contact shadows under the small animals on the ground. Crabs and sanderlings are only a
// few centimetres tall: the sun shadow map (and its normal bias) can't resolve them, and without
// a shadow they seem to hover. One instanced quad each, drawn in the late (transparent) pass and
// darkening what is below (premultiplied black; the velocity target is left untouched): a round
// occlusion blob right under the body plus a sun shadow stretched away from the key light.
//
// Record (2 vec4): ( ground position, radius ), ( height of the body above the ground, darkness,
// ground slope dh/dx, dh/dz ) - the quad lies on the local slope

export class ShadowBlobs {

	constructor( { capacity = 160 } = {} ) {

		this.records = new InstanceRecords( 'blobInstances', capacity, 2 );
		const R = this.records;
		const g = new THREE.PlaneGeometry( 2, 2 );
		g.rotateX( - Math.PI / 2 );
		const F = ( k ) => R.field( k );

		// premultiplied black: the blend darkens what is below; velocity weight 0 keeps the motion
		// of what is below (the TSL version wrote velocity 0 through the MRT with no blending)
		const mat = new Material( {
			name: 'ContactShadows',
			lit: false,
			transparent: true,
			blending: 'premultiplied',
			depthWrite: false,
			velocityWeight: 0,
			storage: { blobInstances: R.buffer },
			varyings: { vBlobUV: 'vec2f', vBlobInfo: 'vec4f' },
			vertex: /* wgsl */`
	let r0 = ${ F( 0 ) }; let r1 = ${ F( 1 ) };
	// the quad covers the blob and its sun shadow (offset away from the light, stretched)
	let L = frame.sunDir;
	let lh = max( length( L.xz ), 1e-3 );
	let dir = - L.xz / lh;
	let reach = min( r1.x * lh / max( L.y, 0.12 ), r0.w * 4.0 );
	let p = v.position;
	let side = vec2f( dir.y, - dir.x ); // (keeps the winding: the quad faces up)
	let s = r0.w * 1.6;
	let along = p.z * ( s + reach * 0.5 ) + reach * 0.5;
	let xz = r0.xz + dir * along + side * ( p.x * s );
	o.vBlobUV = vec2f( along, p.x * s );
	o.vBlobInfo = vec4f( r0.w, reach, r1.y, L.y );
	let off = xz - r0.xz;
	v.useWorld = true;
	v.worldPos = vec3f( xz.x, r0.y + off.x * r1.z + off.y * r1.w + 0.012, xz.y );
	v.worldNormal = vec3f( 0.0, 1.0, 0.0 );
`,
			surface: /* wgsl */`
	let vUV = in.vs.vBlobUV; let vInfo = in.vs.vBlobInfo;
	let r = vInfo.x; let reach = vInfo.y; let dark = vInfo.z;
	let q = vUV / r;
	// occlusion right below, the sun shadow stretched along the light
	let ao = exp( dot( q, q ) * -2.2 ) * 0.55;
	let t = clamp( vUV.x / max( reach, 1e-3 ), 0.0, 1.0 );
	let c = vec2f( vUV.x - reach * t, vUV.y ) / r;
	let sun = exp( dot( c, c ) * -1.6 ) * 0.6 * select( 0.0, 1.0, vInfo.w > 0.0 );
	s.albedo = vec3f( 0.0 );
	s.emissive = vec3f( 0.0 );
	s.alpha = max( ao, sun ) * dark * ( ( 1.0 - frame.night ) * 0.6 + 0.4 );
`,
		} );

		this.material = mat;
		this.mesh = instancedMesh( 'ContactShadows', g, mat, R, {} );
		this.mesh.castShadow = false;
		this.mesh.receiveShadow = false;
		this.mesh.layers.set( LAYERS.TRANSPARENT );
		this.mesh.renderOrder = - 1;

	}

	begin() {

		this.records.begin();

	}

	// ground slope: dh/dx, dh/dz at the blob (the quad follows it)
	add( x, y, z, radius, height, darkness = 1, sx = 0, sz = 0 ) {

		const o = this.records.push();
		if ( o < 0 ) return;
		const d = this.records.data;
		d[ o ] = x; d[ o + 1 ] = y; d[ o + 2 ] = z; d[ o + 3 ] = radius;
		d[ o + 4 ] = height; d[ o + 5 ] = darkness; d[ o + 6 ] = sx; d[ o + 7 ] = sz;

	}

	commit() {

		this.records.commit();

	}

}
