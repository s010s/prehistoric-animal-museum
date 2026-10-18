import { Vector3, Vector4, Matrix4, Sphere, PlaneGeometry, InstancedBufferGeometry, BufferAttribute, Mesh } from '../engine/index.js';
import {
	GPU, UniformBlock, Texture, StorageBuffer, ShaderModule, ComputeKernel, Material, generateMipmaps, commonModule,
} from '../engine/webgpu.js';
import { GRAVITY } from '../core/Globals.js';
import { LAYERS } from '../core/SceneRenderer.js';

// GPU spray particles: drops, ligaments, dense spray and mist.
//
// One storage ring buffer. The first part is written by GPU emitters (breaking waves) through an
// atomic head; the tail is owned by the CPU emit API (boat bow spray, splashes), whose requests
// are expanded by the update kernel into the slots the CPU reserved. Particles are integrated with
// gravity + drag toward the air around them (the wind; for mist first the air pushed along by the
// wave) and die when they fall back into the water, where they leave foam (ShoreSim deposit).
//
// Rendering (soft camera-facing sprites, premultiplied alpha):
//  * drops and ligaments are clear water: sub-pixel drops are drawn as motion-blurred streaks whose
//    opacity conserves the drop's cross-section (a drop covering 1/10 of a pixel for 1/5 of the
//    exposure adds 1/50 of its colour), so their visual weight is the amount of water; they show the
//    bright sky they refract, a tiny sun glint, and light up strongly when backlit (forward lobe)
//  * dense spray (clouds of drops) is white from every side (multiple scattering), with a forward
//    lobe and its own shadow on the far side
//  * mist is a thin, strongly forward-scattering, sky-tinted veil
//  * clear sheets (a boat's bow sheet) are thin water: translucent, showing the sky, glowing when
//    backlit, torn into strands and drop clusters as they age
//  * all of it is darkened in the shadow of the wave that made it, of the clouds, and at night
//
// Particles collide with one moving body (the boat, setBody): its hull (plan outline with an
// elliptic bow, up to the sheer) and one box (the wheelhouse). They are pushed out through the
// nearest face, lose the velocity into it (relative to the body), and drops that hit it run off.
//
// WGSL (this.module, prefix `spray`; storage bindings read_write: compute shaders only). GPU
// emitters (Breakers) reserve ring slots and write particles:
//   fn sprayReserve( n: u32 ) -> u32                     atomic add on the GPU head, returns the base
//   fn spraySlot( base: u32, i: u32 ) -> u32              ring slot of the i-th reserved particle
//   fn sprayWrite( slot: u32, p: vec3f, v: vec3f, size: f32, kind: f32, life: f32, seed: f32 )
//   fn sprayRand( a: u32, b: u32 ) -> f32                 hash with this frame's seed, [0, 1)
//   const SPRAY_DROPLET / SPRAY_MIST / SPRAY_LIGAMENT / SPRAY_SPRAY / SPRAY_SHEET: f32
//   (the TSL emitNode( n, init ) loop becomes: let base = sprayReserve( n );
//    for ( var i = 0u; i < n; i++ ) { let slot = spraySlot( base, i ); ... sprayWrite( slot, ... ); })
// Consumes: waterQueryHeightAtXZ( xz ) (query.module), terrainHeightAt( xz ) (terrain.module),
// cloudsShadow( xz ) (clouds.module, optional), shoreSimDepositAt( xz, n ) (shoreSim.depositModule,
// optional), breakersSprayShadow( p, tag ) (the `waveShadow` module, optional). The optional hooks
// are resolved when the kernel / material are first built (first update() / first draw).

export const SPRAY = { DROPLET: 0, MIST: 1, LIGAMENT: 2, SPRAY: 3, SHEET: 4 };

// per-kind constants: droplet (a drop of a few mm, ballistic), mist (fine drops that follow the air),
// ligament (an elongated blob of water, ~1-2 cm, torn off a sheet or jet), spray (a cloud of drops:
// the white of splashes), sheet (a thin clear sheet of water peeling off a hull, spreading and tearing)
const KIND = {
	tau: [ 3.0, 0.35, 5.0, 1.8, 2.5 ], // drag time constant toward the air velocity (s): ~ drop size^2
	grav: [ GRAVITY, 0.3, GRAVITY, 8.5, GRAVITY ], // effective gravity (mist barely settles; torn sheets fall back)
	turb: [ 0, 0.5, 0, 0.3, 0.1 ], // turbulent wander (m/s^2, zero mean)
	grow: [ 0, 0.22, 0, 0.3, 0.7 ], // size growth (1/s)
	dies: [ 1, 0, 1, 1, 1 ], // killed when falling into the water (else skims over it)
	deposit: [ 1, 0, 3, 4, 2 ], // foam left where it falls into the water (drops' worth)
	stretch: [ 1 / 40, 0, 1 / 40, 1 / 30, 1 / 60 ], // motion blur (s of travel)
	alpha: [ 0.55, 0.06, 0.8, 0.66, 0.22 ], // (dense spray: see-through, streaked by its motion, never cotton wool)
	fadeIn: [ 0.02, 0.2, 0.02, 0.12, 0.02 ], // (dense spray blooms out of the splash instead of popping in)
	fadeOut: [ 0.8, 0.45, 0.8, 0.7, 0.5 ], // fraction of life when it starts to fade
};

const fl = ( x ) => {

	const s = String( x );
	return /[.e]/.test( s ) ? s : s + '.0';

};

// select a per-kind constant (WGSL expression)
const byKind = ( kind, arr ) => `sprayByKind( ${ kind }, ${ arr.map( fl ).join( ', ' ) } )`;

const MAX_REQUESTS = 32;

// helpers shared by the kernels and the sprite material (no bindings)
const sprayCommon = new ShaderModule( {
	name: 'sprayCommon',
	deps: [ commonModule ],
	code: /* wgsl */`
const SPRAY_DROPLET: f32 = 0.0;
const SPRAY_MIST: f32 = 1.0;
const SPRAY_LIGAMENT: f32 = 2.0;
const SPRAY_SPRAY: f32 = 3.0;
const SPRAY_SHEET: f32 = 4.0;

// PCG hash of a uint -> [0, 1)
fn sprayHash( seed: u32 ) -> f32 {
	let state = seed * 747796405u + 2891336453u;
	let word = ( ( state >> ( ( state >> 28u ) + 4u ) ) ^ state ) * 277803737u;
	return f32( ( word >> 22u ) ^ word ) * ( 1.0 / 4294967296.0 );
}

// select a per-kind constant
fn sprayByKind( kind: f32, a: f32, b: f32, c: f32, d: f32, e: f32 ) -> f32 {
	return select( select( select( select( e, d, kind < 3.5 ), c, kind < 2.5 ), b, kind < 1.5 ), a, kind < 0.5 );
}

// Henyey-Greenstein phase (1/sr)
fn sprayPhaseHG( cosT: f32, g: f32 ) -> f32 {
	let g2 = g * g;
	return ( ( 1.0 - g2 ) / ( 4.0 * PI ) ) / pow( max( 1.0 + g2 - 2.0 * g * cosT, 1e-4 ), 1.5 );
}
`,
} );

export class Spray {

	constructor( renderer, { query, terrain, sceneCopy, clouds = null, gpuCapacity = 32768, cpuCapacity = 8192 } ) {

		this.renderer = renderer;
		this.query = query;
		this.terrain = terrain;
		this.clouds = clouds;
		// optional hooks, resolved when the shaders are first built:
		//   shoreSim: drops falling into the surf zone leave foam there (shoreSim.depositModule:
		//     fn shoreSimDepositAt( xz: vec2f, n: u32 ))
		//   waveShadow: ShaderModule with fn breakersSprayShadow( p: vec3f, tag: f32 ) -> f32, the sun
		//     visibility for particles made by a breaking wave (Breakers)
		this.shoreSim = null;
		this.waveShadow = null;
		this.NG = gpuCapacity; // power of two (ring index wraps with the uint head)
		this.NC = cpuCapacity;
		this.N = gpuCapacity + cpuCapacity;

		const N = this.N;
		// pos: xyz, age (s) | vel: xyz, radius (m) | info: kind, life (s, 0 = dead), water height, tag
		// (tag: fraction = random seed, integer part = which breaking crest made it, 0 = none)
		this.pos = new StorageBuffer( { label: 'sprayPos', count: N, type: 'vec4f' } );
		this.vel = new StorageBuffer( { label: 'sprayVel', count: N, type: 'vec4f' } );
		this.info = new StorageBuffer( { label: 'sprayInfo', count: N, type: 'vec4f' } );
		this.head = new StorageBuffer( { label: 'sprayHead', count: 1, type: 'u32' } );

		// CPU emit requests (4 vec4 each): (a.xyz, prefix end) (b.xyz, size) (vel.xyz, kind) (velSpread, posSpread, life, sizeJitter)
		this.reqData = new Float32Array( MAX_REQUESTS * 16 );
		this.reqBuffer = new StorageBuffer( { label: 'sprayReq', count: MAX_REQUESTS * 4, type: 'vec4f' } );
		this.nReq = 0;
		this.nReqParticles = 0;
		this.cpuHead = 0;
		this._frame = 0;

		// simulation parameters (compute): the frame seed is shared with the GPU emitters
		this.simParams = new UniformBlock( 'SprayParams', {
			frameSeed: [ 'u32', 0 ],
			cpuStart: [ 'u32', 0 ],
			cpuCount: [ 'u32', 0 ],
			reqCount: [ 'u32', 0 ],
			// one moving body the particles collide with (setBody / setBodyShape)
			bodyMat: [ 'mat4x4f', new Matrix4() ], // body -> world
			bodyInv: [ 'mat4x4f', new Matrix4() ], // world -> body
			bodyVel: [ 'vec3f', new Vector3() ],
			bodyOn: [ 'f32', 0 ],
			bodyHull: [ 'vec4f', new Vector4( 0, 0, 1, 0 ) ], // at the sheer: z aft, z shoulder, z stem, half beam
			bodyHullWL: [ 'vec4f', new Vector4( 0, 1, 0, 0 ) ], // at y = 0: z shoulder, z stem, half beam
			bodySheer: [ 'vec4f', new Vector4( 0, 0, - 1, 0 ) ], // y sheer aft, y sheer stem, y bottom
			bodyBoxMin: [ 'vec3f', new Vector3() ],
			bodyBoxMax: [ 'vec3f', new Vector3() ],
		}, { label: 'spray params' } );
		const S = this.simParams.fields;
		this.cpuStart = S.cpuStart;
		this.cpuCount = S.cpuCount;
		this.reqCount = S.reqCount;
		this.frameSeed = S.frameSeed;

		// one moving body the particles collide with (setBody / setBodyShape)
		this.body = {
			on: S.bodyOn,
			mat: S.bodyMat, // body -> world
			inv: S.bodyInv, // world -> body
			vel: S.bodyVel,
			hull: S.bodyHull, // at the sheer: z aft, z shoulder, z stem, half beam
			hullWL: S.bodyHullWL, // at y = 0: z shoulder, z stem, half beam
			sheer: S.bodySheer, // y sheer aft, y sheer stem, y bottom
			boxMin: S.bodyBoxMin,
			boxMax: S.bodyBoxMax,
		};

		// the emitter API for GPU kernels (see the header)
		this.module = new ShaderModule( {
			name: 'spray',
			deps: [ sprayCommon ],
			uniforms: this.simParams,
			uniformName: 'sprayParams',
			bindings: {
				sprayPos: { storage: this.pos, access: 'read_write' },
				sprayVel: { storage: this.vel, access: 'read_write' },
				sprayInfo: { storage: this.info, access: 'read_write' },
				sprayHead: { storage: this.head, access: 'read_write', wgslType: 'array<atomic<u32>>' },
			},
			code: /* wgsl */`
const SPRAY_NG: u32 = ${ this.NG }u;
const SPRAY_NC: u32 = ${ this.NC }u;
const SPRAY_N: u32 = ${ this.N }u;

// Reserve n ring slots of the GPU part; returns the base (pass it to spraySlot)
fn sprayReserve( n: u32 ) -> u32 { return atomicAdd( &sprayHead[ 0 ], n ); }
fn spraySlot( base: u32, i: u32 ) -> u32 { return ( base + i ) & ( SPRAY_NG - 1u ); }

fn sprayWrite( slot: u32, p: vec3f, v: vec3f, size: f32, kind: f32, life: f32, seed: f32 ) {
	sprayPos[ slot ] = vec4f( p, 0.0 );
	sprayVel[ slot ] = vec4f( v, size );
	sprayInfo[ slot ] = vec4f( kind, life, p.y, seed );
}

fn sprayRand( a: u32, b: u32 ) -> f32 {
	return sprayHash( a + b * 1664525u + sprayParams.frameSeed * 2654435761u );
}
`,
		} );

		this.updateKernel = null; // built on the first update() (hooks)
		this._buildMesh( sceneCopy );

	}

	// ------------------------------------------------------------------ CPU API

	// Emit `count` particles at `position` (Vector3) with base `velocity` (Vector3, m/s). size: radius (m),
	// kind: SPRAY.DROPLET | SPRAY.LIGAMENT | SPRAY.SPRAY | SPRAY.MIST. Up to 32 calls and 8192 particles per
	// frame; nothing is allocated. opts: spread (velocity jitter, m/s), jitter (position jitter, m),
	// life (s), to (Vector3: emit along the segment position -> to), sizeJitter (0..1)
	emit( position, velocity, count, size = 0.04, kind = SPRAY.DROPLET, opts = {} ) {

		if ( this.nReq >= MAX_REQUESTS || count <= 0 ) return;
		count = Math.min( Math.round( count ), this.NC - this.nReqParticles );
		if ( count <= 0 ) return;
		const { spread = 0.6, jitter = 0.05, life = kind === SPRAY.MIST ? 2.5 : 1.6, to = null, sizeJitter = 0.5 } = opts;
		// requests are expanded on the GPU by the update kernel (see _buildUpdate)
		const b = to || position;
		const d = this.reqData;
		const o = this.nReq * 16;
		this.nReqParticles += count;
		d[ o ] = position.x; d[ o + 1 ] = position.y; d[ o + 2 ] = position.z; d[ o + 3 ] = this.nReqParticles;
		d[ o + 4 ] = b.x; d[ o + 5 ] = b.y; d[ o + 6 ] = b.z; d[ o + 7 ] = size;
		d[ o + 8 ] = velocity.x; d[ o + 9 ] = velocity.y; d[ o + 10 ] = velocity.z; d[ o + 11 ] = kind;
		d[ o + 12 ] = spread; d[ o + 13 ] = jitter; d[ o + 14 ] = life; d[ o + 15 ] = sizeJitter;
		this.nReq ++;

	}

	// Emit along a polyline: countPerSegment particles spread over each segment. velocity is a Vector3,
	// or an array with one per point (each segment uses the velocity of its start point).
	emitAlongPoints( points, velocity, countPerSegment, size = 0.04, kind = SPRAY.DROPLET, opts = {} ) {

		const o = Object.assign( this._segOpts || ( this._segOpts = {} ), opts );
		for ( let i = 0; i + 1 < points.length; i ++ ) {

			o.to = points[ i + 1 ];
			this.emit( points[ i ], Array.isArray( velocity ) ? velocity[ i ] : velocity, countPerSegment, size, kind, o );

		}

		o.to = null;

	}

	// Collision shape of the body, in its own frame (+Z forward, +Y up): the hull's plan outline
	// (full half beam aft of the shoulder, an elliptic bow to the stem), given at the waterline
	// (y = 0: wl*) and at the sheer, blended with height (flare, raked stem), from yBottom up to the
	// sheer (linear from ySheerAft to ySheerStem); and one box (e.g. the wheelhouse).
	setBodyShape( { zAft, zShoulder, zStem, halfBeam, wlShoulder, wlStem, wlHalfBeam, ySheerAft, ySheerStem, yBottom, boxMin, boxMax } ) {

		const b = this.body;
		b.hull.value.set( zAft, zShoulder, zStem, halfBeam );
		b.hullWL.value.set( wlShoulder, wlStem, wlHalfBeam, 0 );
		b.sheer.value.set( ySheerAft, ySheerStem, yBottom, 0 );
		b.boxMin.value.copy( boxMin );
		b.boxMax.value.copy( boxMax );

	}

	// The body's pose (matrixWorld) and velocity this frame; null disables the collisions.
	setBody( matrixWorld, velocity ) {

		const b = this.body;
		b.on.value = matrixWorld ? 1 : 0;
		if ( ! matrixWorld ) return;
		b.mat.value.copy( matrixWorld );
		b.inv.value.copy( matrixWorld ).invert();
		b.vel.value.copy( velocity );

	}

	// ------------------------------------------------------------------ hooks

	// shoreSim / waveShadow / clouds are optional and may be attached after construction: one
	// module wraps them for the kernel and the sprites (built once, on first use)
	_hooks() {

		if ( this._hookModule ) return this._hookModule;
		const deps = [];
		let code = '';
		if ( this.clouds && this.clouds.module ) {

			deps.push( this.clouds.module );
			code += 'fn sprayCloudShadow( xz: vec2f ) -> f32 { return cloudsShadow( xz ); }\n';

		} else code += 'fn sprayCloudShadow( xz: vec2f ) -> f32 { return 1.0; }\n';
		if ( this.waveShadow ) {

			deps.push( this.waveShadow.module || this.waveShadow );
			code += 'fn sprayWaveShadow( p: vec3f, tag: f32 ) -> f32 { return breakersSprayShadow( p, tag ); }\n';

		} else code += 'fn sprayWaveShadow( p: vec3f, tag: f32 ) -> f32 { return 1.0; }\n';
		this._hookModule = new ShaderModule( { name: 'sprayHooks', deps, code } );
		return this._hookModule;

	}

	// ------------------------------------------------------------------ simulation

	_buildUpdate() {

		const NG = this.NG, NC = this.NC;
		const shoreSim = this.shoreSim;
		const deposit = shoreSim && shoreSim.depositModule;
		const modules = [ this.module, this.query.module, this.terrain.module ];
		if ( deposit ) modules.push( deposit );

		this.updateKernel = new ComputeKernel( {
			label: 'Spray Update',
			modules,
			bindings: { sprayReq: { storage: this.reqBuffer, access: 'read' } },
			workgroupSize: [ 64, 1, 1 ],
			code: /* wgsl */`
// Push a particle out of the body (hull or box) through the nearest face; the velocity into it
// (relative to the body) is removed and the rest damped (the water runs off as a film); drops
// that hit it die soon after.
fn sprayCollideBody( p: ptr<function, vec3f>, v: ptr<function, vec3f>, age: f32, life: ptr<function, f32>, isMist: bool ) {
	if ( sprayParams.bodyOn < 0.5 ) { return; }
	var q = ( sprayParams.bodyInv * vec4f( *p, 1.0 ) ).xyz;
	let H = sprayParams.bodyHull; let W = sprayParams.bodyHullWL; let S = sprayParams.bodySheer;
	// hull: the outline at this height (waterline -> sheer), half breadth at q.z (elliptic bow)
	let sheer = mix( S.x, S.y, sat( ( q.z - H.x ) / max( H.z - H.x, 0.01 ) ) );
	let fh = sat( q.y / max( sheer, 0.1 ) );
	let zSh = mix( W.x, H.y, fh ); let zSt = mix( W.y, H.z, fh ); let HB = mix( W.z, H.w, fh );
	let bowL = max( zSt - zSh, 0.01 );
	let e = sat( ( q.z - zSh ) / bowL );
	let c = sqrt( max( 1.0 - e * e, 0.02 ) );
	let hb = HB * c;
	let inHull = q.z > H.x && q.z < zSt && abs( q.x ) < hb && q.y < sheer && q.y > S.z;
	let b0 = sprayParams.bodyBoxMin; let b1 = sprayParams.bodyBoxMax;
	let inBox = q.x > b0.x && q.x < b1.x && q.y > b0.y && q.y < b1.y && q.z > b0.z && q.z < b1.z;
	if ( inHull || inBox ) {
		var n = vec3f( 0.0, 1.0, 0.0 );
		if ( inHull ) {
			let sx = select( - 1.0, 1.0, q.x > 0.0 );
			if ( hb - abs( q.x ) < sheer - q.y ) {
				// through the side; on the bow the side faces forward too (- d hb / dz)
				n = normalize( vec3f( sx, 0.0, HB * e / ( c * bowL ) ) );
				q.x = sx * ( hb + 0.02 );
			} else {
				q.y = sheer + 0.02;
			}
		} else {
			let dx = min( q.x - b0.x, b1.x - q.x );
			let dz = min( q.z - b0.z, b1.z - q.z );
			let dy = b1.y - q.y;
			if ( dy < dx && dy < dz ) {
				q.y = b1.y + 0.02;
			} else if ( dx < dz ) {
				let right = q.x > ( b0.x + b1.x ) * 0.5;
				n = vec3f( select( - 1.0, 1.0, right ), 0.0, 0.0 );
				q.x = select( b0.x - 0.02, b1.x + 0.02, right );
			} else {
				let front = q.z > ( b0.z + b1.z ) * 0.5;
				n = vec3f( 0.0, 0.0, select( - 1.0, 1.0, front ) );
				q.z = select( b0.z - 0.02, b1.z + 0.02, front );
			}
		}
		let nw = normalize( ( sprayParams.bodyMat * vec4f( n, 0.0 ) ).xyz );
		var vr = *v - sprayParams.bodyVel;
		let vn = dot( vr, nw );
		if ( vn < 0.0 ) { vr -= nw * vn; }
		*v = sprayParams.bodyVel + vr * 0.5;
		*p = ( sprayParams.bodyMat * vec4f( q, 1.0 ) ).xyz;
		// water that hits it wets it and runs off (gone); mist flows around it and settles
		*life = min( *life, select( age, age + 0.25, isMist ) );
	}
}

@compute @workgroup_size( WG_X, 1, 1 )
fn main( @builtin( global_invocation_id ) gid: vec3u ) {
	let i = gid.x;
	if ( i >= SPRAY_N ) { return; }

	// ---- CPU-owned slots: spawn from this frame's requests
	if ( i >= ${ NG }u ) {
		let k = ( i - ${ NG }u + ${ NC }u - sprayParams.cpuStart ) % ${ NC }u;
		if ( k < sprayParams.cpuCount ) {
			var r = 0u;
			for ( var j = 0u; j < sprayParams.reqCount; j++ ) {
				r = j;
				if ( f32( k ) < sprayReq[ j * 4u ].w ) { break; }
			}
			let r0 = sprayReq[ r * 4u ];
			let r1 = sprayReq[ r * 4u + 1u ];
			let r2 = sprayReq[ r * 4u + 2u ];
			let r3 = sprayReq[ r * 4u + 3u ];
			let h0 = sprayRand( i, 11u ); let h1 = sprayRand( i, 12u ); let h2 = sprayRand( i, 13u );
			let h3 = sprayRand( i, 14u ); let h4 = sprayRand( i, 15u ); let h5 = sprayRand( i, 16u );
			let h6 = sprayRand( i, 17u );
			let along = mix( r0.xyz, r1.xyz, h0 );
			let jit = vec3f( h1 - 0.5, h2 - 0.5, h3 - 0.5 ) * ( r3.y * 2.0 );
			let vj = vec3f( h4 - 0.5, h5 - 0.5, h6 - 0.5 ) * ( r3.x * 2.0 );
			let size = r1.w * ( 1.0 + ( h2 - 0.5 ) * r3.w );
			let life = r3.z * ( h3 * 0.5 + 0.75 );
			sprayWrite( i, along + jit, r2.xyz + vj, size, r2.w, life, h5 );
		}
	}

	// ---- integrate live particles
	let P = sprayPos[ i ];
	let Vv = sprayVel[ i ];
	let info = sprayInfo[ i ];
	if ( info.y > 0.0 ) {
		let dt = frame.dt;
		var p = P.xyz;
		var v = Vv.xyz;
		let age = P.w + dt;
		let kind = info.x;

		// wind near the surface (~70% of the 10 m wind), gusty
		let gust = sin( frame.time * 0.7 + p.x * 0.05 ) * 0.25 + 0.85;
		let wind = vec3f( frame.windDir.x, 0.0, frame.windDir.y ) * ( frame.windSpeed * 0.7 * gust );
		// drag toward the wind: small drops follow the air, mist drifts with it
		// mist first keeps moving with the air the wave pushes ahead of it, then joins the wind
		let isMist = kind > 0.5 && kind < 1.5;
		let tau = ${ byKind( 'kind', KIND.tau ) } * select( 1.0, exp( age * - 1.2 ) * 4.0 + 1.0, isMist );
		let grav = ${ byKind( 'kind', KIND.grav ) };
		let turb = vec3f(
			sin( age * 2.1 + fract( info.w ) * 40.0 ),
			sin( age * 1.7 + fract( info.w ) * 17.0 ) * 0.5,
			cos( age * 1.9 + fract( info.w ) * 29.0 ) ) * ${ byKind( 'kind', KIND.turb ) };
		v += ( ( wind - v ) / tau + turb ) * dt;
		v.y -= grav * dt;
		p += v * dt;

		var life = info.y;
		sprayCollideBody( &p, &v, age, &life, isMist );

		// water surface and ground below
		let hw = waterQueryHeightAtXZ( p.xz );
		let ground = terrainHeightAt( p.xz );
		let top = max( hw, ground );

		// drops die in the water / on the sand; mist and foam skim over it
		if ( p.y < top && v.y < 0.0 && age > 0.04 ) {
			if ( ${ byKind( 'kind', KIND.dies ) } > 0.5 ) {
				life = 0.0;
${ deposit ? /* wgsl */`				// fell into the water (not onto the sand): its bubbles add to the foam there
				if ( hw > ground + 0.02 ) {
					shoreSimDepositAt( p.xz, u32( ${ byKind( 'kind', KIND.deposit ) } ) );
				}
` : '' }			} else {
				p.y = top + 0.02;
				v.y = max( v.y, 0.0 );
				v = vec3f( v.x * 0.95, v.y, v.z * 0.95 );
			}
		}

		if ( age > life ) { life = 0.0; }

		// mist and spray clouds grow as they dilute
		let size = Vv.w * ( 1.0 + dt * ${ byKind( 'kind', KIND.grow ) } );
		sprayPos[ i ] = vec4f( p, age );
		sprayVel[ i ] = vec4f( v, size );
		sprayInfo[ i ] = vec4f( info.x, life, hw, info.w );
	}
}
`,
		} );

	}

	update() {

		if ( ! this.updateKernel ) this._buildUpdate();
		// CPU requests -> ring slots
		const n = this.nReqParticles;
		this.cpuStart.value = this.cpuHead;
		this.cpuCount.value = n;
		this.reqCount.value = this.nReq;
		this.cpuHead = ( this.cpuHead + n ) % this.NC;
		if ( this.nReq > 0 ) this.reqBuffer.write( this.reqData.subarray( 0, this.nReq * 16 ) );
		this.frameSeed.value = ( ++ this._frame ) >>> 0;
		this.updateKernel.dispatch( Math.ceil( this.N / 64 ) );
		this.nReq = 0;
		this.nReqParticles = 0;

	}

	// ------------------------------------------------------------------ rendering

	_buildMesh( sceneCopy ) {

		// one camera-facing quad per particle slot (instanced; dead ones collapse off-screen)
		const geo = new InstancedBufferGeometry();
		geo.setAttribute( 'position', new BufferAttribute( new Float32Array( [ - 1, - 1, 0, 1, - 1, 0, 1, 1, 0, - 1, 1, 0 ] ), 3 ) );
		geo.setIndex( [ 0, 1, 2, 0, 2, 3 ] );
		geo.boundingSphere = new Sphere( new Vector3(), 1e7 );
		geo.instanceCount = this.N;

		const noiseTex = makePuffTexture();
		const dotsTex = makeDotsTexture();

		const mat = new Material( {
			name: 'Spray',
			lit: false,
			transparent: true,
			depthWrite: false,
			depthTest: true,
			side: 'double',
			// premultiplied: color one / one-minus-src-alpha (alpha likewise)
			blending: 'premultiplied',
			modules: [ sprayCommon ],
			uniforms: {
				intensity: [ 'f32', 1 ],
				maxDistance: [ 'f32', 320 ],
			},
			storage: {
				sprayPosR: this.pos,
				sprayVelR: this.vel,
				sprayInfoR: this.info,
			},
			textures: {
				sprayPuff: noiseTex, // repeat, mipmapped (smpLinearRepeat)
				sprayDots: dotsTex,
				spraySceneDepth: { texture: () => sceneCopy.depthTexture },
			},
			varyings: {
				vUV: 'vec2f',
				vCol: 'vec4f', // premultiplied-ready radiance, opacity
				vMisc: 'vec4f', // kind, water height, softness, seed
				vFwd: 'vec4f', // forward-scattered sun (thin parts glow with it), w: half-size in pixels
			},
			vertex: /* wgsl */`
	let posA = sprayPosR[ v.instance ];
	let velA = sprayVelR[ v.instance ];
	let info = sprayInfoR[ v.instance ];
	let p = posA.xyz;
	let age = posA.w;
	let vel = velA.xyz;
	let kind = info.x;
	let life = info.y;
	let isDrop = kind < 0.5;
	let isLig = kind > 1.5 && kind < 2.5;
	let isMist = kind > 0.5 && kind < 1.5;
	let water = isDrop || isLig; // clear water: drops and ligaments
	let alive = life > 0.0 && age < life;

	let toCam = frame.cameraPos - p;
	let dist = max( length( toCam ), 0.05 );
	let Vd = toCam / dist;

	// pixel footprint at this distance: drops are drawn at least ~1.3 px wide
	let p11 = frame.proj[ 1 ][ 1 ];
	let pixel = dist * 2.0 / ( p11 * frame.resolution.y );
	let r0 = velA.w; // radius (m)
	// dense spray is thrown out of the splash as a compact mass and spreads (grows from ~half size)
	let tAge = age / max( life, 1e-3 );
	let r = select( r0, r0 * mix( 0.45, 1.0, smoothstep( 0.0, 0.25, tAge ) ), kind > 2.5 && kind < 3.5 );
	let size = max( r, pixel * 1.3 );

	// motion blur along the velocity projected on the view plane; ligaments are elongated anyway
	let vPerp = vel - Vd * dot( vel, Vd );
	let speed = length( vPerp );
	let stretchLen = speed * ${ byKind( 'kind', KIND.stretch ) };
	let elong = select( 0.0, r * 2.0, isLig );
	let up = select( vec3f( 0.0, 1.0, 0.0 ), vPerp / max( speed, 1e-3 ), speed > 1e-3 );
	// clouds: random rotation that slowly turns
	let rot = fract( info.w ) * 6.283 + age * ( fract( info.w ) - 0.5 );
	let camRight = normalize( cross( vec3f( 0.0, 1.0, 0.0 ), Vd ) + vec3f( 1e-5, 0.0, 0.0 ) );
	let camUp = cross( Vd, camRight );
	let mRight = camRight * cos( rot ) + camUp * sin( rot );
	let mUp = camUp * cos( rot ) - camRight * sin( rot );
	// torn sheets (dense spray) are drawn along their motion too, tilted a little at random and
	// stretched by their speed: fibrous, streaked silhouettes instead of round puffs
	let isSheet = kind > 2.5;
	let isClear = kind > 3.5; // clear sheet (bow sheet)
	let side = normalize( cross( Vd, up ) );
	let tilt = ( fract( info.w * 7.31 ) - 0.5 ) * 0.7;
	let sUp = up * cos( tilt ) + side * sin( tilt );
	let sSide = side * cos( tilt ) - up * sin( tilt );
	// mist streams with the air: drawn along its motion, stretched by its speed (wisps, not discs)
	let alongMotion = isSheet || ( isMist && speed > 0.3 );
	let axisY = select( select( mUp, sUp, alongMotion ), up, water );
	let axisX = select( select( mRight, sSide, alongMotion ), side, water );
	let sheetLen = select( 0.0, size * clamp( speed * 0.08, 0.0, 0.8 ), isSheet );
	let mistLen = select( 0.0, size * clamp( ( speed - 0.3 ) * 0.35, 0.0, 1.4 ), isMist );
	let halfY = size + stretchLen * 0.5 + elong + sheetLen + mistLen;
	let halfX = select( size, size * 1.05, isSheet );
	let corner = v.position.xy;
	let world = p + axisX * ( corner.x * halfX ) + axisY * ( corner.y * halfY );

	// coverage that conserves the water's cross-section: the drop's projected area (and the time it
	// spends on each pixel of its streak) spread over the drawn footprint. For the gaussian
	// footprint exp( -k d^2 ) the peak is k r (r + elong) / ( halfX halfY ). Clouds: lost to the clamp.
	let kShape = select( 3.5, 4.5, isLig );
	let cover = select( sat( r / size ), min( r * ( r + elong ) * kShape / ( halfX * halfY ), 1.0 ), water );

	// ---- lighting (per particle)
	let L = frame.sunDir;
	let cosT = dot( - Vd, L ); // 1 = looking toward the sun through the particle
	let cosA = dot( Vd, L );
	let sunVis = sprayCloudShadow( p.xz ) * sprayWaveShadow( p, info.w );
	let sun = frame.sunColor * sunVis;
	// clear water (drop, ligament): the bright sky it refracts and reflects, a strong forward lobe
	// (diffraction + refraction) when backlit, a small glint from any side
	let cWater = frame.skyIrradiance * 0.9 + sun * ( sprayPhaseHG( cosT, 0.85 ) * 1.2 + 0.12 );
	// dense spray: multiply scattered, white from any side (a diffuse sphere: its far side is in its
	// own shadow), plus a forward lobe
	let lambert = ( sqrt( max( 1.0 - cosA * cosA, 0.0 ) ) + ( PI - acos( clamp( cosA, -1.0, 1.0 ) ) ) * cosA ) / PI;
	// (the forward lobe is passed on separately: thin, torn parts glow with it, thick parts shade it)
	let cSpray = sun * ( ( lambert * 0.65 + 0.35 ) / PI ) + frame.skyIrradiance * 1.15;
	let fSpray = sun * ( sprayPhaseHG( cosT, 0.6 ) * 0.9 );
	// mist: a thin veil of fine drops, strongly forward scattering, tinted by the sky
	let cMist = sun * ( 0.25 / PI ) + frame.skyIrradiance * 0.9;
	let fMist = sun * sprayPhaseHG( cosT, 0.75 );
	// clear sheet: thin water, the sky it shows and a little sun off its surface; the sun shining
	// through it (forward lobe) is passed on: the thin torn parts glow when backlit
	let cClear = frame.skyIrradiance * 0.95 + sun * 0.05;
	let fClear = sun * ( sprayPhaseHG( cosT, 0.8 ) * 1.1 );
	let col = select( select( select( cSpray, cClear, isClear ), cMist, isMist ), cWater, water );
	o.vFwd = vec4f( select( select( select( fSpray, fClear, isClear ), fMist, isMist ), vec3f( 0.0 ), water ), halfX / pixel );

	// opacity over the particle's life
	let t = age / max( life, 1e-3 );
	let fadeIn = smoothstep( 0.0, ${ byKind( 'kind', KIND.fadeIn ) }, t );
	let fadeOut = 1.0 - smoothstep( ${ byKind( 'kind', KIND.fadeOut ) }, 1.0, t );
	let baseA = ${ byKind( 'kind', KIND.alpha ) };
	// far: fade out; very near the eye: sheets and mist would fill the screen (and cost a lot of overdraw)
	let distFade = smoothstep( mat.maxDistance, mat.maxDistance * 0.55, dist ) * select( smoothstep( 0.6, 3.0, dist ), 1.0, water );
	let a = baseA * fadeIn * fadeOut * cover * distFade * mat.intensity;

	o.vUV = corner;
	o.vCol = vec4f( col, a );
	// x: kind + 0.45 * life fraction (the kind tests below have 0.5 of margin)
	o.vMisc = vec4f( kind + sat( t ) * 0.45, info.z, size, fract( info.w ) );

	// dead particles collapse off-screen
	v.useWorld = true;
	v.worldPos = select( vec3f( 0.0, -1e5, 0.0 ), world, alive && a > 1e-4 );
	v.worldNormal = Vd;
`,
			// motion vectors: camera-only reprojection of the world position (the default for a
			// world-space vertex without a previous position), weighted by coverage in the late pass
			output: /* wgsl */`
	let uv = in.vs.vUV;
	let vMisc = in.vs.vMisc;
	let kind = vMisc.x;
	let isDrop = kind < 0.5;
	let isLig = kind > 1.5 && kind < 2.5;
	let isSheet = kind > 2.5;
	let isClear = kind > 3.5;
	let t = sat( fract( kind ) / 0.45 ); // life fraction
	let r2 = dot( uv, uv );
	let sd = vec2f( vMisc.w, vMisc.w * 1.7 );
	// drop: gaussian streak; ligament: a slightly sharper, beaded blob
	let drop = max( exp( r2 * - 3.5 ) - 0.03, 0.0 );
	let lig = max( exp( r2 * - 4.5 ) * ( sin( uv.y * 5.0 + vMisc.w * 40.0 ) * 0.2 + 0.9 ) - 0.03, 0.0 );
	// torn sheet: noise streaked along the motion (uv.y), eroded from its edges inward and more and
	// more as it ages, so it tears into strands and fragments instead of shrinking. Thick parts are
	// dense white water, the torn edges thin and translucent.
	let env = sat( 1.0 - r2 );
	let fib = textureSample( sprayPuff, smpLinearRepeat, vec2f( uv.x * 0.5, uv.y * 0.26 ) + sd ).x;
	let fine = textureSample( sprayPuff, smpLinearRepeat, vec2f( uv.x * 1.2, uv.y * 0.6 ) + sd * 2.3 ).x;
	let field = fib * 0.6 + fine * 0.4 + ( env - 0.55 ) * 0.75 - smoothstep( 0.8, 1.0, r2 );
	// a torn sheet only a few pixels across can't show its tears: a solid white dot, and a cluster of
	// them reads as cauliflower puffs. Small on screen, it is drawn thinner and more torn: a far
	// splash-up is a ragged, see-through burst
	let farK = smoothstep( 14.0, 3.0, in.vs.vFwd.w ) * select( 0.0, 1.0, isSheet && ! isClear );
	let erode = mix( 0.26, 0.7, t ) + farK * 0.16;
	let dens = sat( ( field - erode ) * 3.0 );
	// torn edges are thin, translucent water: soft and see-through, the core dense white
	let torn = smoothstep( erode - 0.04, erode + 0.2, field ) * ( dens * 0.45 + 0.55 );
	// ... which breaks up into a cluster of drops: many small dots in a ragged envelope that thins
	// out as it ages (sub-pixel drops average out through the mipmaps: never a solid blob)
	let dots = textureSample( sprayDots, smpLinearRepeat, uv * vec2f( 0.5, 0.32 ) + sd * 3.7 ).x;
	let swarm = dots * smoothstep( 0.25, 0.55, fib + env * 0.45 - t * 0.2 ) * ( 1.0 - t * 0.5 );
	let sheet = max( torn * ( 1.0 - smoothstep( 0.15, 0.6, t ) ), swarm );
	// mist: a soft veil of low-frequency noise that drifts and thins, never a disc
	let m1 = textureSample( sprayPuff, smpLinearRepeat, uv * 0.2 + sd ).x;
	let m2 = textureSample( sprayPuff, smpLinearRepeat, uv * 0.55 + sd * 3.1 ).x;
	let veil = smoothstep( 0.28, 0.8, m1 * 0.7 + m2 * 0.3 + env * 0.3 - 0.12 ) * sqrt( env ) * ( 1.0 - t * 0.4 );
	let shape = select( select( select( veil, sheet, isSheet ), lig, isLig ), drop, isDrop );
	// self-shadowing inside thick sheets; the forward-scattered sun lights up the thin parts
	let shade = select( 1.0, 1.0 - dens * 0.15, isSheet && ! isClear );
	let glow = select( select( 1.0, 1.0 - dens * 0.6, isSheet ), 1.0 - dens * 0.3, isClear );

	// soft intersections: opaque scene depth and the water surface under the particle
	// (depth via exact texel loads; reversed-Z, view z negative in front of the camera)
	let dsz = vec2f( textureDimensions( spraySceneDepth ) );
	let q = vec2i( clamp( in.pixel * frame.invResolution, vec2f( 0.0 ), vec2f( 0.9999 ) ) * dsz );
	let sceneZ = - viewDepth( textureLoad( spraySceneDepth, q, 0 ) );
	let posViewZ = ( frame.view * vec4f( in.P, 1.0 ) ).z;
	let soft = vMisc.z * 1.5 + 0.03;
	let fadeScene = sat( ( posViewZ - sceneZ ) / soft );
	let fadeWater = sat( ( in.P.y - vMisc.y ) / ( soft * 0.6 ) + 0.15 );
	let aOut = in.vs.vCol.w * shape * fadeScene * fadeWater * ( 1.0 - farK * 0.4 );
	if ( aOut < 0.002 ) { discard; }
	r.color = vec4f( ( in.vs.vCol.rgb * shade + in.vs.vFwd.xyz * glow ) * aOut, aOut );
`,
		} );

		// the optional hooks (clouds, wave shadow) join the material on its first pipeline build
		const key = mat.pipelineKey;
		mat.pipelineKey = () => {

			if ( ! this._matHooked ) {

				this._matHooked = true;
				mat.modules = [ sprayCommon, this._hooks() ];

			}

			return key.call( mat );

		};

		this.material = mat;
		this.params = {
			intensity: mat.uniforms.intensity,
			maxDistance: mat.uniforms.maxDistance,
		};

		const mesh = this.mesh = new Mesh( geo, mat );
		mesh.count = this.N;
		mesh.frustumCulled = false;
		mesh.castShadow = false;
		mesh.receiveShadow = false;
		mesh.renderOrder = 20;
		mesh.layers.set( LAYERS.TRANSPARENT );
		mesh.name = 'Spray';

	}

}

// mipmapped rgba8 texture from CPU data (repeat wrap: sample with smpLinearRepeat)
function mipTexture( data, size, label ) {

	const tex = new Texture( { label, width: size, height: size, format: 'rgba8unorm', mips: true, usage: [ 'sample', 'copyDst', 'render' ], data, sampler: 'linearRepeat' } );
	tex.getGPU();
	generateMipmaps( tex );
	return tex;

}

// Small tileable value-noise texture for mist puffs (generated once on the CPU).
function makePuffTexture( size = 64 ) {

	const data = new Uint8Array( size * size * 4 );
	const rnd = ( i, j, o ) => {

		const s = Math.sin( ( i % o ) * 127.1 + ( j % o ) * 311.7 + o * 17.3 ) * 43758.5453;
		return s - Math.floor( s );

	};

	const vnoise = ( x, y, o ) => {

		const i = Math.floor( x ), j = Math.floor( y );
		const fx = x - i, fy = y - j;
		const ux = fx * fx * ( 3 - 2 * fx ), uy = fy * fy * ( 3 - 2 * fy );
		const a = rnd( i, j, o ), b = rnd( i + 1, j, o ), c = rnd( i, j + 1, o ), d = rnd( i + 1, j + 1, o );
		return ( a * ( 1 - ux ) + b * ux ) * ( 1 - uy ) + ( c * ( 1 - ux ) + d * ux ) * uy;

	};

	for ( let j = 0; j < size; j ++ ) for ( let i = 0; i < size; i ++ ) {

		let s = 0, a = 0.5, n = 0;
		for ( let o = 4; o <= 32; o *= 2 ) {

			s += vnoise( i / size * o, j / size * o, o ) * a;
			n += a;
			a *= 0.55;

		}

		const v = Math.max( 0, Math.min( 1, ( s / n - 0.2 ) * 1.6 ) );
		const k = ( j * size + i ) * 4;
		data[ k ] = data[ k + 1 ] = data[ k + 2 ] = Math.round( v * 255 );
		data[ k + 3 ] = 255;

	}

	return mipTexture( data, size, 'sprayPuff' );

}

// Tileable texture of scattered drops (r: coverage), for clusters of drops. Heavy-tailed radii: many
// tiny drops, a few large ones.
function makeDotsTexture( size = 128, count = 150 ) {

	const data = new Uint8Array( size * size * 4 );
	let seed = 12345;
	const rnd = () => ( ( seed = ( seed * 1664525 + 1013904223 ) >>> 0 ) / 4294967296 );
	const cov = new Float32Array( size * size );
	for ( let k = 0; k < count; k ++ ) {

		const cx = rnd() * size, cy = rnd() * size;
		const r = Math.min( 0.9 * Math.pow( 1 - rnd() * 0.97, - 0.55 ), 6 );
		const R = Math.ceil( r + 1.5 );
		for ( let dy = - R; dy <= R; dy ++ ) for ( let dx = - R; dx <= R; dx ++ ) {

			const x = ( ( Math.floor( cx ) + dx ) % size + size ) % size, y = ( ( Math.floor( cy ) + dy ) % size + size ) % size;
			const d = Math.hypot( Math.floor( cx ) + dx + 0.5 - cx, Math.floor( cy ) + dy + 0.5 - cy );
			const c = Math.max( 0, Math.min( 1, r + 0.5 - d ) );
			cov[ y * size + x ] = Math.max( cov[ y * size + x ], c );

		}

	}

	for ( let i = 0; i < size * size; i ++ ) {

		const v = Math.round( cov[ i ] * 255 );
		data[ i * 4 ] = data[ i * 4 + 1 ] = data[ i * 4 + 2 ] = v;
		data[ i * 4 + 3 ] = 255;

	}

	return mipTexture( data, size, 'sprayDots' );

}
