import { GPU } from '../../engine/gpu/GPU.js';
import { Texture } from '../../engine/gpu/Texture.js';
import { ComputeKernel } from '../../engine/gpu/Compute.js';
import { ShaderModule } from '../../engine/gpu/Shader.js';
import { generateMipmaps } from '../../engine/gpu/Mipmaps.js';

// GPU-baked, tileable PBR texture sets for the village materials.
//
// Every set is generated once, on the first frame that draws a village material
// (the village meshes call bake() from onBeforeRender, which runs before the frame's first
// render pass is opened), with two compute kernels per set:
//   1. a "fields" kernel (generator picked by the JOB define) writes height / roughness /
//      occlusion into a transient RGBA16F storage texture and the final albedo or mask map
//      into an RGBA8 storage texture,
//   2. a derivation kernel turns the height field into a tangent-space normal (Sobel
//      filtered) plus horizon-based ambient occlusion, packed as RG = normal xy,
//      B = roughness, A = AO.
// All final maps are RGBA8, fully mipmapped (engine box filter, Mipmaps.js), sampled
// repeat-wrapped, trilinear + 8x anisotropic (smpAnisoRepeat): 43 MB in total. Each transient
// field map is freed right after the submit that ran its derivation pass.
// (The three.js version used ONE uber fields shader + ONE derivation shader to keep cold
// shader compiles short; here each kernel only contains its own generator, which keeps every
// pipeline small instead.)
//
// All noise is periodic over the texture tile so the maps tile seamlessly.
//
// Maps (tile size in metres):
//   woodA / woodN      weathered timber: grain, growth rings, knots, checks; A = paint chip field
//   paintN             paint film: brush strokes, crazing
//   roofA / roofN      corrugated sheet: ribs, screws, dents; A = rust, rust hue, fade, grime
//   thatchA / thatchN  layered palm fronds with frayed tips; A = tip mask
//   stoneA / stoneN    rubble masonry, pits, lichen; A = plaster survival field
//   hardA / hardN      worn metal: rust blooms, pits, scratches
//   grime              R streaks, G salt, B spots / barnacles, A macro variation
//   rope               three strand twist: R shade, G AO, BA normal
//   net                knotted diamond mesh: R alpha, G shade, BA normal
//
// Texel (px, py) of a map holds tile coordinate X = ( px + 0.5 ) / w, Y = ( py + 0.5 ) / h, so
// sampling at uv = ( X, Y ) returns it (as the TSL version's render-target uv convention).
//
// Note on pow(): the TSL generators squared possibly negative values with .pow( 2 ); WGSL's pow()
// is undefined for negative bases, so those are written as x * x (the intended square).

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Periodic noise library (compact: loops are real shader loops so pipelines compile fast)

const noiseModule = new ShaderModule( {
	name: 'villageBakeNoise',
	code: /* wgsl */`
const VLG_TAU: f32 = ${ TAU };

fn vlgHashU( x: f32, y: f32, s: f32 ) -> u32 {
	return ( u32( x ) * 1597334677u ) ^ ( u32( y ) * 3812015801u ) ^ ( u32( s ) * 2654435761u + 1013904223u );
}

// three.js TSL hash() (pcg), [0, 1)
fn vlgPcg( seed: u32 ) -> f32 {
	let state = seed * 747796405u + 2891336453u;
	let word = ( ( state >> ( ( state >> 28u ) + 4u ) ) ^ state ) * 277803737u;
	return f32( ( word >> 22u ) ^ word ) * ( 1.0 / 4294967296.0 );
}

// three independent 10-bit randoms from one hash
fn vlgHash3( x: f32, y: f32, s: f32 ) -> vec3f {
	let h = u32( vlgPcg( vlgHashU( x, y, s ) ) * 1073741823.0 );
	return vec3f( f32( h & 1023u ), f32( ( h >> 10u ) & 1023u ), f32( ( h >> 20u ) & 1023u ) ) / 1023.0;
}

fn vlgWrapP( i: vec2f, per: vec2f ) -> vec2f { return i - per * floor( i / per ); }

fn vlgGrad( gx: f32, gy: f32, s: f32, f: vec2f, ox: f32, oy: f32 ) -> f32 {
	let h = vlgHash3( gx, gy, s ).xy - 0.5;
	return h.x * ( f.x - ox ) + h.y * ( f.y - oy );
}

// periodic 2D gradient noise, roughly in [-1, 1]
fn vlgPNoise( p: vec2f, per: vec2f, s: f32 ) -> f32 {
	let i = floor( p );
	let f = fract( p );
	let u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
	let i0 = vlgWrapP( i, per );
	let i1 = vlgWrapP( i + 1.0, per );
	let n00 = vlgGrad( i0.x, i0.y, s, f, 0.0, 0.0 );
	let n10 = vlgGrad( i1.x, i0.y, s, f, 1.0, 0.0 );
	let n01 = vlgGrad( i0.x, i1.y, s, f, 0.0, 1.0 );
	let n11 = vlgGrad( i1.x, i1.y, s, f, 1.0, 1.0 );
	return mix( mix( n00, n10, u.x ), mix( n01, n11, u.x ), u.y ) * 3.4;
}

// periodic fBm (octave loop inside the shader)
fn vlgPFbm( p: vec2f, per: vec2f, oct: i32, s: f32, gain: f32 ) -> f32 {
	var sum = 0.0;
	var amp = 1.0;
	var norm = 0.0;
	var q = p;
	var pp = per;
	for ( var o = 0; o < oct; o++ ) {
		sum += vlgPNoise( q, pp, s + f32( o ) * 17.0 ) * amp;
		norm += amp;
		amp *= gain;
		q *= 2.0;
		pp *= 2.0;
	}
	return sum / norm;
}

// periodic cellular noise: returns vec4( F1, F2, cellId, 0 )
fn vlgPWorley( p: vec2f, per: vec2f, s: f32, jit: f32 ) -> vec4f {
	let i = floor( p );
	let f = fract( p );
	var d1 = 9.0;
	var d2 = 9.0;
	var id = 0.0;
	for ( var cy = -1; cy < 2; cy++ ) {
		for ( var cx = -1; cx < 2; cx++ ) {
			let o = vec2f( f32( cx ), f32( cy ) );
			let c = vlgWrapP( i + o, per );
			let h = vlgHash3( c.x, c.y, s );
			let d = length( o + ( h.xy - 0.5 ) * jit + 0.5 - f );
			if ( d < d1 ) {
				d2 = d1;
				d1 = d;
				id = h.z;
			} else if ( d < d2 ) {
				d2 = d;
			}
		}
	}
	return vec4f( d1, d2, id, 0.0 );
}

// periodic cellular noise returning the offset to the nearest feature: vec4( rel.x, rel.y, F1, cellId )
fn vlgPWorleyRel( p: vec2f, per: vec2f, s: f32, jit: f32 ) -> vec4f {
	let i = floor( p );
	let f = fract( p );
	var d1 = 9.0;
	var rel = vec2f( 0.0 );
	var id = 0.0;
	for ( var cy = -1; cy < 2; cy++ ) {
		for ( var cx = -1; cx < 2; cx++ ) {
			let o = vec2f( f32( cx ), f32( cy ) );
			let c = vlgWrapP( i + o, per );
			let h = vlgHash3( c.x, c.y, s );
			let dv = f - ( o + ( h.xy - 0.5 ) * jit + 0.5 );
			let d = length( dv );
			if ( d < d1 ) {
				d1 = d;
				rel = dv;
				id = h.z;
			}
		}
	}
	return vec4f( rel, d1, id );
}

// convenience wrappers (fx, fy: integer frequencies over the tile)
fn vlgPn( X: f32, Y: f32, fx: f32, fy: f32, s: f32 ) -> f32 { return vlgPNoise( vec2f( X * fx, Y * fy ), vec2f( fx, fy ), s ); }
fn vlgPf( X: f32, Y: f32, fx: f32, fy: f32, oct: i32, s: f32, gain: f32 ) -> f32 { return vlgPFbm( vec2f( X * fx, Y * fy ), vec2f( fx, fy ), oct, s, gain ); }
fn vlgPw( X: f32, Y: f32, fx: f32, fy: f32, s: f32, jit: f32 ) -> vec4f { return vlgPWorley( vec2f( X * fx, Y * fy ), vec2f( fx, fy ), s, jit ); }
fn vlgPwr( X: f32, Y: f32, fx: f32, fy: f32, s: f32, jit: f32 ) -> vec4f { return vlgPWorleyRel( vec2f( X * fx, Y * fy ), vec2f( fx, fy ), s, jit ); }
fn vlgN01( n: f32 ) -> f32 { return n * 0.5 + 0.5; }
fn vlgHf( a: f32, b: f32 ) -> f32 { return fract( sin( a * 12.9898 + b * 78.233 ) * 43758.5453 ); }
fn vlgBand( x: f32, a: f32, b: f32, c: f32, d: f32 ) -> f32 { return smoothstep( a, b, x ) * ( 1.0 - smoothstep( c, d, x ) ); }

struct VlgOut {
	fields: vec4f,  // height, roughness, occlusion, 0
	albedo: vec4f,  // albedo / mask map
};
`,
} );

// ---------------------------------------------------------------------------
// Texture set generators. Each returns VlgOut { fields: vec4( height, roughness, occlusion, 0 ), albedo }
// X, Y are tile coordinates in [0, 1).

const GENERATORS = {

	// WEATHERED WOOD - tile = 2 m along the grain (X) x 1 m across (Y)
	wood: /* wgsl */`
fn vlgGen( X: f32, Y: f32 ) -> VlgOut {
	// knots with grain flowing around them
	let kw = vlgPwr( X, Y, 6.0, 10.0, 11.0, 0.7 );
	let kHas = step( 0.9, kw.w );
	let kRad = 0.01 + vlgHf( kw.w, 3.3 ) * 0.013;
	let kdm = length( vec2f( kw.x * ( 2.0 / 6.0 ), kw.y * ( 1.0 / 10.0 ) ) );
	let kInfl = exp( - ( kdm / ( kRad * 2.4 ) ) ) * kHas;

	// growth rings with uneven spacing and per-ring width / contrast
	let warpA = vlgPf( X, Y, 2.0, 4.0, 3, 21.0, 0.5 );
	let warpB = vlgPf( X, Y, 1.0, 2.0, 2, 23.0, 0.5 );
	let r = Y * 110.0 + warpA * 5.0 + warpB * 14.0 + kInfl * 14.0;
	let ringId = floor( r );
	let ringIdW = ringId - floor( ringId / 110.0 ) * 110.0;
	let w = fract( r );
	let lw = mix( 0.09, 0.32, vlgHf( ringIdW, 5.1 ) );
	let late = smoothstep( 0.93 - lw, 1.0 - lw, w ) * ( 1.0 - smoothstep( 0.9, 0.995, w ) );
	let ringDark = mix( 0.65, 1.15, vlgHf( ringIdW, 9.7 ) );

	// dense fibre streaks along the grain (the signature of sun-weathered timber)
	let fA = vlgN01( vlgPn( X, Y, 12.0, 300.0, 53.0 ) );
	let fB = vlgN01( vlgPn( X, Y, 5.0, 140.0, 55.0 ) );
	let fC = vlgN01( vlgPn( X, Y, 16.0, 400.0, 57.0 ) );
	let streak = fA * 0.5 + fB * 0.3 + fC * 0.2;
	let erosion = ( 1.0 - late ) * ( fB * 0.6 + 0.4 );

	// checks / cracks along the grain, tapering at the ends
	let crN = abs( vlgPn( X, Y, 6.0, 60.0, 71.0 ) );
	let crMask = smoothstep( 0.1, 0.45, vlgPf( X, Y, 3.0, 4.0, 2, 73.0, 0.5 ) );
	let crack = ( 1.0 - smoothstep( 0.012, 0.055, crN / ( crMask + 0.05 ) ) ) * step( 0.05, crMask );

	let kCore = ( 1.0 - smoothstep( kRad * 0.72, kRad, kdm ) ) * kHas;
	let kRing = vlgBand( kdm, kRad * 0.92, kRad * 1.02, kRad * 1.05, kRad * 1.3 ) * kHas;

	let height = 0.46 + late * 0.22 * ringDark - erosion * 0.09 + ( streak - 0.5 ) * 0.14
		- crack * 0.36 + kCore * 0.08 - kRing * 0.22;

	// silver grey surface, brown-grey eroded grooves, fibre streaks, stains and bleaching
	let blotch = vlgN01( vlgPf( X, Y, 2.0, 3.0, 3, 81.0, 0.5 ) );
	let bleach = smoothstep( 0.5, 0.82, vlgN01( vlgPf( X, Y, 3.0, 2.0, 3, 83.0, 0.5 ) ) );
	let stain = smoothstep( 0.58, 0.86, vlgN01( vlgPf( X, Y, 4.0, 5.0, 3, 85.0, 0.5 ) ) );
	// sun-bleached driftwood grey (linear albedo ~0.2 in the grooves, ~0.45 on the latewood)
	let grooveC = vec3f( 0.2, 0.186, 0.168 );
	let silverC = vec3f( 0.45, 0.445, 0.428 );
	var col = mix( grooveC, silverC, clamp( late * ringDark * 0.55 + streak * 0.75 - 0.12, 0.0, 1.0 ) );
	col = col * ( fA * 0.34 + 0.83 );
	col = col * ( 1.0 - smoothstep( 0.7, 0.95, fC ) * 0.3 );
	col = col * ( blotch * 0.24 + 0.88 );
	col = mix( col, vec3f( 0.55, 0.54, 0.51 ), bleach * 0.3 );
	col = mix( col, col * vec3f( 0.8, 0.68, 0.54 ), stain * 0.6 );
	col = mix( col, vec3f( 0.035, 0.03, 0.026 ), crack * 0.92 );
	col = mix( col, mix( vec3f( 0.13, 0.085, 0.05 ), vec3f( 0.07, 0.045, 0.03 ), fract( kdm * 900.0 ) ), kCore );
	col = mix( col, vec3f( 0.05, 0.04, 0.03 ), kRing * 0.8 );

	// paint chip field (A): paint lets go in grain-aligned flakes, first at cracks, knots and eroded grain
	let flake = vlgPw( X, Y, 30.0, 80.0, 91.0, 0.9 );
	let chipLarge = vlgN01( vlgPf( X, Y, 4.0, 8.0, 4, 97.0, 0.5 ) );
	let chip = chipLarge * 0.62 + flake.z * 0.3 + late * 0.06 - erosion * 0.04
		- crack * 0.4 - kCore * 0.1;

	let rough = clamp( 0.82 + erosion * 0.1 + fA * 0.04 + crack * 0.08 - kCore * 0.15, 0.0, 1.0 );
	let occ = 1.0 - crack * 0.65 - kRing * 0.4 - erosion * 0.08;
	return VlgOut( vec4f( height, rough, occ, 0.0 ), vec4f( col, clamp( chip, 0.0, 1.0 ) ) );
}
`,

	// PAINT FILM - tile = 1 m along the grain (X) x 0.5 m across (Y): brush strokes and crazing
	paint: /* wgsl */`
fn vlgGen( X: f32, Y: f32 ) -> VlgOut {
	let strokes = vlgPn( X, Y, 4.0, 60.0, 701.0 ) * 0.25 + vlgPn( X, Y, 16.0, 160.0, 703.0 ) * 0.12 + vlgPn( X, Y, 2.0, 12.0, 704.0 ) * 0.2;
	let cz = vlgPw( X, Y, 34.0, 40.0, 705.0, 1.0 );
	let crazeMask = smoothstep( 0.62, 0.85, vlgN01( vlgPf( X, Y, 3.0, 2.0, 3, 707.0, 0.5 ) ) );
	let craze = ( 1.0 - smoothstep( 0.015, 0.04, cz.y - cz.x ) ) * crazeMask;
	let height = 0.5 + strokes - craze * 0.12;
	let rough = clamp( 0.5 + strokes * 0.35 + craze * 0.15, 0.0, 1.0 );
	let occ = 1.0 - craze * 0.18;
	return VlgOut( vec4f( height, rough, occ, 0.0 ), vec4f( 0.0 ) );
}
`,

	// GRIME / SALT - tile = 2 m x 2 m in mesh space (X along the wall, Y up)
	grime: /* wgsl */`
fn vlgGen( X: f32, Y: f32 ) -> VlgOut {
	let streak = smoothstep( 0.55, 0.9, vlgN01( vlgPn( X, Y, 26.0, 2.0, 601.0 ) ) ) * smoothstep( 0.35, 0.7, vlgN01( vlgPf( X, Y, 4.0, 3.0, 2, 603.0, 0.5 ) ) );
	let drip = smoothstep( 0.6, 0.95, vlgN01( vlgPn( X, Y, 70.0, 4.0, 604.0 ) ) ) * 0.5;
	let salt = smoothstep( 0.52, 0.8, vlgN01( vlgPf( X, Y, 4.0, 4.0, 5, 605.0, 0.5 ) ) ) * ( vlgN01( vlgPn( X, Y, 120.0, 120.0, 607.0 ) ) * 0.5 + 0.5 );
	let mw = vlgPw( X, Y, 60.0, 60.0, 609.0, 1.0 );
	let mildew = ( 1.0 - smoothstep( 0.05, 0.22, mw.x ) ) * step( 0.6, vlgN01( vlgPf( X, Y, 3.0, 3.0, 3, 611.0, 0.5 ) ) );
	let macroV = vlgN01( vlgPf( X, Y, 2.0, 2.0, 3, 613.0, 0.5 ) );
	return VlgOut( vec4f( 0.0 ), vec4f( clamp( streak + drip, 0.0, 1.0 ), salt, mildew, macroV ) );
}
`,

	// CORRUGATED ROOF SHEET - tile = 0.84 m across the ribs (X, 8 ribs) x 1.68 m down the slope (Y, 3 purlins)
	roof: /* wgsl */`
fn vlgGen( X: f32, Y: f32 ) -> VlgOut {
	let corr = sin( ( X * 8.0 - 0.25 ) * VLG_TAU ) * 0.5 + 0.5;
	let valley = 1.0 - corr;
	// screws with washers on every second crest at each purlin
	let sx = ( fract( X * 4.0 - 0.25 + 0.5 ) - 0.5 ) * ( 0.84 / 4.0 );
	let sy = ( fract( Y * 3.0 - 0.5 + 0.5 ) - 0.5 ) * ( 1.68 / 3.0 );
	let ds = length( vec2f( sx, sy ) );
	let washer = 1.0 - smoothstep( 0.0095, 0.0115, ds );
	let hq = ds / 0.0065;
	let head = sqrt( max( 1.0 - hq * hq, 0.0 ) );
	// dents, rust pitting
	let dw = vlgPw( X, Y, 5.0, 10.0, 13.0, 0.9 );
	let dent = step( 0.7, dw.z ) * ( 1.0 - smoothstep( 0.0, 0.5, dw.x ) );
	let blot = vlgN01( vlgPf( X, Y, 3.0, 5.0, 5, 31.0, 0.5 ) );
	let vstreak = vlgN01( vlgPn( X, Y, 48.0, 3.0, 33.0 ) );
	let sq = sx / 0.007;
	let screwStreak = exp( - ( sq * sq ) ) * smoothstep( - 0.35, - 0.01, sy ) * step( sy, 0.004 )
		* ( vlgN01( vlgPn( X, Y, 16.0, 6.0, 35.0 ) ) * 0.8 + 0.2 );
	let edge = 1.0 - smoothstep( 0.0, 0.05, min( X, 1.0 - X ) * 0.84 );
	let streakLong = smoothstep( 0.55, 0.85, vlgN01( vlgPn( X, Y, 64.0, 2.0, 39.0 ) ) ) * vlgN01( vlgPf( X, Y, 4.0, 6.0, 2, 45.0, 0.5 ) );
	let rust = clamp( blot * 0.42 + vstreak * valley * 0.25 + streakLong * 0.35 + screwStreak * 0.7 + washer * 0.45 + edge * 0.3 + dent * 0.15 - 0.05, 0.0, 1.0 );
	let pit = vlgPn( X, Y, 150.0, 300.0, 37.0 ) * smoothstep( 0.45, 0.8, rust );
	let lapLine = 1.0 - smoothstep( 0.0012, 0.0028, abs( X * 0.84 - 0.028 ) );
	let lapTop = 1.0 - smoothstep( 0.026, 0.03, X * 0.84 );
	let height = corr * 0.9 + washer * 0.035 + head * 0.05 - dent * 0.1 + pit * 0.012 + lapTop * 0.012;

	let rustVar = vlgN01( vlgPf( X, Y, 10.0, 20.0, 3, 41.0, 0.5 ) );
	let fade = clamp( vlgN01( vlgPf( X, Y, 2.0, 4.0, 4, 43.0, 0.5 ) ) * 0.8 + corr * 0.25, 0.0, 1.0 );
	let grime = clamp( valley * vlgN01( vlgPn( X, Y, 32.0, 2.0, 47.0 ) ) * 0.8 + blot * 0.2, 0.0, 1.0 );
	let rough = clamp( 0.5 + ( vlgN01( vlgPn( X, Y, 20.0, 40.0, 49.0 ) ) - 0.5 ) * 0.25 + fade * 0.1, 0.0, 1.0 );
	let occ = 1.0 - lapLine * 0.7 - vlgBand( ds, 0.0095, 0.011, 0.012, 0.016 ) * 0.35;
	return VlgOut( vec4f( height, rough, occ, 0.0 ), vec4f( rust, rustVar, fade, grime ) );
}
`,

	// PALM THATCH - tile = 1 m along the eave (X) x 1 m up the slope (Y), 5 layered rows
	thatch: /* wgsl */`
struct VlgRow { tip: f32, sf: f32, rnd: f32 };

const VLG_R: f32 = 5.0;

fn vlgRow( X: f32, rowF: f32, k: f32 ) -> VlgRow {
	let kk = k - floor( k / VLG_R ) * VLG_R;
	let warp = vlgPNoise( vec2f( X * 7.0, kk * 3.1 ), vec2f( 7.0, 1000.0 ), 131.0 );
	// strands lean a little, in coherent groups, so they are not perfectly parallel
	let lean = vlgPNoise( vec2f( X * 9.0, kk * 5.3 ), vec2f( 9.0, 1000.0 ), 133.0 );
	let s = max( rowF - k, - 0.5 );
	let sc = X * 110.0 + warp * 1.3 + lean * s * 2.2;
	let sid = floor( sc );
	let sidW = sid - floor( sid / 110.0 ) * 110.0;
	let sf = fract( sc );
	let rnd = vlgHf( sidW + kk * 211.0, kk * 7.3 + 1.0 );
	let lump = vlgN01( vlgPNoise( vec2f( X * 5.0, kk * 2.3 ), vec2f( 5.0, 1000.0 ), 137.0 ) );
	let lump2 = vlgN01( vlgPNoise( vec2f( X * 2.0, kk * 1.7 ), vec2f( 2.0, 1000.0 ), 139.0 ) );
	let hang = 0.06 + lump * 0.14 + lump2 * 0.16 + rnd * rnd * 0.22;
	return VlgRow( k - hang, sf, rnd );
}

fn vlgGen( X: f32, Y: f32 ) -> VlgOut {
	// rows wave up and down along the eave and are unevenly spaced
	let rowWarp = vlgPn( X, Y, 3.0, 1.0, 143.0 ) * 0.22 + vlgPn( X, Y, 7.0, 2.0, 145.0 ) * 0.1;
	let rowF = Y * VLG_R + rowWarp;
	let k0 = floor( rowF );

	let r0 = vlgRow( X, rowF, k0 );
	let r1 = vlgRow( X, rowF, k0 + 1.0 );
	let r2 = vlgRow( X, rowF, k0 + 2.0 );
	let in1 = step( r1.tip, rowF );
	let tip = mix( r0.tip, r1.tip, in1 );
	let nextTip = mix( r1.tip, r2.tip, in1 );
	let sf = mix( r0.sf, r1.sf, in1 );
	let rnd = mix( r0.rnd, r1.rnd, in1 );
	let s = rowF - tip;
	let dNext = nextTip - rowF;

	let bulge = sin( sf * ${ Math.PI } );
	let tipZone = 1.0 - smoothstep( 0.0, 0.16, s );
	// frayed tips and gaps between strands reveal the darker layer underneath
	let gapW = mix( 0.43, 0.3, tipZone ) - vlgHf( rnd, 2.2 ) * 0.06;
	let gap = smoothstep( gapW, gapW + 0.05, abs( sf - 0.5 ) );
	let fibre = vlgPn( X, Y, 330.0, 6.0, 139.0 );
	let fibre2 = vlgPn( X, Y, 160.0, 3.0, 141.0 );
	let height = 0.92 - min( s, 1.3 ) / 1.3 * 0.55 + bulge * 0.08 + fibre * 0.03 - gap * 0.32;

	let golden = vec3f( 0.42, 0.3, 0.13 );
	let pale = vec3f( 0.5, 0.43, 0.27 );
	let brown = vec3f( 0.24, 0.165, 0.09 );
	let grey = vec3f( 0.34, 0.31, 0.26 );
	var col = mix( golden, pale, smoothstep( 0.25, 0.75, rnd ) );
	col = mix( col, brown, step( 0.85, rnd ) * 0.75 );
	col = mix( col, grey, smoothstep( 0.1, 0.5, vlgHf( rnd, 9.1 ) ) * 0.4 );
	col = col * ( vlgN01( fibre ) * 0.38 + 0.8 ) * ( vlgN01( fibre2 ) * 0.2 + 0.9 );
	col = mix( col, grey * 1.18, tipZone * 0.4 );
	col = col * ( 1.0 - smoothstep( 0.55, 1.25, s ) * 0.3 );
	col = mix( col, vec3f( 0.07, 0.055, 0.035 ), gap * 0.85 );
	let occ = ( smoothstep( 0.0, 0.32, dNext ) * 0.7 + 0.3 ) * ( bulge * 0.25 + 0.75 ) * ( 1.0 - gap * 0.6 );
	let rough = 0.88 + fibre * 0.05;
	return VlgOut( vec4f( height, rough, occ, 0.0 ), vec4f( col, tipZone ) );
}
`,

	// RUBBLE STONE WITH MORTAR - tile = 2 m x 2 m: warped, rounded stones with mottling and lichen
	stone: /* wgsl */`
fn vlgGen( X: f32, Y: f32 ) -> VlgOut {
	let wx = vlgPf( X, Y, 4.0, 4.0, 2, 213.0, 0.5 ) * 0.45;
	let wy = vlgPf( X, Y, 4.0, 4.0, 2, 215.0, 0.5 ) * 0.45;
	let W = vlgPWorley( vec2f( X * 7.0 + wx, Y * 12.0 + wy ), vec2f( 7.0, 12.0 ), 201.0, 0.85 );
	let edge = W.y - W.x;
	let mortar = 1.0 - smoothstep( 0.035, 0.085, edge );
	let dome = pow( smoothstep( 0.02, 0.5, edge ), 0.7 );
	let surf = vlgPf( X, Y, 24.0, 24.0, 4, 203.0, 0.5 );
	let pits = vlgPw( X, Y, 70.0, 70.0, 207.0, 1.0 );
	let porous = step( 0.55, vlgHf( W.z, 4.2 ) );
	let pitSize = mix( 0.1, 0.19, vlgHf( pits.z, 1.7 ) );
	let pit = ( 1.0 - smoothstep( pitSize * 0.6, pitSize, pits.x ) ) * step( 0.4, pits.z ) * ( porous * 0.75 + 0.25 );
	let sandy = vlgPn( X, Y, 140.0, 140.0, 209.0 );
	let height = 0.2 + dome * 0.46 + surf * 0.11 + vlgPn( X, Y, 200.0, 200.0, 229.0 ) * 0.025 - pit * 0.16 - mortar * 0.12 + sandy * 0.02;

	let id = W.z;
	// coral stone / limestone: warm beiges with the odd darker basalt and pale block
	let c0 = vec3f( 0.55, 0.5, 0.41 );
	let c1 = vec3f( 0.47, 0.45, 0.41 );
	let c2 = vec3f( 0.42, 0.37, 0.3 );
	let c3 = vec3f( 0.3, 0.29, 0.27 );
	let c4 = vec3f( 0.64, 0.6, 0.52 );
	var col = mix( c0, c1, smoothstep( 0.2, 0.4, id ) );
	col = mix( col, c2, smoothstep( 0.5, 0.62, id ) );
	col = mix( col, c3, smoothstep( 0.8, 0.86, id ) * 0.8 );
	col = mix( col, c4, smoothstep( 0.9, 0.97, id ) );
	// mottling, veins and weathering inside each stone
	let mott = vlgN01( vlgPf( X, Y, 10.0, 10.0, 4, 217.0, 0.5 ) );
	let vein = ( 1.0 - smoothstep( 0.0, 0.035, abs( vlgPf( X, Y, 6.0, 6.0, 3, 219.0, 0.5 ) ) ) ) * step( 0.6, vlgHf( id, 6.6 ) );
	let speck = vlgN01( vlgPn( X, Y, 300.0, 300.0, 225.0 ) );
	let grain = vlgN01( vlgPn( X, Y, 120.0, 120.0, 227.0 ) );
	col = col * ( mott * 0.6 + 0.68 ) * ( vlgN01( surf ) * 0.3 + 0.85 ) * ( speck * 0.34 + 0.83 ) * ( grain * 0.22 + 0.89 );
	col = col * mix( 0.66, 1.0, smoothstep( 0.04, 0.28, edge ) );
	col = mix( col, col * 1.25, vein * 0.5 );
	// lichen: pale grey-green and dark specks
	let lich = smoothstep( 0.62, 0.8, vlgN01( vlgPf( X, Y, 8.0, 8.0, 3, 221.0, 0.5 ) ) ) * smoothstep( 0.4, 0.6, vlgN01( vlgPn( X, Y, 60.0, 60.0, 223.0 ) ) );
	col = mix( col, vec3f( 0.42, 0.44, 0.36 ), lich * 0.45 );
	col = col * ( 1.0 - pit * 0.5 );
	col = mix( col, vec3f( 0.5, 0.47, 0.41 ) * ( vlgN01( sandy ) * 0.3 + 0.85 ), mortar );
	col = col * ( 1.0 - vlgBand( edge, 0.03, 0.06, 0.08, 0.16 ) * 0.3 );
	let plaster = clamp( vlgN01( vlgPf( X, Y, 3.0, 3.0, 5, 211.0, 0.5 ) ) - mortar * 0.08, 0.0, 1.0 );
	let rough = 0.84 + surf * 0.06 + mortar * 0.1 - lich * 0.05;
	let occ = 1.0 - pit * 0.55 - mortar * 0.3;
	return VlgOut( vec4f( height, rough, occ, 0.0 ), vec4f( col, plaster ) );
}
`,

	// WORN METAL / PLASTIC - tile = 1 m x 1 m: rust blooms, pits, scratches, grime
	hard: /* wgsl */`
fn vlgGen( X: f32, Y: f32 ) -> VlgOut {
	let base = vlgN01( vlgPf( X, Y, 4.0, 4.0, 5, 401.0, 0.5 ) );
	let sp = vlgPw( X, Y, 16.0, 16.0, 403.0, 1.0 );
	let spots = ( 1.0 - smoothstep( 0.1, 0.38, sp.x ) ) * step( 0.5, sp.z );
	let rust = clamp( base * 0.8 + spots * 0.35 - 0.08, 0.0, 1.0 );
	let sMask = smoothstep( 0.2, 0.6, vlgN01( vlgPf( X, Y, 3.0, 3.0, 2, 413.0, 0.5 ) ) );
	let s1 = 1.0 - smoothstep( 0.008, 0.03, abs( vlgPn( X, Y, 3.0, 90.0, 405.0 ) ) );
	let s2 = 1.0 - smoothstep( 0.008, 0.03, abs( vlgPn( X, Y, 90.0, 3.0, 407.0 ) ) );
	let scratch = max( s1, s2 ) * sMask;
	let grime = vlgN01( vlgPf( X, Y, 3.0, 3.0, 3, 409.0, 0.5 ) );
	let pw2 = vlgPw( X, Y, 90.0, 90.0, 411.0, 1.0 );
	let pit = ( 1.0 - smoothstep( 0.1, 0.28, pw2.x ) ) * smoothstep( 0.4, 0.8, rust );
	let bump = vlgPn( X, Y, 40.0, 40.0, 415.0 ) * 0.04 * rust;
	let height = 0.5 - pit * 0.3 - scratch * 0.12 + bump;
	let rough = clamp( 0.5 + rust * 0.3 - scratch * 0.25 + grime * 0.08, 0.0, 1.0 );
	let occ = 1.0 - pit * 0.5;
	return VlgOut( vec4f( height, rough, occ, 0.0 ), vec4f( rust, scratch, grime, 0.0 ) );
}
`,

	// three-strand rope, tile = one circumference long x full circumference around
	rope: /* wgsl */`
fn vlgRopeH( q: vec2f ) -> f32 {
	let phi = ( q.x + q.y ) * 3.0;
	let sf = fract( phi );
	let a = sf * 2.0 - 1.0;
	let prof = sqrt( max( 1.0 - a * a, 0.0 ) );
	let yarn = fract( sf * 3.0 + ( q.x - q.y ) * 6.0 );
	let b = yarn * 2.0 - 1.0;
	let yprof = sqrt( max( 1.0 - b * b, 0.0 ) );
	let fuzz = vlgPNoise( q * 64.0, vec2f( 64.0 ), 801.0 );
	return prof * 0.8 + yprof * prof * 0.2 + fuzz * 0.03;
}

fn vlgGen( X: f32, Y: f32 ) -> VlgOut {
	let q = vec2f( X, Y );
	let e = 1.0 / 256.0;
	let hx = vlgRopeH( q + vec2f( e, 0.0 ) ) - vlgRopeH( q - vec2f( e, 0.0 ) );
	let hy = vlgRopeH( q + vec2f( 0.0, e ) ) - vlgRopeH( q - vec2f( 0.0, e ) );
	let n = normalize( vec3f( hx * ( - 0.09 / ( 2.0 * e ) ), hy * ( - 0.09 / ( 2.0 * e ) ), 1.0 ) );
	let h = vlgRopeH( q );
	let fib = vlgN01( vlgPNoise( vec2f( ( X + Y ) * 40.0, ( X - Y ) * 160.0 ), vec2f( 40.0, 160.0 ), 803.0 ) );
	let lum = 0.45 + h * 0.4 + fib * 0.15;
	let ao = 0.3 + smoothstep( 0.0, 0.7, h ) * 0.7;
	return VlgOut( vec4f( 0.0 ), vec4f( lum, ao, n.x * 0.5 + 0.5, n.y * 0.5 + 0.5 ) );
}
`,

	// knotted diamond fishing net, tile = 0.2 m (4 x 4 meshes)
	net: /* wgsl */`
fn vlgNetH( q: vec2f ) -> f32 {
	let a = ( q.x + q.y ) * 4.0;
	let b = ( q.x - q.y ) * 4.0;
	let da = 0.5 - abs( fract( a ) - 0.5 );
	let db = 0.5 - abs( fract( b ) - 0.5 );
	let w = 0.055;
	let qa = da / w;
	let qb = db / w;
	let la = sqrt( max( 1.0 - qa * qa, 0.0 ) ) * ( abs( fract( b * 14.0 ) - 0.5 ) * 0.25 + 0.8 );
	let lb = sqrt( max( 1.0 - qb * qb, 0.0 ) ) * ( abs( fract( a * 14.0 ) - 0.5 ) * 0.25 + 0.8 );
	let qk = length( vec2f( da, db ) ) / 0.1;
	let knot = sqrt( max( 1.0 - qk * qk, 0.0 ) ) * 1.35;
	return max( max( la, lb ), knot );
}

fn vlgGen( X: f32, Y: f32 ) -> VlgOut {
	let q = vec2f( X, Y );
	let e = 1.0 / 256.0;
	let h = vlgNetH( q );
	let hx = vlgNetH( q + vec2f( e, 0.0 ) ) - vlgNetH( q - vec2f( e, 0.0 ) );
	let hy = vlgNetH( q + vec2f( 0.0, e ) ) - vlgNetH( q - vec2f( 0.0, e ) );
	let n = normalize( vec3f( hx * ( - 0.012 / ( 2.0 * e ) ), hy * ( - 0.012 / ( 2.0 * e ) ), 1.0 ) );
	let alpha = smoothstep( 0.0, 0.18, h );
	let shade = 0.45 + min( h, 1.0 ) * 0.55;
	return VlgOut( vec4f( 0.0 ), vec4f( alpha, shade, n.x * 0.5 + 0.5, n.y * 0.5 + 0.5 ) );
}
`,

};

// ---------------------------------------------------------------------------
// Derivation pass: Sobel normal + horizon AO from the height field.
// Taps read the field map like the TSL version's nearest-filtered, repeat-wrapped texture():
// texel floor( pixel centre + offset ), wrapped.

function deriveCode( set ) {

	const f = ( x ) => {

		const s = Number( x ).toPrecision( 9 );
		return s.includes( '.' ) || s.includes( 'e' ) ? s : s + '.0';

	};

	const slope = [ set.hs / ( set.mx / set.w ), set.hs / ( set.my / set.h ) ];
	const ao = [ set.ao, set.hs / ( ( set.mx / set.w + set.my / set.h ) * 0.5 ) ];
	let hor = '';
	for ( let i = 0; i < 8; i ++ ) {

		const a = i / 8 * TAU + 0.3;
		for ( const rad of [ 3, 9 ] ) hor += `\tocc += clamp( ( vlgTap( px, vec2f( ${ f( Math.cos( a ) * rad ) }, ${ f( Math.sin( a ) * rad ) } ) ).x - c.x ) * AO.y / ${ f( rad ) } * 1.6, 0.0, 1.0 );\n`;

	}

	return /* wgsl */`
const SLOPE = vec2f( ${ f( slope[ 0 ] ) }, ${ f( slope[ 1 ] ) } );
const AO = vec2f( ${ f( ao[ 0 ] ) }, ${ f( ao[ 1 ] ) } );

fn vlgTap( px: vec2f, o: vec2f ) -> vec4f {
	let dim = vec2i( textureDimensions( vlgFields ) );
	let p = vec2i( floor( px + o ) );
	return textureLoad( vlgFields, ( ( p % dim ) + dim ) % dim, 0 );
}

@compute @workgroup_size( WG_X, WG_Y, 1 )
fn main( @builtin( global_invocation_id ) gid: vec3u ) {
	let dim = textureDimensions( vlgFields );
	if ( gid.x >= dim.x || gid.y >= dim.y ) { return; }
	let px = vec2f( gid.xy ) + 0.5;
	let tl = vlgTap( px, vec2f( -1.0, 1.0 ) ).x;
	let t = vlgTap( px, vec2f( 0.0, 1.0 ) ).x;
	let tr = vlgTap( px, vec2f( 1.0, 1.0 ) ).x;
	let l = vlgTap( px, vec2f( -1.0, 0.0 ) ).x;
	let r = vlgTap( px, vec2f( 1.0, 0.0 ) ).x;
	let bl = vlgTap( px, vec2f( -1.0, -1.0 ) ).x;
	let b = vlgTap( px, vec2f( 0.0, -1.0 ) ).x;
	let br = vlgTap( px, vec2f( 1.0, -1.0 ) ).x;
	let c = vlgTap( px, vec2f( 0.0 ) );
	let dX = ( tr + r * 2.0 + br - ( tl + l * 2.0 + bl ) ) / 8.0;
	let dY = ( tl + t * 2.0 + tr - ( bl + b * 2.0 + br ) ) / 8.0;
	let n = normalize( vec3f( - dX * SLOPE.x, - dY * SLOPE.y, 1.0 ) );
	// horizon based occlusion: 8 directions x 2 radii
	var occ = 0.0;
${ hor }
	let ao = clamp( 1.0 - occ / 16.0 * AO.x, 0.0, 1.0 ) * c.z;
	textureStore( vlgNRA, vec2i( gid.xy ), vec4f( n.x * 0.5 + 0.5, n.y * 0.5 + 0.5, c.y, ao ) );
}
`;

}

// ---------------------------------------------------------------------------
// Bake orchestration.

// out: name of the albedo / mask map, nra: name of the normal-roughness-AO map
const SETS = [
	{ name: 'wood', w: 1024, h: 1024, mx: 2.0, my: 1.0, hs: 0.0022, ao: 1.2, out: 'woodA', nra: 'woodN' },
	{ name: 'paint', w: 512, h: 512, mx: 1.0, my: 0.5, hs: 0.0016, ao: 0.6, out: null, nra: 'paintN' },
	{ name: 'roof', w: 512, h: 1024, mx: 0.84, my: 1.68, hs: 0.022, ao: 0.9, out: 'roofA', nra: 'roofN' },
	{ name: 'thatch', w: 1024, h: 1024, mx: 1.0, my: 1.0, hs: 0.035, ao: 1.3, out: 'thatchA', nra: 'thatchN' },
	{ name: 'stone', w: 1024, h: 1024, mx: 2.0, my: 2.0, hs: 0.02, ao: 1.1, out: 'stoneA', nra: 'stoneN' },
	{ name: 'hard', w: 512, h: 512, mx: 1.0, my: 1.0, hs: 0.0012, ao: 0.8, out: 'hardA', nra: 'hardN' },
	{ name: 'grime', w: 512, h: 512, out: 'grime', nra: null },
	{ name: 'rope', w: 256, h: 256, out: 'rope', nra: null },
	{ name: 'net', w: 256, h: 256, out: 'net', nra: null },
];

function finalTexture( label, w, h ) {

	// RGBA8, full mip chain; sampled with smpAnisoRepeat (trilinear + 8x anisotropic, repeat)
	return new Texture( { label, width: w, height: h, format: 'rgba8unorm', mips: true, usage: [ 'sample', 'storage', 'copyDst' ], sampler: 'anisoRepeat' } );

}

export class VillageTextures {

	constructor() {

		this.baked = false;
		this.bakeMs = 0;
		this.textures = {};
		this.jobs = [];
		this._bytes = 0;

		for ( const set of SETS ) {

			const job = { set, fields: null, albedo: null, nra: null };
			if ( set.nra ) job.fields = new Texture( { label: 'vlgFields_' + set.name, width: set.w, height: set.h, format: 'rgba16float', usage: [ 'sample', 'storage' ] } );
			if ( set.out ) {

				job.albedo = finalTexture( set.out, set.w, set.h );
				this.textures[ set.out ] = job.albedo;
				this._bytes += set.w * set.h * 4 * 4 / 3;

			}

			if ( set.nra ) {

				job.nra = finalTexture( set.nra, set.w, set.h );
				this.textures[ set.nra ] = job.nra;
				this._bytes += set.w * set.h * 4 * 4 / 3;

			}

			this.jobs.push( job );

		}

		// kept for API compatibility with the TSL version (a zero node added to the colour of every
		// village material so the bake ran on first use); the meshes now call bake() themselves
		this.trigger = null;

	}

	// approximate GPU memory of the final (mipmapped) maps in bytes
	get bytes() {

		return this._bytes;

	}

	// Records every bake pass into the current frame encoder (call outside of a render pass).
	bake() {

		if ( this.baked ) return;
		this.baked = true;
		const t0 = performance.now();
		const transient = [];
		for ( const job of this.jobs ) {

			const { set } = job;
			const bindings = {};
			if ( job.fields ) bindings.vlgOutFields = { storageTexture: job.fields, access: 'write' };
			if ( job.albedo ) bindings.vlgOutAlbedo = { storageTexture: job.albedo, access: 'write' };
			const fieldsKernel = new ComputeKernel( {
				label: 'VillageBakeFields ' + set.name,
				modules: [ noiseModule ],
				bindings,
				workgroupSize: [ 8, 8, 1 ],
				code: GENERATORS[ set.name ] + /* wgsl */`
@compute @workgroup_size( WG_X, WG_Y, 1 )
fn main( @builtin( global_invocation_id ) gid: vec3u ) {
	let dim = vec2u( ${ set.w }u, ${ set.h }u );
	if ( gid.x >= dim.x || gid.y >= dim.y ) { return; }
	let t = ( vec2f( gid.xy ) + 0.5 ) / vec2f( dim );
	let r = vlgGen( t.x, t.y );
	${ job.fields ? 'textureStore( vlgOutFields, vec2i( gid.xy ), r.fields );' : '' }
	${ job.albedo ? 'textureStore( vlgOutAlbedo, vec2i( gid.xy ), r.albedo );' : '' }
}
`,
			} );
			fieldsKernel.dispatch( fieldsKernel.groups( set.w, set.h ) );

			if ( job.nra ) {

				const deriveKernel = new ComputeKernel( {
					label: 'VillageBakeDerive ' + set.name,
					bindings: {
						vlgFields: { texture: job.fields, sampleType: 'unfilterable-float' },
						vlgNRA: { storageTexture: job.nra, access: 'write' },
					},
					workgroupSize: [ 8, 8, 1 ],
					code: deriveCode( set ),
				} );
				deriveKernel.dispatch( deriveKernel.groups( set.w, set.h ) );
				generateMipmaps( job.nra );
				transient.push( job.fields );
				job.fields = null;

			}

			if ( job.albedo ) generateMipmaps( job.albedo );

		}

		// free the transient field maps once the passes above have been submitted, so the peak
		// GPU memory stays at the final maps + the field maps of one bake
		GPU.onSubmit( null, () => {

			for ( const t of transient ) t.destroy();

		} );
		this.bakeMs = performance.now() - t0;

	}

	dispose() {

		for ( const job of this.jobs ) {

			if ( job.albedo ) job.albedo.destroy();
			if ( job.nra ) job.nra.destroy();
			if ( job.fields ) job.fields.destroy();

		}

	}

}
