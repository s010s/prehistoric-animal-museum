import { ShaderModule, UniformBlock } from '../engine/gpu/Shader.js';
import { RenderTarget } from '../engine/gpu/Texture.js';
import { FullscreenPass } from '../engine/render/FullscreenPass.js';
import { G } from '../engine/render/Frame.js';
import { shadowModule } from '../engine/render/wgsl/lighting.js';
import { commonModule } from '../engine/render/wgsl/common.js';
import { MathUtils, Vector2 } from '../engine/math/index.js';

// full-screen passes overwrite every pixel: clear instead of load (no tile load of the old contents on
// tile-based GPUs)
const CLR = [ 0, 0, 0, 0 ];

// Air above the water, in post (no per-material cost):
//  - aerial perspective + marine haze: two exponential height layers (a thin, dense marine layer at
//    the sea surface and a thin aerosol layer kilometres high), analytic optical depth along the view
//    ray. The haze takes the colour of the sky (Hillaire sky view LUT) just above the horizon in the
//    view direction, so distant land and the far sea fade into the actual horizon sky, sun glow
//    included. Sky pixels get none (the sky already holds its in-scatter).
//  - volumetric sun shafts: sun in-scatter of the haze ray-marched at half resolution with the
//    cascaded shadow maps (palms, pier, rocks), the terrain hill shadow and the cloud shadow
//    (crepuscular rays), jittered per pixel and frame (the TAAU resolves the noise), depth-aware
//    upsampled in the composite. Near geometry gets the lit in-scatter (bright shafts between shadowed
//    air); toward the sky / far geometry it hands over to the shadowed deficit only, so silhouettes
//    against the sky stay consistent and the sky is only ever darkened (crepuscular rays in the sky).
// The camera under water, and pixels whose lens is in water, get nothing (Underwater handles those).
//
// WGSL (prefix `haze`): this.compositeModule: fn hazeApply( uv: vec2f, c: vec4f ) -> vec4f (the composite,
// the former apply()); this.module: the helpers the passes share (hazeRay, hazeVisibility, hazePhase, ...). Consumed: underwater.module (camera ray helpers), atmosphere.module
// `atmosphereSkyLuminance( dir ) -> vec3f`, sky.module `skyMoonSky( dir ) -> vec3f` (optional),
// clouds.module `cloudsShadow( xz ) -> f32` + `cloudsSampleView( dir ) -> vec4f` (optional),
// terrain.module `terrainSunShadowAt( P ) -> f32` (optional), the engine shadow module
// `sunShadowHard( P: vec3f ) -> f32` (one hardware tap in the cascade covering P).
// Port notes: the cascade is picked by sunShadowHard (distance along the view axis, like the original's
// view depth test against the splits); the hill shadow is the terrain module's own lookup (the original
// read the terrain's baked shadow texture here with the same soft edge); the cloud shadow follows the
// light down to the ground as before and uses cloudsShadow (bilinear, same strength / border fade).

const STEPS = 16;
const MARCH_DIST = 2500; // m: shafts from clouds and hills reach this far
const NEAR = 900; // m: explicit (shadowed) sun single scattering in front of geometry closer than this
const FAR_CLAMP = 60000; // m (fits half float)
// screen-space god rays: radial blur taps per pass, sample decay per pass, overall gain
const SS_TAPS = 8;
const SS_DECAY = [ 0.9, 0.97, 1.0 ];
const SS_GAIN = 3.5;

// haze layers: sea level extinction (1/m) and scale height (m)
const MARINE = { sigma: 1.5e-4, H: 110 };
const AEROSOL = { sigma: 3.2e-5, H: 1400 };

const f = ( x ) => {

	const s = String( x );
	return s.includes( '.' ) || s.includes( 'e' ) ? s : s + '.0';

};

// sunShadowHard until the engine's shadow module has it
const hardShadowFallback = new ShaderModule( { name: 'haze-shadow-hard', deps: [ shadowModule ], code: /* wgsl */`
fn sunShadowHard( P: vec3f ) -> f32 {
	if ( shadowParams.enabled < 0.5 ) { return 1.0; }
	let dist = dot( P - frame.cameraPos, - vec3f( frame.view[ 0 ][ 2 ], frame.view[ 1 ][ 2 ], frame.view[ 2 ][ 2 ] ) );
	let c = shadowCascadeOf( dist );
	if ( c < 0 ) { return 1.0; }
	let sc = shadowParams.matrices[ c ] * vec4f( P, 1.0 );
	let uvz = vec3f( sc.x * 0.5 + 0.5, 0.5 - sc.y * 0.5, sc.z );
	if ( any( uvz.xy < vec2f( 0.0 ) ) || any( uvz.xy > vec2f( 1.0 ) ) || uvz.z > 1.0 ) { return 1.0; }
	return select( 1.0, 0.0, _shadowDepth( uvz.xy, c ) < uvz.z - 2e-5 );
}
` } );

export class AirHaze {

	constructor( { depthTexture, underwater, atmosphere, sky = null, clouds = null, terrain = null, csm = null } ) {

		this.depthTexture = depthTexture;
		this.uw = underwater;
		this.atmosphere = atmosphere;
		this.sky = sky;
		this.clouds = clouds;
		this.terrain = terrain;
		this.csm = csm;

		this.uniforms = new UniformBlock( 'HazeParams', {
			// haze (1 = ~20 km visibility at sea level). Default: a humid tropical day, ~12 km: the far side
			// of the island and the horizon soften visibly
			density: [ 'f32', 1.6 ],
			// sun shaft strength (1 = physical single scattering near the camera; more veils everything in
			// front of a low sun in white)
			shafts: [ 'f32', 1.0 ],
			enabled: [ 'f32', 1 ],
			frame: [ 'f32', 0 ],
			sunUV: [ 'vec2f', new Vector2( 0.5, 0.5 ) ],
			ssFade: [ 'f32', 0 ], // light in view, low in the sky, camera in air
			hasMedium: [ 'f32', 0 ],
			histValid: [ 'f32', 0 ], // the shaft history holds a previous frame
		}, { label: 'haze' } );
		const U = this.uniforms.fields;
		this.density = U.density;
		this.shafts = U.shafts;
		this.enabled = U.enabled;
		this.frame = U.frame;
		this.sunUV = U.sunUV;
		this.ssFade = U.ssFade;
		this.mediumTexture = null; // lens medium (set by the post chain): water pixels are skipped

		// half resolution march (x = lit share of the in-scatter, y = marched / exact in-scatter, z = view
		// distance), and its temporal accumulation (ping-pong; the composite reads the latest)
		this.low = new RenderTarget( 1, 1, { colors: [ 'rgba16float' ], label: 'hazeShafts' } );
		this.hist = [ 0, 1 ].map( ( i ) => new RenderTarget( 1, 1, { colors: [ 'rgba16float' ], label: 'hazeShaftsHistory' + i } ) );
		this._hc = 0;
		this._histValid = false;
		// screen-space god rays (GPU Gems 3 ch. 13 / UE4 light shafts) on top of the volumetric term:
		// sky visibility around the key light (sun disc + aureole, times the cloud transmittance) at
		// quarter resolution, blurred toward the light's screen position in three passes of 8 taps
		// (512 effective samples): crisp streaks through fronds, treelines and cloud gaps
		this.ssTargets = [ 0, 1, 2, 3 ].map( ( i ) => new RenderTarget( 1, 1, { colors: [ 'r16float' ], label: 'hazeSS' + i } ) );
		this.ssShafts = this.ssTargets[ 3 ];
		this.godRays = true;
		this.scale = 1;
		this._module = null;
		this._passes = null;

	}

	setScale( s ) {

		this.scale = s;

	}

	// output (drawing buffer) size; the passes run at 0.5 / 0.25 of it times the scale (as the rtt
	// resolution scales of the original)
	setSize( w, h ) {

		const s = this.scale;
		this.low.setSize( Math.round( w * 0.5 * s ), Math.round( h * 0.5 * s ) );
		for ( const r of this.hist ) r.setSize( Math.round( w * 0.5 * s ), Math.round( h * 0.5 * s ) );
		this._histValid = false;
		for ( const r of this.ssTargets ) r.setSize( Math.round( w * 0.25 * s ), Math.round( h * 0.25 * s ) );

	}

	// per frame, after the scene render
	update() {

		this.frame.value = ( this.frame.value + 1 ) % 1024;

		// key light on screen (view space = camera rotation transposed times the light direction)
		const m = this.uw.camWorld.value.elements, L = G.sunDir.value, P = this.uw.proj.value;
		const vx = m[ 0 ] * L.x + m[ 1 ] * L.y + m[ 2 ] * L.z;
		const vy = m[ 4 ] * L.x + m[ 5 ] * L.y + m[ 6 ] * L.z;
		const vz = m[ 8 ] * L.x + m[ 9 ] * L.y + m[ 10 ] * L.z;
		const ss = MathUtils.smoothstep;
		let fade = 0;
		if ( vz < - 0.02 ) {

			const u = 0.5 + 0.5 * ( vx / - vz ) * P.x, v = 0.5 - 0.5 * ( vy / - vz ) * P.y;
			this.sunUV.value.set( u, v );
			// fades out as the light leaves the frame, and as it climbs (strong at golden hour only)
			fade = ( 1 - ss( Math.max( Math.abs( u - 0.5 ), Math.abs( v - 0.5 ) ), 0.6, 1.15 ) ) * ss( - vz, 0.02, 0.25 ) * ( 1 - ss( L.y, 0.3, 0.75 ) );

		}

		if ( G.cameraUnderwater.value > 0.5 || this.enabled.value < 0.5 || this.shafts.value <= 0 || ! this.godRays ) fade = 0;
		this.ssFade.value = fade;
		this.uniforms.fields.hasMedium.value = this.mediumTexture ? 1 : 0;

	}

	// record the march and the god ray passes (the post chain calls this before the composite)
	render() {

		if ( ! this._passes ) this._build();
		const p = this._passes;
		p.march.render( { colorViews: [ this.low.texture ], clear: CLR } );
		// accumulate: 16 jittered steps per pixel are noisy, and the final temporal resolve clamps the
		// noisy history away, so the shafts flickered; here they settle over ~10 frames
		const on = this.enabled.value > 0.5 && this.shafts.value > 0;
		this.uniforms.fields.histValid.value = this._histValid && on ? 1 : 0;
		p.temporal[ this._hc ].render( { colorViews: [ this.hist[ 1 - this._hc ].texture ], clear: CLR } );
		this._hc = 1 - this._hc;
		this._histValid = on;
		// the god ray passes only matter while the light is in view (the composite skips them otherwise)
		if ( this.ssFade.value > 0.001 ) {

			p.mask.render( { colorViews: [ this.ssTargets[ 0 ].texture ], clear: CLR } );
			for ( let i = 0; i < 3; i ++ ) p.blur[ i ].render( { colorViews: [ this.ssTargets[ i + 1 ].texture ], clear: CLR } );

		}

	}

	// ---------------------------------------------------------------- WGSL

	_deps() {

		const hard = shadowModule.code.includes( 'fn sunShadowHard' ) ? shadowModule : hardShadowFallback;
		return [ commonModule, this.uw.module, this.atmosphere && this.atmosphere.module, this.sky && this.sky.module,
			this.clouds && this.clouds.module, this.terrain && this.terrain.module, hard ];

	}

	_defines() {

		return {
			HZ_CLOUDS: this.clouds && this.clouds.module ? 1 : 0,
			HZ_TERRAIN: this.terrain && this.terrain.module ? 1 : 0,
			HZ_MOON: this.sky && this.sky.module ? 1 : 0,
		};

	}

	// the helpers shared by the passes and the composite
	get module() {

		if ( this._module ) return this._module;
		this._module = new ShaderModule( {
			name: 'haze',
			deps: this._deps(),
			uniforms: this.uniforms,
			uniformName: 'hazeParams',
			bindings: {
				hazeDepth: { texture: () => this.depthTexture },
			},
			code: /* wgsl */`
const HZ_MARINE_SIGMA: f32 = ${ f( MARINE.sigma ) };
const HZ_MARINE_H: f32 = ${ f( MARINE.H ) };
const HZ_AEROSOL_SIGMA: f32 = ${ f( AEROSOL.sigma ) };
const HZ_AEROSOL_H: f32 = ${ f( AEROSOL.H ) };
const HZ_FAR_CLAMP: f32 = ${ f( FAR_CLAMP ) };
const HZ_NEAR: f32 = ${ f( NEAR ) };

// optical depth of one exponential layer from height hc along a ray with direction y component
// vy over distance d
fn hazeLayerDepth( sigma: f32, H: f32, hc: f32, vy: f32, d: f32 ) -> f32 {
	let base = exp( hc / - H ) * sigma;
	let k = vy * d / H;
	let fk = select( H * ( 1.0 - exp( - k ) ) / vy, d, abs( k ) < 1e-3 );
	return base * fk;
}

// unshadowed in-scatter depth of both layers from height hc along a ray (direction y component vy)
// over distance d: 1 - their transmittance
fn hazeInScatter( hc: f32, vy: f32, d: f32 ) -> f32 {
	return 1.0 - exp( - ( hazeLayerDepth( HZ_MARINE_SIGMA, HZ_MARINE_H, hc, vy, d ) + hazeLayerDepth( HZ_AEROSOL_SIGMA, HZ_AEROSOL_H, hc, vy, d ) ) * hazeParams.density );
}

// Cornette-Shanks (strong forward lobe) plus a little isotropic scattering
// (a softer lobe than coastal aerosol's ~0.76: toward the sun the haze glared over everything
// in front of it and washed distant foliage out to white)
fn hazePhase( cosT: f32 ) -> f32 {
	let g = 0.62; let g2 = g * g;
	let cs = 3.0 * ( 1.0 - g2 ) / ( 8.0 * PI * ( 2.0 + g2 ) ) * ( cosT * cosT + 1.0 ) / pow( max( 1.0 + g2 - cosT * 2.0 * g, 1e-4 ), 1.5 );
	return cs * 0.7 + 0.3 / ( 4.0 * PI );
}

struct HazeRay { dist: f32, dir: vec3f, sky: bool, rayLen: f32 };

// view distance of the pixel (reversed-Z depth, sky = 0) and its world direction
fn hazeRay( uv: vec2f ) -> HazeRay {
	let size = vec2f( textureDimensions( hazeDepth ) );
	let d = textureLoad( hazeDepth, vec2i( clamp( uv, vec2f( 0.0 ), vec2f( 0.9999 ) ) * size ), 0 );
	let ray = underwaterViewRay( uv );
	var r: HazeRay;
	r.rayLen = length( ray );
	r.sky = d < 1e-7;
	r.dist = select( min( - underwaterViewZ( max( d, 1e-9 ) ) * r.rayLen, HZ_FAR_CLAMP ), HZ_FAR_CLAMP, r.sky );
	r.dir = normalize( ( underwaterParams.camWorld * vec4f( ray, 0.0 ) ).xyz );
	return r;
}

// the march's hill shadow: terrainSunShadowAt with one filtered fetch instead of four loads (the
// texture is half float, filterable; the materials keep the loads: they are short of samplers)
fn hazeTerrainSun( P: vec3f ) -> f32 {
#if HZ_TERRAIN
	let s = textureSampleLevel( terrainSunShadowTex, smpLinearClamp, terrainUvOf( P.xz ), 0.0 );
	let w = s.y * 0.012 + 0.35;
	return mix( 1.0, smoothstep( -w, w, P.y - s.x ), terrainParams.sunBaked );
#else
	return 1.0;
#endif
}

// the march's sun visibility after the shadow map (hills, clouds), only where light is left
fn hazeVisibilityRest( P: vec3f, v0: f32 ) -> f32 {
	var v = v0;
#if HZ_TERRAIN
	if ( v > 0.0 ) { v *= hazeTerrainSun( P ); }
#endif
#if HZ_CLOUDS
	if ( v > 0.0 ) {
		let L = frame.sunDir;
		let g = P.xz - L.xz * ( max( P.y, 0.0 ) / max( L.y, 0.08 ) );
		v *= cloudsShadow( g );
	}
#endif
	return v;
}

// sun visibility at world position P: shadow cascades, hills, clouds
fn hazeVisibility( P: vec3f ) -> f32 {
	// (each lookup only where the ones before left some light)
	var v = sunShadowHard( P );
#if HZ_TERRAIN
	if ( v > 0.0 ) { v *= terrainSunShadowAt( P ); }
#endif
#if HZ_CLOUDS
	if ( v > 0.0 ) {
		// the cloud shadow map is the ground's shadow along the key light: follow the light down
		let L = frame.sunDir;
		let g = P.xz - L.xz * ( max( P.y, 0.0 ) / max( L.y, 0.08 ) );
		v *= cloudsShadow( g );
	}
#endif
	return v;
}

`,
		} );
		return this._module;

	}

	// the composite (reads the passes' results: not usable by the passes themselves)
	get compositeModule() {

		if ( this._compositeModule ) return this._compositeModule;
		this._compositeModule = new ShaderModule( {
			name: 'haze-composite',
			deps: [ this.module ],
			bindings: {
				hazeLow: { texture: () => this.hist[ this._hc ].texture },
				hazeSS: { texture: () => this.ssShafts.texture },
				hazeMedium: { texture: () => this.mediumTexture || this.low.texture },
			},
			code: /* wgsl */`
// c: the scene colour at uv. Returns the hazed colour.
//   geometry: c T + (1 - T) fog (1 - fSun (1 - h)) + (1 - h) E p(θ) lit - h fSun fog (all - lit)
//   sky:      c - fSun fog (all - lit)
// fog: sky radiance just above the horizon in the view direction; fSun: its sunlit share (phase
// weighted); lit / all: shadowed / unshadowed in-scatter depth from the march; h: 0 near the
// camera (explicit, shadowed sun single scattering: bright shafts) -> 1 far away and for the sky
// (only the shadowed share of the sky-coloured haze is removed: consistent with the sky)
fn hazeApply( uv: vec2f, c: vec4f ) -> vec4f {
	var out = c.rgb;
	let isActive = hazeParams.enabled > 0.5 && frame.cameraUnderwater < 0.5;
	if ( isActive ) {
		var inAir = 1.0;
		if ( hazeParams.hasMedium > 0.5 ) {
			let ms = vec2i( textureDimensions( hazeMedium ) );
			inAir = select( 1.0, 0.0, textureLoad( hazeMedium, clamp( vec2i( uv * vec2f( ms ) ), vec2i( 0 ), ms - 1 ), 0 ).r > 0.5 );
		}
		if ( inAir > 0.5 ) {
			let R = hazeRay( uv );
			let dist = R.dist; let dir = R.dir; let sky = R.sky;
			let camH = max( underwaterParams.camPos.y - frame.seaLevel, 0.0 );

			// the haze looks like the sky just above the horizon in this direction
			let vh = normalize( vec3f( dir.x, max( dir.y, 0.02 ), dir.z ) );
			var fog = atmosphereSkyLuminance( vh );
#if HZ_MOON
			fog += skyMoonSky( vh );
#endif

			// sun (moon) light scattered toward the eye, and its share of the haze radiance
			let Ep = frame.sunColor * hazePhase( dot( dir, frame.sunDir ) );
			let eL = luminance( Ep );
			let fSun = eL / ( eL + luminance( frame.skyIrradiance ) + 1e-5 ) * min( hazeParams.shafts, 1.0 );
			let h = select( smoothstep( 0.0, HZ_NEAR, dist ), 1.0, sky );

			// ---- aerial perspective / marine haze on geometry (the water surface included)
			if ( ! sky ) {
				let tau = ( hazeLayerDepth( HZ_MARINE_SIGMA, HZ_MARINE_H, camH, dir.y, dist ) + hazeLayerDepth( HZ_AEROSOL_SIGMA, HZ_AEROSOL_H, camH, dir.y, dist ) ) * hazeParams.density;
				let T = exp( - tau );
				out = out * T + fog * ( 1.0 - T ) * ( 1.0 - fSun * ( 1.0 - h ) );
			}

			// ---- sun shafts: depth-aware upsample of the half resolution march
			if ( hazeParams.shafts > 0.0 ) {
				let ls = vec2i( textureDimensions( hazeLow ) );
				let pa = uv * vec2f( ls ) - 0.5;
				let i0 = floor( pa );
				let fr = pa - i0;
				var acc = vec2f( 0.0 );
				var wSum = 1e-6;
				for ( var k = 0; k < 4; k++ ) {
					let o = vec2i( k & 1, k >> 1u );
					let s = textureLoad( hazeLow, clamp( vec2i( i0 ) + o, vec2i( 0 ), ls - 1 ), 0 );
					let wb = select( 1.0 - fr.x, fr.x, o.x == 1 ) * select( 1.0 - fr.y, fr.y, o.y == 1 );
					let rel = abs( s.z - dist ) / max( dist, 0.5 );
					let wd = 1.0 / pow2( rel * 10.0 + 1.0 );
					let wt = wb * wd + 1e-5;
					acc += s.xy * wt;
					wSum += wt;
				}
				// The upsample carries the lit share of the in-scatter and the march's ratio to the exact
				// in-scatter; the exact in-scatter is then taken over this pixel's own ray. Upsampling the
				// in-scatter itself gave a thin frond in front of the low sun, whose half resolution
				// neighbours all lie far behind it, their long rays' in-scatter: bright, flickering specks.
				let sh = acc / wSum;
				let all = sh.y * hazeInScatter( camH, dir.y, min( dist, ${ f( MARCH_DIST ) } ) );
				let lit = sat( sh.x ) * all;
				let near = Ep * lit * ( 1.0 - h ) * hazeParams.shafts;
				let deficit = fog * fSun * ( all - lit ) * h;
				out = max( out + near - deficit, vec3f( 0.0 ) );
			}

			// ---- screen-space god rays: sun colour x phase x the near air's haze depth
			if ( hazeParams.ssFade > 0.001 ) {
				let rays = textureSampleLevel( hazeSS, smpLinearClamp, uv, 0.0 ).r;
				let k = 1.0 - exp( - HZ_MARINE_SIGMA * 300.0 * hazeParams.density );
				out += Ep * rays * k * hazeParams.shafts * hazeParams.ssFade * ${ f( SS_GAIN ) };
			}
		}
	}
	return vec4f( out, c.a );
}
`,
		} );
		return this._compositeModule;

	}

	_build() {

		const mod = this.module;
		const defines = this._defines();
		const march = new FullscreenPass( {
			label: 'haze march',
			modules: [ mod ],
			defines,
			colorFormats: [ 'rgba16float' ],
			code: /* wgsl */`
fn fragment( in: FSIn ) -> vec4f {
	let uv = in.uv;
	let R = hazeRay( uv );
	var out = vec4f( 0.0, 0.0, R.dist, 1.0 );
	if ( hazeParams.enabled > 0.5 && frame.cameraUnderwater < 0.5 && hazeParams.shafts > 0.0 ) {
		let cam = underwaterParams.camPos;
		let tMax = min( R.dist, ${ f( MARCH_DIST ) } );
		// interleaved gradient noise, decorrelated per frame (golden ratio sequence)
		let jitter = fract( interleavedGradientNoise( in.pos.xy ) + hazeParams.frame * 0.61803398875 );
		let sigM = HZ_MARINE_SIGMA * hazeParams.density;
		let sigA = HZ_AEROSOL_SIGMA * hazeParams.density;
		var lit = 0.0; var all = 0.0; var tau = 0.0; var tPrev = 0.0;
		// the ray in each cascade's light space is linear in t: its end points, once
		let fwd = - vec3f( frame.view[ 0 ][ 2 ], frame.view[ 1 ][ 2 ], frame.view[ 2 ][ 2 ] );
		var sc0: array<vec4f, 4>; var scd: array<vec4f, 4>;
		for ( var c = 0; c < i32( shadowParams.count ); c++ ) {
			sc0[ c ] = shadowParams.matrices[ c ] * vec4f( cam, 1.0 );
			scd[ c ] = shadowParams.matrices[ c ] * vec4f( R.dir, 0.0 );
		}
		for ( var i = 0; i < ${ STEPS }; i++ ) {
			// quadratic spacing: dense near the camera (palm and pier shafts), sparse far out (clouds, hills)
			let u = ( f32( i ) + jitter ) / ${ f( STEPS ) };
			let t = u * u * tMax;
			let dt = u * ${ f( 2 / STEPS ) } * tMax;
			let P = cam + R.dir * t;
			let h = max( P.y - frame.seaLevel, 0.0 );
			let sig = exp( h / - HZ_MARINE_H ) * sigM + exp( h / - HZ_AEROSOL_H ) * sigA;
			tau += sig * ( t - tPrev );
			tPrev = t;
			let Tr = exp( - tau );
			let w = sig * Tr * dt;
			// sunShadowHard( P ) with the hoisted light-space ray
			var v = 1.0;
			if ( shadowParams.enabled > 0.5 ) {
				let c = shadowCascadeOf( dot( P - frame.cameraPos, fwd ) );
				if ( c >= 0 ) {
					let sc = sc0[ c ] + scd[ c ] * t;
					let suv = vec2f( sc.x * 0.5 + 0.5, 0.5 - sc.y * 0.5 );
					if ( ! ( any( suv <= vec2f( 0.0 ) ) || any( suv >= vec2f( 1.0 ) ) || sc.z > 1.0 ) ) {
						v = select( 0.0, 1.0, sc.z - 2e-5 <= _shadowDepth( suv, c ) );
					}
				}
			}
			lit += w * hazeVisibilityRest( P, v );
			all += w;
		}
		// The lit share of the in-scatter (0..1) and the ratio of the marched in-scatter to its exact
		// value over this ray: both smooth across depth edges, unlike the in-scatter itself, which
		// grows with the distance (see the composite)
		let exact = hazeInScatter( max( cam.y - frame.seaLevel, 0.0 ), R.dir.y, tMax );
		out = vec4f( lit / max( all, 1e-12 ), all / max( exact, 1e-12 ), R.dist, 1.0 );
	}
	return out;
}
`,
		} );

		// sources: sky pixels near the key light, weighted by the sun disc and its aureole, times the
		// cloud transmittance in that direction
		const mask = new FullscreenPass( {
			label: 'haze sun mask',
			modules: [ mod ],
			defines,
			colorFormats: [ 'r16float' ],
			code: /* wgsl */`
fn fragment( in: FSIn ) -> vec4f {
	var out = vec4f( 0.0 );
	if ( hazeParams.ssFade > 0.001 ) {
		let uv = in.uv;
		let dir = underwaterWorldDir( uv );
#if HZ_CLOUDS
		let cloudT = cloudsSunTransmittance( cloudsSampleView( dir ).a );
#else
		let cloudT = 1.0;
#endif
		let size = vec2f( textureDimensions( hazeDepth ) );
		let d = textureLoad( hazeDepth, vec2i( clamp( uv, vec2f( 0.0 ), vec2f( 0.9999 ) ) * size ), 0 );
		let c = dot( dir, frame.sunDir );
		let glow = exp( ( c - 1.0 ) * 600.0 ) + exp( ( c - 1.0 ) * 50.0 ) * 0.25;
		out = vec4f( select( 0.0, glow * cloudT, d < 1e-7 ), 0.0, 0.0, 1.0 );
	}
	return out;
}
`,
		} );

		// one pass of the iterative radial blur toward the light: pass p spans 1 / 8^p of the way, so the
		// three passes together sample the whole segment densely
		const blur = [ 0, 1, 2 ].map( ( p ) => {

			const span = 0.95 / Math.pow( SS_TAPS, p );
			const decay = SS_DECAY[ p ];
			let taps = '', wSum = 0;
			for ( let j = 0; j < SS_TAPS; j ++ ) {

				const w = Math.pow( decay, j );
				taps += `\t\tacc += textureSampleLevel( hzSrc, smpLinearClamp, uv + step * ( ${ f( j ) } + jit ), 0.0 ).r * ${ f( w ) };\n`;
				wSum += w;

			}

			return new FullscreenPass( {
				label: 'haze god rays ' + p,
				modules: [ mod ],
				bindings: { hzSrc: { texture: () => this.ssTargets[ p ].texture } },
				colorFormats: [ 'r16float' ],
				code: /* wgsl */`
fn fragment( in: FSIn ) -> vec4f {
	var out = vec4f( 0.0 );
	if ( hazeParams.ssFade > 0.001 ) {
		let uv = in.uv;
		let step = ( hazeParams.sunUV - uv ) * ${ f( span / SS_TAPS ) };
		// taps shifted by a per pixel, per frame fraction of a step: the fixed taps drew hard radial
		// streaks through cloud gaps and foliage; jittered, the temporal resolve blends them
		// (centred on 0: the average over frames keeps the fixed taps' result)
		let jit = fract( interleavedGradientNoise( in.pos.xy ) + hazeParams.frame * 0.61803398875 + ${ f( p * 0.37 ) } ) - 0.5;
		var acc = 0.0;
${ taps }
		out = vec4f( acc / ${ f( wSum ) }, 0.0, 0.0, 1.0 );
	}
	return out;
}
`,
			} );

		} );

		// temporal accumulation of the march: last frame's result at this pixel's world point (its view
		// distance must match: no history across disocclusions), clamped to this frame's 3x3
		// neighbourhood, blended with the new march
		const temporal = [ 0, 1 ].map( ( src ) => new FullscreenPass( {
			label: 'haze shafts temporal',
			modules: [ mod ],
			defines,
			bindings: { hzCur: { texture: () => this.low.texture }, hzPrev: { texture: () => this.hist[ src ].texture } },
			colorFormats: [ 'rgba16float' ],
			code: /* wgsl */`
fn fragment( in: FSIn ) -> vec4f {
	let size = vec2i( textureDimensions( hzCur ) );
	let p = vec2i( in.pos.xy );
	let cur = textureLoad( hzCur, p, 0 );
	var out = cur;
	if ( hazeParams.histValid > 0.5 ) {
		var lo = cur.xy; var hi = cur.xy;
		for ( var k = 0; k < 9; k++ ) {
			let s = textureLoad( hzCur, clamp( p + vec2i( k % 3 - 1, k / 3 - 1 ), vec2i( 0 ), size - 1 ), 0 ).xy;
			lo = min( lo, s ); hi = max( hi, s );
		}
		let R = hazeRay( in.uv );
		let world = underwaterParams.camPos + R.dir * cur.z;
		let clip = frame.prevViewProjNoJitter * vec4f( world, 1.0 );
		if ( clip.w > 1e-4 ) {
			let puv = clip.xy / clip.w * vec2f( 0.5, -0.5 ) + 0.5;
			if ( all( puv >= vec2f( 0.0 ) ) && all( puv <= vec2f( 1.0 ) ) ) {
				let prev = textureSampleLevel( hzPrev, smpLinearClamp, puv, 0.0 );
				let expect = length( world - frame.prevCameraPos );
				if ( abs( prev.z - expect ) < expect * 0.05 + 0.3 ) {
					out = vec4f( mix( clamp( prev.xy, lo, hi ), cur.xy, 0.12 ), cur.z, 1.0 );
				}
			}
		}
	}
	return out;
}
`,
		} ) );

		this._passes = { march, mask, blur, temporal };

	}

}
