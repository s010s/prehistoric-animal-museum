import { ShaderModule } from '../../engine/gpu/Shader.js';
import { commonModule } from '../../engine/render/wgsl/common.js';
import { standard } from '../../materials/Materials.js';
import { lodFadeModule } from '../../materials/LODFade.js';
import { srgb, terrainShadingModule } from '../terrain/TerrainShading.js';

// Material for the natural debris (one draw call): stones, coconuts and husks, seaweed and
// seagrass wrack, shells, coral rubble, dry palm fronds. Base colours are procedural per kind;
// surface detail comes from the terrain's tileable detail texture (3 samples, UVs chosen per kind:
// triplanar for stones / coral, fibre-aligned mesh UVs for husks and fronds, world xz for draped
// weed). Normals use the same surface-gradient bump as the terrain; contact with the ground adds
// occlusion and a dusting of sand; the key light gets the terrain's heightfield sun shadow.
//
// vdata: x seed, y kind, z kind parameter, w object size (m)
//   0 STONE    z = style + palette (style 0 beach stone, 1 field / wall stone with lichen,
//              2 whitewashed; palette fract: basalt .. grey .. coral limestone .. ochre)
//   1 COCONUT  z < 1.5: whole coconut, age 0 green .. 0.5 brown .. 1 grey; z >= 1.5: husk fibre
//   2 WEED     z = dryness (0 fresh golden sargassum .. 1 black, brittle)
//   3 SHELL    z < 1: clam, hue; z >= 1: turban / cone shell, hue (lathe uvs: u along the profile)
//   4 CORAL    z < 2: branch rubble, bleach 0..1; z >= 2: coral head, bleach = z - 2
//   5 FROND    z = dryness
//   6 DRIFT    driftwood: z = bark remnants (0 fully bleached .. 1 patchy bark); uv: u along the
//              grain (m), v around (m)
// tint multiplies the albedo (baked contact occlusion, colour variation).
//
// Small items dissolve with distance (Bayer screen-door over ~ 450-650 x their size): no popping and
// no shimmering specks far away.
//
// WGSL (stoneSurfaceModule, shared with the pebble field):
//   fn debrisHashS( s: f32, k: f32 ) -> f32
//   fn debrisStoneSurface( T: vec4f, N: vec3f, pal: f32, style: f32, seed: f32, tile: f32 ) -> DebrisStone
//     T: triplanar detail sample (r facets, g soil / stones, b grains / pits, a fbm); pal 0..1;
//     style 0 / 1 / 2; returns { albedo, rough, hd }

// vertex attributes of the debris geometry (GeoBuilder batches)
export const aTint = 'tint';
export const aData = 'vdata';

export const stoneSurfaceModule = new ShaderModule( {
	name: 'debrisStone',
	deps: [ commonModule ],
	code: /* wgsl */`
fn debrisHashS( s: f32, k: f32 ) -> f32 { return fract( sin( s * 91.345 + k ) * 47453.5453 ); }

struct DebrisStone {
	albedo: vec3f,
	rough: f32,
	hd: f32,
};

// Stone surface shared with the pebble field.
fn debrisStoneSurface( T: vec4f, N: vec3f, pal: f32, style: f32, seed: f32, tile: f32 ) -> DebrisStone {
	let basalt = ${ srgb( 0.15, 0.145, 0.14 ) }; let grey = ${ srgb( 0.4, 0.38, 0.35 ) };
	let lime = ${ srgb( 0.76, 0.72, 0.63 ) }; let ochre = ${ srgb( 0.55, 0.4, 0.28 ) };
	var col = mix( basalt, grey, smoothstep( 0.12, 0.42, pal ) );
	col = mix( col, lime, smoothstep( 0.5, 0.72, pal ) );
	col = mix( col, ochre, smoothstep( 0.88, 0.97, pal ) );
	// per stone tone, speckles and pits, soft blotches
	col = col * ( debrisHashS( seed, 1.7 ) * 0.3 + 0.85 );
	col = col * ( ( T.b - 0.5 ) * 0.5 + 1.0 ) * ( ( T.a - 0.5 ) * 0.6 + 1.0 );
	let pits = smoothstep( 0.62, 0.85, T.b ) * smoothstep( 0.45, 0.8, pal );
	col = mix( col, col * 0.55, pits * 0.6 );
	// quartz veins / bands in a few of the dark stones
	let vein = smoothstep( 0.03, 0.0, abs( fract( T.a * 7.0 + seed * 3.0 ) - 0.5 ) ) * step( debrisHashS( seed, 5.1 ), 0.25 ) * ( 1.0 - smoothstep( 0.3, 0.5, pal ) );
	col = mix( col, ${ srgb( 0.7, 0.68, 0.62 ) }, vein * 0.7 );
	var rough = 0.74 + T.b * 0.12 - smoothstep( 0.0, 0.3, pal ) * 0.0;
	// field / wall stones: lichen crusts on the upper faces, soil at the bottom
	let s1 = step( 0.5, style ) * step( style, 1.5 );
	let lichen = smoothstep( 0.55, 0.68, T.a + N.y * 0.18 + debrisHashS( seed, 2.3 ) * 0.15 ) * s1;
	let lichenCol = mix( ${ srgb( 0.62, 0.64, 0.55 ) }, ${ srgb( 0.72, 0.52, 0.2 ) }, step( 0.72, T.g ) );
	col = mix( col, lichenCol, lichen * 0.75 );
	col = mix( col, col * 0.62, smoothstep( 0.2, -0.6, N.y ) * s1 );
	// whitewashed stones: lime wash, worn through on edges and blotches
	let s2 = step( 1.5, style );
	let wash = smoothstep( 0.5, 0.58, T.a + ( T.r - 0.45 ) * 0.4 + debrisHashS( seed, 6.6 ) * 0.12 ) * s2;
	col = mix( col, ${ srgb( 0.8, 0.79, 0.75 ) } * ( T.b * 0.14 + 0.86 ) * ( ( T.a - 0.5 ) * 0.3 + 1.0 ), wash );
	rough = mix( rough, 0.93, wash );
	var o: DebrisStone;
	o.albedo = col;
	o.rough = rough;
	o.hd = ( T.r * 0.6 + T.b * 0.3 ) * tile * mix( 0.06, 0.02, wash );
	return o;
}
`,
} );

// the TSL colorNode / roughnessNode / normalNode / aoNode of the nature material
const NATURE_SURFACE = /* wgsl */`
	let seed = in.vs.vData.x; let kind = in.vs.vData.y; let prm = in.vs.vData.z; let size = in.vs.vData.w;
	let p = in.P;
	// ---- distance fade: small items dissolve (Bayer screen-door, see LODFade) far away
	let fadeEnd = clamp( size * 650.0, 22.0, 450.0 );
	if ( ! lodFadeVisible( in.pixel, 1.0 - smoothstep( fadeEnd * 0.7, fadeEnd, length( p - frame.cameraPos ) ), false ) ) { discard; }
	let N = in.N;
	let uv0 = in.uv;
	let isStone = kind < 0.5;
	let isCoral = kind > 3.5 && kind < 4.5;
	let isWeed = kind > 1.5 && kind < 2.5;
	let isShell = kind > 2.5 && kind < 3.5;
	let isFrond = kind > 4.5 && kind < 5.5;
	let isDrift = kind > 5.5;
	let triK = isStone || isCoral;

	// ---- texture coordinates per kind (all three samples in uniform control flow)
	let tile = select( clamp( size * 1.1, 0.07, 0.9 ), 0.07, isCoral );
	let so = vec2f( debrisHashS( seed, 3.1 ), debrisHashS( seed, 7.9 ) );
	// fibre-aligned (coconut / frond), world xz (weed), shell uvs
	let fibA = select( select( vec2f( uv0.x * 3.0, uv0.y * 26.0 ), vec2f( uv0.x * 1.1, uv0.y * 45.0 ), isFrond ), vec2f( uv0.x * 0.3, uv0.y * 5.5 ), isDrift );
	let uvA0 = select( select( fibA, uv0 * vec2f( 0.5, 0.16 ), isShell ), p.xz / 0.42, isWeed );
	let uvB0 = select( select( uv0 * 1.3, vec2f( uv0.x * 1.4, uv0.y * 21.0 ), isDrift ), p.xz / 0.11 + 0.3, isWeed );
	let uvC0 = select( select( select( uv0 * 8.0, vec2f( uv0.x * 0.09, uv0.y * 0.9 ), isDrift ), vec2f( uv0.x * 5.0, uv0.y * 80.0 ), isFrond ), p.xz / 1.4, isWeed );
	let uvA = select( uvA0 + so, p.zy / tile, triK );
	let uvB = select( uvB0 + so.yx, p.xz / tile + 0.37, triK );
	let uvC = select( uvC0 + so * 2.0, p.xy / tile + 0.71, triK );
	let A = textureSample( terrainDetailTex, smpAniso4Repeat, uvA );
	let B = textureSample( terrainDetailTex, smpAniso4Repeat, uvB );
	let Cc = textureSample( terrainDetailTex, smpAniso4Repeat, uvC );
	let w = terrainTriWeights( N );
	let T3 = A * w.x + B * w.y + Cc * w.z;

	var col = vec3f( 0.5 );
	var rough = 0.8;
	var hd = 0.0;

	if ( isStone ) {

		let S = debrisStoneSurface( T3, N, fract( prm ), floor( prm ), seed, tile );
		col = S.albedo;
		rough = S.rough;
		hd = S.hd;

	} else if ( kind < 1.5 ) {

		// coconut: fibrous husk; green -> brown -> grey with age; split husk pieces show the
		// paler, coarser fibre
		let age = min( prm, 1.0 );
		let inner = step( 1.5, prm );
		var c = mix( ${ srgb( 0.4, 0.42, 0.12 ) }, ${ srgb( 0.37, 0.23, 0.11 ) }, smoothstep( 0.18, 0.55, age ) );
		c = mix( c, ${ srgb( 0.36, 0.32, 0.27 ) }, smoothstep( 0.7, 0.95, age ) );
		c = mix( c, ${ srgb( 0.52, 0.37, 0.21 ) }, inner );
		let fib = A.a * 0.7 + Cc.b * 0.3;
		c = c * ( ( fib - 0.5 ) * mix( 0.9, 1.4, inner ) + 1.0 );
		c = mix( c, c * 0.62, smoothstep( 0.55, 0.78, B.g ) * 0.7 );
		// the three germination pores / calyx at the stem end: dark
		col = c;
		rough = mix( 0.62, 0.86, max( smoothstep( 0.2, 0.6, age ), inner ) ) + fib * 0.08;
		hd = ( fib * 0.004 + Cc.b * 0.0015 ) * ( inner + 1.0 );

	} else if ( isWeed ) {

		// sargassum / seagrass wrack: golden and olive when fresh (wet sheen, air bladders),
		// drying to brittle black with bleached tips
		let dry = prm;
		var c = mix( ${ srgb( 0.46, 0.3, 0.08 ) }, ${ srgb( 0.26, 0.22, 0.08 ) }, smoothstep( 0.35, 0.7, Cc.a ) );
		c = mix( c, ${ srgb( 0.12, 0.08, 0.04 ) }, smoothstep( 0.5, 0.7, A.a + ( Cc.a - 0.5 ) * 0.6 ) * 0.6 );
		c = mix( c, ${ srgb( 0.075, 0.06, 0.045 ) }, smoothstep( 0.25, 0.75, dry ) );
		c = mix( c, ${ srgb( 0.42, 0.38, 0.29 ) }, smoothstep( 0.62, 0.78, Cc.a + A.g * 0.2 ) * smoothstep( 0.5, 1.0, dry ) * 0.55 );
		let leaf = A.g;
		c = c * ( ( leaf - 0.4 ) * 0.8 + 1.0 );
		let bladder = smoothstep( 0.72, 0.82, B.b ) * ( 1.0 - dry );
		c = mix( c, ${ srgb( 0.62, 0.5, 0.16 ) }, bladder * 0.6 );
		col = c;
		rough = mix( 0.55, 0.88, smoothstep( 0.2, 0.7, dry ) ) - bladder * 0.12;
		hd = leaf * 0.012 + B.b * 0.004 + bladder * 0.004 + Cc.a * 0.01;

	} else if ( isShell ) {

		// shells: ribbed cups with growth bands; turban shells with spiral bands
		let turban = step( 1.0, prm );
		let hue = fract( prm );
		var base = mix( ${ srgb( 0.92, 0.9, 0.84 ) }, ${ srgb( 0.9, 0.8, 0.62 ) }, smoothstep( 0.3, 0.5, hue ) );
		base = mix( base, ${ srgb( 0.9, 0.64, 0.6 ) }, smoothstep( 0.62, 0.72, hue ) );
		base = mix( base, ${ srgb( 0.8, 0.52, 0.3 ) }, smoothstep( 0.85, 0.95, hue ) );
		let dark = mix( ${ srgb( 0.5, 0.32, 0.2 ) }, ${ srgb( 0.35, 0.3, 0.32 ) }, step( 0.5, debrisHashS( seed, 4.4 ) ) );
		let ribs = sin( uv0.y * 19.0 ) * 0.5 + 0.5;
		let growth = sin( uv0.x * 38.0 + A.a * 6.0 ) * 0.5 + 0.5;
		let spiral = sin( uv0.x * 22.0 + uv0.y * 1.0 + A.a * 4.0 ) * 0.5 + 0.5;
		let bandK = mix( smoothstep( 0.6, 0.9, growth ) * 0.35 * step( 0.4, debrisHashS( seed, 8.8 ) ), smoothstep( 0.45, 0.75, spiral ) * 0.75, turban );
		var c = mix( base, dark, bandK );
		c = c * ( ribs * 0.12 + 0.92 ) * ( ( B.a - 0.5 ) * 0.2 + 1.0 );
		col = c;
		rough = 0.42 + A.b * 0.2;
		hd = mix( ribs * 0.0012, spiral * 0.0015, turban );

	} else if ( isCoral ) {

		// bleached coral rubble: porous (polyp cups), stained grey / algae in the older pieces;
		// coral heads: meandering grooves
		let head = step( 2.0, prm );
		let bleach = max( fract( prm ), step( 0.999, prm ) );
		let pit = smoothstep( 0.55, 0.82, T3.b );
		var c = mix( ${ srgb( 0.5, 0.48, 0.42 ) }, ${ srgb( 0.88, 0.86, 0.8 ) }, bleach );
		c = mix( c, ${ srgb( 0.4, 0.42, 0.3 ) }, smoothstep( 0.6, 0.75, T3.a ) * ( 1.0 - bleach ) * 0.6 );
		let groove = ( 1.0 - smoothstep( 0.2, 0.34, T3.r ) ) * head;
		c = c * ( 1.0 - pit * 0.35 ) * ( 1.0 - groove * 0.4 );
		col = c;
		rough = 0.88;
		hd = pit * -0.0012 - groove * 0.004 + T3.a * 0.002;

	} else if ( isDrift ) {

		// driftwood: sun-bleached silver-grey with warmer, less weathered patches; open grain
		// (dark wavy lines along the wood), deep checks, flaking bark remnants in the grooves
		let bark = prm;
		let lines = smoothstep( 0.06, 0.0, abs( fract( A.a * 3.0 + Cc.a ) - 0.5 ) );
		let crack = smoothstep( 0.03, 0.0, abs( B.a - 0.5 ) ) * smoothstep( 0.35, 0.65, A.r );
		var c = mix( ${ srgb( 0.63, 0.61, 0.57 ) }, ${ srgb( 0.83, 0.81, 0.77 ) }, smoothstep( 0.3, 0.7, Cc.a + ( A.a - 0.5 ) * 0.5 ) );
		c = mix( c, ${ srgb( 0.66, 0.57, 0.46 ) }, smoothstep( 0.6, 0.8, Cc.g ) * 0.45 );
		c = c * ( ( B.a - 0.5 ) * 0.5 + 1.0 ) * ( 1.0 - lines * 0.45 ) * ( 1.0 - crack * 0.75 );
		let barkM = smoothstep( 0.68, 0.72, Cc.g + ( B.g - 0.5 ) * 0.25 ) * step( 0.5, bark );
		c = mix( c, mix( ${ srgb( 0.14, 0.1, 0.07 ) }, ${ srgb( 0.27, 0.19, 0.12 ) }, A.a ), barkM );
		col = c;
		rough = 0.8 + crack * 0.12 - barkM * 0.08;
		hd = A.a * 0.004 + B.a * 0.0015 - lines * 0.0015 - crack * 0.004 + barkM * 0.0025;

	} else {

		// dry palm frond: parallel veins, olive-yellow drying to straw, brown and grey
		let dry = prm;
		var c = mix( ${ srgb( 0.44, 0.42, 0.17 ) }, ${ srgb( 0.6, 0.5, 0.3 ) }, smoothstep( 0.1, 0.45, dry ) );
		c = mix( c, ${ srgb( 0.33, 0.24, 0.15 ) }, smoothstep( 0.45, 0.8, dry ) * ( B.g * 0.6 + 0.4 ) );
		c = mix( c, ${ srgb( 0.46, 0.42, 0.36 ) }, smoothstep( 0.8, 1.0, dry ) * Cc.a );
		let veins = A.a * 0.6 + Cc.a * 0.4;
		c = c * ( ( veins - 0.5 ) * 0.7 + 1.0 );
		col = c;
		rough = 0.66 + dry * 0.2;
		hd = veins * 0.0015;

	}

	// ---- ground contact: occlusion and a dusting of sand on the lower parts; wet near the sea
	let ground = terrainHeightAt( p.xz );
	let above = p.y - ground;
	let contact = 1.0 - smoothstep( 0.0, max( size * 0.32, 0.012 ), above );
	let sandy = smoothstep( 0.6, 1.6, ground ) * ( 1.0 - select( 0.0, 1.0, isWeed ) );
	let sandDust = contact * sandy * smoothstep( 0.4, 0.7, T3.a + contact * 0.3 );
	col = mix( col * in.vs.vTint, ${ srgb( 0.78, 0.7, 0.56 ) }, sandDust * 0.55 );
	let wet = 1.0 - smoothstep( 0.35, 0.9, p.y );
	col = col * ( 1.0 - wet * 0.4 );
	s.albedo = col;
	s.roughness = clamp( mix( rough, 0.28, wet * 0.8 ) + sandDust * 0.1, 0.05, 1.0 );
	s.ao = sat( 1.0 - contact * 0.45 );
	hd = hd + sandDust * 0.0015;
	// (derivatives of hd after the branches: every pixel of the quad reaches this point)
	s.normal = terrainPerturbNormal( p, N, hd, 1.0 );
`;

export function createNatureMaterial( gpu, { sunShadow = true } = {} ) {

	const mat = standard( {
		name: 'DebrisNature',
		roughness: 0.8, metalness: 0,
		underwaterLighting: 'lite',
		modules: [ commonModule, lodFadeModule, terrainShadingModule(), gpu.module, stoneSurfaceModule, ...( sunShadow ? [ gpu.sunModulationModule ] : [] ) ],
		// the former TerrainLightingModel (heightfield sun shadow on the key light)
		defines: sunShadow ? { MATERIAL_SUN_MODULATION: 1 } : {},
		appliesHillShadow: sunShadow, // (applied above: the lighting hook must not apply it again)
		attributes: { [ aTint ]: 'vec3f', [ aData ]: 'vec4f' },
		varyings: { vTint: 'vec3f', vData: 'vec4f' },
		vertex: `\to.vTint = v.${ aTint };\n\to.vData = v.${ aData };\n`,
		surface: NATURE_SURFACE,
	} );
	// (the TSL version set mat.mrtNode = staticVelocityMRT: the meshes set `staticVelocity = true`)
	return mat;

}
