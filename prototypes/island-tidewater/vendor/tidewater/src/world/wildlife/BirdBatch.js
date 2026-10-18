import * as THREE from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';
import { StorageBuffer } from '../../engine/gpu/Texture.js';
import { SPECIES, buildBird } from './BirdShapes.js';
import { InstanceRecords, instancedMesh, kitModule } from './Kit.js';

// One instanced draw for every bird (gulls, terns, pelicans, frigatebirds, sanderlings), plus
// the near shadow cascade.
//
// Instance record (16 vec4), written by the simulations through write():
//   0 position, scale          1 body orientation     2-4 left wing: shoulder, elbow, wrist
//   5 head rotation            6 head offset, fold    7 left knee, tail pitch
//   8 left foot, tail spread   9 right knee, species  10 right foot, seed
//   11 previous position, scale   12 previous orientation   13-15 previous wing rotations
// Wing rotations are cumulative (shoulder, shoulder * elbow, shoulder * elbow * wrist) in the
// body frame; the right wing mirrors them. Knees / feet are in the body frame.

const REC = 16;

// WGSL: an sRGB-ish colour literal, linearised on the CPU (as the TSL version's srgb())
const f = ( x ) => {

	const t = String( + x.toFixed( 6 ) );
	return t.includes( '.' ) || t.includes( 'e' ) ? t : t + '.0';

};
const srgb = ( r, g, b ) => `vec3f( ${ f( Math.pow( r, 2.2 ) ) }, ${ f( Math.pow( g, 2.2 ) ) }, ${ f( Math.pow( b, 2.2 ) ) } )`;

export class BirdBatch {

	constructor( { csm = null, capacity = 160 } = {} ) {

		// ---- species rest shapes, one storage buffer (species-major)
		const built = SPECIES.map( ( sp ) => buildBird( sp ) );
		const NV = built[ 0 ].count;
		this.NV = NV;
		const sp = new Float32Array( SPECIES.length * NV * 16 );
		built.forEach( ( b, s ) => {

			for ( let i = 0; i < NV; i ++ ) {

				const o = ( s * NV + i ) * 16;
				sp.set( b.A.subarray( i * 4, i * 4 + 4 ), o );
				sp.set( b.B.subarray( i * 4, i * 4 + 4 ), o + 4 );
				sp.set( b.C.subarray( i * 4, i * 4 + 4 ), o + 8 );
				sp.set( b.D.subarray( i * 4, i * 4 + 4 ), o + 12 );

			}

		} );
		this.speciesBuffer = new StorageBuffer( { label: 'birdSpecies', count: SPECIES.length * NV * 4, type: 'vec4f', data: sp } );

		// joints per species: shoulder (+ leg radius), elbow, wrist, neck pivot, tail base, hip, eye
		const J = [];
		SPECIES.forEach( ( s, k ) => {

			const j = built[ k ].joints;
			J.push( new THREE.Vector4( ...j.S, s.legs.r ) );
			J.push( new THREE.Vector4( ...j.E, 0 ) );
			J.push( new THREE.Vector4( ...j.W, 0 ) );
			J.push( new THREE.Vector4( ...s.pivot, 0 ) );
			J.push( new THREE.Vector4( 0, s.tail.y, s.tail.z, 0 ) );
			J.push( new THREE.Vector4( ...s.legs.hip, 0 ) );
			J.push( new THREE.Vector4( 0, s.eye[ 1 ], s.eye[ 0 ], s.eye[ 2 ] ) );
			J.push( new THREE.Vector4() );

		} );
		this.joints = J;
		this.built = built;

		// ---- template geometry (species 0 as the nominal attributes)
		const g = new THREE.BufferGeometry();
		const p = new Float32Array( NV * 3 ), n = new Float32Array( NV * 3 );
		for ( let i = 0; i < NV; i ++ ) {

			p.set( built[ 0 ].C.subarray( i * 4, i * 4 + 3 ), i * 3 );
			n.set( [ 0, 1, 0 ], i * 3 );

		}

		g.setAttribute( 'position', new THREE.BufferAttribute( p, 3 ) );
		g.setAttribute( 'normal', new THREE.BufferAttribute( n, 3 ) );
		g.setIndex( built[ 0 ].index );

		this.records = new InstanceRecords( 'birdInstances', capacity, REC );
		this.material = this.createMaterial();
		this.mesh = instancedMesh( 'Birds', g, this.material, this.records, { csm, castShadow: true } );
		this.triangles = built[ 0 ].index.length / 3;

	}

	begin() {

		this.records.begin();

	}

	// b: pose (see Flight / pose helpers): pos, scale, q, QA, QB, QC, qH, headOff, fold, kneeL, footL,
	// kneeR, footR, tailPitch, tailSpread, species, seed, and the previous pos / scale / q / QA / QB / QC
	write( b ) {

		const o = this.records.push();
		if ( o < 0 ) return;
		const d = this.records.data;
		const v4 = ( k, a, w ) => {

			const i = o + k * 4;
			d[ i ] = a[ 0 ]; d[ i + 1 ] = a[ 1 ]; d[ i + 2 ] = a[ 2 ]; d[ i + 3 ] = w === undefined ? a[ 3 ] : w;

		};

		v4( 0, b.pos, b.scale );
		v4( 1, b.q );
		v4( 2, b.QA );
		v4( 3, b.QB );
		v4( 4, b.QC );
		v4( 5, b.qH );
		v4( 6, b.headOff, b.fold );
		v4( 7, b.kneeL, b.tailPitch );
		v4( 8, b.footL, b.tailSpread );
		v4( 9, b.kneeR, b.species );
		v4( 10, b.footR, b.seed );
		v4( 11, b.pPos, b.pScale );
		v4( 12, b.pQ );
		v4( 13, b.pQA );
		v4( 14, b.pQB );
		v4( 15, b.pQC );

	}

	commit() {

		this.records.commit();

	}

	get count() {

		return this.records.count;

	}

	createMaterial() {

		const R = this.records, NV = this.NV;
		const F = ( k ) => R.field( k );

		const mat = new Material( {
			name: 'Birds',
			roughness: 0.72, metalness: 0,
			underwaterLighting: 'none',
			modules: [ kitModule ],
			uniforms: { birdJoints: [ `vec4f[${ this.joints.length }]`, this.joints ] },
			storage: { birdInstances: R.buffer, birdSpecies: this.speciesBuffer },
			varyings: {
				vBirdRest: 'vec3f',
				vBirdRestN: 'vec3f',
				vBirdInfo: 'vec4f', // part, u, v, species + seed
				vBirdFold: 'f32',
			},
			vertex: /* wgsl */`
	let r0 = ${ F( 0 ) }; let q = ${ F( 1 ) }; let QA = ${ F( 2 ) }; let QB = ${ F( 3 ) }; let QC = ${ F( 4 ) };
	let qH = ${ F( 5 ) }; let r6 = ${ F( 6 ) }; let r7 = ${ F( 7 ) }; let r8 = ${ F( 8 ) }; let r9 = ${ F( 9 ) }; let r10 = ${ F( 10 ) };
	let p11 = ${ F( 11 ) }; let pq = ${ F( 12 ) }; let pQA = ${ F( 13 ) }; let pQB = ${ F( 14 ) }; let pQC = ${ F( 15 ) };
	let si = u32( r9.w + 0.5 );
	let base = ( si * ${ NV }u + v.vertex ) * 4u;
	let A = birdSpecies[ base ]; let B = birdSpecies[ base + 1u ];
	let C = birdSpecies[ base + 2u ]; let D = birdSpecies[ base + 3u ];
	let jb = si * 8u;
	let part = A.w;
	let fold = r6.w;

	var pl = vec3f( 0.0 ); var pp = vec3f( 0.0 ); var nl = vec3f( 0.0, 1.0, 0.0 );

	if ( part < 3.5 ) {

		// body, neck, head and bill: the head bone turns about the neck pivot
		let piv = mat.birdJoints[ jb + 3u ].xyz;
		let hp = piv + r6.xyz + rotateQ( qH, A.xyz - piv );
		let w = select( 0.0, B.w, part < 2.5 );
		pl = mix( hp, A.xyz, w );
		nl = mix( rotateQ( qH, B.xyz ), B.xyz, w );
		pp = pl;

	} else if ( part < 4.5 ) {

		// tail: spread about the centre line, pitched about the tail base
		let T = mat.birdJoints[ jb + 4u ].xyz;
		let d = ( A.xyz - T ) * vec3f( r8.w, 1.0, 1.0 );
		let c = cos( r7.w ); let s = sin( r7.w );
		pl = T + vec3f( d.x, d.y * c + d.z * s, d.z * c - d.y * s );
		nl = vec3f( B.x, B.y * c + B.z * s, B.z * c - B.y * s );
		pp = pl;

	} else if ( part < 7.5 ) {

		// wings: three bones, mirrored for the right wing, blended at the joints, and morphed
		// into the folded shape
		let side = sign( A.x );
		let mir = vec4f( 1.0, side, side, 1.0 );
		let sx = vec3f( side, 1.0, 1.0 );
		let S = mat.birdJoints[ jb ].xyz * sx; let E = mat.birdJoints[ jb + 1u ].xyz * sx; let Wj = mat.birdJoints[ jb + 2u ].xyz * sx;
		let seg = part - 5.0;
		// current pose (with normals)
		{
			let a = QA * mir; let b = QB * mir; let c = QC * mir;
			let Ep = S + rotateQ( a, E - S );
			let Wp = Ep + rotateQ( b, Wj - E );
			let pa = S + rotateQ( a, A.xyz - S );
			let pb = Ep + rotateQ( b, A.xyz - E );
			let pc = Wp + rotateQ( c, A.xyz - Wj );
			let p = select( select( mix( pc, pb, B.w ), mix( pb, pa, B.w ), seg < 1.5 ), pa, seg < 0.5 );
			let na = rotateQ( a, B.xyz ); let nb = rotateQ( b, B.xyz ); let nc = rotateQ( c, B.xyz );
			let n = select( select( mix( nc, nb, B.w ), mix( nb, na, B.w ), seg < 1.5 ), na, seg < 0.5 );
			pl = mix( p, C.xyz, fold );
			nl = mix( n, D.xyz, fold );
		}
		// previous pose
		{
			let a = pQA * mir; let b = pQB * mir; let c = pQC * mir;
			let Ep = S + rotateQ( a, E - S );
			let Wp = Ep + rotateQ( b, Wj - E );
			let pa = S + rotateQ( a, A.xyz - S );
			let pb = Ep + rotateQ( b, A.xyz - E );
			let pc = Wp + rotateQ( c, A.xyz - Wj );
			let p = select( select( mix( pc, pb, B.w ), mix( pb, pa, B.w ), seg < 1.5 ), pa, seg < 0.5 );
			pp = mix( p, C.xyz, fold );
		}

	} else {

		// legs: tube hip -> knee -> ankle, the foot at the ankle
		let side = A.x; let seg = A.y;
		let hip = mat.birdJoints[ jb + 5u ].xyz * vec3f( side, 1.0, 1.0 );
		let left = side > 0.0;
		let knee = select( r9.xyz, r7.xyz, left );
		let foot = select( r10.xyz, r8.xyz, left );
		let c = select( select( foot, knee, seg < 1.5 ), hip, seg < 0.5 );
		let d0 = select( select( foot - knee, foot - hip, seg < 1.5 ), knee - hip, seg < 0.5 );
		let dir = d0 / max( length( d0 ), 1e-5 );
		let ax = normalize( cross( dir, vec3f( 1.0, 0.0, 0.001 ) ) );
		let ay = cross( dir, ax );
		let radial = ax * B.x + ay * B.y;
		// collapsed legs (tucked in flight) vanish: the radius follows the leg's length
		let r = mat.birdJoints[ jb ].w * B.z * smoothstep( 0.0, 0.01, length( knee - hip ) + length( foot - knee ) );
		let ring = c + radial * r;
		let isFoot = seg > 2.5;
		pl = select( ring, foot + C.xyz * smoothstep( 0.0, 0.01, length( foot - knee ) ), isFoot );
		nl = select( radial, vec3f( 0.0, 1.0, 0.0 ), isFoot );
		pp = pl;

	}

	o.vBirdRest = select( A.xyz, C.xyz, part > 7.5 );
	o.vBirdRestN = B.xyz;
	o.vBirdInfo = vec4f( part, C.w, D.w, r9.w + fract( r10.w ) * 0.9 );
	o.vBirdFold = fold;

	let world = r0.xyz + rotateQ( q, pl * r0.w );
	let prev = p11.xyz + rotateQ( pq, pp * p11.w );
	v.useWorld = true;
	v.worldPos = world;
	v.worldNormal = rotateQ( q, nl );
	v.prevWorldPos = prev;
`,
			// ---- plumage, bills, legs, eyes
			surface: /* wgsl */`
	let vInfo = in.vs.vBirdInfo;
	let part = floor( vInfo.x + 0.5 );
	let u = vInfo.y; let v = abs( vInfo.z );
	let species = floor( vInfo.w ); let seed = fract( vInfo.w ) / 0.9;
	let P = in.vs.vBirdRest; let N = in.vs.vBirdRestN;
	let fold = in.vs.vBirdFold;
	let isBody = part < 2.5; let isBill = part == 3.0; let isTail = part == 4.0;
	let isWing = part > 4.5 && part < 7.5; let isLeg = part > 7.5;
	let top = N.y > 0.0;
	var c = vec3f( 0.5 );
	var rough = 0.72;
	var trans = select( 0.0, 0.35, isWing || isTail );
	// feather texture: fine noise in the rest frame (scaled to the bird's size)
	let fnz = mx_noise_float3( P * 160.0 );

	if ( species == 0.0 ) {

		// laughing gull: slate mantle and upperwing, black primaries with a white trailing
		// edge, white body and tail; breeding birds have a black hood, winter birds a grey smudge
		let white = ${ srgb( 0.93, 0.93, 0.92 ) }; let slate = ${ srgb( 0.38, 0.4, 0.43 ) }; let black = ${ srgb( 0.05, 0.05, 0.055 ) };
		let hooded = seed < 0.5;
		let mantle = smoothstep( 0.1, 0.45, N.y ) * smoothstep( -0.1, -0.07, P.z ) * smoothstep( 0.1, 0.075, P.z );
		let head = smoothstep( 0.1, 0.115, P.z );
		let eyeArc = smoothstep( 0.006, 0.004, length( vec2f( P.z - 0.139, P.y - 0.037 ) ) ) * smoothstep( 0.002, 0.004, length( vec2f( P.z - 0.141, P.y - 0.032 ) ) );
		let hood = select( head * smoothstep( 0.012, 0.004, length( vec2f( P.z - 0.126, P.y - 0.03 ) ) ) * 0.45, head * ( 1.0 - eyeArc ), hooded );
		let body = mix( mix( white, slate, mantle ), select( ${ srgb( 0.45, 0.45, 0.47 ) }, black, hooded ), hood );
		let tipK = smoothstep( 0.68, 0.76, u );
		let edge = smoothstep( 0.9, 0.97, v ) * ( 1.0 - tipK ) * ( 1.0 - fold );
		let wingTop = mix( mix( slate, white, edge ), black, tipK );
		let wingBot = mix( mix( white, ${ srgb( 0.72, 0.73, 0.75 ) }, smoothstep( 0.3, 0.9, u ) * 0.6 ), black, smoothstep( 0.78, 0.9, u ) );
		c = select( select( body, white, isTail ), select( wingBot, wingTop, top ), isWing );
		c = select( c, select( ${ srgb( 0.12, 0.08, 0.08 ) }, ${ srgb( 0.42, 0.07, 0.07 ) }, hooded ), isBill );
		c = select( c, ${ srgb( 0.16, 0.07, 0.07 ) }, isLeg );

	} else if ( species == 1.0 ) {

		// royal tern: pale grey mantle and upperwing with a dusky primary wedge, white body,
		// shaggy black crest behind a white forehead, orange bill, black legs
		let white = ${ srgb( 0.95, 0.95, 0.94 ) }; let grey = ${ srgb( 0.74, 0.77, 0.8 ) };
		let mantle = smoothstep( 0.15, 0.5, N.y ) * smoothstep( -0.095, -0.07, P.z ) * smoothstep( 0.1, 0.075, P.z );
		let cap = smoothstep( 0.108, 0.12, P.z ) * smoothstep( 0.158, 0.145, P.z ) * smoothstep( 0.028, 0.033, P.y );
		let body = mix( mix( white, grey, mantle ), ${ srgb( 0.04, 0.04, 0.045 ) }, cap );
		let wedge = smoothstep( 0.66, 0.8, u ) * ( smoothstep( 0.2, 0.0, v ) * 0.5 + 0.5 );
		let wingTop = mix( grey, ${ srgb( 0.32, 0.33, 0.35 ) }, wedge );
		let wingBot = mix( white, ${ srgb( 0.55, 0.56, 0.58 ) }, smoothstep( 0.82, 0.95, u ) * smoothstep( 0.4, 1.0, v ) );
		c = select( select( body, mix( white, grey, 0.3 ), isTail ), select( wingBot, wingTop, top ), isWing );
		c = select( c, ${ srgb( 0.95, 0.45, 0.1 ) }, isBill );
		c = select( c, ${ srgb( 0.05, 0.05, 0.05 ) }, isLeg );

	} else if ( species == 2.0 ) {

		// brown pelican: silvery grey-brown back, dark belly, cream-white head and neck
		// (chestnut hind neck in breeding birds), dark flight feathers, grey bill, dark pouch
		let back = mix( ${ srgb( 0.44, 0.42, 0.38 ) }, ${ srgb( 0.68, 0.67, 0.63 ) }, smoothstep( 0.0, 0.6, fnz ) * smoothstep( 0.0, 0.6, N.y ) );
		let belly = ${ srgb( 0.24, 0.22, 0.2 ) };
		let neckZone = smoothstep( 0.12, 0.17, P.z );
		let head = mix( ${ srgb( 0.92, 0.9, 0.82 ) }, ${ srgb( 0.95, 0.86, 0.55 ) }, smoothstep( 0.27, 0.3, P.z ) * smoothstep( 0.13, 0.15, P.y ) );
		let hindNeck = select( ${ srgb( 0.9, 0.88, 0.82 ) }, ${ srgb( 0.28, 0.14, 0.09 ) }, seed < 0.4 );
		let neckCol = mix( hindNeck, head, smoothstep( 0.2, 0.235, P.z ) );
		let body = mix( mix( belly, back, smoothstep( -0.35, 0.25, N.y ) ), mix( neckCol, head, smoothstep( 0.22, 0.25, P.z ) ), neckZone );
		let flight = max( smoothstep( 0.52, 0.6, u ), smoothstep( 0.45, 0.62, v ) * ( 1.0 - fold ) );
		let wingTop = mix( mix( ${ srgb( 0.56, 0.55, 0.51 ) }, ${ srgb( 0.72, 0.71, 0.67 ) }, ( fnz * 0.5 + 0.5 ) * 0.6 ), ${ srgb( 0.1, 0.09, 0.085 ) }, flight );
		let wingBot = mix( ${ srgb( 0.2, 0.19, 0.18 ) }, ${ srgb( 0.45, 0.44, 0.42 ) }, smoothstep( 0.2, 0.35, v ) * smoothstep( 0.6, 0.4, v ) * smoothstep( 0.6, 0.3, u ) );
		c = select( select( body, ${ srgb( 0.2, 0.19, 0.18 ) }, isTail ), select( wingBot, wingTop, top ), isWing );
		let pouch = smoothstep( 0.3, 0.38, v ) * smoothstep( 0.7, 0.62, v );
		c = select( c, mix( mix( ${ srgb( 0.58, 0.54, 0.5 ) }, ${ srgb( 0.75, 0.55, 0.45 ) }, smoothstep( 0.6, 1.0, u ) ), ${ srgb( 0.22, 0.21, 0.2 ) }, pouch ), isBill );
		c = select( c, ${ srgb( 0.12, 0.12, 0.12 ) }, isLeg );
		trans *= 0.5;

	} else if ( species == 3.0 ) {

		// magnificent frigatebird: black with a faint gloss; females a white breast and a
		// brown bar on the upperwing, juveniles a white head and breast; males a red throat
		let black = ${ srgb( 0.035, 0.035, 0.04 ) };
		let female = seed < 0.45; let juvenile = seed > 0.85;
		let breast = smoothstep( 0.2, -0.3, N.y ) * smoothstep( -0.06, 0.0, P.z ) * smoothstep( 0.14, 0.1, P.z );
		let headW = smoothstep( 0.13, 0.16, P.z );
		let white = ${ srgb( 0.9, 0.9, 0.88 ) };
		let body = mix( black, white, select( select( 0.0, breast, female ), max( breast, headW ), juvenile ) );
		let throat = smoothstep( 0.13, 0.16, P.z ) * smoothstep( 0.0, -0.5, N.y ) * select( 1.0, 0.0, female || juvenile );
		let bar = smoothstep( 0.08, 0.14, u ) * smoothstep( 0.45, 0.38, u ) * smoothstep( 0.12, 0.22, v ) * smoothstep( 0.5, 0.4, v ) * select( 0.4, 1.0, female || juvenile );
		let wingTop = mix( black, ${ srgb( 0.32, 0.25, 0.18 ) }, bar );
		c = select( select( mix( body, ${ srgb( 0.55, 0.06, 0.05 ) }, throat ), black, isTail ), select( black, wingTop, top ), isWing );
		c = select( c, ${ srgb( 0.5, 0.52, 0.56 ) }, isBill );
		c = select( c, ${ srgb( 0.35, 0.28, 0.28 ) }, isLeg );
		rough = 0.55;
		trans *= 0.3;

	} else {

		// sanderling (winter): pale grey above with dark feather centres, white below, dark
		// shoulder and primaries, bold white wing bar, black bill and legs
		let white = ${ srgb( 0.95, 0.95, 0.94 ) }; let grey = mix( ${ srgb( 0.62, 0.62, 0.6 ) }, ${ srgb( 0.48, 0.48, 0.47 ) }, smoothstep( 0.2, 0.7, fnz ) );
		let upper = smoothstep( -0.05, 0.35, N.y ) * max( smoothstep( 0.092, 0.08, P.z ), smoothstep( 0.2, 0.6, N.y ) );
		let body = mix( white, grey, upper );
		let bar = smoothstep( 0.18, 0.26, u ) * smoothstep( 0.78, 0.7, u ) * smoothstep( 0.42, 0.48, v ) * smoothstep( 0.66, 0.6, v ) * ( 1.0 - fold );
		let shoulder = smoothstep( 0.2, 0.3, u ) * smoothstep( 0.55, 0.45, u ) * smoothstep( 0.3, 0.1, v );
		let wingTop = mix( mix( mix( grey, ${ srgb( 0.12, 0.12, 0.12 ) }, smoothstep( 0.62, 0.72, u ) ), white, bar ), ${ srgb( 0.1, 0.1, 0.1 ) }, shoulder * 0.8 );
		c = select( select( body, mix( grey, ${ srgb( 0.2, 0.2, 0.2 ) }, smoothstep( 0.25, 0.0, abs( u - 0.5 ) ) ), isTail ), select( white, wingTop, top ), isWing );
		c = select( c, ${ srgb( 0.04, 0.04, 0.04 ) }, isBill || isLeg );

	}

	// eye: dark, with a pale iris for pelicans
	let eye = mat.birdJoints[ u32( species ) * 8u + 6u ];
	let ed = length( vec2f( P.z - eye.z, P.y - eye.y ) );
	let onHead = part < 2.5 && abs( P.x ) > 0.004;
	let iris = smoothstep( eye.w, eye.w * 0.8, ed ) * select( 0.0, 1.0, onHead );
	let pupil = smoothstep( eye.w * 0.6, eye.w * 0.45, ed ) * select( 0.0, 1.0, onHead );
	c = mix( mix( c, select( ${ srgb( 0.05, 0.03, 0.02 ) }, ${ srgb( 0.8, 0.75, 0.55 ) }, species == 2.0 ), iris ), ${ srgb( 0.01, 0.01, 0.01 ) }, pupil );
	rough = mix( select( rough, 0.4, isBill || isLeg ), 0.15, iris );
	// fine feather texture, darker feather bases toward the trailing edge of the wings
	c *= ( fnz * 0.06 + 1.0 ) * select( 1.0, mix( 1.0, 0.92, smoothstep( 0.5, 1.0, v ) * ( 1.0 - fold ) ), isWing );
	s.albedo = c;
	s.roughness = rough;
	// light through the thin wing and tail feathers when they are between the sun and the eye
	let back = sat( - dot( in.N, frame.sunDir ) );
	s.translucency = c * trans * ( back * 0.8 + 0.2 );
`,
		} );

		return mat;

	}

}
