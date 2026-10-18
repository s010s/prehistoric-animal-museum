import { Vector2, Vector3, Vector4, MathUtils, DataUtils } from '../engine/index.js';
import { GPU, UniformBlock, Texture, StorageBuffer, ShaderModule, ComputeKernel, commonModule } from '../engine/webgpu.js';
import { GRAVITY } from '../core/Globals.js';

const N = 512; // grid cells per side
const LOG2N = 9;
const HALF = N / 2;
const MASK = N - 1;
const CELL = 0.4; // m
const SIZE = N * CELL; // window size (m)
// reference depths of the four spectral operators (m); a cell blends the two bracketing its depth
const DEPTHS = [ Infinity, 6, 1.8, 0.6 ];
const SPONGE = 22; // absorbing band at the window edges (cells)
// boat-frame box of the near-field template (steady wave pattern under the hull)
const TW = 32, TH = 88; // 0.1 m texels (steep pressure near the stem: keep resampling errors small)
const TX0 = - 1.6, TX1 = 1.6, TZ0 = - 4.4, TZ1 = 4.4;

// WGSL float literal
const f = ( x ) => {

	const s = String( x );
	return /[.e]/.test( s ) ? s : s + '.0';

};

// Interactive boat wake: a linear free-surface wave simulation with exact dispersion.
//
// Height h and vertical velocity w on a 512^2 grid (0.4 m cells, 205 m) in a window that follows
// the boat. The window is addressed toroidally (world cell I lives in texel I mod N): it scrolls
// by whole cells without moving any data, and the FFT's periodicity is the addressing itself.
// Each step is 3 dispatches in one compute pass (~0.13 ms on an M5 Pro):
//   1. rows: per-cell physics (hull pressure, dissipation, breaking, foam, obstacles), display
//      texture, forward FFT along x
//   2. columns: forward FFT along z, spectral operators, inverse FFT along z (spare workgroups
//      update the boat's near-field template)
//   3. rows: inverse FFT along x, symplectic Euler step, absorbing sponge at the window edges
//
// Waves: dw/dt = -g L[h + P], dh/dt = w. L = |k| tanh(|k| d) is the Dirichlet-to-Neumann operator of
// linear water waves; P is the pressure head of the hull (the boat is a moving pressure
// distribution, after Havelock): its immersion, a dynamic part ~U^2/2g where the hull enters the
// water and the hollow behind the transom at speed. Deep water gives the Kelvin wake (transverse
// and divergent waves inside 19.5 deg, narrowing at high Froude numbers) for any course and speed.
// Variable depth: four spectral operators (d = inf, 6, 1.8, 0.6 m) are blended per cell in the
// symmetric form sum_i s_i L_i[s_i u] (the two levels bracketing the local depth; <= 5 % phase
// speed error for 1-100 m waves down to 0.5 m depth). It is self-adjoint, so wake waves slow
// down, shorten, refract and grow over the shoaling beach until they break in the swash zone.
// Dissipation is a turbulent eddy viscosity in flux form (conserves mass): breaking crests, the
// surf and the propeller wash feed the turbulence, which flattens the waves it passes through.
// Dry land and the pier piles are rigid (weak reflection, scattering around the piles).
//
// Output (display texture, rgba16f): (h, dh/dx, dh/dz, foam), read by WaterSurface through
// displacement() / fragment() (one sampler per shader stage), plus the aeration (bubbles in the
// water column, a slower field than the surface foam: fragment().aeration, 0..aerOut), read with
// textureLoad (no sampler).
//
// WGSL (this.module, prefix `wake`):
//   fn wakeDisplacement( xz: vec2f ) -> vec3f        displacement of the wake surface at world xz
//   struct WakeFrag { slopes: vec2f, foam: f32, aeration: f32 }
//   fn wakeFragment( xz: vec2f ) -> WakeFrag          slopes (dh/dx, dh/dz), foam, aeration (0..aerOut)
//   fn wakeHeight( xz: vec2f ) -> f32, fn wakeSample( xz: vec2f ) -> vec4f, fn wakeAeration( xz: vec2f ) -> f32
// Consumes terrainHeightAt( xz: vec2f ) -> f32 from terrainGPU.module (compute kernels only).
//
// Port note: the simulation kernels read their parameters from their own uniform block
// (WakeKernel, `wk`); the readers use WakeParams, whose fields share the same `{ value }` handles.
// A uniform buffer holds one value per submit, and `reset` is cleared after the step while the
// water is drawn later in the same frame.
export class WakeSim {

	constructor( renderer, { terrainGPU, boat, colliders = null } ) {

		this.renderer = renderer;
		this.terrain = terrainGPU;
		this.boat = boat;
		this.lines = boat.model.lines;

		const K = this.kernelParams = new UniformBlock( 'WakeKernel', {
			origin: [ 'vec2f', new Vector2() ], // min corner, cells
			prev: [ 'vec2f', new Vector2() ], // min corner last step
			center: [ 'vec2f', new Vector2() ], // world centre (m)
			boatPos: [ 'vec2f', new Vector2() ],
			boatRot: [ 'vec2f', new Vector2( 1, 0 ) ], // cos, sin yaw
			dead: [ 'vec2f', new Vector2( 0.03, 0.08 ) ], // residual dead zone (m)
			trim: [ 'vec3f', new Vector3() ], // immersion change: c + a x + b z
			reset: [ 'f32', 1 ],
			pileBox: [ 'vec4f', new Vector4( 0, 0, 1, 1 ) ],
			dt: [ 'f32', 1 / 60 ],
			amount: [ 'f32', 0 ],
			source: [ 'f32', 1 ], // pressure gain
			wash: [ 'f32', 0 ], // propeller wash / transom turbulence
			bow: [ 'f32', 0 ], // breaking bow wave
			speed: [ 'f32', 0 ],
			washW: [ 'f32', 0.6 ], // half width of the wash at the transom
			boil: [ 'f32', 1.2 ], // turbulent stirring of the surface (boils)
			visc: [ 'f32', 0.006 ], // m^2/s, damps grid-scale waves (~k^2)
			dyn: [ 'f32', 0 ], // dynamic pressure head at the entry, K U^2 / 2g (m)
			hollow: [ 'f32', 1 ], // length of the transom hollow (m)
			hollowK: [ 'f32', 0 ],
			amplitude: [ 'f32', 1 ],
			foamGain: [ 'f32', 0.35 ], // thick churn at the transom, patchy lace behind
			aerGain: [ 'f32', 1 ],
			aerOut: [ 'f32', 0.3 ], // output aeration at saturation (0..1)
			nearRate: [ 'f32', 1 ],
		}, { label: 'wake kernel params' } );
		const R = this.readerParams = new UniformBlock( 'WakeParams', {
			center: 'vec2f', boatPos: 'vec2f', boatRot: 'vec2f', dead: 'vec2f',
			amount: 'f32', amplitude: 'f32', aerOut: 'f32',
		}, { label: 'wake params' } );
		// the readers see the same handles
		for ( const k of R.order ) R.fields[ k ] = K.fields[ k ];

		const U = K.fields;
		// ---- window (cell indices), output fade
		this.uOrigin = U.origin;
		this.uPrev = U.prev;
		this.uReset = U.reset;
		this.uDt = U.dt;
		this.uCenter = U.center;
		this.uAmount = U.amount;

		// ---- boat
		this.uBoatPos = U.boatPos;
		this.uBoatRot = U.boatRot;
		this.uTrim = U.trim;
		this.uSource = U.source;
		this.uWash = U.wash;
		this.uBow = U.bow;
		this.uSpeed = U.speed;
		this.uWashW = U.washW;
		this.uBoil = U.boil;
		this.uVisc = U.visc;
		this.uDyn = U.dyn;
		this.dynamicPressure = 0.35; // K
		this.uHollow = U.hollow;
		this.uHollowK = U.hollowK;

		// ---- tuning
		this.amplitude = U.amplitude;
		this.foamGain = U.foamGain;
		this.sourceGain = 0.72; // near-field waves ~0.2-0.4 m at cruise

		this.state = new StorageBuffer( { label: 'wakeState', count: N * N, type: 'vec4f' } ); // h, w, foam, turbulence
		this.scratch = new StorageBuffer( { label: 'wakeScratch', count: N * N, type: 'vec4f' } ); // h, w', foam', turb'
		this.spec = new StorageBuffer( { label: 'wakeSpectrum', count: N * N, type: 'vec4f' } ); // two packed complex fields
		// aeration: bubbles mixed into the water column by the propeller race and breaking (the
		// turquoise-milky water under and around the foam); slower than the surface foam
		this.aerA = new StorageBuffer( { label: 'wakeAer', count: N * N, type: 'f32' } );
		this.aerB = new StorageBuffer( { label: 'wakeAerNext', count: N * N, type: 'f32' } );
		this.aerGain = U.aerGain;
		this.aerOut = U.aerOut;

		// (h, dh/dx, dh/dz, foam), sampled linear / repeat (smpLinearRepeat)
		this.display = new Texture( { label: 'wakeDisplay', width: N, height: N, format: 'rgba16float', usage: [ 'sample', 'storage' ], sampler: 'linearRepeat' } );
		// read with textureLoad: no sampler binding
		this.aerTex = new Texture( { label: 'wakeAeration', width: N, height: N, format: 'rgba16float', usage: [ 'sample', 'storage' ], sampler: 'nearestRepeat' } );

		// The boat must not feel its own steady wave pattern through the water queries (the
		// controller models its hydrodynamics already, and the 1-3 frame query latency turns that
		// self-coupling into porpoising). A boat-frame running mean of the wake height under the
		// hull is subtracted inside the footprint: waves moving relative to the hull (crossing an
		// old wake) still get through.
		this.nearBuf = new StorageBuffer( { label: 'wakeNearMean', count: TW * TH, type: 'f32' } );
		// read with textureLoad: no sampler binding
		this.nearTex = new Texture( { label: 'wakeNearField', width: TW, height: TH, format: 'rgba16float', usage: [ 'sample', 'storage' ], sampler: 'nearestClamp' } );
		this.uNearRate = U.nearRate;
		this.uDead = U.dead;

		this._bakeHull();
		this._bakePiles( colliders );
		this._buildKernels();
		this._buildReaders();

		this.center = new Vector2(); // window centre (cells, integer)
		this.hasWindow = false;
		this.sleeping = true;
		this.idleTime = 1e9;
		this.stepCount = 0;
		this.primed = false;
		this.settleTime = 40; // s of calm before the simulation goes to sleep

	}

	// ---------------------------------------------------------------- setup

	// Hull immersion at the design waterline over the boat frame (x = |port|, z = forward),
	// blurred to the grid scale so the moving pressure field does not excite grid noise.
	_bakeHull() {

		const L = this.lines;
		const NX = 24, NZ = 112;
		const X1 = 1.9, Z0 = L.zAft - 0.8, Z1 = L.wlEnd + 0.8;
		const R = 0.55;
		const data = new Uint16Array( NX * NZ );
		for ( let iz = 0; iz < NZ; iz ++ ) {

			for ( let ix = 0; ix < NX; ix ++ ) {

				const x = ( ix + 0.5 ) / NX * X1, z = Z0 + ( iz + 0.5 ) / NZ * ( Z1 - Z0 );
				let sum = 0, wsum = 0;
				for ( let u = - 3; u <= 3; u ++ ) {

					for ( let v = - 3; v <= 3; v ++ ) {

						const dx = u / 3 * R, dz = v / 3 * R;
						const wgt = Math.exp( - ( dx * dx + dz * dz ) / ( R * R * 0.4 ) );
						const y = L.bottomAt( x + dx, z + dz );
						sum += wgt * ( Number.isFinite( y ) ? Math.max( 0, - y ) : 0 );
						wsum += wgt;

					}

				}

				data[ iz * NX + ix ] = DataUtils.toHalfFloat( ix === NX - 1 || iz === 0 || iz === NZ - 1 ? 0 : sum / wsum );

			}

		}

		// linear filter, clamp (smpLinearClamp)
		this.hullTex = new Texture( { label: 'wakeHull', width: NX, height: NZ, format: 'r16float', data, sampler: 'linearClamp' } );
		this.hullBox = { X1, Z0, Z1 };

	}

	// Fraction of each grid cell blocked by the pier piles standing in the water (cells are made
	// rigid). Land, cliffs and the sea stacks come from the terrain.
	_bakePiles( colliders ) {

		const piles = colliders ? colliders.cylinders.filter( ( c ) => c.tag === 'pile' && c.yMin < - 0.1 && c.yMax > 0.2 ) : [];
		let x0 = 0, z0 = 0, x1 = 1, z1 = 1;
		if ( piles.length ) {

			x0 = Math.min( ...piles.map( ( c ) => c.x - c.radius ) ) - 1;
			x1 = Math.max( ...piles.map( ( c ) => c.x + c.radius ) ) + 1;
			z0 = Math.min( ...piles.map( ( c ) => c.z - c.radius ) ) - 1;
			z1 = Math.max( ...piles.map( ( c ) => c.z + c.radius ) ) + 1;

		}

		const res = Math.max( 0.1, ( x1 - x0 ) / 2048, ( z1 - z0 ) / 2048 );
		const W = Math.max( 2, Math.ceil( ( x1 - x0 ) / res ) ), H = Math.max( 2, Math.ceil( ( z1 - z0 ) / res ) );
		const cover = new Float32Array( W * H );
		const sub = 4;
		for ( const c of piles ) {

			const ia = Math.floor( ( c.x - c.radius - x0 ) / res ), ib = Math.ceil( ( c.x + c.radius - x0 ) / res );
			const ja = Math.floor( ( c.z - c.radius - z0 ) / res ), jb = Math.ceil( ( c.z + c.radius - z0 ) / res );
			for ( let j = Math.max( 0, ja ); j <= Math.min( H - 1, jb ); j ++ ) {

				for ( let i = Math.max( 0, ia ); i <= Math.min( W - 1, ib ); i ++ ) {

					let n = 0;
					for ( let a = 0; a < sub; a ++ ) for ( let b = 0; b < sub; b ++ ) {

						const px = x0 + ( i + ( a + 0.5 ) / sub ) * res, pz = z0 + ( j + ( b + 0.5 ) / sub ) * res;
						if ( ( px - c.x ) ** 2 + ( pz - c.z ) ** 2 < c.radius * c.radius ) n ++;

					}

					cover[ j * W + i ] = Math.min( 1, cover[ j * W + i ] + n / ( sub * sub ) );

				}

			}

		}

		// box filter over one grid cell -> blocked fraction of a cell centred at each texel
		const k = Math.max( 1, Math.round( CELL / res / 2 ) );
		const data = new Uint16Array( W * H );
		for ( let j = 0; j < H; j ++ ) {

			for ( let i = 0; i < W; i ++ ) {

				let s = 0, n = 0;
				for ( let b = - k; b < k; b ++ ) for ( let a = - k; a < k; a ++ ) {

					const ii = i + a, jj = j + b;
					if ( ii >= 0 && jj >= 0 && ii < W && jj < H ) s += cover[ jj * W + ii ];
					n ++;

				}

				data[ j * W + i ] = DataUtils.toHalfFloat( s / n );

			}

		}

		// linear filter, clamp (smpLinearClamp)
		this.pileTex = new Texture( { label: 'wakePiles', width: W, height: H, format: 'r16float', data, sampler: 'linearClamp' } );
		this.pileCount = piles.length;
		this.uPileBox = this.kernelParams.fields.pileBox;
		this.uPileBox.value.set( x0, z0, x1 - x0, z1 - z0 );

	}

	// ---------------------------------------------------------------- kernels

	_buildKernels() {

		const HB = this.hullBox;
		const L = this.lines;

		// constants + hashes shared by the kernels and the readers
		this.commonModule = new ShaderModule( {
			name: 'wakeCommon',
			deps: [ commonModule ],
			code: /* wgsl */`
const WAKE_N: u32 = ${ N }u;
const WAKE_HALF: u32 = ${ HALF }u;
const WAKE_MASK: u32 = ${ MASK }u;
const WAKE_CELL: f32 = ${ f( CELL ) };
const WAKE_SIZE: f32 = ${ f( SIZE ) };
const WAKE_TW: u32 = ${ TW }u;
const WAKE_TH: u32 = ${ TH }u;

// integer lattice hash -> [0, 1), smooth value noise
fn wakeHash( ix: i32, iy: i32 ) -> f32 {
	var v = ( u32( ix ) * 0x8da6b343u ) ^ ( u32( iy ) * 0xd8163841u );
	v = ( v ^ ( v >> 13u ) ) * 0x5bd1e995u;
	v = v ^ ( v >> 15u );
	return f32( v >> 8u ) * ( 1.0 / 16777216.0 );
}

fn wakeNoise( q: vec2f ) -> f32 {
	let i = floor( q );
	let fr = fract( q );
	let u = fr * fr * ( 3.0 - 2.0 * fr );
	let ix = i32( i.x ); let iy = i32( i.y );
	let a = wakeHash( ix, iy ); let b = wakeHash( ix + 1, iy );
	let c = wakeHash( ix, iy + 1 ); let d = wakeHash( ix + 1, iy + 1 );
	return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}
`,
		} );

		// state buffers, hull map and the simulation parameters (compute only)
		const simModule = new ShaderModule( {
			name: 'wakeSim',
			deps: [ this.commonModule, this.terrain.module ],
			uniforms: this.kernelParams,
			uniformName: 'wk',
			bindings: {
				wakeState: { storage: this.state, access: 'read_write' },
				wakeScratch: { storage: this.scratch, access: 'read_write' },
				wakeSpec: { storage: this.spec, access: 'read_write' },
				wakeAerA: { storage: this.aerA, access: 'read_write' },
				wakeAerB: { storage: this.aerB, access: 'read_write' },
				wakeHullTex: { texture: this.hullTex },
			},
			code: /* wgsl */`
const WAKE_LOG2N: u32 = ${ LOG2N }u;

fn wakeBrev( v: u32 ) -> u32 { return reverseBits( v ) >> ( 32u - WAKE_LOG2N ); }

// toroidal texel -> world cell index in the window starting at o
fn wakeWorldIndex( i: i32, o: i32 ) -> i32 { return o + ( ( i - o ) & i32( WAKE_MASK ) ); }
fn wakeInWindow( I: i32, J: i32, o: vec2f ) -> bool {
	return I >= i32( o.x ) && I < i32( o.x ) + i32( WAKE_N ) && J >= i32( o.y ) && J < i32( o.y ) + i32( WAKE_N );
}

// state of texel (c, r) if it held the same world cell last step, else zero
fn wakeLoadState( c: u32, r: u32 ) -> vec4f {
	let I = wakeWorldIndex( i32( c ), i32( wk.origin.x ) );
	let J = wakeWorldIndex( i32( r ), i32( wk.origin.y ) );
	let keep = wakeInWindow( I, J, wk.prev ) && wk.reset < 0.5;
	return select( vec4f( 0.0 ), wakeState[ r * WAKE_N + c ], keep );
}

fn wakeLoadAer( c: u32, r: u32 ) -> f32 {
	let I = wakeWorldIndex( i32( c ), i32( wk.origin.x ) );
	let J = wakeWorldIndex( i32( r ), i32( wk.origin.y ) );
	let keep = wakeInWindow( I, J, wk.prev ) && wk.reset < 0.5;
	return select( 0.0, wakeAerA[ r * WAKE_N + c ], keep );
}

fn wakeCellPos( c: u32, r: u32 ) -> vec2f {
	let I = wakeWorldIndex( i32( c ), i32( wk.origin.x ) );
	let J = wakeWorldIndex( i32( r ), i32( wk.origin.y ) );
	return vec2f( f32( I ) + 0.5, f32( J ) + 0.5 ) * WAKE_CELL;
}

// sqrt of the blend weights of the four operators (deep, 6, 1.8, 0.6 m) for local depth d:
// the two levels bracketing d share the weight (fitted for <= 5 % phase-speed error over
// 1-100 m wavelengths down to 0.5 m depth); below 0.6 m the shallowest one fades out
fn wakeDepthWeights( d: f32 ) -> vec4f {
	let t0 = 1.0 - exp( ( d - 6.0 ) / - 9.0 );
	let t1 = pow( sat( ( d - 1.8 ) / 4.2 ), 0.8 );
	let t2 = pow( sat( ( d - 0.6 ) / 1.2 ), 0.85 );
	let w0 = select( 0.0, t0, d > 6.0 );
	let w1 = select( select( 0.0, t1, d > 1.8 ), 1.0 - t0, d > 6.0 );
	let w2 = select( select( select( 0.0, t2, d > 0.6 ), 1.0 - t1, d > 1.8 ), 0.0, d > 6.0 );
	let w3 = select( select( sat( d / 0.6 ), 1.0 - t2, d > 0.6 ), 0.0, d > 1.8 );
	return sqrt( vec4f( w0, w1, w2, w3 ) );
}

// hull immersion (m) at boat-frame (x, z): design immersion + scheduled heave / trim
fn wakeImmersionAt( x: f32, z: f32 ) -> f32 {
	let huv = vec2f( abs( x ) / ${ f( HB.X1 ) }, ( z - ${ f( HB.Z0 ) } ) / ${ f( HB.Z1 - HB.Z0 ) } );
	let D = textureSampleLevel( wakeHullTex, smpLinearClamp, huv, 0.0 ).x;
	return max( D + wk.trim.x + wk.trim.y * x + wk.trim.z * z, 0.0 ) * smoothstep( 0.0, 0.04, D );
}

// radix-2 DIT butterflies (bit-reversed in, natural order out); dir = -1 forward, +1 inverse
// (unnormalized): twiddle and pair index of thread t in stage s
fn wakeTwiddle( t: u32, s: u32, dir: f32 ) -> vec2f {
	let half = 1u << s;
	let pos = t & ( half - 1u );
	let ang = f32( pos ) * ( dir * PI / f32( half ) );
	return vec2f( cos( ang ), sin( ang ) );
}
fn wakeStageIndex( t: u32, s: u32 ) -> u32 {
	let half = 1u << s;
	return ( ( t >> s ) << ( s + 1u ) ) | ( t & ( half - 1u ) );
}
fn wakeCmul( b: vec4f, w: vec2f ) -> vec4f {
	return vec4f( b.x * w.x - b.y * w.y, b.x * w.y + b.y * w.x, b.z * w.x - b.w * w.y, b.z * w.y + b.w * w.x );
}
`,
		} );

		// FFT stages over one or two N-point sequences of complex pairs (vec4) in the workgroup array
		// `sh` (inlined: a workgroup array can't be passed to a function by value)
		const stages = ( sh, bases, dir ) => /* wgsl */`
	for ( var s = 0u; s < WAKE_LOG2N; s++ ) {
		let half = 1u << s;
		let i0 = wakeStageIndex( t, s );
		let w = wakeTwiddle( t, s, ${ f( dir ) } );
${ bases.map( ( base ) => /* wgsl */`		{
			let i = i0 + ${ base }u;
			let j = i + half;
			let a = ${ sh }[ i ];
			let bw = wakeCmul( ${ sh }[ j ], w );
			${ sh }[ i ] = a + bw;
			${ sh }[ j ] = a - bw;
		}
` ).join( '' ) }		workgroupBarrier();
	}
`;

		// ---- pass 1: per-cell physics + forward FFT along rows
		const cellPhysics = /* wgsl */`
fn wakeCell( col: u32, row: u32 ) -> vec4f {
	let dt = wk.dt;
	let idx = row * WAKE_N + col;
	let p = wakeCellPos( col, row );
	let s = wakeLoadState( col, row );
	let cL = ( col + WAKE_MASK ) & WAKE_MASK; let cR = ( col + 1u ) & WAKE_MASK;
	let rD = ( row + WAKE_MASK ) & WAKE_MASK; let rU = ( row + 1u ) & WAKE_MASK;
	let sL = wakeLoadState( cL, row ); let sR = wakeLoadState( cR, row );
	let sD = wakeLoadState( col, rD ); let sU = wakeLoadState( col, rU );

	let d = frame.seaLevel - terrainHeightAt( p );

	// boat frame of the cell
	let rel = p - wk.boatPos;
	let cs = wk.boatRot.x; let sn = wk.boatRot.y;
	let bx = rel.x * cs - rel.y * sn;
	let bz = rel.x * sn + rel.y * cs;
	// hull pressure head (m): hydrostatic (immersion, with the speed-scheduled trim) and a
	// dynamic part where the hull enters the water: ~ K U^2/2g times the rise of the bottom
	let e = 0.7;
	let Ph = wakeImmersionAt( bx, bz );
	let entry = max( ( wakeImmersionAt( bx, bz - e ) - wakeImmersionAt( bx, bz + e ) ) / ( 2.0 * e ), 0.0 );
	// transom stern at speed: the flow separates at the transom and leaves a hollow behind it
	// (then the rooster tail and the quarter waves)
	let aft = ${ f( L.zAft ) } - bz;
	let hollow = wakeImmersionAt( bx, ${ f( L.zAft + 0.25 ) } ) * exp( - max( aft, 0.0 ) / wk.hollow ) * smoothstep( - 0.3, 0.3, aft );
	let P = ( max( Ph, hollow * wk.hollowK ) + entry * wk.dyn ) * wk.source;

	// on a (re)start the water under the hull is already displaced: no transient
	let h = select( s.x, - P, wk.reset > 0.5 );
	let w = s.y;

	let gx = ( sR.x - sL.x ) / ( 2.0 * WAKE_CELL ); let gz = ( sU.x - sD.x ) / ( 2.0 * WAKE_CELL );
	let slope = length( vec2f( gx, gz ) );

	// obstacles: dry land, pier piles
	let puv = ( p - wk.pileBox.xy ) / wk.pileBox.zw;
	let pileIn = select( 0.0, 1.0, puv.x > 0.0 && puv.x < 1.0 && puv.y > 0.0 && puv.y < 1.0 );
	let pile = textureSampleLevel( wakePileTex, smpLinearClamp, puv, 0.0 ).x * pileIn;
	let wet = smoothstep( 0.0, 0.05, d );
	let keep = wet * sat( 1.0 - pile * 2.5 );

	// breaking: steep crests (deep water) and depth-limited (surf zone); free waves only, the
	// forced depression under the hull is steep but does not break
	let brk = sat( ( slope - 0.2 ) / 0.2 ) * ( 1.0 - smoothstep( 0.0, 0.03, P ) );
	let surf = sat( ( h - d * 0.42 ) / max( d * 0.3, 0.03 ) ) * wet;
	let turb = s.w;

	// propeller wash / transom wake (boat frame): widens behind the transom, streaky
	// (lateral noise that changes as the boat moves on) and patchy
	let time = frame.time;
	let behind = ${ f( L.zAft ) } - bz;
	let washW = max( behind, 0.0 ) * 0.1 + wk.washW;
	let inWash = smoothstep( - 0.6, 0.3, behind ) * smoothstep( 7.0, 1.5, behind ) * smoothstep( washW, washW * 0.3, abs( bx ) );
	let streak = wakeNoise( vec2f( bx * 1.7, time * 0.9 ) );
	let patchN = wakeNoise( p * 0.45 + time * 0.13 );
	// churning white right behind the transom (the propeller race), streaks and patches further aft
	let race = smoothstep( 7.0, 0.0, behind ) * 0.9;
	// streaks: noise stretched along the track (fixed in the water), deposited with the wash so
	// the band is laid down as long ragged streaks, not a uniform ribbon
	let along = p.x * sn + p.y * cs; let across = p.x * cs - p.y * sn;
	let streaks = wakeNoise( vec2f( along * 0.12, across * 0.9 ) ) * 0.7 + wakeNoise( vec2f( along * 0.3, across * 1.9 ) + 5.3 ) * 0.3;
	let mottle = clamp( ( streaks - 0.5 ) * 3.2, - 0.85, 0.85 ) + 1.0;
	let washGen = inWash * wk.wash * ( wk.speed + 1.5 ) * ( streak * patchN * 0.6 + race + 0.08 ) * mix( mottle, 1.0, smoothstep( 3.0, 0.0, behind ) * 0.7 );

	// bow: the spray thrown off the forward hull falls back in a band just outside the
	// waterline (up to ~1.3 m out), where the bow wave rolls away from the hull
	let outside = 1.0 - smoothstep( 0.0, 0.03, Ph );
	let nearHull = smoothstep( 0.0, 0.03, wakeImmersionAt( max( abs( bx ) - 0.9, 0.0 ), bz ) );
	let bowBand = outside * nearHull * smoothstep( - 0.5, 1.2, bz ) * smoothstep( 4.2, 3.2, bz );
	let bowGen = bowBand * wk.bow * ( wk.speed + 1.0 ) * ( wakeNoise( vec2f( bz * 1.5, time * 3.0 ) ) * 1.4 + 0.1 ) * 0.35;

	// Dissipation is a turbulent eddy viscosity acting on w in flux form: it conserves mass
	// exactly, damps short (breaking, choppy) waves ~k^2 and leaves the refilling flow behind
	// the hull alone. Breaking crests and the surf feed the turbulence; the turbulent wash
	// also stirs the surface (boils).
	let nuC = min( turb * 0.6, 1.0 ) + wk.visc;
	let flux = ( ( nuC + min( sL.w * 0.6, 1.0 ) + wk.visc ) * ( sL.y - w )
		+ ( nuC + min( sR.w * 0.6, 1.0 ) + wk.visc ) * ( sR.y - w )
		+ ( nuC + min( sD.w * 0.6, 1.0 ) + wk.visc ) * ( sD.y - w )
		+ ( nuC + min( sU.w * 0.6, 1.0 ) + wk.visc ) * ( sU.y - w ) ) * ( 0.5 / ( WAKE_CELL * WAKE_CELL ) );
	// boils: Laplacian of (turbulence x noise), so the stirring sums to zero (conserves mass)
	var boil = 0.0;
	if ( turb + sL.w + sR.w + sD.w + sU.w > 0.02 ) {
		let drift = vec2f( time * 0.5, time * - 0.35 );
		let c0 = ( wakeNoise( p * 0.45 + drift ) - 0.5 ) * min( turb, 1.5 );
		boil = ( wakeNoise( ( p - vec2f( WAKE_CELL, 0.0 ) ) * 0.45 + drift ) - 0.5 ) * min( sL.w, 1.5 )
			+ ( wakeNoise( ( p + vec2f( WAKE_CELL, 0.0 ) ) * 0.45 + drift ) - 0.5 ) * min( sR.w, 1.5 )
			+ ( wakeNoise( ( p - vec2f( 0.0, WAKE_CELL ) ) * 0.45 + drift ) - 0.5 ) * min( sD.w, 1.5 )
			+ ( wakeNoise( ( p + vec2f( 0.0, WAKE_CELL ) ) * 0.45 + drift ) - 0.5 ) * min( sU.w, 1.5 )
			- c0 * 4.0;
	}
	let w1 = ( w + flux * dt + boil * ( dt * wk.boil ) ) * exp( dt * - 0.006 ) * keep;

	// foam: thick foam thins quickly (bubbles rise and burst), the lace lingers
	let lapF = ( sL.z + sR.z + sD.z + sU.z - s.z * 4.0 ) / ( WAKE_CELL * WAKE_CELL );
	// foam streaks widen: molecular-ish spreading plus turbulent mixing in the wash
	let f0 = max( s.z + lapF * min( dt * ( turb * 0.3 + 0.04 ), 0.03 ), 0.0 );
	let gen = ( washGen + bowGen + brk * 3.0 + surf * 4.0 ) * wk.foamGain;
	// the lace breaks up as it ages: it lingers in some patches and streaks and clears fast in
	// others (a fixed noise in the water: the pattern stays put while the foam thins)
	let breakup = wakeNoise( p * 0.17 + vec2f( 13.1, 7.3 ) ) * 0.65 + wakeNoise( p * 0.55 + vec2f( 3.7, 1.9 ) ) * 0.35;
	let clr = smoothstep( 0.3, 0.72, breakup ) * 2.6 + 0.2;
	let foam = min( f0 * exp( - dt * ( f0 * f0 * 0.6 + clr / 35.0 ) ) + gen * dt, 3.0 );
	let turb1 = min( turb * exp( dt * ( - 1.0 / 6.0 ) ) + ( inWash * wk.wash * ( wk.speed + 1.5 ) * 0.5 + brk * 4.0 + surf * 6.0 ) * dt, 3.0 );

	// aeration (0..~3): injected broadly by the race (not only where the surface foam is), by
	// breaking and the surf; mixed sideways by the turbulence; the bubbles rise out over ~25 s
	let aC = wakeLoadAer( col, row );
	let lapA = wakeLoadAer( cL, row ) + wakeLoadAer( cR, row ) + wakeLoadAer( col, rD ) + wakeLoadAer( col, rU ) - aC * 4.0;
	let a0 = max( aC + lapA * min( ( turb * 0.35 + 0.07 ) * dt / ( WAKE_CELL * WAKE_CELL ), 0.2 ), 0.0 );
	// the bubble cloud is wider than the white race and its edge wanders (soft, irregular)
	let wA = washW * ( wakeNoise( p * 0.22 + time * 0.05 ) * 0.8 + 0.8 );
	let aerBand = smoothstep( - 0.6, 0.3, behind ) * smoothstep( 9.0, 2.0, behind ) * smoothstep( wA, wA * 0.2, abs( bx ) );
	let aerGen = ( aerBand * wk.wash * ( wk.speed + 1.5 ) * ( ( race * 1.2 + 0.15 ) * ( patchN * 1.3 + streak * 0.5 + 0.1 ) )
		* ( mottle * mottle * 0.55 ) + bowGen * 0.6 + brk * 1.5 + surf * 2.0 ) * wk.aerGain;
	// bubbles rise out over ~25 s, faster in some patches (mottled as it ages)
	let rise = smoothstep( 0.25, 0.75, breakup * 0.6 + patchN * 0.4 ) * 1.3 + 0.45;
	let aer = min( a0 * exp( - dt * ( a0 * 0.06 + rise / 25.0 ) ) + aerGen * dt, 3.0 ) * wet;
	wakeAerB[ idx ] = aer;
	textureStore( wakeAerOut, vec2u( col, row ), vec4f( aer, 0.0, 0.0, 0.0 ) );

	wakeScratch[ idx ] = vec4f( h, w1, foam, turb1 );
	// the free surface is h (pushed down under the hull, the hollow behind the transom)
	textureStore( wakeDisplayOut, vec2u( col, row ), vec4f( h, gx, gz, foam ) );

	return wakeDepthWeights( d ) * ( h + P );
}
`;

		this.rowKernel = new ComputeKernel( {
			label: 'Wake Rows',
			modules: [ simModule ],
			bindings: {
				wakePileTex: { texture: this.pileTex },
				wakeDisplayOut: { storageTexture: this.display, access: 'write' },
				wakeAerOut: { storageTexture: this.aerTex, access: 'write' },
			},
			workgroupSize: [ HALF, 1, 1 ],
			code: cellPhysics + /* wgsl */`
var<workgroup> shRow: array<vec4f, ${ N }>;

@compute @workgroup_size( WG_X, 1, 1 )
fn main( @builtin( local_invocation_id ) lid: vec3u, @builtin( workgroup_id ) wid: vec3u ) {
	let t = lid.x;
	let row = wid.x;
	for ( var e = 0u; e < 2u; e++ ) {
		let col = t + e * WAKE_HALF;
		shRow[ wakeBrev( col ) ] = wakeCell( col, row );
	}
	workgroupBarrier();
${ stages( 'shRow', [ 0 ], - 1 ) }
	for ( var e = 0u; e < 2u; e++ ) {
		let col = t + e * WAKE_HALF;
		wakeSpec[ row * WAKE_N + col ] = shRow[ col ];
	}
}
`,
		} );

		// ---- pass 2: columns kx and -kx together (separates the two packed real fields)
		const dk = 2 * Math.PI / SIZE;
		const norm = 1 / ( N * N );
		// exp-based tanh overflows: clamp the argument
		const Lk = DEPTHS.map( ( D ) => ( D === Infinity ? 'k' : `k * tanh( min( k * ${ f( D ) }, 12.0 ) )` ) + ` * ${ f( norm ) }` );
		this.colKernel = new ComputeKernel( {
			label: 'Wake Columns',
			modules: [ simModule ],
			bindings: {
				wakeDisplayTex: { texture: this.display },
				wakeNearBuf: { storage: this.nearBuf, access: 'read_write' },
				wakeNearOut: { storageTexture: this.nearTex, access: 'write' },
			},
			workgroupSize: [ HALF, 1, 1 ],
			code: /* wgsl */`
var<workgroup> shCol: array<vec4f, ${ N * 2 }>;

// Z = FFT(a) + i FFT(b) for each packed pair of real fields (a, b) = (s_i u, s_j u);
// Y = L_i FFT(a) + i L_j FFT(b) = Z (L_i + L_j) / 2 + conj( Z(-k) ) (L_i - L_j) / 2
fn wakeApply( Z: vec4f, Zm: vec4f, p: vec2f, m: vec2f ) -> vec4f {
	return vec4f( Z.x * p.x + Zm.x * m.x, Z.y * p.x - Zm.y * m.x, Z.z * p.y + Zm.z * m.y, Z.w * p.y - Zm.w * m.y );
}

@compute @workgroup_size( WG_X, 1, 1 )
fn main( @builtin( local_invocation_id ) lid: vec3u, @builtin( workgroup_id ) wid: vec3u ) {
	let t = lid.x;
	let wg = wid.x;
	if ( wg <= WAKE_HALF ) {
		let cA = wg;
		let cB = ( WAKE_N - wg ) & WAKE_MASK;
		for ( var e = 0u; e < 2u; e++ ) {
			let r = t + e * WAKE_HALF;
			let rb = wakeBrev( r );
			shCol[ rb ] = wakeSpec[ r * WAKE_N + cA ];
			shCol[ rb + WAKE_N ] = wakeSpec[ r * WAKE_N + cB ];
		}
		workgroupBarrier();
${ stages( 'shCol', [ 0, N ], - 1 ) }
		let fx = f32( select( i32( cA ) - i32( WAKE_N ), i32( cA ), cA < WAKE_HALF ) ) * ${ f( dk ) };
		var outs: array<vec4f, 4>;
		for ( var e = 0u; e < 2u; e++ ) {
			let r = t + e * WAKE_HALF;
			let rm = ( WAKE_N - r ) & WAKE_MASK;
			let fz = f32( select( i32( r ) - i32( WAKE_N ), i32( r ), r < WAKE_HALF ) ) * ${ f( dk ) };
			let k = length( vec2f( fx, fz ) );
			let L0 = ${ Lk[ 0 ] }; let L1 = ${ Lk[ 1 ] }; let L2 = ${ Lk[ 2 ] }; let L3 = ${ Lk[ 3 ] };
			let p = vec2f( L0 + L1, L2 + L3 ) * 0.5;
			let m = vec2f( L0 - L1, L2 - L3 ) * 0.5;
			outs[ e * 2u ] = wakeApply( shCol[ r ], shCol[ rm + WAKE_N ], p, m );
			outs[ e * 2u + 1u ] = wakeApply( shCol[ r + WAKE_N ], shCol[ rm ], p, m );
		}
		workgroupBarrier();
		for ( var e = 0u; e < 2u; e++ ) {
			let rb = wakeBrev( t + e * WAKE_HALF );
			shCol[ rb ] = outs[ e * 2u ];
			shCol[ rb + WAKE_N ] = outs[ e * 2u + 1u ];
		}
		workgroupBarrier();
${ stages( 'shCol', [ 0, N ], 1 ) }
		for ( var e = 0u; e < 2u; e++ ) {
			let r = t + e * WAKE_HALF;
			wakeSpec[ r * WAKE_N + cA ] = shCol[ r ];
			if ( cB != cA ) {
				wakeSpec[ r * WAKE_N + cB ] = shCol[ r + WAKE_N ];
			}
		}
	} else if ( wg <= WAKE_HALF + ${ Math.ceil( TW * TH / HALF ) }u ) {
		// near-field template (spare workgroups): running mean of the wake height at
		// boat-frame points
		let k = ( wg - ( WAKE_HALF + 1u ) ) * WAKE_HALF + t;
		if ( k < WAKE_TW * WAKE_TH ) {
			let tx = k % WAKE_TW; let tz = k / WAKE_TW;
			let bx = ( f32( tx ) + 0.5 ) * ${ f( ( TX1 - TX0 ) / TW ) } + ${ f( TX0 ) };
			let bz = ( f32( tz ) + 0.5 ) * ${ f( ( TZ1 - TZ0 ) / TH ) } + ${ f( TZ0 ) };
			let cs = wk.boatRot.x; let sn = wk.boatRot.y;
			let pw = wk.boatPos + vec2f( bx * cs + bz * sn, bz * cs - bx * sn );
			let eta = textureSampleLevel( wakeDisplayTex, smpLinearRepeat, pw / WAKE_SIZE, 0.0 ).x;
			let prev = wakeNearBuf[ k ];
			let mean = prev + ( eta - prev ) * wk.nearRate;
			wakeNearBuf[ k ] = mean;
			let border = tx == 0u || tx == WAKE_TW - 1u || tz == 0u || tz == WAKE_TH - 1u;
			let D = textureSampleLevel( wakeHullTex, smpLinearClamp, vec2f( abs( bx ) / ${ f( HB.X1 ) }, ( bz - ${ f( HB.Z0 ) } ) / ${ f( HB.Z1 - HB.Z0 ) } ), 0.0 ).x;
			let m = select( smoothstep( 0.0, 0.03, D ), 0.0, border );
			textureStore( wakeNearOut, vec2u( tx, tz ), vec4f( mean, m, 0.0, 0.0 ) );
		}
	}
}
`,
		} );

		// ---- pass 3: inverse FFT along rows, time step, sponge
		this.invKernel = new ComputeKernel( {
			label: 'Wake Inverse',
			modules: [ simModule ],
			workgroupSize: [ HALF, 1, 1 ],
			code: /* wgsl */`
var<workgroup> shRow: array<vec4f, ${ N }>;

@compute @workgroup_size( WG_X, 1, 1 )
fn main( @builtin( local_invocation_id ) lid: vec3u, @builtin( workgroup_id ) wid: vec3u ) {
	let t = lid.x;
	let row = wid.x;
	let dt = wk.dt;
	for ( var e = 0u; e < 2u; e++ ) {
		let col = t + e * WAKE_HALF;
		shRow[ wakeBrev( col ) ] = wakeSpec[ row * WAKE_N + col ];
	}
	workgroupBarrier();
${ stages( 'shRow', [ 0 ], 1 ) }
	let rl = f32( ( i32( row ) - i32( wk.origin.y ) ) & i32( WAKE_MASK ) ) + 0.5;
	let ez = min( rl, f32( WAKE_N ) - rl );
	for ( var e = 0u; e < 2u; e++ ) {
		let col = t + e * WAKE_HALF;
		let idx = row * WAKE_N + col;
		let Y = shRow[ col ];
		let sc = wakeScratch[ idx ];
		let p = wakeCellPos( col, row );
		let d = frame.seaLevel - terrainHeightAt( p );
		let Lu = dot( wakeDepthWeights( d ), Y );
		let w1 = sc.y - Lu * ( dt * ${ f( GRAVITY ) } );
		let h1 = sc.x + w1 * dt;
		let cl = f32( ( i32( col ) - i32( wk.origin.x ) ) & i32( WAKE_MASK ) ) + 0.5;
		let edge = min( min( cl, f32( WAKE_N ) - cl ), ez );
		let sig = smoothstep( ${ f( SPONGE ) }, 0.0, edge );
		let k = exp( dt * ( sig * sig * - 6.0 ) );
		wakeState[ idx ] = vec4f( h1 * k, w1 * k, sc.z, sc.w );
		wakeAerA[ idx ] = wakeAerB[ idx ];
	}
}
`,
		} );

	}

	// ---------------------------------------------------------------- readers (WGSL)

	_buildReaders() {

		// one sampler for the whole wake: the display texture (height, slopes, foam); the
		// near-field template and the aeration are read with textureLoad (no sampler)
		this.module = new ShaderModule( {
			name: 'wake',
			deps: [ this.commonModule ],
			uniforms: this.readerParams,
			uniformName: 'wakeParams',
			bindings: {
				wakeDisplay: { texture: this.display },
				wakeNear: { texture: this.nearTex },
				wakeAerTex: { texture: this.aerTex },
			},
			code: /* wgsl */`
fn wakeEdgeDist( xz: vec2f ) -> f32 {
	let rel = abs( xz - wakeParams.center );
	return WAKE_SIZE / 2.0 - max( rel.x, rel.y );
}
fn wakeFade( xz: vec2f ) -> f32 { return smoothstep( 4.0, 16.0, wakeEdgeDist( xz ) ) * wakeParams.amount; }
// foam and aeration: a long fade toward the window edge, no visible end of the track
fn wakeFadeLong( xz: vec2f ) -> f32 { return smoothstep( 4.0, 45.0, wakeEdgeDist( xz ) ) * wakeParams.amount; }

// template texel coordinates of world xz (boat frame)
fn wakeNearCoord( xz: vec2f ) -> vec2f {
	let rel = xz - wakeParams.boatPos;
	let cs = wakeParams.boatRot.x; let sn = wakeParams.boatRot.y;
	let bx = rel.x * cs - rel.y * sn; let bz = rel.x * sn + rel.y * cs;
	return vec2f( ( bx - ${ f( TX0 ) } ) * ${ f( TW / ( TX1 - TX0 ) ) }, ( bz - ${ f( TZ0 ) } ) * ${ f( TH / ( TZ1 - TZ0 ) ) } ) - 0.5;
}
fn wakeInTemplate( tc: vec2f ) -> bool { return tc.x > 0.0 && tc.y > 0.0 && tc.x < ${ f( TW - 1 ) } && tc.y < ${ f( TH - 1 ) }; }

// (outside the simulated window, or asleep, both fades are 0: nothing to read)
fn wakeOff( xz: vec2f ) -> bool { return wakeParams.amount <= 0.0 || wakeEdgeDist( xz ) <= 4.0; }

fn wakeSample( xz: vec2f ) -> vec4f {
	if ( wakeOff( xz ) ) { return vec4f( 0.0 ); }
	var s = textureSampleLevel( wakeDisplay, smpLinearRepeat, xz / WAKE_SIZE, 0.0 ) * vec4f( vec3f( wakeFade( xz ) ), wakeFadeLong( xz ) );
	// the forced depression under the hull is covered by it: keep its edge out of the normals
	let tc = wakeNearCoord( xz );
	if ( wakeInTemplate( tc ) ) {
		let m = textureLoad( wakeNear, vec2i( tc + 0.5 ), 0 ).y;
		s = vec4f( s.x, s.yz * ( 1.0 - m ), s.w );
	}
	return s;
}

// aeration (0..aerOut): the aeration texture is read with textureLoad (bilinear by hand), then
// mottled: a noise fixed in the water sets how milky each patchN is and where the band's edge
// falls (soft, irregular), so it breaks into clouds and streaks instead of a uniform ribbon
fn wakeAeration( xz: vec2f ) -> f32 {
	var out = 0.0;
	if ( wakeOff( xz ) ) { return out; }
	let tc = xz / WAKE_CELL - 0.5;
	let i = vec2i( floor( tc ) );
	let fr = fract( tc );
	let M = vec2i( i32( WAKE_MASK ) );
	let a = mix( mix( textureLoad( wakeAerTex, i & M, 0 ).x, textureLoad( wakeAerTex, ( i + vec2i( 1, 0 ) ) & M, 0 ).x, fr.x ),
		mix( textureLoad( wakeAerTex, ( i + vec2i( 0, 1 ) ) & M, 0 ).x, textureLoad( wakeAerTex, ( i + vec2i( 1, 1 ) ) & M, 0 ).x, fr.x ), fr.y );
	if ( a > 0.01 ) {
		let m = wakeNoise( xz * 0.3 + vec2f( frame.time * 0.02, 0.0 ) ) * 0.55 + wakeNoise( xz * 0.85 + 17.3 ) * 0.45;
		let aN = ( 1.0 - exp( a * - 0.5 ) ) * ( m * 0.8 + 0.6 );
		out = smoothstep( m * 0.2 + 0.03, m * 0.2 + 0.55, aN ) * wakeParams.aerOut * wakeFadeLong( xz );
	}
	return out;
}

fn wakeHeight( xz: vec2f ) -> f32 {
	if ( wakeOff( xz ) ) { return 0.0; }
	var h = textureSampleLevel( wakeDisplay, smpLinearRepeat, xz / WAKE_SIZE, 0.0 ).x;
	let tc = wakeNearCoord( xz );
	if ( wakeInTemplate( tc ) ) {
		// under the hull only waves moving relative to it remain (an old wake being crossed);
		// small residuals are sampling jitter of the steep near field and are dropped
		// (bilinear by hand: the template has no sampler)
		let i = vec2i( floor( tc ) );
		let fr = fract( tc );
		let a = textureLoad( wakeNear, i, 0 ); let b = textureLoad( wakeNear, i + vec2i( 1, 0 ), 0 );
		let c = textureLoad( wakeNear, i + vec2i( 0, 1 ), 0 ); let d = textureLoad( wakeNear, i + vec2i( 1, 1 ), 0 );
		let t = mix( mix( a, b, fr.x ), mix( c, d, fr.x ), fr.y );
		let r = h - t.x;
		h = mix( h, r * smoothstep( wakeParams.dead.x, wakeParams.dead.y, abs( r ) ), t.y );
	}
	return h * wakeFade( xz ) * wakeParams.amplitude;
}

// Displacement (vec3) of the wake surface at world xz (Lagrangian point of the ocean grid).
fn wakeDisplacement( xz: vec2f ) -> vec3f { return vec3f( 0.0, wakeHeight( xz ), 0.0 ); }

// slopes: (dh/dx, dh/dz), foam, aeration (0..1, bubbles in the water column: the prop race and
// breaking; lingers ~25 s, widening)
struct WakeFrag { slopes: vec2f, foam: f32, aeration: f32 };
fn wakeFragment( xz: vec2f ) -> WakeFrag {
	let s = wakeSample( xz );
	var o: WakeFrag;
	o.slopes = s.yz * wakeParams.amplitude;
	o.foam = s.w;
	o.aeration = wakeAeration( xz );
	return o;
}
`,
		} );

	}

	// ---------------------------------------------------------------- per frame

	_dispatch() {

		GPU.computePass( 'Wake', ( pass ) => {

			this.rowKernel.dispatch( N, { pass } );
			this.colKernel.dispatch( N, { pass } );
			this.invKernel.dispatch( N, { pass } );

		} );

	}

	update( dt ) {

		const b = this.boat;
		const speed = Math.hypot( b.velocity.x, b.velocity.z );
		const moving = speed > 0.5 || ( b.driven && Math.abs( b.throttle ) > 0.04 );
		this.idleTime = moving ? 0 : this.idleTime + dt;

		if ( this.idleTime > this.settleTime ) {

			// asleep: nothing is dispatched; the (faded out) output is ignored by the shaders
			this.sleeping = true;
			this.uAmount.value = 0;
			// one step on the first frame compiles the pipelines behind the loading screen, not
			// when the player first opens the throttle
			if ( ! this.primed ) this._prime();
			return;

		}

		if ( this.sleeping ) {

			this.sleeping = false;
			this.hasWindow = false;
			this.uReset.value = 1;

		}

		this.uAmount.value = Math.min( 1, ( this.settleTime - this.idleTime ) / 4 );
		const h = Math.min( Math.max( dt, 1 / 240 ), 1 / 30 );
		this.uDt.value = h;

		// ---- window: keep the boat inside a box around the centre (moves by whole cells)
		const bx = b.position.x / CELL, bz = b.position.z / CELL;
		const box = 170; // the boat runs up to 68 m off centre: ~170 m of track behind it, ~25 m ahead
		const c = this.center;
		if ( ! this.hasWindow || Math.abs( bx - c.x ) > N || Math.abs( bz - c.y ) > N ) {

			c.set( Math.round( bx ), Math.round( bz ) );
			this.hasWindow = true;
			this.uReset.value = 1;

		}

		if ( bx - c.x > box ) c.x = Math.ceil( bx - box );
		if ( c.x - bx > box ) c.x = Math.floor( bx + box );
		if ( bz - c.y > box ) c.y = Math.ceil( bz - box );
		if ( c.y - bz > box ) c.y = Math.floor( bz + box );
		this.uPrev.value.copy( this.uOrigin.value );
		this.uOrigin.value.set( c.x - HALF, c.y - HALF );
		if ( this.uReset.value > 0.5 ) this.uPrev.value.copy( this.uOrigin.value );
		this.uCenter.value.set( c.x * CELL, c.y * CELL );

		// ---- boat
		const fw = b.forward( _fwd );
		const yaw = Math.atan2( fw.x, fw.z );
		this.uBoatPos.value.set( b.position.x, b.position.z );
		this.uBoatRot.value.set( Math.cos( yaw ), Math.sin( yaw ) );
		this._scheduleTrim( speed );
		this.uSpeed.value = speed;
		this.uDyn.value = this.dynamicPressure * speed * speed / ( 2 * GRAVITY );
		const plane = MathUtils.smoothstep( speed, 2, 9 );
		this.uHollow.value = 0.35 + 0.015 * speed * speed;
		this.uHollowK.value = 0.3 * plane;
		this.uSource.value = this.sourceGain * ( 1 + 0.2 * plane );
		const prop = b.driven ? Math.abs( b.throttle ) * b.rpm : 0;
		this.uWash.value = prop * 1.0 + MathUtils.smoothstep( speed, 1.5, 7 ) * 0.5;
		this.uWashW.value = 0.7 + 0.6 * MathUtils.smoothstep( speed, 2, 9 );
		this.uBow.value = MathUtils.smoothstep( speed, 3.5, 9 );

		this.uNearRate.value = this.uReset.value > 0.5 ? 1 : 1 - Math.exp( - h / 0.25 );
		// (the kernel block uploads when the first kernel binds and nothing else reads it this frame:
		// clearing the reset flag below only affects the next step)
		this._dispatch();
		this.primed = true;
		this.uReset.value = 0;
		this.stepCount ++;

	}

	_prime() {

		this.primed = true;
		this.uReset.value = 1;
		this.uPrev.value.copy( this.uOrigin.value );
		this._dispatch();

	}

	// Immersion change of the hull relative to its design waterline, c + a x + b z (m), scheduled
	// from speed rather than fitted to the boat's pose: the boat feels its own pressure field
	// through the water queries 1-3 frames late, and any dependence of the source on the boat's
	// heave / pitch / roll closes a delayed feedback loop (porpoising). Coming onto the plane the
	// hull rises and the bow lifts out, so the pressure footprint moves aft.
	_scheduleTrim( speed ) {

		const plane = MathUtils.smoothstep( speed, 3, 10 );
		this.uTrim.value.set( - 0.08 * plane, 0, - 0.035 * plane );

	}

}

const _fwd = new Vector3();
