import * as THREE from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';
import { StorageBuffer } from '../../engine/gpu/Texture.js';
import { ShaderModule } from '../../engine/gpu/Shader.js';
import { buildCritters, BODY_VERTS, LIMBS, CRITTER } from './CritterShapes.js';
import { InstanceRecords, instancedMesh, kitModule } from './Kit.js';

// One instanced draw for the beach critters: ghost crabs, hermit crabs and burrows.
//
// Instance record (6 vec4), written through write():
//   0 position (ground), scale     1 orientation
//   2 species, gait phase, stride (0 still .. 1 full), body lift
//   3 out (ghost crab: 0 down the burrow .. 1 out; hermit crab: 0 withdrawn .. 1 out), eyes up,
//     claws raised, seed
//   4 previous position, previous gait phase     5 previous orientation

const REC = 6;
// WGSL: an sRGB-ish colour literal, linearised on the CPU (as the TSL version's srgb())
const f = ( x ) => {

	const t = String( + x.toFixed( 6 ) );
	return t.includes( '.' ) || t.includes( 'e' ) ? t : t + '.0';

};
const srgb = ( r, g, b ) => `vec3f( ${ f( Math.pow( r, 2.2 ) ) }, ${ f( Math.pow( g, 2.2 ) ) }, ${ f( Math.pow( b, 2.2 ) ) } )`;

// tetrapod gait: legs 0, 2, 5, 7 swing together, 1, 3, 4, 6 half a cycle later
const GAIT = [ 0, Math.PI, 0, Math.PI, Math.PI, 0, Math.PI, 0 ];

export class CritterBatch {

	constructor( { capacity = 160 } = {} ) {

		const T = buildCritters();
		this.template = T;
		this.bodyBuffer = new StorageBuffer( { label: 'critterBodies', count: T.bodyData.length / 4, type: 'vec4f', data: T.bodyData } );
		this.limbs = T.limbs;
		this.records = new InstanceRecords( 'critterInstances', capacity, REC );
		this.material = this.createMaterial();
		this.mesh = instancedMesh( 'Critters', T.geometry, this.material, this.records, { castShadow: false } );
		this.triangles = T.triangles;

	}

	begin() {

		this.records.begin();

	}

	// c: { x, y, z, scale, q, species, phase, stride, lift, out, eyes, claws, seed, px, py, pz, pPhase, pq }
	write( c ) {

		const o = this.records.push();
		if ( o < 0 ) return;
		const d = this.records.data;
		d[ o ] = c.x; d[ o + 1 ] = c.y; d[ o + 2 ] = c.z; d[ o + 3 ] = c.scale;
		d[ o + 4 ] = c.q[ 0 ]; d[ o + 5 ] = c.q[ 1 ]; d[ o + 6 ] = c.q[ 2 ]; d[ o + 7 ] = c.q[ 3 ];
		d[ o + 8 ] = c.species; d[ o + 9 ] = c.phase; d[ o + 10 ] = c.stride; d[ o + 11 ] = c.lift;
		d[ o + 12 ] = c.out; d[ o + 13 ] = c.eyes; d[ o + 14 ] = c.claws; d[ o + 15 ] = c.seed;
		d[ o + 16 ] = c.px; d[ o + 17 ] = c.py; d[ o + 18 ] = c.pz; d[ o + 19 ] = c.pPhase;
		d[ o + 20 ] = c.pq[ 0 ]; d[ o + 21 ] = c.pq[ 1 ]; d[ o + 22 ] = c.pq[ 2 ]; d[ o + 23 ] = c.pq[ 3 ];

	}

	commit() {

		this.records.commit();

	}

	get count() {

		return this.records.count;

	}

	createMaterial() {

		const R = this.records;
		const F = ( k ) => R.field( k );
		const gait = GAIT.map( ( g ) => new THREE.Vector4( g, 0, 0, 0 ) );

		// joints of limb k for gait phase ph: j0 (at the body) .. j3 (tip)
		const helpers = new ShaderModule( {
			name: 'critterJoints',
			deps: [ kitModule ],
			code: /* wgsl */`
struct CritterJoints { j0: vec3f, j1: vec3f, j2: vec3f, j3: vec3f, r: f32 };

fn critterDir( az: f32, el: f32 ) -> vec3f { return vec3f( cos( az ) * cos( el ), sin( el ), sin( az ) * cos( el ) ); }

fn critterJoints( si: u32, k: u32, ph: f32, stride: f32, lift: f32, outK: f32, eyes: f32, claws: f32 ) -> CritterJoints {
	let a = mat.critterLimbs[ si * ${ LIMBS * 2 }u + k * 2u ];
	let L = mat.critterLimbs[ si * ${ LIMBS * 2 }u + k * 2u + 1u ];
	let kf = f32( k );
	let isLeg = kf < 7.5; let isClaw = kf > 7.5 && kf < 9.5;
	let side = select( -1.0, 1.0, a.x > 0.0 );
	let p = ph + mat.critterGait[ min( k, 7u ) ].x;
	let swing = max( sin( p ), 0.0 ) * stride;
	let az = a.w + cos( p ) * stride * 0.28 * select( 0.0, 1.0, isLeg );
	let j0 = vec3f( a.x, a.y + lift, a.z );
	var j1 = vec3f( 0.0 ); var j2 = vec3f( 0.0 ); var j3 = vec3f( 0.0 );
	if ( isLeg ) {
		// merus up and out, carpus level, dactyl reaching down to the ground
		j1 = j0 + critterDir( az, 0.62 + swing * 0.22 ) * L.x;
		j2 = j1 + critterDir( az, -0.15 + swing * 0.15 ) * L.y;
		let e3 = asin( clamp( - j2.y / max( L.z, 1e-4 ), -0.99, -0.25 ) ) + swing * 0.25;
		j3 = j2 + critterDir( az, e3 ) * L.z;
	} else if ( isClaw ) {
		// chelipeds folded in front of the mouth, lifted when feeding / threatening
		let inward = side * 0.95;
		j1 = j0 + critterDir( az, -0.35 + claws * 0.5 ) * L.x;
		j2 = j1 + critterDir( az + inward, 0.25 + claws * 0.6 ) * L.y;
		j3 = j2 + critterDir( az + inward * 1.55, -0.25 + claws * 0.4 ) * L.z;
	} else {
		// eyestalks: up when alert, folded along the front edge when running for the burrow
		let el = mix( 0.05, 1.3, eyes );
		j1 = j0 + critterDir( az, el * 0.8 ) * L.x;
		j2 = j1 + critterDir( az, el ) * L.y;
		j3 = j2;
	}
	// hermit crabs pull everything back into the aperture
	let hole = vec3f( 0.0, lift + 0.32, 0.5 );
	let isHermit = si == ${ CRITTER.HERMIT }u;
	let k2 = select( 1.0, outK, isHermit );
	var J: CritterJoints;
	J.j0 = mix( hole, j0, k2 ); J.j1 = mix( hole, j1, k2 ); J.j2 = mix( hole, j2, k2 ); J.j3 = mix( hole, j3, k2 );
	J.r = L.w * select( 1.0, outK * 0.7 + 0.3, isHermit );
	return J;
}

// a vertex of limb k at ( segment, t, radius ) around the segment; returns position (xyz) and
// writes the normal
fn critterLimbVertex( J: CritterJoints, seg: f32, t: f32, rs: f32, ring: vec2f, n: ptr<function, vec3f> ) -> vec3f {
	let a = select( select( J.j2, J.j1, seg < 1.5 ), J.j0, seg < 0.5 );
	let b = select( select( J.j3, J.j2, seg < 1.5 ), J.j1, seg < 0.5 );
	let d0 = b - a;
	let d = d0 / max( length( d0 ), 1e-5 );
	let rf = select( vec3f( 0.0, 1.0, 0.0 ), vec3f( 1.0, 0.0, 0.0 ), abs( d.y ) > 0.9 );
	let ax = normalize( cross( d, rf ) );
	let ay = cross( ax, d );
	let radial = ax * ring.x + ay * ring.y;
	*n = normalize( radial + d * select( 0.0, 1.0, rs < 0.01 ) );
	return mix( a, b, t ) + radial * ( J.r * rs );
}
`,
		} );

		const mat = new Material( {
			name: 'Critters',
			roughness: 0.6, metalness: 0,
			underwaterLighting: 'none',
			modules: [ kitModule, helpers ],
			uniforms: {
				critterLimbs: [ `vec4f[${ this.limbs.length }]`, this.limbs ],
				critterGait: [ 'vec4f[8]', gait ],
			},
			storage: { critterInstances: R.buffer, critterBodies: this.bodyBuffer },
			attributes: { aLimb: 'vec4f', aRing: 'vec2f' },
			varyings: {
				vCritInfo: 'vec4f', // part (0 body, 1 leg, 2 claw, 3 eye), u, v, species + seed
				vCritLocal: 'vec3f',
			},
			vertex: /* wgsl */`
	let r0 = ${ F( 0 ) }; let q = ${ F( 1 ) }; let r2 = ${ F( 2 ) }; let r3 = ${ F( 3 ) }; let p4 = ${ F( 4 ) }; let pq = ${ F( 5 ) };
	let si = u32( r2.x + 0.5 );
	let lift = r2.w; let outK = r3.x;
	var pl = vec3f( 0.0 ); var pp = vec3f( 0.0 ); var nl = vec3f( 0.0, 1.0, 0.0 );
	var info = vec4f( 0.0 );
	let k = v.aLimb.x;

	if ( k < 0.0 ) {

		// body grid: carapace / shell (lifted on the legs) or the burrow mound
		let base = ( si * ${ BODY_VERTS }u + v.vertex ) * 2u;
		let A = critterBodies[ base ]; let B = critterBodies[ base + 1u ];
		let up = select( lift, 0.0, si == ${ CRITTER.BURROW }u );
		pl = A.xyz + vec3f( 0.0, up, 0.0 );
		nl = B.xyz;
		pp = pl;
		info = vec4f( 0.0, A.w, B.w, 0.0 );

	} else {

		let ki = u32( k );
		let J = critterJoints( si, ki, r2.y, r2.z, lift, outK, r3.y, r3.z );
		var n = vec3f( 0.0 );
		pl = critterLimbVertex( J, v.aLimb.y, v.aLimb.z, v.aLimb.w, v.aRing, &n );
		nl = n;
		let Jp = critterJoints( si, ki, p4.w, r2.z, lift, outK, r3.y, r3.z );
		var np = vec3f( 0.0 );
		pp = critterLimbVertex( Jp, v.aLimb.y, v.aLimb.z, v.aLimb.w, v.aRing, &np );
		let part = select( select( 3.0, 2.0, k < 9.5 ), 1.0, k < 7.5 );
		info = vec4f( part, v.aLimb.y + v.aLimb.z, v.aLimb.w, 0.0 );

	}

	// ghost crabs sink into their burrow (the sand hides what is below)
	let sink = select( 0.0, ( 1.0 - outK ) * 1.3, si == ${ CRITTER.GHOST }u );
	pl.y -= sink;
	pp.y -= sink;
	o.vCritLocal = pl;
	o.vCritInfo = vec4f( info.xyz, r2.x + fract( r3.w ) * 0.9 );
	let world = r0.xyz + rotateQ( q, pl * r0.w );
	let prev = p4.xyz + rotateQ( pq, pp * r0.w );
	v.useWorld = true;
	v.worldPos = world;
	v.worldNormal = rotateQ( q, nl );
	v.prevWorldPos = prev;
`,
			surface: /* wgsl */`
	let vInfo = in.vs.vCritInfo;
	let part = floor( vInfo.x + 0.5 );
	let u = vInfo.y; let v = vInfo.z;
	let species = floor( vInfo.w ); let seed = fract( vInfo.w ) / 0.9;
	let P = in.vs.vCritLocal;
	let n = mx_noise_float3( P * 14.0 + seed * 17.0 );
	var c = vec3f( 0.5 );
	var rough = 0.6;

	if ( species == ${ f( CRITTER.GHOST ) } ) {

		// ghost crab: pale straw carapace with fine granules, whitish legs and claws, black
		// club-shaped eyes on the stalks
		let straw = mix( ${ srgb( 0.8, 0.73, 0.58 ) }, ${ srgb( 0.88, 0.83, 0.7 ) }, n * 0.5 + 0.5 );
		let body = straw * mix( 0.86, 1.04, smoothstep( 0.0, 0.18, P.y ) );
		let legs = mix( ${ srgb( 0.86, 0.82, 0.72 ) }, ${ srgb( 0.7, 0.62, 0.5 ) }, smoothstep( 0.8, 1.0, fract( u ) ) * 0.5 );
		let claw = mix( ${ srgb( 0.9, 0.87, 0.8 ) }, ${ srgb( 0.78, 0.7, 0.75 ) }, smoothstep( 1.6, 2.3, u ) );
		let eye = mix( ${ srgb( 0.8, 0.75, 0.62 ) }, ${ srgb( 0.04, 0.04, 0.045 ) }, smoothstep( 1.25, 1.4, u ) );
		c = select( select( select( eye, claw, part == 2.0 ), legs, part == 1.0 ), body, part == 0.0 );
		rough = select( 0.55, 0.15, part == 3.0 && u > 1.3 );

	} else if ( species == ${ f( CRITTER.HERMIT ) } ) {

		// hermit crab: turban shell (banded / mottled / chequered by seed), red-orange legs
		// with pale tips, a purple claw; the aperture shows the crab's dark body
		let turns = u + v * 3.2; // spiral: sutures along u + v * turns
		let suture = smoothstep( 0.9, 0.97, fract( turns ) ) * smoothstep( 0.05, 0.3, v );
		let kind = floor( fract( seed * 3.7 ) * 3.0 );
		let c1 = select( select( ${ srgb( 0.85, 0.8, 0.7 ) }, ${ srgb( 0.72, 0.42, 0.2 ) }, kind == 1.0 ), ${ srgb( 0.9, 0.86, 0.78 ) }, kind == 0.0 );
		let c2 = select( select( ${ srgb( 0.55, 0.35, 0.22 ) }, ${ srgb( 0.35, 0.18, 0.08 ) }, kind == 1.0 ), ${ srgb( 0.12, 0.11, 0.1 ) }, kind == 0.0 );
		let bands = select(
			smoothstep( 0.2, 0.8, sin( v * 31.0 + n * 2.0 ) ),
			smoothstep( 0.3, 0.7, sin( u * ${ f( 6.2832 * 7 ) } + sin( v * 40.0 ) * 1.5 ) ), // zigzag
			kind == 0.0 );
		let shellC = mix( c1, c2, bands * 0.8 ) * ( 1.0 - suture * 0.5 ) * ( n * 0.12 + 0.94 );
		let aperture = smoothstep( 0.86, 0.93, v );
		let body = mix( shellC, ${ srgb( 0.35, 0.12, 0.08 ) }, aperture );
		let legs = mix( ${ srgb( 0.72, 0.28, 0.12 ) }, ${ srgb( 0.9, 0.78, 0.6 ) }, smoothstep( 2.6, 3.0, u ) );
		let claw = mix( ${ srgb( 0.42, 0.14, 0.4 ) }, ${ srgb( 0.85, 0.5, 0.2 ) }, smoothstep( 2.5, 3.1, u ) );
		c = select( select( select( ${ srgb( 0.1, 0.08, 0.06 ) }, claw, part == 2.0 ), legs, part == 1.0 ), body, part == 0.0 );
		rough = select( 0.5, 0.45, part == 0.0 );

	} else {

		// burrow: dark shaft, damp dug-out sand around the lip, loose clumps fanned out; the
		// rim fades into the beach
		let dry = ${ srgb( 0.86, 0.79, 0.64 ) } * ( n * 0.1 + 0.95 );
		let damp = ${ srgb( 0.66, 0.58, 0.45 ) };
		let clumps = smoothstep( 0.35, 0.55, mx_noise_float3( P * 38.0 + seed * 5.0 ) );
		let sand = mix( mix( damp, dry, smoothstep( 0.4, 0.75, v ) ), dry * 1.06, clumps * 0.5 );
		let hole = smoothstep( 0.36, 0.2, v );
		c = mix( sand, ${ srgb( 0.035, 0.03, 0.025 ) }, hole );
		rough = 0.9;
		// dithered fade at the outer edge (resolved by the temporal filter)
		let fade = smoothstep( 1.0, 0.72, v );
		let noise = interleavedGradientNoise( in.pixel + fract( frame.time * 7.13 ) * 97.0 );
		if ( noise > fade ) { discard; }

	}

	s.albedo = c;
	s.roughness = rough;
`,
		} );

		return mat;

	}

}
