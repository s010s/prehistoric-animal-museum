import { Color, SRGBColorSpace } from '../../engine/math/index.js';
import { ShaderModule } from '../../engine/gpu/Shader.js';
import { commonModule } from '../../engine/render/wgsl/common.js';
import { getDetailTexture } from './DetailTextures.js';

// Shared WGSL building blocks for the terrain and the scattered rocks (the former TSL helpers).
//
// JS helpers (build WGSL source):
//   srgb( r, g, b )  -> 'vec3f( ... )' linear constant of an sRGB triplet
//   rot2( v, a )     -> WGSL expression rotating the vec2 expression v by a constant angle
// WGSL (terrainShadingModule(); the detail texture is bound as `terrainDetailTex`):
//   fn terrainPerturbNormal( P: vec3f, N: vec3f, hd: f32, scale: f32 ) -> vec3f   surface-gradient bump
//   fn terrainTriWeights( N: vec3f ) -> vec3f
//   fn terrainTriplanar( p: vec3f, w: vec3f, tile: f32, g: RockGrad ) -> vec4f
//   fn terrainRockSurface( p, N, h, mcr, seed, mossAmount, g: RockGrad ) -> RockSurface
//   fn terrainImplicitGrad( p: vec3f ) -> RockGrad       (call in uniform control flow)
//   fn terrainSaturation( c: vec3f, s: f32 ) -> vec3f
//   fn terrainMeadowTone( mA, mB, slope, south, detail, hasDetail: bool ) -> MeadowTone
//   const PAL_<name> (rock palette), MEADOW_<name> (meadow palette)
// RockGrad { dpdx, dpdy: world position derivatives, fwY: fwidth of the bedding coordinate,
// useGrad: true = use these gradients everywhere (branch safe; the former `grad` option),
// false = implicit derivatives for px / fwY / strata like the TSL version without `grad` }.

// sRGB triplet -> linear vec3 constant (WGSL source)
export const srgb = ( r, g, b ) => {

	const c = new Color().setRGB( r, g, b, SRGBColorSpace );
	return `vec3f( ${ f( c.r ) }, ${ f( c.g ) }, ${ f( c.b ) } )`;

};

// 2D rotation of a vec2 WGSL expression by a constant angle
export const rot2 = ( v, a ) => {

	const c = Math.cos( a ), s = Math.sin( a );
	return `( mat2x2f( ${ f( c ) }, ${ f( s ) }, ${ f( - s ) }, ${ f( c ) } ) * ( ${ v } ) )`;

};

function f( x ) {

	const s = Number( x ).toPrecision( 9 );
	return s.includes( '.' ) || s.includes( 'e' ) ? s : s + '.0';

}

// ---- palette (sRGB picked from photo references, stored linear)
export const PALETTE = {
	rockDark: srgb( 0.15, 0.145, 0.135 ),
	rockMid: srgb( 0.3, 0.285, 0.265 ),
	rockLight: srgb( 0.48, 0.455, 0.42 ),
	rockWarm: srgb( 0.44, 0.37, 0.30 ),
	lichenPale: srgb( 0.70, 0.70, 0.64 ),
	lichenOrange: srgb( 0.78, 0.50, 0.20 ),
	blackZone: srgb( 0.075, 0.075, 0.07 ),
	barnacle: srgb( 0.78, 0.76, 0.70 ),
	algae: srgb( 0.20, 0.27, 0.10 ),
	coralline: srgb( 0.62, 0.44, 0.46 ),
	moss: srgb( 0.19, 0.29, 0.08 ),
	mossDry: srgb( 0.3, 0.34, 0.14 ),
};

// ---- tropical meadow (tall guinea / elephant grass)
// The tone is shared by the terrain and the grass field (blade base colour): both evaluate it from
// the same inputs, so the geometric grass fades into the ground without a visible boundary.
export const MEADOW = {
	lush: srgb( 0.13, 0.2, 0.05 ),
	green: srgb( 0.25, 0.32, 0.1 ),
	olive: srgb( 0.36, 0.37, 0.14 ),
	yellow: srgb( 0.5, 0.46, 0.2 ),
	straw: srgb( 0.62, 0.54, 0.33 ),
	soil: srgb( 0.17, 0.13, 0.08 ),
};

const consts = ( prefix, o ) => Object.entries( o ).map( ( [ k, v ] ) => `const ${ prefix }${ k }: vec3f = ${ v };` ).join( '\n' );

const SHADING_WGSL = /* wgsl */`
${ consts( 'PAL_', PALETTE ) }
${ consts( 'MEADOW_', MEADOW ) }

struct RockGrad {
	dpdx: vec3f,
	dpdy: vec3f,
	fwY: f32,
	useGrad: bool,
};

// implicit-derivative RockGrad for a world position (call in uniform control flow)
fn terrainImplicitGrad( p: vec3f ) -> RockGrad {
	var g: RockGrad;
	g.dpdx = dpdx( p ); g.dpdy = dpdy( p ); g.fwY = 0.0; g.useGrad = false;
	return g;
}

// Mikkelsen surface-gradient bump: perturb world normal N by the scalar height field hd
// (screen-space derivatives, so any mix of projections / scales works). Robustness for terrain:
//  - the tilt is limited to ~55 degrees (at grazing angles |det| collapses and the unclamped
//    gradient would swing the normal into the tangent plane: 'chrome' patches on steep faces)
//  - the bump fades out where the screen-space frame is degenerate (the thin sliver triangles
//    of CDLOD geomorphing, which otherwise light up as bright lines along the grid) or where the
//    rendered facet disagrees with N (sub-texel crags)
fn terrainPerturbNormal( p: vec3f, N: vec3f, hd: f32, scale: f32 ) -> vec3f {
	let dpx = dpdx( p ); let dpy = dpdy( p );
	let dhdx = dpdx( hd ) * scale; let dhdy = dpdy( hd ) * scale;
	let r1 = cross( dpy, N );
	let r2 = cross( N, dpx );
	let det = dot( dpx, r1 );
	let ad = abs( det );
	let grad = ( r1 * dhdx + r2 * dhdy ) * sign( det );
	let area = length( cross( dpx, dpy ) );
	let fr = area / max( length( dpx ) * length( dpy ), 1e-20 ); // sin of the footprint angle
	let facet = ad / max( area, 1e-20 ); // cos between the facet and N
	let k = smoothstep( 0.12, 0.35, fr ) * smoothstep( 0.3, 0.6, facet );
	let g = grad * min( 1.0, ad * 1.4 / max( length( grad ), 1e-20 ) ) * k;
	return normalize( N * max( ad, 1e-20 ) - g );
}

// triplanar blend weights (sharp)
fn terrainTriWeights( N: vec3f ) -> vec3f {
	let a = abs( N );
	let w = a * a * ( a * a );
	return w / ( w.x + w.y + w.z );
}

fn terrainDetailGrad( uv: vec2f, gx: vec2f, gy: vec2f ) -> vec4f {
	return textureSampleGrad( terrainDetailTex, smpAniso4Repeat, uv, gx, gy );
}

// one channel-set of the detail texture, triplanar. The samples use explicit gradients (the
// derivatives of the world position in g), so they may run in non-uniform control flow.
fn terrainTriplanar( p: vec3f, w: vec3f, tile: f32, g: RockGrad ) -> vec4f {
	let s = 1.0 / tile;
	let x = terrainDetailGrad( p.zy * s, g.dpdx.zy * s, g.dpdy.zy * s );
	let y = terrainDetailGrad( p.xz * s + 0.37, g.dpdx.xz * s, g.dpdy.xz * s );
	let z = terrainDetailGrad( p.xy * s + 0.71, g.dpdx.xy * s, g.dpdy.xy * s );
	return x * w.x + y * w.y + z * w.z;
}

struct RockSurface {
	albedo: vec3f,
	rough: f32,
	hd: f32,     // bump height (m)
	moss: f32,   // 0..1
	wet: f32,
	height: f32,
};

// Weathered volcanic rock seen on the headlands, sea stacks and boulders.
//   p world position, N world normal (geometric / mcr), h height above sea level
//   mcr: 0..1 large scale variation, seed: per object variation (0..1)
// With g.useGrad every sample uses the gradients in g (branch safe).
fn terrainRockSurface( p: vec3f, N: vec3f, h: f32, mcr: f32, seed: f32, mossAmount: f32, g: RockGrad ) -> RockSurface {
	let w = terrainTriWeights( N );
	// big blocks (4 m cells), plates (0.9 m) and grain / chips
	let big = terrainTriplanar( p, w, 27.0, g );
	let mid = terrainTriplanar( p, w, 6.1, g );
	let fine = terrainTriplanar( p, w, 1.3, g );
	// pixel footprint (m): features smaller than a few pixels fade out instead of sparkling
	let px = select( length( abs( g.dpdx ) + abs( g.dpdy ) ), max( length( g.dpdx ), length( g.dpdy ) ), g.useGrad );
	let fineK = 1.0 - smoothstep( 0.006, 0.02, px );
	let midK = 1.0 - smoothstep( 0.03, 0.1, px );
	let hr = big.x * 0.45 + mid.x * 0.35 + ( ( fine.x - 0.5 ) * fineK + 0.5 ) * 0.2;

	// layered lava flows / bedding on steep faces: irregular bands (1D lookup of the fbm channel
	// along the height, warped), faded out once a band gets thinner than a few pixels
	let steep = 1.0 - smoothstep( 0.55, 0.85, N.y );
	let bandY = p.y + mid.w * 2.5 + mcr * 6.0;
	var fwY = g.fwY;
	if ( ! g.useGrad ) { fwY = fwidth( bandY ); }
	let bandUV = vec2f( bandY / 14.0, seed * 0.37 + 0.13 );
	var strata: f32;
	if ( g.useGrad ) {
		strata = terrainDetailGrad( bandUV, vec2f( fwY / 14.0, 0.0 ), vec2f( 0.0 ) ).w;
	} else {
		strata = textureSample( terrainDetailTex, smpAniso4Repeat, bandUV ).w;
	}
	let strataAA = 1.0 - smoothstep( 0.15, 0.6, fwY );
	let tone = hr * 0.9 + ( mcr - 0.5 ) * 0.7 + ( strata - 0.5 ) * 0.8 * steep * strataAA + ( seed - 0.5 ) * 0.3;
	var col = mix( PAL_rockDark, PAL_rockMid, smoothstep( 0.1, 0.5, tone ) );
	col = mix( col, PAL_rockLight, smoothstep( 0.5, 0.85, tone ) );
	// iron staining / warm weathering in patches
	col = mix( col, PAL_rockWarm, smoothstep( 0.62, 0.8, mid.w + mcr * 0.3 ) * 0.18 );
	// joints between the big blocks, fainter between plates
	col = col * ( smoothstep( 0.05, 0.25, big.x ) * 0.35 + 0.65 ) * ( smoothstep( 0.05, 0.25, mid.x ) * 0.15 + 0.85 );
	// rain streaks: dark stains running down steep faces, paler bands between (the fbm channel
	// stretched vertically on the two vertical projection planes)
	let sUVa = vec2f( p.z / 3.1, p.y / 41.0 );
	let sUVb = vec2f( p.x / 3.1 + 0.5, p.y / 41.0 + 0.3 );
	let sa = terrainDetailGrad( sUVa, vec2f( g.dpdx.z / 3.1, g.dpdx.y / 41.0 ), vec2f( g.dpdy.z / 3.1, g.dpdy.y / 41.0 ) );
	let sb = terrainDetailGrad( sUVb, vec2f( g.dpdx.x / 3.1, g.dpdx.y / 41.0 ), vec2f( g.dpdy.x / 3.1, g.dpdy.y / 41.0 ) );
	let sw4 = pow( abs( N.xz ), vec2f( 4.0 ) );
	let stainS = ( sa.w * sw4.x + sb.w * sw4.y ) / ( sw4.x + sw4.y + 1e-5 );
	let stain = smoothstep( 0.52, 0.72, stainS ) * steep;
	col = col * ( 1.0 - stain * 0.4 ) * ( smoothstep( 0.35, 0.2, stainS ) * steep * 0.12 + 1.0 );

	// lichens on the dry upper faces
	let dry = smoothstep( 2.6, 4.0, h );
	let lichen = smoothstep( 0.6, 0.78, mid.y ) * smoothstep( 0.2, 0.7, N.y ) * dry * smoothstep( 0.45, 0.65, mcr );
	col = mix( col, PAL_lichenPale, lichen * 0.45 );
	col = mix( col, PAL_lichenOrange, smoothstep( 0.8, 0.88, mid.y ) * dry * smoothstep( 0.5, 0.8, N.y ) * 0.3 );

	// moss / grass on ledges and tops, ferns hanging along the bedding planes of steep faces
	let ledge = smoothstep( 0.55, 0.7, strata ) * steep * strataAA * smoothstep( 0.4, 0.6, mid.w + ( mcr - 0.5 ) * 0.4 );
	let moss = max( smoothstep( 0.62, 0.9, N.y + ( big.x - 0.5 ) * 0.5 + ( mcr - 0.5 ) * 0.3 ), ledge * 0.8 )
		* smoothstep( 2.5, 5.0, h ) * mossAmount;
	col = mix( col, mix( PAL_moss, PAL_mossDry, mid.w ), moss * 0.9 );

	// shoreline zonation: black lichen band (splash zone), barnacles and algae in the intertidal
	let splash = smoothstep( 0.5, 1.0, h ) * smoothstep( 2.8, 1.8, h + mid.w * 1.2 ) * smoothstep( 0.35, 0.6, mcr + mid.w * 0.3 );
	col = mix( col, PAL_blackZone, splash * 0.55 );
	// sun-bleached, weathered upper faces
	col = mix( col, PAL_rockLight, smoothstep( 0.35, 0.95, N.y ) * smoothstep( 1.5, 3.0, h ) * 0.3 );
	let inter = smoothstep( -0.7, -0.2, h ) * smoothstep( 0.7, 0.2, h );
	let barn = smoothstep( 0.62, 0.72, fine.z ) * inter * fineK;
	col = mix( col, PAL_algae, inter * smoothstep( 0.4, 0.6, mid.y ) * 0.6 );
	col = mix( col, PAL_barnacle, barn * 0.8 );
	// below the water: algae films and pink coralline crusts
	let sub = smoothstep( -0.3, -1.2, h );
	col = mix( col, mix( PAL_algae, PAL_coralline, smoothstep( 0.45, 0.7, mid.w ) ), sub * 0.55 );

	// wet below the swash line (dark, glossy)
	let wet = smoothstep( 1.0, 0.25, h + mid.w * 0.3 );
	col = col * mix( 1.0, 0.55, wet );

	var r: RockSurface;
	r.albedo = col;
	r.rough = mix( mix( 0.88, 0.8, steep ), 0.45, wet ) + moss * 0.06;
	// relief (m): tilted blocks and plates with bevelled joints, then grain
	r.hd = big.x * 0.25 + mid.x * 0.07 * ( midK * 0.6 + 0.4 ) + fine.x * 0.012 * fineK * ( 1.0 - wet * 0.6 ) + barn * 0.005;
	r.moss = moss;
	r.wet = wet;
	r.height = hr;
	return r;
}

// saturation helper
fn terrainSaturation( c: vec3f, s: f32 ) -> vec3f {
	return mix( vec3f( luminance( c ) ), c, s );
}

struct MeadowTone {
	tone: vec3f,
	dry: f32,
	lush: f32,
};

//   mA, mB: detail fbm channel at the 173 m / 47 m scales (~0.5 +- 0.1): the samples at
//   rot2( xz, 0.7 ) / 173 and rot2( xz, 2.1 ) / 47 that the terrain takes anyway; slope: 1 - N.y;
//   south: N.z (the sun side); detail: optional finer fbm (~0.5 +- 0.1) that breaks up the patches
//   (hasDetail = false: none)
// Returns { tone, dry, lush }: mostly fresh green grass with olive, sun-bleached yellow and a few
// straw-dry patches (more on exposed slopes), darker lush grass in the damp patches (the hollows
// are darkened further by the AO).
fn terrainMeadowTone( mA: f32, mB: f32, slope: f32, south: f32, detail: f32, hasDetail: bool ) -> MeadowTone {
	var m = mA * 0.55 + mB * 0.45 + slope * 0.25 + south * 0.04;
	let dd = select( 0.0, detail - 0.5, hasDetail );
	m += dd * 0.28;
	let olive = smoothstep( 0.52, 0.6, m );
	let yellow = smoothstep( 0.6, 0.67, m );
	let straw = smoothstep( 0.66, 0.73, m + ( mB - 0.5 ) * 0.2 );
	let lush = smoothstep( 0.46, 0.37, mB * 0.7 + mA * 0.3 + slope * 0.2 + dd * 0.2 );
	var c = mix( MEADOW_green, MEADOW_olive, olive );
	c = mix( c, MEADOW_yellow, yellow * 0.8 );
	c = mix( c, MEADOW_straw, straw * 0.55 );
	c = mix( c, MEADOW_lush, lush * 0.75 );
	var o: MeadowTone;
	o.tone = c;
	o.dry = olive * 0.4 + yellow * 0.6;
	o.lush = lush;
	return o;
}
`;

let _module = null;
let _detailSpec = null;

// the binding spec of the shared detail texture (terrain, rocks, debris, vegetation), bound under
// the name `terrainDetailTex`
export function detailBinding() {

	return _detailSpec || ( _detailSpec = { texture: getDetailTexture() } );

}

export function terrainShadingModule() {

	if ( _module ) return _module;
	_module = new ShaderModule( {
		name: 'terrainShading',
		deps: [ commonModule ],
		bindings: { terrainDetailTex: detailBinding() },
		code: SHADING_WGSL,
	} );
	return _module;

}
