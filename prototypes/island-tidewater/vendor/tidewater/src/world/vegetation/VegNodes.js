import { Vector2, Vector3 } from '../../engine/index.js';
import { ShaderModule, UniformBlock } from '../../engine/gpu/Shader.js';
import { commonModule } from '../../engine/render/wgsl/common.js';
import { lodFadeModule } from '../../materials/LODFade.js';
import { getDetailTexture } from '../terrain/DetailTextures.js';
import { LOBE_TABLE, TREE_VARIANTS, SHRUB_VARIANTS } from './PlantGeometry.js';

// Shared WGSL building blocks for all vegetation: hashing, value noise, wind and the
// plant deformation used by palms, young palms, bananas and ferns.
//
// Module `vegModule` (prefix `veg`):
//   uniforms `vegParams`: camPos, gustOffset, canopyNear, lobeTable
//   fn vegHash12( p: vec2f ) -> f32                     Dave Hoskins' sine-free hash, [0, 1)
//   fn vegNoise( p: vec2f ) -> f32                      value noise
//   fn vegWindStrength() -> f32, vegWindDir3() -> vec3f, vegWindPerp3() -> vec3f
//   fn vegGustAt( xz: vec2f ) -> f32                    travelling gust field in [0, 1]
//   fn vegRotUpTo( v: vec3f, T: vec3f ) -> vec3f        rotation taking +Y to T, applied to v
//   fn vegInstanceNormal( m: mat4x4f, n: vec3f ) -> vec3f   three's instance normal transform
//   fn vegVariantOf( seed: f32, isShrub: bool ) -> f32
//   fn vegLobeScale( seed: f32, li: f32, isShrub: bool ) -> f32
//   fn vegLodScale( base: vec3f, lodRange: vec3f ) -> f32
//   fn vegLodDither( base: vec3f, lodRange: vec3f, pixel: vec2f ) -> bool
//   fn vegTranslucency( albedo, N, strength, P ) -> vec3f   (x light colour in the lighting model)
//   fn vegPlantDeform( P, N0, iPos, iDat, aVeg, aMat, aLobe, lodRange ) -> VegPlant
// The per-object LOD window (three's uLodRange, read per draw) is `draw.params.yzw` (mesh.drawParams,
// set by InstanceLOD). Materials pass it into the functions above.

const LOBE_VEC4 = Math.ceil( LOBE_TABLE.length / 4 );

export const vegParams = new UniformBlock( 'VegParams', {
	// Position of the *main* camera. The shadow pass has its own cameraPosition, so all
	// distance based effects (LOD split, fades) use this uniform to keep shadows consistent.
	camPos: [ 'vec3f', new Vector3( 0, 10, 0 ) ],
	pad0: [ 'f32', 0 ],
	// Integrated gust-field offset (m). Integrated on the CPU so that changes of wind speed
	// or direction never make the gust pattern jump.
	gustOffset: [ 'vec2f', new Vector2() ],
	// near -> impostor switch distance (m) of trees (x) and shrubs (y) (VegMaterials.uCanopyNear)
	canopyNear: [ 'vec2f', new Vector2( 75, 45 ) ],
	// Crown variants: the per-instance variant picks a row of the lobe table (per-lobe size, 0 =
	// dropped), 4 entries per vec4
	lobeTable: [ `vec4f[${ LOBE_VEC4 }]`, Array.from( { length: LOBE_VEC4 }, ( _, i ) => [ 0, 1, 2, 3 ].map( ( c ) => LOBE_TABLE[ i * 4 + c ] ?? 0 ) ) ],
}, { label: 'vegParams' } );

// three-style `{ value }` handles
export const uCamPos = vegParams.fields.camPos;
export const uGustOffset = vegParams.fields.gustOffset;

// LOD window factor for an instance at `base` (0 = hidden, 1 = full size). Hard switches (a window
// that starts at x > 0, or ends with z - y < 5 cm) are widened by a cross-fade band where both
// levels are drawn and dissolve into each other (lodDither, Bayer screen-door); soft windows shrink.
export const LOD_BAND = 0.12; // share of the switch distance

// distance window (m) of the ferns inside the merged understory mesh
export const UNDER_FERN_FADE = [ 42, 58 ];

// WGSL float literal
export const f = ( x ) => {

	const s = String( x );
	return s.includes( '.' ) || s.includes( 'e' ) ? s : s + '.0';

};

export const vegModule = new ShaderModule( {
	name: 'veg',
	deps: [ commonModule, lodFadeModule ],
	uniforms: vegParams,
	bindings: {
		vegDetail: { texture: () => getDetailTexture() },
	},
	code: /* wgsl */`
const VEG_UP = vec3f( 0.0, 1.0, 0.0 );
const VEG_LOD_BAND: f32 = ${ f( LOD_BAND ) };

// Dave Hoskins' sine-free hash, [0, 1)
fn vegHash12( p: vec2f ) -> f32 {
	var p3 = fract( vec3f( p.x, p.y, p.x ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}

fn vegNoise( p: vec2f ) -> f32 {
	let i = floor( p );
	let fr = fract( p );
	let u = fr * fr * ( fr * -2.0 + 3.0 );
	let a = vegHash12( i );
	let b = vegHash12( i + vec2f( 1.0, 0.0 ) );
	let c = vegHash12( i + vec2f( 0.0, 1.0 ) );
	let d = vegHash12( i + vec2f( 1.0, 1.0 ) );
	return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}

// Wind ---------------------------------------------------------------------------------

// 0 (calm) .. 2.5 (storm). Tiny floor so nothing is ever perfectly frozen.
fn vegWindStrength() -> f32 { return max( frame.windSpeed * 0.1, 0.03 ); }
fn vegWindDir3() -> vec3f { return vec3f( frame.windDir.x, 0.0, frame.windDir.y ); }
fn vegWindPerp3() -> vec3f { return vec3f( -frame.windDir.y, 0.0, frame.windDir.x ); }

// Travelling gust field in [0, 1]: noise of (worldXZ - windDir * t * speed), where the
// time-integrated offset comes from vegParams.gustOffset. Two fetches of the detail texture's fbm
// channel (~35 m and ~15 m gust cells); the terrain uses the same function for its wind sheen.
fn vegGustAt( xz: vec2f ) -> f32 {
	let p = xz - vegParams.gustOffset;
	let n = textureSampleLevel( vegDetail, smpLinearRepeat, p / 140.0, 0.0 ).w * 0.62
		+ textureSampleLevel( vegDetail, smpLinearRepeat, p / 61.0 + 0.37, 0.0 ).w * 0.38;
	return smoothstep( 0.46, 0.6, n );
}

// Rotation taking +Y to the unit vector T, applied to v.
fn vegRotUpTo( v: vec3f, T: vec3f ) -> vec3f {
	let k = vec3f( T.z, 0.0, -T.x );
	let c1 = cross( k, v );
	return v + c1 + cross( k, c1 ) / ( T.y + 1.0 );
}

// normal through the instance matrix as three's instance node does it (not normalised: its
// length scales the leaf flutter the same way)
fn vegInstanceNormal( m: mat4x4f, n: vec3f ) -> vec3f {
	let a = m[ 0 ].xyz; let b = m[ 1 ].xyz; let c = m[ 2 ].xyz;
	let t = n / vec3f( dot( a, a ), dot( b, b ), dot( c, c ) );
	return mat3x3f( a, b, c ) * t;
}

// Crown variants: the per-instance variant picks a row of the lobe table (per-lobe size, 0 =
// dropped). Shared by the near canopy geometry and the impostor bake, so near and far crowns match.
fn vegVariantOf( seed: f32, isShrub: bool ) -> f32 {
	return floor( fract( seed * 7.77 ) * select( ${ f( TREE_VARIANTS ) }, ${ f( SHRUB_VARIANTS ) }, isShrub ) );
}
fn vegLobeScale( seed: f32, li: f32, isShrub: bool ) -> f32 {
	let row = vegVariantOf( seed, isShrub ) + select( 0.0, ${ f( TREE_VARIANTS ) }, isShrub );
	let i = i32( row * 8.0 + max( li, 0.0 ) );
	return vegParams.lobeTable[ i / 4 ][ i % 4 ];
}

// LOD window factor for an instance at base (0 = hidden, 1 = full size); lodRange = (visible from,
// fade-out start, fade-out end)
fn vegLodScale( base: vec3f, lodRange: vec3f ) -> f32 {
	let d = length( vegParams.camPos - base );
	let inside = d >= lodRange.x * ( 1.0 - VEG_LOD_BAND / 2.0 );
	let hardEnd = lodRange.z - lodRange.y < 0.05;
	let endK = select( 1.0 - smoothstep( lodRange.y, lodRange.z, d ), select( 0.0, 1.0, d < lodRange.y * ( 1.0 + VEG_LOD_BAND / 2.0 ) ), hardEnd );
	return select( 0.0, endK, inside );
}

// Fragment-stage keep test of the LOD cross-fade for an instance at base (true: keep the pixel)
fn vegLodDither( base: vec3f, lodRange: vec3f, pixel: vec2f ) -> bool {
	let d = length( vegParams.camPos - base );
	let t = bayer4( pixel );
	let x = lodRange.x; let y = lodRange.y;
	let fadeIn = select( 1.0, smoothstep( x * ( 1.0 - VEG_LOD_BAND / 2.0 ), x * ( 1.0 + VEG_LOD_BAND / 2.0 ), d ), x > 0.0 );
	let fadeOut = select( 0.0, smoothstep( y * ( 1.0 - VEG_LOD_BAND / 2.0 ), y * ( 1.0 + VEG_LOD_BAND / 2.0 ), d ), lodRange.z - y < 0.05 );
	return t < fadeIn && t >= fadeOut;
}

// Leaf translucency: sunlight transmitted through the leaf when it is lit from behind (relative
// to the viewer). The lighting model multiplies it by the shadowed light colour, so leaves in
// shadow (behind a hill at sunset, inside the canopy) don't glow.
fn vegTranslucency( albedo: vec3f, N: vec3f, strength: f32, P: vec3f ) -> vec3f {
	let V = normalize( frame.cameraPos - P );
	let L = frame.sunDir;
	let back = sat( dot( -N, L ) );
	let forward = pow( sat( dot( -V, L ) ), 3.0 ) * 0.7 + 0.3;
	let tint = albedo * vec3f( 1.25, 1.45, 0.55 ) + vec3f( 0.012, 0.018, 0.0 );
	return tint * ( back * forward * strength ) * ( 1.0 - frame.night );
}

struct VegPlant {
	pos: vec3f,
	normal: vec3f,
	trunkY: f32,  // height along the stem (m)
	trunkT: vec3f, // stem axis (world)
};

// Plant deformation shared by palms / young palms / bananas / ferns.
//
// Geometry conventions (local space, applied after the instance matrix = T * Ry * S):
//   aMat.x == 0  -> stem vertex: aVeg.x = height fraction u, x/z = radial offset.
//   aMat.x >= 1  -> crown vertex: position is relative to the crown centre.
//   aVeg = (u, s along frond, flutter weight, phase)
// Per instance:
//   iPos = (base.xyz, scale), iDat = (lean azimuth, lean (fraction of H), stem height H (m), seed)
// P / N0: the vertex through the instance matrix (three's positionLocal / normalLocal after the
// instance node).
fn vegPlantDeform( P: vec3f, N0: vec3f, iPos: vec4f, iDat: vec4f, veg: vec4f, aMat: vec4f, aLobe: vec4f, lodRange: vec3f ) -> VegPlant {
	let part = aMat.x;
	let base = iPos.xyz;
	let sc = iPos.w;
	let leanDir = vec3f( cos( iDat.x ), 0.0, sin( iDat.x ) );
	let lean = iDat.y;
	let H = iDat.z;
	// merged geometries (understory): the instance's plant kind is the integer part of the seed;
	// vertices of the other plants collapse onto the base
	let seed = fract( iDat.w );
	let kindI = floor( iDat.w );
	let kindV = -aLobe.w - 1.0;
	let keepKind = kindV < 0.5 || abs( kindV - kindI ) < 0.5;

	let u = veg.x;
	let s = veg.y;
	let flut = veg.z;
	let ph = veg.w;

	let t = frame.time;
	let w = vegWindStrength();
	let g = vegGustAt( base.xz );
	let ph0 = seed * 6.2832;
	let windDir3 = vegWindDir3();
	let windPerp3 = vegWindPerp3();

	// stem sway: horizontal offset of the top as a fraction of H
	let sway = w * w * 0.014 * ( g * 0.9 + 0.3 ) + sin( t * 0.83 + ph0 ) * w * 0.0065 * ( g + 0.45 );
	let swayP = sin( t * 0.61 + ph0 * 1.7 ) * w * 0.0028;
	let windOff = windDir3 * sway + windPerp3 * swayP;

	// stem curve: mix of a straight tilt and a "banana" curve (vertical at the top)
	let c = fract( seed * 7.31 );
	let fc = mix( u, u * ( ( 1.0 - u ) + 1.0 ), c );
	let df = mix( 1.0, ( 1.0 - u ) * 2.0, c );
	let off = leanDir * ( lean * fc ) + windOff * ( u * u );
	let T = normalize( VEG_UP + leanDir * ( lean * df ) + windOff * ( u * 2.0 ) );

	let radial = vec3f( P.x - base.x, 0.0, P.z - base.z );
	let axisPt = base + vec3f( 0.0, u * H, 0.0 ) + off * H;
	let stemPos = axisPt + vegRotUpTo( radial, T );
	let stemN = vegRotUpTo( N0, T );

	// crown: follows the stem top, tilted half as much as the stem tip
	let Ttop = normalize( VEG_UP + leanDir * ( lean * ( 1.0 - c ) ) + windOff * 2.0 );
	let Ttilt = normalize( VEG_UP + Ttop );
	let C = base + vec3f( 0.0, H, 0.0 ) + ( leanDir * lean + windOff ) * H;
	let o1 = vegRotUpTo( P - base, Ttilt );
	let N1 = vegRotUpTo( N0, Ttilt );

	// frond / leaf motion: gust bending + slow bounce + leaflet flutter, applied as a
	// length preserving rotation about the crown centre so fronds stream downwind in storms.
	let s2 = s * s;
	let bend = s2 * sc * 4.5 * ( w * w * 0.16 * ( g * 0.8 + 0.35 )
		+ sin( t * ( ph * 0.5 + 1.3 ) + ph * 23.0 + ph0 ) * w * 0.075 * ( g + 0.3 ) );
	let bounce = sin( t * ( ph + 2.1 ) + ph * 41.0 ) * s2 * w * sc * 0.1;
	let flutter = flut * sc * ( sin( t * ( ph * 5.0 + 11.0 ) + ph * 60.0 + s * 9.0 ) * ( w * 0.045 + 0.008 )
		+ sin( t * 23.0 + ph * 13.0 + s * 17.0 ) * ( max( w - 1.0, 0.0 ) * 0.05 ) );
	let disp = windDir3 * bend + VEG_UP * ( bounce - bend * 0.3 ) + N1 * flutter;
	let L = length( o1 );
	let o2 = normalize( o1 + disp + vec3f( 0.0, 1e-5, 0.0 ) ) * L;
	let crownPos = C + o2;

	// the dead (hanging) frond is only kept on some palms
	let hideDead = part > 0.5 && part < 1.5 && aMat.y > 0.95 && fract( seed * 13.7 ) > 0.4;
	let crownPos2 = select( crownPos, C, hideDead );

	let isStem = part < 0.5;
	let pos = select( crownPos2, stemPos, isStem );

	var out: VegPlant;
	out.normal = select( N1, stemN, isStem );
	out.trunkY = u * H;
	out.trunkT = T;

	// LOD window / distance fade: shrink around the base (ferns fade out earlier)
	let dCam = length( vegParams.camPos - base );
	let fernFade = select( 1.0, 1.0 - smoothstep( ${ f( UNDER_FERN_FADE[ 0 ] ) }, ${ f( UNDER_FERN_FADE[ 1 ] ) }, dCam ), kindI > 2.5 && kindI < 3.5 );
	let k = vegLodScale( base, lodRange ) * fernFade * select( 0.0, 1.0, keepKind );
	out.pos = base + ( pos - base ) * k;
	return out;
}
`,
} );

// WGSL expression of the linear colour of an sRGB hex (three's `new Color( hex )` -> vec3)
const _lin = ( c ) => ( c < 0.04045 ? c * 0.0773993808 : Math.pow( c * 0.9478672986 + 0.0521327014, 2.4 ) );
export const C = ( hex ) => {

	const r = _lin( ( ( hex >> 16 ) & 255 ) / 255 ), g = _lin( ( ( hex >> 8 ) & 255 ) / 255 ), b = _lin( ( hex & 255 ) / 255 );
	return `vec3f( ${ r.toFixed( 6 ) }, ${ g.toFixed( 6 ) }, ${ b.toFixed( 6 ) } )`;

};
