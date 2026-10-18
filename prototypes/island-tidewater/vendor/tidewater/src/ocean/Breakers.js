import { Vector3, Sphere, Mesh, BufferGeometry, BufferAttribute } from '../engine/index.js';
import { GPU, StorageBuffer, UniformBlock, ShaderModule, ComputeKernel, Material, Readback, commonModule, LAYERS } from '../engine/webgpu.js';
import { GRAVITY, G } from '../engine/render/Frame.js';
import { makeLaceTexture, LACE_TILE } from './SurfFoam.js';

// Plunging breakers along the main beach.
//
// Stations are laid out every ~0.6 m along the shoreline (CPU, once). Each frame a compute pass
// marches every station's transect through the surf zone and finds the crests of the breaking
// waves as crossings of the wave phase s = (t - T) / period + wobble with integers (the same
// analytic field that drives the water surface, so the crest found here is exactly the crest of
// the rendered surface). For every crest it stores the lip root, the breaking progress and the
// wave height, and emits spray where a real breaker makes it (rates ~ the energy released there):
//  * nothing while the face steepens: the face and the lip are clean, glassy water
//  * a few drops and ligaments torn off the leading edge of the falling lip, falling with it
//  * the splash-up where the lip hits the trough (the plunge point): a burst of drops, ligaments and
//    dense spray thrown up (up to ~H) and forward, falling back within 1-2 s, a puff blown out of
//    the collapsing barrel, and a mist that drifts off with the wind
//  * the turbulent front of the roller: small drops and a low mist, all the way to the shore, and
//    a splash where the bore runs into the backwash of the previous wave
//  * spindrift (fine drops blown back over the crest) only in a strong offshore wind
// Drops falling back into the water leave foam there (ShoreSim).
//
// The thrown lip is a separate ribbon mesh extruded along the crest (Thuerey et al. 2007): a
// ballistic curtain leaving the crest horizontally and falling in front of the concave face,
// shaded like the water (Fresnel sky reflection, light through the thin sheet, aerated streaks
// that grow toward the tip) and blended over the water with premultiplied alpha. Its root lies
// on the crest of the water surface and fades in there, so there is no visible seam.

//
// WGSL: this.sprayShadowModule (installed as spray.waveShadow) defines
//   fn breakersSprayShadow( p: vec3f, tag: f32 ) -> f32
// Consumes: shore.module (shorePhaseAt, shoreWaveAmp, shoreCrest, shoreShape, shoreBore), the terrain
// module (terrainHeightAt), fft.module (oceanDisplacement), spray.module (sprayReserve, spraySlot,
// sprayWrite, sprayRand), sky.module (skyReflectionRadiance), clouds.module (cloudsShadow).

const NV = 20; // profile vertices across the lip (2 on the back of the crest + 18 along the curtain)

const f = ( x ) => {

	const s = String( x );
	return s.includes( '.' ) || s.includes( 'e' ) ? s : s + '.0';

};

// exact unpolarized dielectric Fresnel (the same as WaterMaterial's fresnelDielectric), cosI > 0, eta = n2/n1
const fresnelModule = new ShaderModule( {
	name: 'breakersFresnel',
	code: /* wgsl */`
fn breakersFresnel( cosI: f32, eta: f32 ) -> f32 {
	let c = clamp( cosI, 0.0, 1.0 );
	let g2 = eta * eta - 1.0 + c * c;
	let g = sqrt( max( g2, 0.0 ) );
	let a = ( g - c ) / ( g + c );
	let b = ( c * ( g + c ) - 1.0 ) / ( c * ( g - c ) + 1.0 );
	return select( 0.5 * a * a * ( b * b + 1.0 ), 1.0, g2 < 0.0 );
}
`,
} );

export class Breakers {

	constructor( renderer, { surface, shore, terrainData, sky, spray = null, clouds = null } ) {

		this.renderer = renderer;
		this.surface = surface;
		this.shore = shore;
		this.sky = sky;
		this.spray = spray;
		this.clouds = clouds;

		this.uniforms = new UniformBlock( 'BreakersParams', {
			cameraPos: [ 'vec3f', new Vector3() ],
			spray: [ 'f32', 1 ], // emission multiplier
			sheet: [ 'f32', 1 ], // lip opacity multiplier
			emitRange: [ 'f32', 240 ], // no emission beyond this camera distance
			amplitude: [ 'f32', 1 ], // WaterSurface.amplitude (FFT displacement scale), copied each update
			budget: [ 'f32', 0.3 ], // emission scale that keeps the spray ring from wrapping (see update)
		} );
		const F = this.uniforms.fields;
		this.params = { spray: F.spray, sheet: F.sheet, emitRange: F.emitRange };
		this.cameraPos = F.cameraPos;

		const t0 = performance.now();
		const st = buildStations( terrainData );
		this.NS = st.count;
		this.spacing = st.spacing;
		this.stationData = st.data;
		this.stations = new StorageBuffer( { label: 'brkStations', count: Math.max( 1, this.NS ), type: 'vec4f', data: st.data.length ? st.data : new Float32Array( 4 ) } );
		// per station and slot (wave parity): 3 x vec4
		//   (root.xyz, b) (back.xyz, H) (dir.xz, trough y, wave id 1..1024 or 0 = none)
		this.crest = new StorageBuffer( { label: 'brkCrest', count: Math.max( 1, this.NS * 6 ), type: 'vec4f' } );
		this.crestRead = { storage: this.crest, access: 'read' };
		this.setupMs = performance.now() - t0;

		// Sun visibility (0..1) for a spray particle made by one of the crests: in front of the wave with
		// the sun behind it (a beach view into the sun) the particles below the crest line are in the
		// shadow of the wave (and of the overhanging lip while it plunges). seedTag: the particle's tag.
		this.sprayShadowModule = new ShaderModule( {
			name: 'breakersSprayShadow',
			deps: [ commonModule ],
			bindings: { breakersCrest: this.crestRead },
			code: /* wgsl */`
fn breakersSprayShadow( p: vec3f, seedTag: f32 ) -> f32 {
	var out = 1.0;
	let idx = floor( seedTag ) - 1.0;
	if ( idx >= 0.0 && idx < ${ f( this.NS * 2 ) } ) {
		let k = u32( idx ) * 3u;
		let c0 = breakersCrest[ k ];
		let c1 = breakersCrest[ k + 1u ];
		let c2 = breakersCrest[ k + 2u ];
		let L = frame.sunDir;
		let d2 = c2.xy;
		let Ld = dot( L.xz, d2 ); // < 0: the sun is on the sea side of the wave
		if ( c2.w > 0.5 && Ld < -0.02 ) {
			let root = c0.xyz;
			let b = c0.w;
			let H = c1.w;
			let q = clamp( b / 0.9, 0.0, 1.0 ) * ( 1.0 - smoothstep( 1.0, 1.3, b ) );
			// vertical plane through the crest (moved forward under the overhanging lip)
			let plane = root.xz + d2 * ( H * 0.8 * q * 0.6 );
			let s = dot( p.xz - plane, d2 ); // > 0: in front of it
			let tau = s / - Ld;
			let yRay = p.y + L.y * tau; // height of the ray toward the sun where it crosses the plane
			let top = root.y + 0.05;
			let shade = smoothstep( top, top - 0.4, yRay ) * smoothstep( -0.1, 0.1, s ) * smoothstep( 14.0, 6.0, s );
			out = 1.0 - shade * 0.55;
		}
	}
	return out;
}
`,
		} );

		if ( spray ) {

			// the spray shader asks the crests for the wave's shadow on the particles they made, and the
			// drops falling back into the water leave foam in the shore simulation
			spray.waveShadow = this.sprayShadowModule;
			if ( ! spray.shoreSim && surface.shoreSim ) spray.shoreSim = surface.shoreSim;

		}

		if ( this.NS > 1 ) {

			this._buildKernel();
			this._buildMesh();

		} else {

			console.warn( 'Breakers: no beach stations found' );
			this.mesh = new Mesh( new BufferGeometry(), new Material( { name: 'BreakerLip', visible: false } ) );
			this.mesh.visible = false;

		}

	}

	update( camera ) {

		this.cameraPos.value.copy( camera.position );
		if ( this.surface && this.surface.amplitude ) this.uniforms.fields.amplitude.value = this.surface.amplitude.value;
		if ( this.kernel ) this.kernel.dispatch( Math.ceil( this.NS / 64 ) );
		this._budget();

	}

	// Emission budget. The emitters write into the spray's GPU ring (NG slots): emitting faster than
	// NG per particle lifetime overwrites particles a few frames after they're born (big surf made
	// ~8k a frame into a 32k ring: every sprite popped out again within ~60 ms). The ring head is read
	// back (a few frames late) and the emission scale steered so the ring holds ~2 s of spray.
	_budget() {

		const sp = this.spray;
		if ( ! sp || ! sp.head ) return;
		if ( ! this._rb ) {

			this._rb = new Readback( { byteLength: 4, ring: 3, label: 'breakersHead' } );
			this._hist = [];
			this._simT = new Map(); // GPU frame -> simulation time (emission is scaled by frame.dt)

		}

		if ( this._rb.request( sp.head ) ) this._simT.set( GPU.frame, G.time.value );
		if ( this._rb.latest && this._simT.has( this._rb.frame ) ) {

			const head = new Uint32Array( this._rb.latest )[ 0 ];
			const now = this._simT.get( this._rb.frame );
			for ( const f of this._simT.keys() ) if ( f < this._rb.frame ) this._simT.delete( f );
			const H = this._hist;
			if ( ! H.length || H[ H.length - 1 ].t !== now ) H.push( { head, t: now } );
			while ( H.length > 2 && now - H[ 0 ].t > 2.5 ) H.shift();
			if ( H.length > 1 ) {

				const a = H[ 0 ], b = H[ H.length - 1 ];
				const dt = b.t - a.t;
				if ( dt > 1.0 ) {

					const rate = ( ( b.head - a.head ) >>> 0 ) / dt; // particles / s (uint wrap safe)
					const target = sp.NG / 2.0;
					const k = this.uniforms.fields.budget;
					const want = rate > 1 ? k.value * Math.sqrt( target / rate ) : 1;
					k.value = Math.min( 1, Math.max( 0.05, k.value + ( want - k.value ) * 0.04 ) );

				}

			}

		}

	}

	// ------------------------------------------------------------------ crest finder + emitters

	_buildKernel() {

		const S = this.surface;
		const NS = this.NS;
		const STEP = 2.0, K = 64; // transects: 128 m seaward from the shoreline
		const fft = S.fft;
		const spray = this.spray;

		// FFT displacement at a Lagrangian point (the short cascades that survive in the surf zone),
		// with WaterSurface.cascadeAttenuation (inlined: the long cascades vanish in shallow water)
		let fftCode = '';
		for ( let c = 1; c < fft.cascades; c ++ ) {

			const L = fft.sizes[ c ];
			const texel = L / 256;
			const level = Math.max( Math.log2( 0.35 / texel ) + 0.7, 0 );
			const d0 = Math.min( 40, L * 0.08 );
			const floorAmt = [ 0.0, 0.05, 0.25, 0.5 ][ c ] ?? 0.5;
			fftCode += `	d += textureSampleLevel( oceanDisplacement, smpLinearRepeat, p / ${ f( L ) }, ${ c }, ${ f( level ) } ).xyz * mix( ${ f( floorAmt ) } * smoothstep( 0.0, 0.6, depth ), 1.0, smoothstep( 0.0, ${ f( d0 ) }, depth ) );\n`;

		}

		const emitCode = spray ? this._emitCode() : '';

		const code = /* wgsl */`
const BRK_GRAVITY: f32 = ${ f( GRAVITY ) };

fn breakersFftDisp( p: vec2f, depth: f32 ) -> vec3f {
	var d = vec3f( 0.0 );
${ fftCode }	return d * breakersP.amplitude;
}

${ emitCode }

// One crest of wave m at Lagrangian point pc (station i): store the lip frame and emit spray.
fn breakersProcessCrest( i: u32, pc: vec2f, m: f32 ) {
	let ph = shorePhaseAt( pc );
	let dir = ph.dir;
	let along = ph.along;
	let ground = terrainHeightAt( pc );
	let depth = frame.seaLevel - ground;
	let A = shoreWaveAmp( m, along );
	let cr = shoreCrest( A, depth ); // ( b, H, trough, lipThrow )
	let b = cr.x;
	let env = smoothstep( 26.0, 13.0, depth ) * sat( ph.exposure * 1.4 ) * shoreP.enabled;

	// followed from before it breaks until the bore reaches the shore (the lip sheet only uses b < 1.25)
	if ( b > -0.6 && env > 0.3 && depth > 0.12 ) {
		let c = sqrt( clamp( depth, 0.3, 25.0 ) * BRK_GRAVITY );
		let lam = c * shoreP.period;
		let s0 = shoreShape( 0.0, A, depth, lam );
		let ub = 0.4 / lam;
		let s1 = shoreShape( ub, A, depth, lam );
		let fd = breakersFftDisp( pc, depth );
		let d3 = vec3f( dir.x, 0.0, dir.y );
		let root = vec3f( pc.x, frame.seaLevel, pc.y ) + d3 * ( s0.x * env ) + vec3f( 0.0, s0.y * env, 0.0 ) + fd;
		let back = vec3f( pc.x, frame.seaLevel, pc.y ) + d3 * ( s1.x * env - 0.4 ) + vec3f( 0.0, s1.y * env, 0.0 ) + fd;
		let H = cr.y * env;
		let trough = frame.seaLevel + cr.z * env + fd.y;
		// slot by wave parity (neighbouring stations agree on it), id = wave index mod 1024, + 1 (0 = none)
		let slot = u32( m - floor( m * 0.5 ) * 2.0 );
		let id = m - floor( m / 1024.0 ) * 1024.0 + 1.0;
		let k = i * 6u + slot * 3u;
		breakersCrestW[ k ] = vec4f( root, b );
		breakersCrestW[ k + 1u ] = vec4f( back, H );
		breakersCrestW[ k + 2u ] = vec4f( dir, trough, id );
${ spray ? '		breakersEmit( i, slot, root, dir, b, H, trough, c, m, depth, shoreBore( A, depth ) );' : '' }
	}
}

@compute @workgroup_size( WG_X, WG_Y, WG_Z )
fn main( @builtin( global_invocation_id ) gid: vec3u ) {
	let i = gid.x;
	if ( i >= ${ NS }u ) { return; }
	let st = breakersStations[ i ];
	let o = st.xy;
	let n = st.zw; // toward the sea
	let base = i * 6u;
	// clear both slots
	breakersCrestW[ base + 2u ] = vec4f( 0.0 );
	breakersCrestW[ base + 5u ] = vec4f( 0.0 );

	var sPrev = 0.0;
	for ( var k = 0; k < ${ K }; k++ ) {
		let dist = f32( k ) * ${ f( STEP ) };
		let s = shorePhaseAt( o + n * dist ).s;
		// s grows seaward: a crest (integer phase) lies between this sample and the previous one
		if ( k > 0 && floor( s ) > floor( sPrev ) ) {
			let m = floor( s );
			// secant refinement on the exact phase
			var lo = dist - ${ f( STEP ) };
			var hi = dist;
			var sLo = sPrev;
			var sHi = s;
			var x = lo + ( m - sLo ) / max( sHi - sLo, 1e-5 ) * ${ f( STEP ) };
			for ( var it = 0; it < 2; it++ ) {
				let sx = shorePhaseAt( o + n * x ).s;
				if ( sx < m ) {
					lo = x;
					sLo = sx;
				} else {
					hi = x;
					sHi = sx;
				}
				x = lo + ( m - sLo ) / max( sHi - sLo, 1e-5 ) * ( hi - lo );
			}
			let pc = o + n * x;
			breakersProcessCrest( i, pc, m );
		}
		sPrev = s;
	}
}
`;

		this.kernel = new ComputeKernel( {
			label: 'Surf Crests',
			modules: [ commonModule, this.shore.module, S.terrain && S.terrain.module, fft.module, spray && spray.module ].filter( Boolean ),
			bindings: {
				breakersP: { uniform: this.uniforms },
				breakersStations: { storage: this.stations, access: 'read' },
				breakersCrestW: { storage: this.crest, access: 'read_write' },
			},
			workgroupSize: [ 64, 1, 1 ],
			code,
		} );

	}

	// Spray from one crest (station i, crest slot `slot`), per frame. Positions and velocities come from
	// the analytic wave state; rates are per station (0.6 m of crest) and scale with the energy the
	// breaker releases (~ H^2.5 for the plunge, ~ Hb^2.5 for the roller).
	_emitCode() {

		return /* wgsl */`
struct BrkCtx {
	root: vec3f,
	d3: vec3f,
	tg: vec3f,
	Yi: f32,
	Wt: f32,
	wB: f32,
	trough: f32,
	xr: f32,
	Xi: f32,
	q: f32,
};

struct BrkPN { p: vec3f, n: vec3f };

// A point on the front of the wave, on the water surface (the same curve as ShoreWaves' profile:
// concave tube face while plunging, convex roller front of the bore), and its outward normal.
// s: 0 = crest top .. 1 = foot. Everything the breaker throws starts just outside it.
fn breakersFacePoint( C: BrkCtx, sp: f32 ) -> BrkPN {
	let up = vec3f( 0.0, 1.0, 0.0 );
	let th = sp * ${ f( Math.PI / 2 ) };
	let ct = cos( th );
	let st = sin( th );
	let fx = mix( 1.0 - ct, st, C.wB );
	let fy = mix( 1.0 - st, ct, C.wB );
	let n = normalize( C.d3 * ( C.Yi * mix( ct, st, C.wB ) ) + up * ( C.Wt * mix( st, ct, C.wB ) + 0.02 ) );
	let p = C.root + C.d3 * ( C.Wt * fx );
	return BrkPN( vec3f( p.x, C.trough + C.Yi * fy, p.z ), n );
}

// the plunge point: in the trough ahead of the face while the tube is open; once the bore front
// has formed over it, on the lower part of that front
fn breakersPlunge( C: BrkCtx, r: f32, r2: f32 ) -> BrkPN {
	let f = breakersFacePoint( C, r2 * 0.45 + 0.55 );
	let t = C.root + C.d3 * ( C.xr + ( r - 0.5 ) * 0.5 );
	let inTrough = vec3f( t.x, C.trough + 0.03, t.z );
	let open = C.xr > C.Wt + 0.1;
	return BrkPN( select( f.p + f.n * 0.04, inTrough, open ), select( f.n, vec3f( 0.0, 1.0, 0.0 ), open ) );
}

// the leading edge of the falling lip
fn breakersTipAt( C: BrkCtx, r: f32 ) -> vec3f {
	return C.root + C.d3 * ( C.Xi * C.q * ( r * 0.12 + 0.88 ) ) - vec3f( 0.0, 1.0, 0.0 ) * ( C.Yi * C.q * C.q );
}

fn breakersAlong( C: BrkCtx, r: f32 ) -> vec3f {
	return C.tg * ( ( r - 0.5 ) * ${ f( this.spacing * 1.15 ) } );
}

fn breakersCount( rate: f32, gain: f32, seed: u32, salt: u32 ) -> u32 {
	return u32( floor( rate * gain + sprayRand( seed, salt ) ) );
}

fn breakersEmit( i: u32, slot: u32, root: vec3f, dir: vec2f, b: f32, H: f32, trough: f32, c: f32, m: f32, depth: f32, bore: vec4f ) {
	let camFade = smoothstep( breakersP.emitRange, breakersP.emitRange * 0.35, length( root - breakersP.cameraPos ) );
	let gain = breakersP.spray * camFade * frame.dt;
	// the many sub-pixel drops and ligaments take the ring budget; the few, visible spray and mist
	// sprites always get their full rate
	let gainD = gain * breakersP.budget;
	let d3 = vec3f( dir.x, 0.0, dir.y );
	let tg = vec3f( - dir.y, 0.0, dir.x );
	let up = vec3f( 0.0, 1.0, 0.0 );
	let Hc = clamp( H, 0.15, 3.0 );
	// (the energy released goes as H^2.5, but what reads on screen saturates: bigger breakers make
	// bigger, longer-lived structures, not ever more particles)
	let E = pow( Hc, 1.7 );
	let Hb = max( bore.x, 0.0 );
	let Eb = pow( min( Hb, 2.0 ) / 0.6, 1.7 );
	let Wt = bore.y;
	let q = clamp( b / 0.9, 0.0, 1.0 );
	let Xi = H * 0.8;
	let Yi = max( root.y - trough, 0.05 );
	let seed = i * 7919u + u32( m - floor( m / 64.0 ) * 64.0 ) * 31u;
	// integer part: which crest made the particle (its wave shadow, see sprayShadow); fraction: random
	let tag = f32( i * 2u + slot + 1u );
	let offshore = max( - dot( frame.windDir, dir ), 0.0 ) * frame.windSpeed;
	let wB = bore.w;
	let xr = Xi - bore.z; // horizontal distance from the crest top
	let C = BrkCtx( root, d3, tg, Yi, Wt, wB, trough, xr, Xi, q );

	// ---- stages of the breaker (weights 0..1)
	let lipShed = smoothstep( 0.5, 0.75, b ) * ( 1.0 - smoothstep( 0.86, 0.93, b ) );
	// the splash-up is a fast burst (~0.15-0.2 s) as the lip hits the trough; its mist lingers
	let impact = smoothstep( 0.87, 0.92, b ) * ( 1.0 - smoothstep( 1.0, 1.14, b ) );
	let haze = smoothstep( 0.9, 1.0, b ) * ( 1.0 - smoothstep( 1.2, 1.5, b ) );
	let spit = smoothstep( 0.98, 1.08, b ) * ( 1.0 - smoothstep( 1.15, 1.3, b ) );
	let roller = smoothstep( 1.05, 1.3, b ) * smoothstep( 0.06, 0.25, Hb );
	let clash = roller * smoothstep( 0.1, 0.2, depth ) * smoothstep( 0.7, 0.35, depth );
	let drift = smoothstep( 9.0, 15.0, offshore ) * smoothstep( -0.4, 0.1, b ) * ( 1.0 - smoothstep( 0.75, 0.9, b ) );

	// ---- drops and ligaments (ballistic)
	let n0 = breakersCount( lipShed * 9.0 * E, gainD, seed, 1u ); // drops off the lip
	let n1 = n0 + breakersCount( lipShed * 5.0 * E, gainD, seed, 2u ); // ligaments off the lip
	let n2 = n1 + breakersCount( impact * 240.0 * E, gainD, seed, 3u ); // splash-up drops
	let n3 = n2 + breakersCount( impact * 90.0 * E, gainD, seed, 4u ); // splash-up ligaments (torn strands)
	let n4 = n3 + breakersCount( roller * 45.0 * Eb, gainD, seed, 5u ); // roller front (breaks up its silhouette)
	let n5 = n4 + breakersCount( clash * 40.0 * Eb, gainD, seed, 6u ); // bore / backwash collision
	let n6 = n5 + breakersCount( drift * 24.0 * Hc, gainD, seed, 7u ); // spindrift
	if ( n6 > 0u ) {
		let base = sprayReserve( n6 );
		for ( var j = 0u; j < n6; j++ ) {
			let ring = spraySlot( base, j );
			let h = seed + j * 13u;
			let r0 = sprayRand( h, 11u );
			let r1 = sprayRand( h, 12u );
			let r2 = sprayRand( h, 13u );
			let r3 = sprayRand( h, 14u );
			let r4 = sprayRand( h, 15u );
			let isLip = j < n1;
			let isImp = j < n3;
			let isRol = j < n4;
			let isCl = j < n5;
			let lig = ( j >= n0 && j < n1 ) || ( j >= n2 && j < n3 );
			// lip: moving with the jet (thrown forward a little faster than the wave, falling)
			let vLip = d3 * ( c * ( r2 * 0.2 + 1.05 ) ) - up * ( q * sqrt( Yi * ${ f( 2 * GRAVITY ) } ) * ( r3 * 0.3 + 0.7 ) ) + tg * ( ( r4 - 0.5 ) * 0.6 );
			// splash-up: most drops stay low, some reach ~1.3 H; thrown up and forward, out of the surface
			let pl = breakersPlunge( C, r1, r2 );
			let vUp = sqrt( Hc * ( r3 * r3 * 1.0 + 0.3 ) * ${ f( 2 * GRAVITY ) } );
			let vImp = up * vUp + pl.n * ( r4 * 1.5 ) + d3 * ( c * ( r2 * 0.6 + 0.15 ) - 0.3 ) + tg * ( ( r4 - 0.5 ) * 2.0 );
			// roller: tossed forward and up by the tumbling front (from its upper part)
			let fr = breakersFacePoint( C, r1 * r1 * 0.7 ); // mostly from the tumbling top
			let vRol = d3 * ( c * ( r2 * 0.3 + 0.95 ) ) + up * ( ( r3 * 1.6 + 0.6 ) * sqrt( Hb / 0.5 ) ) + fr.n * 0.5 + tg * ( ( r4 - 0.5 ) * 1.2 );
			// bore running into the backwash: thrown straight up from its front
			let fc = breakersFacePoint( C, r1 * 0.5 + 0.3 );
			let vCl = up * ( ( r3 * 1.6 + 0.8 ) * sqrt( Hb / 0.4 ) ) + d3 * ( r2 * 2.0 - 0.6 ) + tg * ( ( r4 - 0.5 ) * 1.5 );
			// spindrift: fine drops blown back over the crest
			let vDr = d3 * ( - ( offshore * ( r2 * 0.3 + 0.35 ) ) ) + up * ( r3 * 1.5 + 0.8 ) + tg * ( ( r4 - 0.5 ) * 0.5 );
			let p = select( select( select( select( root + up * 0.04, fc.p + fc.n * 0.03, isCl ), fr.p + fr.n * 0.03, isRol ), pl.p, isImp ), breakersTipAt( C, r1 ), isLip ) + breakersAlong( C, r0 );
			let v = select( select( select( select( vDr, vCl, isCl ), vRol, isRol ), vImp, isImp ), vLip, isLip );
			// radius (m): drops of a few mm (smaller off the roller, finest in the spindrift), ligaments ~1-2 cm
			// heavy-tailed drop sizes (many fine drops, a few big ones): r = r0 (1 - u)^-0.7
			let tail = pow( 1.0 - r4 * 0.98, -0.7 );
			let rDrop = min( select( select( select( 0.0005, 0.001, isLip ), 0.0008, isRol ), 0.001, isImp || isCl ) * tail, 0.012 );
			let rLig = 0.005 + r4 * r4 * select( 0.008, 0.016, isImp );
			let kind = select( SPRAY_DROPLET, SPRAY_LIGAMENT, lig );
			sprayWrite( ring, p, v, select( rDrop, rLig, lig ), kind, 2.5, tag + r0 * 0.999 );
		}
	}

	// ---- dense spray (clouds of drops: the white of the splash-up), a puff out of the barrel
	let c0 = breakersCount( impact * 110.0 * E, gain, seed, 21u );
	let c1 = c0 + breakersCount( spit * 10.0 * E, gain, seed, 22u );
	let c2 = c1 + breakersCount( roller * 0.6 * Eb, gain, seed, 23u ); // (rare: a row of them reads as cotton puffs)
	let c3 = c2 + breakersCount( clash * 2.0 * Eb, gain, seed, 24u );
	if ( c3 > 0u ) {
		let base = sprayReserve( c3 );
		for ( var j = 0u; j < c3; j++ ) {
			let ring = spraySlot( base, j );
			let h = seed + j * 29u;
			let r0 = sprayRand( h, 41u );
			let r1 = sprayRand( h, 42u );
			let r2 = sprayRand( h, 43u );
			let r3 = sprayRand( h, 44u );
			let isImp = j < c0;
			let isSpit = j < c1;
			let isRol = j < c2;
			// torn sheets of the splash-up (half-width): many small ones, a few big
			// (heavy-tailed: many small torn sheets, a few big ones; never a row of equal puffs)
			let sz = select( select( select( 0.05 + r2 * r2 * 0.08, sqrt( Hb / 0.5 ) * ( r2 * r2 * 0.06 + 0.03 ), isRol ), sqrt( Hc ) * ( r2 * r2 * 0.14 + 0.05 ), isSpit ), sqrt( Hc ) * ( r2 * r2 * r2 * 0.18 + 0.05 ), isImp );
			// splash-up: sheets thrown up and forward out of the plunge line, rising up to ~1.3 H and
			// falling back as curtains
			let pl = breakersPlunge( C, r1, r3 );
			let pImp = pl.p + pl.n * ( sz * 0.4 ) + up * ( r2 * Hc * 0.1 );
			let vImp = up * sqrt( Hc * ( r3 * r3 * 0.95 + 0.35 ) * ${ f( 2 * GRAVITY ) } ) + pl.n * 0.8 + d3 * ( c * ( r2 * 0.5 + 0.2 ) ) + tg * ( ( r1 - 0.5 ) * 1.2 );
			// the puff blown out of the collapsing barrel: out of the middle of the front, along the crest
			let fs = breakersFacePoint( C, r1 * 0.3 + 0.35 );
			let pSpit = fs.p + fs.n * ( sz * 0.5 );
			let vSpit = d3 * ( c * 0.7 ) + fs.n * 1.2 + tg * ( ( r1 - 0.5 ) * 4.0 );
			// the tumbling top of the roller
			let fr = breakersFacePoint( C, r1 * 0.4 );
			let pRol = fr.p + fr.n * ( sz * 0.4 );
			let vRol = d3 * ( c * 0.85 ) + up * ( r3 * 0.5 + 0.3 );
			let fc = breakersFacePoint( C, r1 * 0.5 + 0.3 );
			let pCl = fc.p + fc.n * ( sz * 0.5 );
			let vCl = up * ( ( r3 * 1.2 + 0.8 ) * sqrt( Hb / 0.4 ) ) + d3 * ( r2 - 0.3 );
			let p = select( select( select( pCl, pRol, isRol ), pSpit, isSpit ), pImp, isImp ) + breakersAlong( C, r0 );
			let v = select( select( select( vCl, vRol, isRol ), vSpit, isSpit ), vImp, isImp );
			let life = select( select( r3 * 0.3 + 0.5, 0.9, isSpit ), r3 * 0.5 + 1.0, isImp );
			sprayWrite( ring, p, v, sz, SPRAY_SPRAY, life, tag + r0 * 0.999 );
		}
	}

	// ---- mist: the fine spray that drifts off with the wind (and the air pushed by the wave)
	// (few, large, faint sprites: mist is the biggest overdraw of the spray)
	let m0 = breakersCount( haze * 5.0 * E + spit * 3.0 * E, gain, seed, 31u );
	// the lip feathers as it throws: a thin wisp torn off the crest and carried by the air (with the
	// wind; the drag toward the air velocity turns it back over the crest in an offshore wind)
	let mL = breakersCount( lipShed * 1.6 * E, gain, seed, 33u );
	// the churning top of the bore smokes: a thin haze drifting off it softens its silhouette (a bore
	// front isn't a hard white edge), some of it lingering as it drifts up the beach
	let m1 = m0 + breakersCount( roller * 4.5 * Eb, gain, seed, 32u );
	if ( mL > 0u ) {
		let base = sprayReserve( mL );
		for ( var j = 0u; j < mL; j++ ) {
			let ring = spraySlot( base, j );
			let h = seed + j * 23u;
			let r0 = sprayRand( h, 61u );
			let r1 = sprayRand( h, 62u );
			let r2 = sprayRand( h, 63u );
			let p = breakersTipAt( C, r1 * 0.4 ) + up * ( r2 * 0.1 ) + breakersAlong( C, r0 );
			let v = d3 * ( c * ( r1 * 0.2 + 0.85 ) ) + up * ( r2 * 0.8 + 0.3 );
			sprayWrite( ring, p, v, ( r2 * r2 * 0.2 + 0.1 ) * sqrt( Hc ), SPRAY_MIST, r1 * 0.8 + 0.7, tag + r0 * 0.999 );
		}
	}
	if ( m1 > 0u ) {
		let base = sprayReserve( m1 );
		for ( var j = 0u; j < m1; j++ ) {
			let ring = spraySlot( base, j );
			let h = seed + j * 17u;
			let r0 = sprayRand( h, 51u );
			let r1 = sprayRand( h, 52u );
			let r2 = sprayRand( h, 53u );
			let r3 = sprayRand( h, 54u );
			let isImp = j < m0;
			let pl = breakersPlunge( C, r1, r3 );
			let ft = breakersFacePoint( C, r1 * 0.3 );
			let p = select( ft.p + ft.n * 0.15 + up * ( r2 * r2 * Hb * 0.35 ), pl.p + pl.n * 0.2 + up * ( r2 * Hc * 0.4 ), isImp ) + breakersAlong( C, r0 );
			let v = select( d3 * ( c * ( r1 * 0.3 + 0.65 ) ) + up * ( r2 * 0.4 + 0.15 ), d3 * ( c * ( r1 * 0.3 + 0.4 ) ) + up * ( r3 * 0.9 + 0.4 ), isImp );
			let size = select( ( r3 * r3 * 0.35 + 0.18 ) * sqrt( max( Hb, 0.2 ) / 0.6 ), sqrt( Hc ) * ( r3 * 0.3 + 0.45 ), isImp );
			let life = select( r3 * r3 * 3.0 + 1.2, r3 * 1.5 + 2.5, isImp );
			sprayWrite( ring, p, v, size, SPRAY_MIST, life, tag + r0 * 0.999 );
		}
	}
}
`;

	}

	// ------------------------------------------------------------------ lip sheet

	_buildMesh() {

		const NS = this.NS;
		const nSeg = NS - 1;
		const vertsPerStrip = NV * 2;
		const nStrips = nSeg * 2;
		const ids = new Float32Array( nStrips * vertsPerStrip * 4 );
		const pos = new Float32Array( nStrips * vertsPerStrip * 3 );
		const index = new Uint32Array( nStrips * ( NV - 1 ) * 6 );
		let p = 0, q = 0;
		for ( let seg = 0; seg < nSeg; seg ++ ) for ( let slot = 0; slot < 2; slot ++ ) {

			const v0 = ( seg * 2 + slot ) * vertsPerStrip;
			for ( let side = 0; side < 2; side ++ ) for ( let k = 0; k < NV; k ++ ) {

				ids[ p ++ ] = seg; ids[ p ++ ] = slot; ids[ p ++ ] = side; ids[ p ++ ] = k;

			}

			for ( let k = 0; k < NV - 1; k ++ ) {

				const a = v0 + k, b = v0 + k + 1, c = v0 + NV + k, d = v0 + NV + k + 1;
				index[ q ++ ] = a; index[ q ++ ] = c; index[ q ++ ] = b;
				index[ q ++ ] = b; index[ q ++ ] = c; index[ q ++ ] = d;

			}

		}

		const geo = new BufferGeometry();
		geo.setAttribute( 'position', new BufferAttribute( pos, 3 ) );
		geo.setAttribute( 'sheetId', new BufferAttribute( ids, 4 ) );
		geo.setIndex( new BufferAttribute( index, 1 ) );
		geo.boundingSphere = new Sphere( new Vector3(), 1e7 );

		const spacing = this.spacing;
		const lace = makeLaceTexture();
		const lipModule = new ShaderModule( {
			name: 'breakersLip',
			deps: [ commonModule, fresnelModule, this.sky && this.sky.module, this.clouds && this.clouds.module ],
			code: /* wgsl */`
const BRK_LACE_TILE: f32 = ${ f( LACE_TILE ) };
const BRK_NV: f32 = ${ f( NV ) };
`,
		} );

		// premultiplied alpha over the water; velocity weighted by coverage (MeshShader late pass)
		const mat = new Material( {
			name: 'BreakerLip',
			lit: false,
			transparent: true,
			depthWrite: false,
			depthTest: true,
			side: 'double',
			blending: 'premultiplied',
			modules: [ lipModule ],
			uniforms: { sheet: [ 'f32', 1 ] },
			textures: { brkLace: lace },
			storage: { breakersCrest: this.crest },
			attributes: { sheetId: 'vec4f' },
			varyings: { vLipN: 'vec3f', vLip: 'vec4f', vLipFade: 'f32' }, // vLip: v, b, along, curtain length
			vertex: /* wgsl */`
	let id = v.sheetId;
	let seg = u32( id.x );
	let slot = u32( id.y );
	let side = u32( id.z );
	let k = id.w;
	let st = seg + side;
	let ot = seg + ( 1u - side );
	let e = st * 6u + slot * 3u;
	let eo = ot * 6u + slot * 3u;
	let c0 = breakersCrest[ e ];
	let c1 = breakersCrest[ e + 1u ];
	let c2 = breakersCrest[ e + 2u ];
	let mOther = breakersCrest[ eo + 2u ].w;
	let bOther = breakersCrest[ eo ].w;
	// (the crests are followed until the bore reaches the shore; the sheet is gone after the plunge)
	// (port: both ends of a segment must pass the b test, else a vertex pair collapses to one side only
	// and the quad between them draws as a long sliver down to y = -1e5 where b jumps between stations)
	let valid = c2.w > 0.5 && abs( mOther - c2.w ) < 0.5 && c0.w < 1.25 && bOther < 1.25;

	let root = c0.xyz;
	let b = c0.w;
	let back = c1.xyz;
	let H = c1.w;
	let d3 = vec3f( c2.x, 0.0, c2.y );
	let trough = c2.z;
	let q = clamp( b / 0.9, 0.0, 1.35 );
	let Xi = max( H * 0.8, 0.05 );
	let Yi = max( root.y - trough, 0.05 );
	// profile parameter: k = 0, 1 on the back of the crest (-1, -0.45), then 0..1 along the curtain
	let pv = select( select( ( k - 2.0 ) / ( BRK_NV - 3.0 ), -0.45, k < 1.5 ), -1.0, k < 0.5 );
	let xl = Xi * q * max( pv, 0.0 );
	let fl = xl / Xi;
	let yl = - Yi * ( fl * fl ); // ballistic: the jet leaves the crest horizontally
	let onLip = root + d3 * xl + vec3f( 0.0, yl, 0.0 );
	let onCap = mix( root, back, max( - pv, 0.0 ) ) + vec3f( 0.0, 0.012, 0.0 );
	let P = select( onLip, onCap, pv < 0.0 );
	// outward normal of the curtain (upper surface of the lip)
	let slope = Yi * 2.0 * xl / ( Xi * Xi );
	o.vLipN = normalize( vec3f( 0.0, 1.0, 0.0 ) + d3 * slope );
	o.vLip = vec4f( pv, b, f32( st ) * ${ f( spacing ) }, Xi * q + Yi * q * q ); // w: curtain length (m)
	// the cap fades in over the crest; the whole lip fades out once it has become whitewater
	let capA = smoothstep( -1.0, -0.1, pv );
	// once the jet has re-entered the water the curtain is gone (the splash and the roller take over)
	o.vLipFade = capA * smoothstep( 0.02, 0.12, q ) * ( 1.0 - smoothstep( 1.0, 1.2, b ) );
	v.useWorld = true;
	v.worldPos = select( vec3f( 0.0, -1e5, 0.0 ), P, valid );
	v.worldNormal = o.vLipN;
`,
			output: /* wgsl */`
	let v = in.vs.vLip.x;
	let b = in.vs.vLip.y;
	let a = in.vs.vLip.z;
	let len = in.vs.vLip.w;
	let pos = in.P;
	let V = normalize( frame.cameraPos - pos );
	let Nw = normalize( in.vs.vLipN );
	let N0 = select( - Nw, Nw, in.front );
	let t = frame.time;
	// The water of the jet is stretched along the flow: streaks and ripples running down the
	// curtain (the lace pattern stretched ~8x along the jet and moving with it) in its surface
	// (normal, from the screen-space gradient of a small relief) and in its thickness
	let flowS = v * len - t * 1.1;
	// along-crest coordinate warped by low-frequency noise (three incommensurate scales, slope kept
	// below 1 so it never folds): the streak spacing drifts along the crest, no fixed period, and the
	// tiles of every pattern below never line up into a comb
	let aw = a + sin( a * 0.23 + 1.7 ) * 1.6 + sin( a * 0.61 + 4.2 ) * 0.4 + sin( a * 1.37 + 0.4 ) * 0.12;
	let sv = textureSample( brkLace, smpAnisoRepeat, vec2f( aw / 0.83, flowS / 3.0 ) );
	// and broad bands (sections of the lip thicker or thinner than others), visible from afar
	let sbv = textureSample( brkLace, smpAnisoRepeat, vec2f( aw / 2.9, flowS / 9.0 ) + vec2f( 0.37, 0.61 ) );
	let sb = sbv.z;
	let hS = sv.x * 0.02 + sv.z * 0.012;
	let dpx = dpdx( pos );
	let dpy = dpdy( pos );
	let r1 = cross( dpy, N0 );
	let r2 = cross( N0, dpx );
	let det = dot( dpx, r1 );
	let grad = ( r1 * dpdx( hS ) + r2 * dpdy( hS ) ) * sign( det );
	let N = normalize( N0 * abs( det ) - grad + N0 * 1e-9 );
	let NdV = max( dot( N, V ), 1e-3 );
	let F = breakersFresnel( NdV, 1.333 );
	let L = frame.sunDir;
	let sun = frame.sunColor * ${ this.clouds ? 'cloudsShadow( pos.xz )' : '1.0' };

	// reflection: sky + sun glint
	let Rr = reflect( - V, N );
	let R = normalize( vec3f( Rr.x, max( Rr.y, 0.004 ), Rr.z ) );
	let refl = ${ this.sky ? 'skyReflectionRadiance( R )' : 'frame.horizonColor' };
	let Hh = normalize( L + V );
	let spec = sun * ( pow( max( dot( N, Hh ), 0.0 ), 180.0 ) * 12.0 ) * F;

	// light through the thin sheet: turquoise when backlit
	let tint = vec3f( 0.16, 0.62, 0.56 );
	let back = pow( sat( dot( - V, L ) * 0.5 + 0.5 ), 4.0 );
	// thick and deep green at the root, thin, bright and clear toward the tip, uneven along the streaks
	let thin = mix( 1.5, 0.7, v ) * ( sv.z * 0.3 + 0.8 ) * ( sb * 0.8 + 0.6 );
	let glow = ( sun * tint * ( back * 0.9 + 0.08 ) + frame.skyIrradiance * tint * 1.4 ) * thin;
	let aW = F + min( ( 1.0 - F ) * mix( 0.42, 0.16, v ) * ( sv.x * 0.5 + 0.75 ) * ( sb * 0.7 + 0.65 ), 0.85 );
	let cW = refl * F + spec + glow * ( 1.0 - F ) * 0.42;

	// The jet stays clear, glassy water while it is in the air: only its leading edge tears into
	// aerated fingers (filaments of the lace pattern stretched along the flow, merging into a
	// ragged white rim). Sections of the lip differ a little.
	let flowM = v * len - t * 1.1; // metres down the curtain, moving with the jet
	let fuv = vec2f( aw / 1.9 + 0.53, flowM / 1.8 );
	let fl = textureSample( brkLace, smpAnisoRepeat, fuv );
	let sect = fl.z; // slowly varying along the crest
	let vary = sect - 0.5 + sin( aw * 0.29 + b * 2.1 ) * 0.15;
	let reach = v + vary * 0.3;
	// slightly irregular leading edge (sections of the lip reach a little further than others)
	let tipN = sin( aw * 1.3 + t * 0.3 ) * 0.6 + sin( aw * 4.7 + 1.3 ) * 0.4;
	let edge = v + tipN * 0.03 + vary * 0.04;
	let thrown = smoothstep( 0.35, 0.8, b );
	// a thin, translucent aerated rim along the leading edge (it tears into the drops and
	// ligaments the spray system throws off it)
	let rim = smoothstep( 0.9, 0.96, edge ) * ( fl.z * 0.2 + 0.2 ) * thrown;
	// once the lip has landed the curtain is a falling mass of whitewater that dissolves (blotchy)
	// into the splash-up and the roller within a fraction of a second
	// (in streaks: white fingers run down the curtain ahead of the rest, so along a peeling crest the
	// broken section feathers into the clear one instead of ending on a vertical line)
	// (each finger its own length and brightness: the fine strands' per-cell random, gated and grouped
	// by the broad pattern so fingers cluster, merge and leave gaps instead of a regular row)
	let fing = ( sv.w * 0.55 + sv.z * 0.2 ) * ( smoothstep( 0.25, 0.75, sbv.w * 0.6 + sb * 0.4 ) * 0.8 + 0.2 ) * 0.34;
	let wh = smoothstep( ( 1.0 - v ) * 0.18 + 0.9 - fing, ( 1.0 - v ) * 0.18 + 1.0 - fing, b ); // from the tip up
	let lc = textureSample( brkLace, smpAnisoRepeat, vec2f( aw * 0.83 + 1.9, v * len - t * 1.3 ) / ( BRK_LACE_TILE * 0.8 ) );
	let blot = lc.z * 0.7 + lc.y * 0.3;
	let gone = smoothstep( 1.0, 1.25, b );
	let clumpW = smoothstep( gone - 0.12, gone + 0.12, blot );
	let clumps = sat( ( blot - gone ) * 2.5 ); // thicker inside the blotches
	// thin aerated filaments stretched down the curtain (foam of the previous wave drawn up the
	// face and thrown out with the lip), more of them toward the tip
	let fil = ( 1.0 - smoothstep( 0.02, 0.12, sv.x ) ) * smoothstep( 0.15, 0.8, v ) * ( sv.w * 0.5 + 0.25 ) * ( sb * 0.9 + 0.3 ) * thrown;
	let aer = mix( max( rim, fil ), 0.95, wh );
	// aerated water is a dense scatterer: bright from every side, glowing when backlit
	let foamLit = ( sun * ( max( dot( N, L ), 0.0 ) * 0.5 + 0.5 + back * 1.2 ) / PI + frame.skyIrradiance ) * 0.9;

	let tip = 1.0 - smoothstep( 0.93, 1.0, edge );
	let alpha = in.vs.vLipFade * tip * mat.sheet * mix( 1.0, clumpW, wh );
	let aF = aer * 0.92;
	let col = foamLit * mix( 1.0, clumps * 0.4 + 0.75, wh ) * aF + cW * ( 1.0 - aF );
	let aOut = ( aF + aW * ( 1.0 - aF ) ) * alpha;
	(*r).color = vec4f( col * alpha, aOut );
`,
		} );
		// the lip opacity multiplier is the material's uniform
		this.params.sheet = mat.uniforms.sheet;
		this.material = mat;

		const mesh = this.mesh = new Mesh( geo, mat );
		mesh.frustumCulled = false;
		mesh.castShadow = false;
		mesh.receiveShadow = false;
		mesh.renderOrder = 10;
		mesh.layers.set( LAYERS.TRANSPARENT );
		mesh.name = 'BreakerLips';
		// velocity: world positions with no motion of their own -> camera-only reprojection (static)
		mesh.staticVelocity = true;

	}

}

// Shoreline stations along the main beach: evenly spaced along the (smoothed) shoreline, each with
// the unit direction toward the sea. Returns { data: Float32Array(n * 4) (x, z, nx, nz), count, spacing }.
export function buildStations( terrain, { x0 = - 175, x1 = 195, spacing = 0.6 } = {} ) {

	// shoreline z(x): first land found marching north from the water
	const pts = [];
	for ( let x = x0; x <= x1; x += 0.5 ) {

		if ( terrain.heightAt( x, 12 ) > - 0.3 ) continue; // not open water in front
		let z = 12, zs = null;
		for ( ; z > - 110; z -= 0.5 ) {

			if ( terrain.heightAt( x, z ) > 0 ) {

				let lo = z, hi = z + 0.5; // land at lo, water at hi
				for ( let k = 0; k < 16; k ++ ) {

					const mid = ( lo + hi ) * 0.5;
					if ( terrain.heightAt( x, mid ) > 0 ) lo = mid; else hi = mid;

				}

				zs = ( lo + hi ) * 0.5;
				break;

			}

		}

		if ( zs !== null ) pts.push( [ x, zs ] );

	}

	// break into continuous runs, keep the longest (the main beach)
	let best = [], run = [];
	for ( let k = 0; k < pts.length; k ++ ) {

		if ( run.length && ( Math.abs( pts[ k ][ 1 ] - run[ run.length - 1 ][ 1 ] ) > 3 || pts[ k ][ 0 ] - run[ run.length - 1 ][ 0 ] > 1.01 ) ) {

			if ( run.length > best.length ) best = run;
			run = [];

		}

		run.push( pts[ k ] );

	}

	if ( run.length > best.length ) best = run;

	// smooth the polyline (the transects should not follow every wiggle of the waterline)
	let sm = best.map( ( p ) => [ p[ 0 ], p[ 1 ] ] );
	for ( let it = 0; it < 30; it ++ ) {

		const nx = sm.map( ( p, k ) => {

			if ( k === 0 || k === sm.length - 1 ) return p;
			return [ p[ 0 ], ( sm[ k - 1 ][ 1 ] + 2 * p[ 1 ] + sm[ k + 1 ][ 1 ] ) * 0.25 ];

		} );
		sm = nx;

	}

	// resample by arc length
	const out = [];
	let acc = 0, next = 0;
	for ( let k = 1; k < sm.length; k ++ ) {

		const [ ax, az ] = sm[ k - 1 ], [ bx, bz ] = sm[ k ];
		const seg = Math.hypot( bx - ax, bz - az );
		while ( next <= acc + seg ) {

			const t = ( next - acc ) / seg;
			const x = ax + ( bx - ax ) * t, z = az + ( bz - az ) * t;
			// normal toward the sea (+z side of a west->east polyline)
			const tx = ( bx - ax ) / seg, tz = ( bz - az ) / seg;
			out.push( x, z, - tz, tx );
			next += spacing;

		}

		acc += seg;

	}

	return { data: new Float32Array( out ), count: out.length / 4, spacing };

}
