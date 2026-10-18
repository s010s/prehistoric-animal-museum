import * as THREE from '../engine/index.js';
import { Material } from '../engine/render/Material.js';

// Seagulls soaring over the bay: each bird circles its own thermal, banking into the turn, with
// occasional flapping bursts and the characteristic bent ("M") wing. Everything is animated in
// the vertex shader from time and per-instance parameters (no CPU work per frame).
export class Gulls {

	constructor( { scene, count = 18, center = new THREE.Vector3( 35, 0, - 10 ), spread = 140, seed = 7 } ) {

		let s = seed >>> 0;
		const rand = () => ( ( s = Math.imul( s ^ ( s >>> 15 ), 2246822519 ) + 0x6D2B79F5 >>> 0 ) / 4294967296 );

		const geo = gullGeometry();
		// per instance: (cx, cz, radius, height) (phase, speed, flapSeed, dir)
		const a = new Float32Array( count * 4 ), b = new Float32Array( count * 4 );
		for ( let i = 0; i < count; i ++ ) {

			a.set( [ center.x + ( rand() - 0.5 ) * spread, center.z + ( rand() - 0.5 ) * spread * 0.8, 14 + rand() * 36, 9 + rand() * 24 ], i * 4 );
			b.set( [ rand() * Math.PI * 2, 8 + rand() * 4, rand() * 100, rand() < 0.5 ? - 1 : 1 ], i * 4 );

		}

		geo.setAttribute( 'gA', new THREE.InstancedBufferAttribute( a, 4 ) );
		geo.setAttribute( 'gB', new THREE.InstancedBufferAttribute( b, 4 ) );

		// velocity: camera motion only (the TSL version used staticVelocityMRT): the engine's
		// previous position defaults to the current one for a displaced vertex
		const mat = new Material( {
			name: 'Gull',
			roughness: 0.75, metalness: 0,
			vertexColors: true,
			underwaterLighting: 'none',
			// gSide: -1 left wing, 1 right wing, 0 body; gSpan: 0 at the shoulder .. 1 at the wing tip
			attributes: { gA: 'vec4f', gB: 'vec4f', gSide: 'f32', gSpan: 'f32' },
			vertex: /* wgsl */`
	let gA = v.gA; let gB = v.gB; let side = v.gSide; let span = v.gSpan;
	let t = frame.time;
	// flight state at time t
	let R = gA.z; let dir = gB.w;
	let th = gB.x + t * gB.y / R * dir;
	let stP = vec3f( gA.x + cos( th ) * R, gA.w + sin( th * 2.0 + gB.z ) * 3.0, gA.y + sin( th ) * R );
	// flight direction (tangent) and bank into the turn
	let fwd = vec3f( - sin( th ) * dir, 0.0, cos( th ) * dir );
	let bank = dir * -0.45;
	// flapping bursts: a slow gate turns wing beats (3 Hz) on and off; gliding otherwise
	let gate = smoothstep( 0.55, 0.8, sin( t * 0.23 + gB.z ) * 0.5 + 0.5 );
	let beat = sin( t * ${ ( 3.1 * 2 * Math.PI ).toFixed( 6 ) } + gB.z * 7.0 );
	let lift = gate * beat * 0.55 + 0.08; // radians at the shoulder
	var p = v.position;
	// wing: rotate about the body axis at the shoulder, the outer wing bends further
	let ang = lift * ( span * 0.6 + 0.4 ) + span * span * ( ( 1.0 - gate ) * -0.18 );
	let ax = abs( p.x );
	let y = p.y + ax * sin( ang );
	let x = p.x * cos( ang );
	p = vec3f( select( p.x, x, side != 0.0 ), select( p.y, y, side != 0.0 ), p.z );
	// bank (roll around the flight axis), then orient along the flight direction
	let cb = cos( bank ); let sb = sin( bank );
	let rolled = vec3f( p.x * cb - p.y * sb, p.x * sb + p.y * cb, p.z );
	let f = fwd;
	let r = vec3f( f.z, 0.0, - f.x );
	v.position = stP + r * rolled.x + vec3f( 0.0, rolled.y, 0.0 ) + f * rolled.z;
`,
		} );

		geo.instanceCount = count;
		this.mesh = new THREE.Mesh( geo, mat );
		this.mesh.name = 'Gulls';
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = false;
		scene.add( this.mesh );

	}

}

// ~1.3 m wingspan gull: slim body, bent wings with grey mantle and black tips, white underside
function gullGeometry() {

	const pos = [], col = [], side = [], span = [], idx = [];
	const white = [ 0.92, 0.92, 0.9 ], grey = [ 0.55, 0.58, 0.62 ], black = [ 0.06, 0.06, 0.07 ], bill = [ 0.85, 0.7, 0.2 ];
	const v = ( x, y, z, c, s, sp ) => {

		pos.push( x, y, z );
		col.push( ...c );
		side.push( s );
		span.push( sp );
		return pos.length / 3 - 1;

	};

	// body: two diamonds (top grey-white, bottom white) along z
	const nose = v( 0, 0.01, 0.26, bill, 0, 0 ), tail = v( 0, 0.0, - 0.24, white, 0, 0 );
	const lt = v( - 0.045, 0.03, 0.02, white, 0, 0 ), rt = v( 0.045, 0.03, 0.02, white, 0, 0 );
	const lb = v( - 0.04, - 0.03, 0.02, white, 0, 0 ), rb = v( 0.04, - 0.03, 0.02, white, 0, 0 );
	idx.push( nose, rt, lt, nose, lb, rb, nose, lt, lb, nose, rb, rt, tail, lt, rt, tail, rb, lb, tail, lb, lt, tail, rt, rb );

	// wings: shoulder -> elbow -> tip, leading/trailing edges (top grey, tip black)
	for ( const s of [ - 1, 1 ] ) {

		const ls = v( s * 0.04, 0.02, 0.07, grey, s, 0 ), ts = v( s * 0.04, 0.02, - 0.08, grey, s, 0 );
		const le = v( s * 0.32, 0.05, 0.05, grey, s, 0.5 ), te = v( s * 0.32, 0.05, - 0.09, grey, s, 0.5 );
		const tip = v( s * 0.66, 0.0, - 0.06, black, s, 1 ), tt = v( s * 0.55, 0.01, - 0.1, black, s, 0.85 );
		if ( s > 0 ) idx.push( ls, le, ts, ts, le, te, le, tip, te, te, tip, tt );
		else idx.push( ls, ts, le, ts, te, le, le, te, tip, te, tt, tip );

	}

	const g = new THREE.BufferGeometry();
	g.setIndex( idx );
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'color', new THREE.Float32BufferAttribute( col, 3 ) );
	g.setAttribute( 'gSide', new THREE.Float32BufferAttribute( side, 1 ) );
	g.setAttribute( 'gSpan', new THREE.Float32BufferAttribute( span, 1 ) );
	g.computeVertexNormals();
	return g;

}
