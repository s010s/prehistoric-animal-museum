import { UniformBlock, ShaderModule, SceneLighting } from '../engine/webgpu.js';
import { Texture } from '../engine/gpu/Texture.js';
import { ComputeKernel } from '../engine/gpu/Compute.js';
import { Vector2 } from '../engine/math/index.js';
import { commonModule } from '../engine/render/wgsl/common.js';
import { surfaceModule } from '../engine/render/wgsl/lighting.js';
import { FFT_SIZE } from './OceanFFT.js';

// The wave terms the lighting needs at a point depend on its xz only (surface height, slope and foam
// of the long waves, the mean level, the gust / slick factor of the caustics). They are baked once
// per frame into two camera-centred maps (0.25 m texels over 128 m, 2 m over 1 km, snapped to their
// texels so they don't crawl) instead of being evaluated by every fragment that can be under water
// (the FFT, shore wave and swash lookups). Beyond the far map: a flat sea. The material hooks only
// bind the maps; the FFT / shore / terrain helpers live in the bake kernels.
const MAP_N = 512;
const MAP_EXTENTS = [ 128, 1024 ];

// Installs the lighting hooks that every scene material uses:
//  - direct sun: attenuated along the refracted sun path through the water column (Beer-Lambert),
//    modulated by caustics that follow the waves above (swell + shore waves tilt the light, surf
//    foam and bubbles shade the floor)
//  - ambient: attenuated + tinted with depth
// Everything runs only for fragments that can be under water.
//
// Per material (material.underwaterLighting -> define UNDERWATER_LIGHTING): 'full' (2, default:
// terrain, reef, rocks - caustics, waves, foam shading), 'lite' (1, water column attenuation only:
// pier, boat hull, village) or 'none' (0, never under water: plants). The water itself (IS_WATER)
// is shaded by WaterMaterial and gets no modulation here.
//
// WGSL: installs `fn hookDirectModulation( P, N ) -> vec3f` and `fn hookAmbientModulation( P, N ) -> vec3f`
// (module prefix `underwater` for the bake helpers: underwaterLongWaves, underwaterMeanLevel; prefix
// `uwMap` for the baked map lookup: uwMapLookup( xz, waves ) -> UwMapSample).
// Note: unlike TSL, the modules' bindings (maps, caustics, terrain, clouds) are declared in every
// material that includes the lighting hooks, whatever its mode (the code itself is #if'd away).
export function installUnderwaterLighting( { fft, caustics, clouds = null, terrain = null, shore = null, surface = null, shoreSim = null } ) {

	const params = new UniformBlock( 'UnderwaterParams', {
		// highest the water can reach on the shore: the swash run-up grows with the surf height. Terrain
		// and props above it (the dry beach) skip the wave evaluation entirely.
		reach: [ 'f32', 3.0 ],
	}, { label: 'underwater' } );
	params.onBeforePack = () => {

		params.fields.reach.value = shore && shore.amplitude ? shore.amplitude.value * 1.5 + 1.2 : 3.0;

	};

	const T = !! terrain;
	const S = !! ( shore && terrain );
	const deps = [ commonModule, surfaceModule, fft.module, terrain && terrain.module, S && shore.module, shoreSim && shoreSim.module,
		caustics && caustics.module, clouds && clouds.module, surface && surface.attenuationModule ];

	const C3 = Math.min( 3, fft.cascades ), C2 = Math.min( 2, fft.cascades );

	const helpers = new ShaderModule( {
		name: 'underwater',
		deps,
		uniforms: params,
		uniformName: 'underwater',
		code: /* wgsl */`
struct UnderwaterLongWaves { height: f32, slope: vec2f, foam: f32 };

// long waves at xz: height, slope and foam from the coarse FFT cascades and the shore waves
// texel: the bake's texel size (m); the cascades are read no finer than it (level >= 2)
fn underwaterLongWaves( xz: vec2f, texel: f32 ) -> UnderwaterLongWaves {
	let seaDepth = ${ T ? 'frame.seaLevel - terrainHeightAt( xz )' : '50.0' };
	var h = 0.0;
	var slope = vec2f( 0.0 );
	for ( var c = 0; c < ${ C3 }; c++ ) {
		let uv = xz / ocean.sizes[ c ].x;
		let att = ${ surface ? 'waterSurfaceCascadeAttenuation( c, seaDepth )' : '1.0' };
		let lvl = max( 2.0, log2( texel * ${ FFT_SIZE }.0 / ocean.sizes[ c ].x ) );
		h += textureSampleLevel( oceanDisplacement, smpLinearRepeat, uv, c, lvl ).y * att;
		if ( c < 2 ) {
			let d = textureSampleLevel( oceanDerivatives, smpLinearRepeat, uv, c, lvl );
			slope += vec2f( d.x, d.y ) * att;
		}
	}

	var foam = 0.0;
${ S ? `	{
		let sw = shoreEvaluate( xz, seaDepth, terrainHeightAt( xz ) );
		h += sw.disp.y;
		let n = sw.nShore;
		slope += - vec2f( n.x, n.z ) / max( n.y, 0.25 );
		foam += sw.foam;
	}` : '' }
${ shoreSim ? '	foam += shoreSimSample( xz ).x * 0.8;' : '' }
	// waves only exist over water: none over dry land
${ T ? '	h = h * smoothstep( 0.0, 1.0, seaDepth ) - smoothstep( 0.0, -0.4, seaDepth ) * 10.0;' : '' }
	var o: UnderwaterLongWaves;
	o.height = frame.seaLevel + h;
	o.slope = slope;
	o.foam = foam;
	return o;
}

fn underwaterSigT() -> vec3f { return frame.waterAbsorption + frame.waterScattering; }

// mean water level from the two longest FFT cascades (one texture binding)
fn underwaterMeanLevel( xz: vec2f ) -> f32 {
	var h = 0.0;
	for ( var c = 0; c < ${ C2 }; c++ ) {
		h += textureSampleLevel( oceanDisplacement, smpLinearRepeat, xz / ocean.sizes[ c ].x, c, 3.0 ).y;
	}
${ T ? '	h *= smoothstep( 0.0, 3.0, frame.seaLevel - terrainHeightAt( xz ) );' : '' }
	return frame.seaLevel + h;
}
`,
	} );

	// ---- the baked maps: A = ( height - sea level, slope.xy, foam ), B = ( mean level - sea level, detail k )
	const mapParams = new UniformBlock( 'UwMapParams', {
		origin0: [ 'vec2f', new Vector2() ],
		origin1: [ 'vec2f', new Vector2() ],
		// highest the water can reach on the shore (see params.reach): the hooks' cheap reject
		reach: [ 'f32', 3.0 ],
	}, { label: 'uwMap' } );
	mapParams.onBeforePack = () => {

		mapParams.fields.reach.value = shore && shore.amplitude ? shore.amplitude.value * 1.5 + 1.2 : 3.0;

	};
	const origins = [ mapParams.fields.origin0, mapParams.fields.origin1 ];
	const make = ( name ) => new Texture( { label: name, width: MAP_N, height: MAP_N, format: 'rgba16float', usage: [ 'sample', 'storage' ] } );
	const levels = MAP_EXTENTS.map( ( extent, l ) => {

		const texel = extent / MAP_N;
		const A = make( 'uwWaves' + l ), B = make( 'uwLevel' + l );
		const kernel = new ComputeKernel( {
			label: 'Underwater Light Map ' + l,
			modules: [ helpers, ...( caustics && caustics.module ? [ caustics.module ] : [] ) ],
			bindings: { uwMapParams: { uniform: mapParams }, uwOutA: { storageTexture: A, access: 'write' }, uwOutB: { storageTexture: B, access: 'write' } },
			workgroupSize: [ 8, 8, 1 ],
			code: /* wgsl */`
@compute @workgroup_size( WG_X, WG_Y, WG_Z )
fn main( @builtin( global_invocation_id ) gid: vec3u ) {
	let xz = ( vec2f( gid.xy ) + 0.5 ) * ${ texel } + uwMapParams.origin${ l };
	let lw = underwaterLongWaves( xz, ${ texel } );
	textureStore( uwOutA, vec2u( gid.xy ), vec4f( lw.height - frame.seaLevel, lw.slope, sat( lw.foam ) ) );
	let dk = ${ caustics && caustics.module ? 'causticsDetailK( xz )' : '1.0' };
	textureStore( uwOutB, vec2u( gid.xy ), vec4f( underwaterMeanLevel( xz ) - frame.seaLevel, dk, 0.0, 1.0 ) );
}
`,
		} );
		return { extent, texel, A, B, kernel, origin: origins[ l ] };

	} );

	const [ L0, L1 ] = levels;
	const mapModule = new ShaderModule( {
		name: 'uwMap',
		deps: [ commonModule ],
		uniforms: mapParams,
		uniformName: 'uwMapParams',
		bindings: { uwWaves0: { texture: L0.A }, uwLevel0: { texture: L0.B }, uwWaves1: { texture: L1.A }, uwLevel1: { texture: L1.B } },
		code: /* wgsl */`
struct UwMapSample { height: f32, slope: vec2f, foam: f32, mean: f32, detailK: f32 };

fn uwReach() -> f32 { return uwMapParams.reach; }

// bilinear lookup of the baked maps at xz (near map first, then far; flat sea beyond).
// waves: map A (height, slope, foam) is only read for the full direct term
// (the direct, ambient and shadow position hooks look up the same point: the last lookup is
// remembered; one made with waves serves the calls without)
var<private> uwMemoXZ: vec2f = vec2f( 3.0e38 );
var<private> uwMemoWaves: bool = false;
var<private> uwMemo: UwMapSample;
fn uwMapLookup( xz: vec2f, waves: bool ) -> UwMapSample {
	if ( all( xz == uwMemoXZ ) && ( uwMemoWaves || ! waves ) ) { return uwMemo; }
	uwMemoXZ = xz;
	uwMemoWaves = waves;
	uwMemo = _uwMapLookup( xz, waves );
	return uwMemo;
}
fn _uwMapLookup( xz: vec2f, waves: bool ) -> UwMapSample {
	var a = vec4f( 0.0 );
	var b = vec4f( 0.0, 0.9, 0.0, 0.0 );
	let st0 = ( xz - uwMapParams.origin0 ) / ${ L0.texel };
	let st1 = ( xz - uwMapParams.origin1 ) / ${ L1.texel };
	if ( all( st0 > vec2f( 0.5 ) ) && all( st0 < vec2f( ${ MAP_N }.0 - 0.5 ) ) ) {
		let uv = st0 / ${ MAP_N }.0;
		if ( waves ) { a = textureSampleLevel( uwWaves0, smpLinearClamp, uv, 0.0 ); }
		b = textureSampleLevel( uwLevel0, smpLinearClamp, uv, 0.0 );
	} else if ( all( st1 > vec2f( 0.5 ) ) && all( st1 < vec2f( ${ MAP_N }.0 - 0.5 ) ) ) {
		let uv = st1 / ${ MAP_N }.0;
		if ( waves ) { a = textureSampleLevel( uwWaves1, smpLinearClamp, uv, 0.0 ); }
		b = textureSampleLevel( uwLevel1, smpLinearClamp, uv, 0.0 );
	}
	return UwMapSample( frame.seaLevel + a.x, a.yz, a.w, frame.seaLevel + b.x, b.y );
}
`,
	} );

	const update = ( camera ) => {

		for ( const lv of levels ) {

			// snapped to whole texels: the texel centres stay fixed in the world
			const half = lv.extent / 2;
			lv.origin.value.set(
				Math.floor( camera.position.x / lv.texel ) * lv.texel - half,
				Math.floor( camera.position.z / lv.texel ) * lv.texel - half,
			);

		}

		for ( const lv of levels ) lv.kernel.dispatch( [ MAP_N / 8, MAP_N / 8, 1 ] );

	};

	// the hooks bind only the maps (+ caustics, clouds, terrain hill shadow)
	const hookDeps = [ commonModule, surfaceModule, mapModule, caustics && caustics.module, clouds && clouds.module, terrain && terrain.module ].filter( Boolean );

	const direct = new ShaderModule( {
		name: 'hook-directModulation-underwater',
		deps: hookDeps,
		code: /* wgsl */`
fn hookDirectModulation( P: vec3f, N: vec3f ) -> vec3f {
#if IS_WATER
	return vec3f( 1.0 );
#else
	var result = vec3f( 1.0 );
#if UNDERWATER_LIGHTING == 2
	// the pixel's footprint on the ground plane, to filter the caustics over it (screen derivatives
	// taken by shadeSurface in uniform control flow: this hook runs in its branches)
	let gdx = lightDPdx.xz;
	let gdy = lightDPdy.xz;
#endif
#if UNDERWATER_LIGHTING != 0
	// cheap reject: above anything the water reaches
	if ( P.y < frame.seaLevel + uwReach() ) {
#if UNDERWATER_LIGHTING == 2
		let lw = uwMapLookup( P.xz, true );
		let lwHeight = lw.height;
#else
		let lwHeight = uwMapLookup( P.xz, false ).mean;
#endif
		let d = max( lwHeight - P.y, 0.0 );
		if ( d > 0.0 ) {
			let under = smoothstep( 0.0, 0.08, d );
			let Ls = refract( - frame.sunDir, vec3f( 0.0, 1.0, 0.0 ), 1.0 / 1.333 );
			let mu = max( - Ls.y, 0.15 );
			let atten = exp( - ( frame.waterAbsorption + frame.waterScattering ) * d / mu );
#if UNDERWATER_LIGHTING == 2
#if REFRACTION_CLIP
			// the refraction source is half resolution and seen blurred: no dispersion
			let caust = ${ caustics ? 'causticsSampleBakedMono( P, d, lw.slope, lw.foam, gdx, gdy, lw.detailK )' : 'vec3f( 1.0 )' };
#else
			let caust = ${ caustics ? 'causticsSampleBaked( P, d, lw.slope, lw.foam, gdx, gdy, lw.detailK )' : 'vec3f( 1.0 )' };
#endif
#else
			let caust = vec3f( 1.0 );
#endif
			result = mix( vec3f( 1.0 ), atten * caust, under );
		}
	}
#endif
	let cloudShadow = ${ clouds ? 'cloudsShadow( P.xz )' : '1.0' };
	// hills shadowing the island and the bay at low sun (terrain heightfield shadow; the terrain and
	// the rocks apply it in their own lighting model)
#if HILL_SHADOW_SELF
	let hill = 1.0;
#else
	let hill = ${ T ? 'terrainSunShadowAt( P )' : '1.0' };
#endif
	return result * cloudShadow * hill;
#endif
}
`,
	} );

	const ambient = new ShaderModule( {
		name: 'hook-ambientModulation-underwater',
		deps: [ direct ],
		code: /* wgsl */`
fn hookAmbientModulation( P: vec3f, N: vec3f ) -> vec3f {
	var result = vec3f( 1.0 );
#if !IS_WATER
#if UNDERWATER_LIGHTING != 0
	if ( P.y < frame.seaLevel + uwReach() ) {
		// the ambient term only needs the mean water level (no shore evaluation)
		let d = max( uwMapLookup( P.xz, false ).mean - P.y, 0.0 );
		let under = smoothstep( 0.0, 0.1, d );
		// diffuse downwelling light: effective path ~1.2x depth, plus a little in-scattered blue
		let atten = exp( - ( frame.waterAbsorption + frame.waterScattering ) * d * 1.2 ) * 0.85 + vec3f( 0.0, 0.02, 0.04 ) * exp( d * -0.1 );
		result = mix( vec3f( 1.0 ), atten, under );
	}
#endif
#endif
	return result;
}
`,
	} );

	// Sun shadows of underwater receivers are looked up where their light entered the water: back up
	// the refracted sun ray (through the local wave slope) to the surface. Shadows of the pier, the boat
	// or rocks above the water then land where refraction puts them (closer under the object than the
	// straight sun ray would), sway with the waves, and blur with depth (forward scattering: the entry
	// point is jittered over a disk that grows with the depth, the temporal resolve averages it).
	const shadowPos = new ShaderModule( {
		name: 'hook-shadowPosition-underwater',
		deps: hookDeps,
		code: /* wgsl */`
fn hookShadowPosition( P: vec3f, N: vec3f, pixel: vec2f ) -> vec3f {
#if IS_WATER || UNDERWATER_LIGHTING == 0
	return P;
#else
	if ( P.y >= frame.seaLevel + uwReach() ) { return P; }
#if UNDERWATER_LIGHTING == 2
	let m = uwMapLookup( P.xz, true );
	let h = m.height;
	let n = normalize( vec3f( - m.slope.x, 1.0, - m.slope.y ) );
#else
	let h = uwMapLookup( P.xz, false ).mean;
	let n = vec3f( 0.0, 1.0, 0.0 );
#endif
	let d = h - P.y;
	if ( d <= 0.0 ) { return P; }
	let up = - refract( - frame.sunDir, n, 1.0 / 1.333 ); // toward the entry point, in the water
	let entry = P + up * ( d / max( up.y, 0.15 ) );
	let g = interleavedGradientNoise( pixel + f32( frame.frameIndex % 64u ) * 5.588238 );
	let phi = g * TWO_PI;
	let rad = sqrt( fract( g * 1.618034 + 0.31 ) ) * min( d * 0.05, 0.5 );
	return entry + vec3f( cos( phi ), 0.0, sin( phi ) ) * rad;
#endif
}
`,
	} );

	SceneLighting.set( 'directModulation', direct );
	SceneLighting.set( 'shadowPosition', shadowPos );
	SceneLighting.set( 'ambientModulation', ambient );
	return { helpers, direct, ambient, shadowPos, params, update, levels };

}
