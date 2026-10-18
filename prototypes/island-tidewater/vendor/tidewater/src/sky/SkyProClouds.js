import { Vector2, Vector3, MathUtils } from '../engine/index.js';
import { GPU, ShaderModule, UniformBlock, ComputeKernel, Texture, G, FrameUniforms } from '../engine/webgpu.js';
import { commonModule } from '../engine/render/wgsl/common.js';

// Volumetric cumulus from sky-pro-webgpu (../sky-pro-webgpu, "Partly cloudy" preset): procedural
// weather map, baked 64³ Perlin-Worley shape noise with a height-dependent erosion, a cone-traced
// light march with three multiple-scattering octaves, powder and base darkening, a quarter-rate
// lattice trace reconstructed temporally at half resolution. Lit by Tidewater's atmosphere (sun
// or moon key light, sky view LUT) instead of sky-pro's own.
//
// Same public interface as the previous clouds (sky/Clouds.js):
//   clouds.module:        fn cloudsSampleView( dir ) -> vec4f   ( rgb in-scattered radiance, a transmittance ), main view
//                         fn cloudsSample( dir ) -> vec4f       panorama (reflections, environment, Snell's window)
//   clouds.shadowModule:  fn cloudsShadow( worldXZ ) -> f32     cloud shadow on the ground (1 = clear)
//   clouds.coverage       { value } 0..1
//   clouds.update( dt, camera ), clouds.resolutionScale, clouds.resetHistory(), clouds.invalidate()
//   await clouds.ready    (noise volume download)

const f = ( x ) => {

	const s = Number( x ).toString();
	return /[.eE]/.test( s ) ? s : s + '.0';

};

const DEG = Math.PI / 180;

// "Partly cloudy": scattered fair-weather cumulus
const PRESET = {
	atmosphere: { multipleScattering: 0.99 },
	shape: {
		altitude: 4000, thickness: 5200, density: 0.019, coverage: 0.49,
		horizonCoverageStart: 20000, horizonCoverageRamp: 45000, horizonCoverageAmount: 0.12,
		edgeSoftness: 0.095, edgeSoftnessFalloff: 1, weatherScale: 29000, baseScale: 7500, baseStrength: 0.69,
		erosionScaleBaseMultiplier: 0.13, erosionStrengthBase: 0.24, erosionStrengthPeak: 2.15, erosionShape: 1,
		baseWeatherStrength: 0.54, baseWeatherHeightStart: 0, baseWeatherHeightEnd: 0.13,
	},
	lighting: {
		scatteringAlbedo: 1, powderStrength: 0.7, ambientIntensity: 0.7,
		groundBounceAlbedo: [ 0.009134058699157796, 0.015208514418949472, 0.018500220124016652 ],
		baseShadowStrength: 0.88, baseShadowHeight: 0.13, moonGain: 0.65,
	},
	// the preset's 89 m/s drift is a time-lapse; the clouds here drift with Tidewater's wind at a
	// trade-wind speed (evolution scaled by the same factor)
	wind: { speed: 12, evolutionSpeed: 60.8 * 12 / 89, skew: 1750 },
	fade: { hazeDensityScale: 0.62, horizonMeltStart: 25000, horizonMeltEnd: 45000 },
	weather: { resolution: 1024, mainMass: [ 4, 5, 0, 1.32 ], detail: [ 6, 6, 1, 0.13 ], coverage: 0.26 },
};

// sky-pro "high" quality
const QUALITY = { historyDivisor: 2, lattice: 4, maxSteps: 256, lightTaps: 6, stepMeters: 25, fullLightingAlpha: 0.5, lightReuseSteps: 3, historyWeight: 0.9 };

const PANO_W = 512, PANO_H = 160; // same mapping as sky/Clouds.js (elevation -4..90 deg, v = sqrt)
const PANO_LATTICE = 4; // 1/16 of the panorama per frame
const SHADOW_RES = 256;
const AP_DIST = 30000; // m: aerial perspective toward the horizon

const v4 = () => [ 0, 0, 0, 0 ];

// ------------------------------------------------------------------ WGSL: shared core (renamed from sky-pro)

const CORE_WGSL = /* wgsl */`
const SC_EARTH: f32 = 6371.0;
const SC_FAR: f32 = 250000.0;
const SC_AP_DIST: f32 = ${ f( AP_DIST ) };

fn scRay( uv: vec2f ) -> vec3f {
	let ndc = vec2f( uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0 );
	return normalize( scf.forward.xyz + scf.right.xyz * ( ndc.x * scf.right.w * scf.position.w )
		+ scf.up.xyz * ( ndc.y * scf.position.w ) );
}
fn scSourceUV( pixel: vec2f ) -> vec2f {
	return ( pixel * scf.sampling.z + scf.sampling.xy + 0.5 ) / scf.viewport.zw;
}
fn scProjectPrevious( p: vec3f ) -> vec3f {
	let v = p - scf.previousPosition.xyz;
	let z = dot( v, scf.previousForward.xyz );
	let denom = max( z, 0.001 ) * scf.previousPosition.w;
	return vec3f( vec2f( dot( v, scf.previousRight.xyz ) / ( denom * scf.previousRight.w ),
		-dot( v, scf.previousUp.xyz ) / denom ) * 0.5 + 0.5, z );
}
fn scHG( mu: f32, g: f32 ) -> f32 {
	let d = max( 1.0 + g * g - 2.0 * g * mu, 0.001 );
	return ( 1.0 - g * g ) / ( 4.0 * PI * d * sqrt( d ) );
}
// normalized droplet phase: 80% forward / 20% backscatter; each higher order halves the asymmetry
fn scPhases( mu: f32 ) -> vec3f {
	return vec3f( scHG( mu, 0.8 ), scHG( mu, 0.4 ), scHG( mu, 0.2 ) ) * 0.8
		+ vec3f( scHG( mu, -0.2 ), scHG( mu, -0.1 ), scHG( mu, -0.05 ) ) * 0.2;
}

// ---- density (sky-pro density.wgsl)
struct ScCandidate {
	conservative: f32, edge: f32, top: f32, floorMask: f32,
	shellHeight: f32, localHeight: f32, coverage: f32, position: vec3f,
};
fn scShellHeight( p: vec3f ) -> f32 {
	let horizontal = p.xz - scf.position.xz;
	// parabolic radial height avoids subtracting two ~6,371,000 m f32 values
	let altitude = p.y + dot( horizontal, horizontal ) / ( 2.0 * SC_EARTH * 1000.0 );
	return ( altitude - scs.shell.x ) / scs.shell.y;
}
fn scConeLod( footprint: f32, scale: f32 ) -> f32 { return max( 0.0, log2( max( footprint * 64.0 / scale, 1.0 ) ) ); }
fn scCandidate( p: vec3f, coverage: f32, lod: f32 ) -> ScCandidate {
	let h = scShellHeight( p );
	var result: ScCandidate;
	result.conservative = 0.0;
	if ( h < -0.1 || h > 1.3 || coverage <= 0.0 ) { return result; }
	let windDirection = scs.wind.xy;
	let shapePosition = p - vec3f( scf.wind.x, 0.0, scf.wind.y )
		- vec3f( windDirection.x, 0.0, windDirection.y ) * ( scs.wind.z * max( h, 0.0 ) - scf.wind.z );
	let weather = textureSampleLevel( scWeatherMap, smpLinearRepeat, ( p.xz - scf.wind.xy ) / scs.shape.x, 0.0 ).r;
	let edge = max( scs.base.y * exp2( -max( h, 0.0 ) * scs.base.z ), 0.0001 );
	// an all-one noise sample bounds top dilation; a failed bound avoids the volume fetch
	let maximumTop = weather + coverage - 1.0 + 1.34 * scs.shape.z * coverage;
	if ( maximumTop < h - edge ) { return result; }
	let required = ( 1.0 - smoothstep( scs.base.w, max( scs.erosion.w, scs.base.w + 0.001 ), h ) ) * scs.base.x;
	let floorMask = smoothstep( required - 0.1, required, weather );
	if ( floorMask <= 0.0 ) { return result; }
	let baseSample = textureSampleLevel( scNoise, smpLinearRepeat, shapePosition / scs.shape.y, lod ).rgb;
	let dilation = dot( baseSample, vec3f( 0.7, 0.41, 0.23 ) ) * scs.shape.z;
	let top = weather + coverage - 1.0 + dilation * coverage;
	result.conservative = smoothstep( -edge, edge, top - h ) * smoothstep( -edge, edge, h ) * floorMask;
	result.edge = edge; result.top = top; result.floorMask = floorMask;
	result.shellHeight = h; result.localHeight = clamp( h / max( top, 0.001 ), 0.0, 1.0 );
	result.coverage = coverage; result.position = shapePosition;
	return result;
}
fn scErodedDensity( c: ScCandidate, lod: f32 ) -> f32 {
	if ( c.conservative <= 0.0 ) { return 0.0; }
	let strength = mix( scs.erosion.x, scs.erosion.y, c.localHeight );
	let maximumErosion = 0.173 * strength * c.coverage;
	if ( min( c.top - c.shellHeight, c.shellHeight ) >= maximumErosion + c.edge ) { return c.floorMask; }
	let s = textureSampleLevel( scNoise, smpLinearRepeat, c.position / ( scs.shape.y * scs.shape.w ), lod ).rgb;
	let field = mix( 1.0 - s, s, scs.erosion.z );
	let erosion = dot( field, vec3f( 0.113, 0.04, 0.02 ) ) * strength * c.coverage;
	return smoothstep( -c.edge, c.edge, c.top - erosion - c.shellHeight )
		* smoothstep( -c.edge, c.edge, c.shellHeight - erosion ) * c.floorMask;
}
fn scLightDensity( p: vec3f, coverage: f32, lods: vec2f, cheap: bool ) -> f32 {
	let c = scCandidate( p, coverage, lods.x );
	if ( cheap ) { return c.conservative; }
	return scErodedDensity( c, lods.y );
}
fn scShellRoots( direction: vec3f, altitude: f32, originHeight: f32 ) -> vec2f {
	let radius = SC_EARTH * 1000.0;
	let b = ( radius + originHeight ) * direction.y;
	let c = ( originHeight - altitude ) * ( 2.0 * radius + originHeight + altitude );
	let h = b * b - c;
	if ( h < 0.0 ) { return vec2f( -1.0 ); }
	let q = -b - select( -sqrt( h ), sqrt( h ), b >= 0.0 );
	let other = c / select( -0.0001, q, abs( q ) > 0.0001 );
	return vec2f( min( q, other ), max( q, other ) );
}
fn scCloudInterval( dir: vec3f, originHeight: f32 ) -> vec2f {
	let inner = scShellRoots( dir, scs.shell.x, originHeight );
	let outer = scShellRoots( dir, scs.shell.x + scs.shell.y, originHeight );
	var start = 0.0; var end = min( outer.y, SC_FAR );
	if ( outer.y <= 0.0 ) { return vec2f( 0.0 ); }
	if ( originHeight < scs.shell.x ) { start = max( inner.y, 0.0 ); }
	else {
		if ( originHeight > scs.shell.x + scs.shell.y ) { start = max( outer.x, 0.0 ); }
		if ( inner.x >= 0.0 ) { end = min( end, inner.x ); }
	}
	let ground = scShellRoots( dir, 0.0, originHeight );
	if ( ground.x > 0.0 ) { end = min( end, ground.x ); }
	return vec2f( start, end );
}
`;

// the ray march (sky-pro clouds.wgsl main(), as a function of the ray)
const MARCH_WGSL = /* wgsl */`
fn scCoverageAt( t: f32 ) -> f32 {
	return scs.shell.w + scs.horizon.z * smoothstep( scs.horizon.x, scs.horizon.x + max( scs.horizon.y, 1.0 ), t );
}
fn scHeightAlongRay( t: f32, dir: vec3f, originHeight: f32 ) -> f32 {
	let altitude = originHeight + dir.y * t + dot( dir.xz, dir.xz ) * t * t / ( 2.0 * SC_EARTH * 1000.0 );
	return ( altitude - scs.shell.x ) / scs.shell.y;
}
fn scCellIsEmpty( t: f32, end: f32, dir: vec3f, originHeight: f32, maximumWeather: f32 ) -> bool {
	let turningPoint = -dir.y * SC_EARTH * 1000.0 / max( dot( dir.xz, dir.xz ), 0.000001 );
	let minHeight = scHeightAlongRay( clamp( turningPoint, t, end ), dir, originHeight );
	let maxHeight = max( scHeightAlongRay( t, dir, originHeight ), scHeightAlongRay( end, dir, originHeight ) );
	let coverage = scCoverageAt( end );
	let maximumTop = maximumWeather + coverage - 1.0 + 1.34 * scs.shape.z * coverage;
	let edgeHeight = select( maxHeight, minHeight, scs.base.z >= 0.0 );
	let edge = max( scs.base.y * exp2( -max( edgeHeight, 0.0 ) * scs.base.z ), 0.0001 );
	let required = ( 1.0 - smoothstep( scs.base.w, max( scs.erosion.w, scs.base.w + 0.001 ), maxHeight ) ) * scs.base.x;
	return maximumTop < minHeight - edge || maximumWeather <= required - 0.1;
}
fn scLightOpticalDepth( p: vec3f, coverage: f32, lods: vec2f, cheap: bool ) -> f32 {
	var opticalDepth = 0.0;
	for ( var i = 1u; i < 8u; i++ ) {
		if ( i >= u32( scf.march.z ) ) { break; }
		let tap = scf.lightOffsets[ i ];
		opticalDepth += scLightDensity( p + tap.xyz, coverage, max( lods, scf.lightLods[ i ].xy ), cheap ) * tap.w * scs.shell.z;
		if ( opticalDepth >= 32.0 ) { break; }
	}
	return opticalDepth;
}
fn scLightEnergy( opticalDepth: f32, phase: vec3f ) -> f32 {
	let quarter = exp( -opticalDepth * 0.25 );
	let halfT = quarter * quarter;
	return dot( vec3f( halfT * halfT, halfT * 0.5, quarter * 0.25 ), phase );
}

// Tidewater's sky (the atmosphere's sky view LUT; the night sky's ambient)
fn scSky( dir: vec3f ) -> vec3f {
	return atmosphereSkyLuminance( dir ) + frame.skyIrradiance * frame.night;
}
// key light: the sun while it is the app's key light, seen from cloud altitude, else the moon
fn scDirect() -> vec3f {
	let isMoon = dot( frame.sunDir, atmosphereParams.sunDir ) < 0.9999;
	let sunE = atmosphereSampleTransmittance( 6360.0 + scs.shell.x * 0.001, frame.sunDir.y ) * atmosphereParams.sunIlluminance;
	return select( sunE, frame.sunColor, isMoon );
}

struct ScMarch { color: vec3f, alpha: f32, depth: f32, steps: u32 };

fn scMarch( origin: vec3f, dir: vec3f, dither: f32, pixelConeAngle: f32, stepConeAngle: f32, maxSteps: u32, useBounds: bool ) -> ScMarch {
	var out: ScMarch;
	out.color = vec3f( 0.0 ); out.alpha = 0.0; out.depth = SC_FAR; out.steps = 0u;
	let interval = scCloudInterval( dir, origin.y );
	var color = vec3f( 0.0 ); var transmission = 1.0; var weightedDepth = 0.0;
	var steps = 0u;
	if ( interval.y > interval.x && scs.shell.w > 0.0 && scs.shell.z > 0.0 ) {
		let L = frame.sunDir;
		let lightCosine = dot( dir, L );
		let phase = scPhases( lightCosine );
		let direct = scDirect();
		let zenith = scSky( vec3f( 0.0, 1.0, 0.0 ) );
		let horizon = scSky( normalize( vec3f( L.x, 0.03, L.z ) + vec3f( 1e-5, 0.0, 0.0 ) ) );
		let bounce = scs.bounce.rgb * direct * max( L.y, 0.0 );
		var t = interval.x + dither * scf.march.x;
		var coarse = true; var emptyRun = 0u; var accumulatedDepth = 0.0;
		var refineEnd = -1.0;
		var cellEnd = -1.0; var cellStart = -1.0; var maximumWeather = 1.0;
		var shadowAt = -SC_FAR; var shadowDensity = -1.0; var shadowTau = 0.0; var skyTau = 0.0; var shadowCheap = false;
		let hasDirectLight = max( direct.x, max( direct.y, direct.z ) ) > 0.00001;
		for ( var i = 0u; i < maxSteps; i++ ) {
			if ( t >= interval.y || transmission < 0.003 ) { break; }
			steps++;
			if ( coarse && useBounds ) {
				if ( t >= cellEnd || t < cellStart ) {
					let size = vec2i( textureDimensions( scWeatherBounds ) );
					let grid = ( origin.xz + dir.xz * t - scf.wind.xy ) / scs.shape.x * vec2f( size );
					let cell = vec2i( floor( grid ) );
					maximumWeather = textureLoad( scWeatherBounds, ( ( cell % size ) + size ) % size, 0 ).r;
					let distance = select( fract( grid ), 1.0 - fract( grid ), dir.xz >= vec2f( 0.0 ) )
						/ max( abs( dir.xz ) * vec2f( size ) / scs.shape.x, vec2f( 0.0000001 ) );
					cellStart = t; cellEnd = min( interval.y, t + max( min( distance.x, distance.y ), 0.05 ) );
				}
				if ( scCellIsEmpty( t, cellEnd, dir, origin.y, maximumWeather ) ) { t = cellEnd + 0.05; continue; }
			}
			let footprint = t * pixelConeAngle;
			let fineStep = max( scf.march.x, t * stepConeAngle * 1.5 );
			let p = origin + dir * t;
			let coverage = scCoverageAt( t );
			let baseLod = scConeLod( footprint, scs.shape.y );
			let c = scCandidate( p, coverage, baseLod );
			let erosionLod = scConeLod( footprint, scs.shape.y * scs.shape.w );
			if ( coarse ) {
				if ( c.conservative > 0.0 ) {
					if ( scErodedDensity( c, erosionLod ) > 0.0 ) {
						refineEnd = t;
						t = max( interval.x, t - fineStep * 4.0 ) + fineStep;
						t = min( t, refineEnd );
						coarse = false; emptyRun = 0u;
						continue;
					}
				}
				t += fineStep * 4.0;
				continue;
			}
			let density = scErodedDensity( c, erosionLod );
			if ( density <= 0.0 ) {
				shadowAt = -SC_FAR;
				emptyRun++;
				if ( t < refineEnd ) { t = min( t + fineStep, refineEnd ); continue; }
				if ( emptyRun >= 4u ) { coarse = true; }
				t += select( fineStep, fineStep * 4.0, coarse ); continue;
			}
			emptyRun = 0u; refineEnd = -1.0;
			let sigmaT = density * scs.shell.z;
			let surfaceStep = clamp( 0.5 / max( sigmaT, 0.000001 ), fineStep * 0.15, fineStep );
			let stepLength = min( mix( surfaceStep, fineStep * 3.0, smoothstep( 1.0, 3.0, accumulatedDepth ) ), interval.y - t );
			let height = clamp( c.shellHeight, 0.0, 1.0 );
			let baseShadow = mix( 1.0, mix( 0.15, 1.0, smoothstep( 0.0, max( scs.shadow.y, 0.001 ), height ) ), scs.shadow.x );
			// darken thin margins away from the sun; keep the forward scattered silver linings
			let powderWeight = scs.cloudLight.y * ( 1.0 - smoothstep( 0.2, 0.95, lightCosine ) );
			let powder = mix( 1.0, 1.0 - exp( -density * 2.0 ), powderWeight );
			var energy = 0.0;
			let cheap = ( 1.0 - transmission ) >= scf.march.w;
			let reuseDistance = min( fineStep * scf.display.y, max( 20.0, scs.shape.y * scs.shape.w * 0.03 ) );
			if ( abs( t - shadowAt ) >= reuseDistance || abs( density - shadowDensity ) > 0.08 || cheap != shadowCheap ) {
				let lods = vec2f( baseLod, erosionLod );
				if ( hasDirectLight ) { shadowTau = scLightOpticalDepth( p, coverage, lods, cheap ); }
				let skyLods = lods + vec2f( 1.0 );
				skyTau = ( scLightDensity( p + vec3f( 0.0, 125.0, 0.0 ), coverage, skyLods, true ) * 250.0
					+ scLightDensity( p + vec3f( 0.0, 600.0, 0.0 ), coverage, skyLods, true ) * 700.0 ) * scs.shell.z;
				shadowAt = t; shadowDensity = density; shadowCheap = cheap;
			}
			if ( hasDirectLight ) {
				energy = scLightEnergy( shadowTau + sigmaT * scf.lightOffsets[ 0 ].w, phase );
			}
			let skyVisibility = 0.2 + 0.8 / ( 1.0 + ( skyTau + sigmaT * 25.0 ) * 0.35 );
			let ambient = ( mix( mix( zenith, horizon, 0.55 ), zenith, sqrt( height ) ) * skyVisibility + bounce * ( 1.0 - height ) )
				* scs.cloudLight.z * ( 1.0 + scs.cloudLight.w );
			let light = ( direct * energy * powder * baseShadow + ambient ) * scs.cloudLight.x;
			let stepT = exp( -sigmaT * stepLength );
			let alpha = transmission * ( 1.0 - stepT );
			color += alpha * light; weightedDepth += alpha * t;
			transmission *= stepT; accumulatedDepth += sigmaT * stepLength; t += stepLength;
		}
	}
	let alpha = 1.0 - transmission;
	var depth = SC_FAR;
	if ( alpha > 0.0 ) {
		depth = weightedDepth / alpha;
		// aerial perspective (distance toward the sky behind), then the far melt into the sky
		let sky = scSky( dir );
		let ap = exp( -depth / SC_AP_DIST );
		color = color * ap + sky * alpha * ( 1.0 - ap );
		let melt = smoothstep( scs.fade.y, max( scs.fade.z, scs.fade.y + 1.0 ), depth );
		color = mix( color, sky * alpha, melt );
	}
	out.color = color; out.alpha = alpha; out.depth = depth; out.steps = steps;
	return out;
}
`;

// sky-pro weather.wgsl (procedural fbm coverage) and weather-bounds.wgsl
const WEATHER_WGSL = /* wgsl */`
fn scHash33( cell: vec3u ) -> vec3u {
	var p = cell * 1664525u + 1013904223u;
	p.x += p.y * p.z; p.y += p.z * p.x; p.z += p.x * p.y;
	p = p ^ ( p >> vec3u( 16u ) );
	p.x += p.y * p.z; p.y += p.z * p.x; p.z += p.x * p.y;
	return p;
}
fn scGradient( cell: vec3i, period: i32, offset: vec3f ) -> f32 {
	let wrapped = vec3u( ( ( cell % vec3i( period ) ) + vec3i( period ) ) % vec3i( period ) );
	let h = ( scHash33( wrapped ).x >> 24u ) & 15u;
	let u = select( offset.y, offset.x, h < 8u );
	let v = select( select( offset.z, offset.x, h == 12u || h == 14u ), offset.y, h < 4u );
	return select( -u, u, ( h & 1u ) == 0u ) + select( -v, v, ( h & 2u ) == 0u );
}
fn scPerlin( p: vec3f, period: i32 ) -> f32 {
	let cell = vec3i( floor( p ) ); let fr = fract( p ); let w = fr * fr * fr * ( fr * ( fr * 6.0 - 15.0 ) + 10.0 );
	return mix( mix( mix( scGradient( cell, period, fr ), scGradient( cell + vec3i( 1, 0, 0 ), period, fr - vec3f( 1, 0, 0 ) ), w.x ),
		mix( scGradient( cell + vec3i( 0, 1, 0 ), period, fr - vec3f( 0, 1, 0 ) ), scGradient( cell + vec3i( 1, 1, 0 ), period, fr - vec3f( 1, 1, 0 ) ), w.x ), w.y ),
		mix( mix( scGradient( cell + vec3i( 0, 0, 1 ), period, fr - vec3f( 0, 0, 1 ) ), scGradient( cell + vec3i( 1, 0, 1 ), period, fr - vec3f( 1, 0, 1 ) ), w.x ),
		mix( scGradient( cell + vec3i( 0, 1, 1 ), period, fr - vec3f( 0, 1, 1 ) ), scGradient( cell + vec3i( 1, 1, 1 ), period, fr - vec3f( 1, 1, 1 ) ), w.x ), w.y ), w.z );
}
fn scFbm( uv: vec2f, profile: vec4f ) -> f32 {
	var frequency = max( 1.0, round( profile.x ) ); var weight = 0.5;
	var sum = 0.0; var weights = 0.0;
	for ( var i = 0u; i < u32( profile.y ); i++ ) {
		sum += scPerlin( vec3f( uv, profile.z * 13.37 + 0.5 ) * frequency, i32( frequency ) ) * weight;
		weights += weight; weight *= 0.5; frequency *= 2.0;
	}
	return sum / max( weights, 0.001 ) * 0.5 + 0.5;
}
`;

export class SkyProClouds {

	constructor( renderer, atmosphere ) {

		this.renderer = renderer;
		this.atmosphere = atmosphere;
		const P = PRESET, s = P.shape, l = P.lighting;

		// ---- per-frame state (sky-pro Frame) and settings (sky-pro Settings)
		this.frameBlock = new UniformBlock( 'SkyCloudFrame', {
			position: [ 'vec4f', v4() ], right: [ 'vec4f', v4() ], up: [ 'vec4f', v4() ], forward: [ 'vec4f', v4() ],
			previousPosition: [ 'vec4f', v4() ], previousRight: [ 'vec4f', v4() ], previousUp: [ 'vec4f', v4() ], previousForward: [ 'vec4f', v4() ],
			viewport: [ 'vec4f', v4() ], sampling: [ 'vec4f', v4() ], clock: [ 'vec4f', v4() ], wind: [ 'vec4f', v4() ], windDelta: [ 'vec4f', v4() ],
			march: [ 'vec4f', v4() ], temporal: [ 'vec4f', v4() ], display: [ 'vec4f', v4() ],
			pano: [ 'vec4f', v4() ], shadow: [ 'vec4f', v4() ],
			lightOffsets: [ 'vec4f[8]', new Float32Array( 32 ) ],
			lightLods: [ 'vec4f[8]', new Float32Array( 32 ) ],
		}, { label: 'sky clouds frame' } );
		this.settingsBlock = new UniformBlock( 'SkyCloudSettings', {
			shell: [ 'vec4f', [ s.altitude, s.thickness, s.density, s.coverage ] ],
			shape: [ 'vec4f', [ s.weatherScale, s.baseScale, s.baseStrength, s.erosionScaleBaseMultiplier ] ],
			erosion: [ 'vec4f', [ s.erosionStrengthBase, s.erosionStrengthPeak, s.erosionShape, s.baseWeatherHeightEnd ] ],
			// exponential softness falloff per shell height fraction
			base: [ 'vec4f', [ s.baseWeatherStrength, s.edgeSoftness, Math.log2( Math.max( s.edgeSoftnessFalloff, 0.001 ) ) * s.thickness * 0.001, s.baseWeatherHeightStart ] ],
			horizon: [ 'vec4f', [ s.horizonCoverageStart, s.horizonCoverageRamp, s.horizonCoverageAmount, 0 ] ],
			// w: the atmosphere's multiple scattering term of the ambient
			cloudLight: [ 'vec4f', [ l.scatteringAlbedo, l.powderStrength, l.ambientIntensity, P.atmosphere.multipleScattering ] ],
			shadow: [ 'vec4f', [ l.baseShadowStrength, l.baseShadowHeight, l.moonGain, 0 ] ],
			bounce: [ 'vec4f', [ ...l.groundBounceAlbedo, 0 ] ],
			wind: [ 'vec4f', [ 0, 1, P.wind.skew, 0 ] ],
			fade: [ 'vec4f', [ P.fade.hazeDensityScale, P.fade.horizonMeltStart, P.fade.horizonMeltEnd, 0 ] ],
			weatherMass: [ 'vec4f', P.weather.mainMass.slice() ],
			weatherDetail: [ 'vec4f', P.weather.detail.slice() ],
			weather: [ 'vec4f', [ P.weather.coverage, 0, 0, 0 ] ],
		}, { label: 'sky clouds settings' } );
		this.F = this.frameBlock.fields;
		this.S = this.settingsBlock.fields;

		// ---- public handles
		this.coverage = { value: s.coverage };
		this.resolutionScale = 1;
		this.outputSize = null;

		// ---- textures
		this.noise = new Texture( { label: 'cloud shape noise 64³', width: 64, height: 64, depth: 64, dimension: '3d', format: 'rgba8unorm', usage: [ 'sample', 'copyDst' ] } );
		this.blue = new Texture( { label: 'cloud blue noise', width: 64, height: 64, format: 'r8unorm', usage: [ 'sample', 'copyDst' ] } );
		const W = P.weather.resolution;
		this.weatherMap = new Texture( { label: 'cloud weather', width: W, height: W, format: 'rgba8unorm', usage: [ 'sample', 'storage' ] } );
		this.weatherBounds = new Texture( { label: 'cloud weather bounds', width: 64, height: 64, format: 'rgba8unorm', usage: [ 'sample', 'storage' ] } );
		const t2 = ( label, w = 4, h = 4, format = 'rgba16float' ) => new Texture( { label, width: w, height: h, format, usage: [ 'sample', 'storage' ] } );
		this.source = t2( 'cloud radiance' );
		this.sourceMeta = t2( 'cloud depth + cost' );
		this.colors = [ t2( 'cloud history A' ), t2( 'cloud history B' ) ];
		this.metas = [ t2( 'cloud history meta A' ), t2( 'cloud history meta B' ) ];
		this.panorama = t2( 'cloud panorama', PANO_W, PANO_H );
		this.shadowMap = t2( 'cloud shadow', SHADOW_RES, SHADOW_RES, 'r32float' );
		this._pp = 0;
		this.viewTex = this.colors[ 0 ];

		this.ready = this._loadNoise();
		this._buildModules();
		this._buildKernels();

		// ---- CPU state
		this._w = 0; this._h = 0; this._scale = 1;
		this.sourceWidth = 1; this.sourceHeight = 1; this.historyWidth = 1; this.historyHeight = 1;
		this.frameIndex = 0;
		this.historyValid = false;
		this.weatherDirty = true;
		this.panoWarm = true;
		this._windX = 0; this._windZ = 0; this._evolution = 0; this._elapsed = 0;
		this._prevCam = null;
		this._prevLight = new Vector3();
		this._lastCoverage = - 1;

	}

	// ------------------------------------------------------------ assets

	async _loadNoise() {

		const base = ( import.meta.env && import.meta.env.BASE_URL ) || '/';
		const get = async ( name ) => {

			const r = await fetch( base + 'clouds/' + name );
			if ( ! r.ok ) throw new Error( `clouds: ${ name } HTTP ${ r.status }` );
			return r;

		};

		const [ noiseRes, blueRes ] = await Promise.all( [ get( 'baseShape64.bin' ), get( 'blueNoise.bin' ) ] );
		// gzip'd blob: 16 byte header ('NZZ1', version, channels, dims, mip count) + RGBA8 mips
		const data = new Uint8Array( await new Response( noiseRes.body.pipeThrough( new DecompressionStream( 'gzip' ) ) ).arrayBuffer() );
		const view = new DataView( data.buffer, data.byteOffset, data.byteLength );
		if ( view.getUint32( 0, true ) !== 0x315a5a4e ) throw new Error( 'clouds: bad noise blob' );
		const dims = [ view.getUint16( 6, true ), view.getUint16( 8, true ), view.getUint16( 10, true ) ];
		const mips = view.getUint8( 12 );
		const t = this.noise;
		t.gpu = GPU.device.createTexture( { label: t.label, dimension: '3d', size: dims, mipLevelCount: mips, format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST } );
		t.mipsOption = mips;
		t._views.clear();
		t.version ++;
		let offset = 16;
		for ( let m = 0; m < mips; m ++ ) {

			const d = dims.map( ( x ) => Math.max( 1, x >> m ) );
			const bytes = d[ 0 ] * d[ 1 ] * d[ 2 ] * 4;
			GPU.queue.writeTexture( { texture: t.gpu, mipLevel: m }, data, { offset, bytesPerRow: d[ 0 ] * 4, rowsPerImage: d[ 1 ] }, d );
			offset += bytes;

		}

		this.blue.upload( new Uint8Array( await blueRes.arrayBuffer() ) );

	}

	// ------------------------------------------------------------ modules

	_buildModules() {

		const A = this.atmosphere;
		// the uniforms alone (the weather kernel writes the map the density reads)
		this.uniformModule = new ShaderModule( {
			name: 'skyCloudsUniforms',
			deps: [ commonModule ],
			bindings: { scf: { uniform: this.frameBlock }, scs: { uniform: this.settingsBlock } },
		} );
		this.coreModule = new ShaderModule( {
			name: 'skyCloudsCore',
			deps: [ this.uniformModule ],
			bindings: { scNoise: { texture: this.noise }, scWeatherMap: { texture: this.weatherMap } },
			code: CORE_WGSL,
		} );
		this.marchModule = new ShaderModule( {
			name: 'skyCloudsMarch',
			deps: [ this.coreModule, A.module, A.transmittanceModule ],
			bindings: { scWeatherBounds: { texture: this.weatherBounds } },
			code: MARCH_WGSL,
		} );

		// the sampling side (every consumer of the clouds): small uniform block of its own
		this.params = new UniformBlock( 'CloudsParams', {
			viewRight: [ 'vec3f', new Vector3( 1, 0, 0 ) ],
			viewUp: [ 'vec3f', new Vector3( 0, 1, 0 ) ],
			viewFwd: [ 'vec3f', new Vector3( 0, 0, - 1 ) ],
			viewTan: [ 'vec2f', new Vector2( 1, 1 ) ],
			viewValid: [ 'f32', 0 ],
			shadowCenter: [ 'vec2f', new Vector2() ],
			shadowSize: [ 'f32', 12000 ],
			shadowStrength: [ 'f32', 0.85 ],
		}, { label: 'clouds' } );
		const U = this.params.fields;
		this.viewCam = { right: U.viewRight, up: U.viewUp, fwd: U.viewFwd, tan: U.viewTan };
		this.viewValid = U.viewValid;
		this.shadowCenter = U.shadowCenter;
		this.shadowSize = U.shadowSize;
		this.shadowStrength = U.shadowStrength;

		this.shadowModule = new ShaderModule( {
			name: 'cloudsShadow',
			deps: [ commonModule ],
			uniforms: this.params,
			uniformName: 'cloudsParams',
			bindings: { cloudsShadowMap: { texture: this.shadowMap } },
			code: /* wgsl */`
// cloud shadow transmittance (1 = clear) at a world position. Manual bilinear filtering of an
// unfilterable texture: costs no sampler in the (sampler hungry) scene materials.
fn cloudsShadowTap( i: vec2i ) -> f32 { return textureLoad( cloudsShadowMap, clamp( i, vec2i( 0 ), vec2i( ${ SHADOW_RES - 1 } ) ), 0 ).x; }
// (the last lookup is remembered: the scene lighting hooks ask for the same point several times)
var<private> cloudsShadowMemoXZ: vec2f = vec2f( 3.0e38 );
var<private> cloudsShadowMemo: f32 = 1.0;
fn cloudsShadow( worldXZ: vec2f ) -> f32 {
	if ( all( worldXZ == cloudsShadowMemoXZ ) ) { return cloudsShadowMemo; }
	cloudsShadowMemoXZ = worldXZ;
	cloudsShadowMemo = _cloudsShadow( worldXZ );
	return cloudsShadowMemo;
}
fn _cloudsShadow( worldXZ: vec2f ) -> f32 {
	let uv = ( worldXZ - cloudsParams.shadowCenter ) / cloudsParams.shadowSize + 0.5;
	let st = uv * ${ f( SHADOW_RES ) } - 0.5;
	let i0 = vec2i( floor( st ) );
	let fr = fract( st );
	let s = mix( mix( cloudsShadowTap( i0 ), cloudsShadowTap( i0 + vec2i( 1, 0 ) ), fr.x ), mix( cloudsShadowTap( i0 + vec2i( 0, 1 ) ), cloudsShadowTap( i0 + vec2i( 1, 1 ) ), fr.x ), fr.y );
	let e = abs( uv - 0.5 );
	let inside = smoothstep( 0.5, 0.42, max( e.x, e.y ) );
	return mix( 1.0, s, cloudsParams.shadowStrength * inside );
}
`,
		} );

		this.module = new ShaderModule( {
			name: 'clouds',
			deps: [ commonModule, this.shadowModule ],
			uniforms: this.params,
			uniformName: 'cloudsParams',
			bindings: {
				cloudsPanorama: { texture: this.panorama },
				cloudsView: { texture: () => this.viewTex },
			},
			code: /* wgsl */`
// vec4( rgb in-scattered radiance, a transmittance ) for a view direction (panorama)
fn cloudsSample( dir: vec3f ) -> vec4f {
	let az = atan2( dir.z, dir.x );
	let u = fract( az / ${ f( 2 * Math.PI ) } );
	let elev = - acos( clamp( dir.y, -1.0, 1.0 ) ) + ${ f( Math.PI / 2 ) };
	let t = clamp( ( elev + ${ f( 4 * DEG ) } ) / ${ f( 94 * DEG ) }, 0.0, 1.0 );
	let s = textureSampleLevel( cloudsPanorama, smpLinearRepeat, vec2f( u, sqrt( t ) ), 0.0 );
	let below = smoothstep( -0.07, -0.03, dir.y );
	return vec4f( s.rgb * below, mix( 1.0, s.a, below ) );
}

// Transmittance for the sun's disc behind the clouds. The cloud march stops once less than 0.3 % of
// the light gets through and reports that remainder, which (noisy from frame to frame) let a
// clamped sun disc of 2500x the sky shine and sparkle through thick cloud: below ~0.4 % it is dark.
fn cloudsSunTransmittance( T: f32 ) -> f32 { return T * smoothstep( 0.004, 0.04, T ); }

// The main view's clouds: the temporally reconstructed half resolution history, looked up with the
// camera it was resolved for; outside it (or before any trace) the panorama
fn cloudsSampleView( dir: vec3f ) -> vec4f {
	let x = dot( dir, cloudsParams.viewRight );
	let y = dot( dir, cloudsParams.viewUp );
	let z = dot( dir, cloudsParams.viewFwd );
	let uv = vec2f( x / max( z, 1e-4 ) / cloudsParams.viewTan.x * 0.5 + 0.5, 0.5 - y / max( z, 1e-4 ) / cloudsParams.viewTan.y * 0.5 );
	let inside = cloudsParams.viewValid > 0.5 && z > 0.01 && all( uv >= vec2f( 0.0 ) ) && all( uv <= vec2f( 1.0 ) );
	if ( inside ) {
		let v = max( textureSampleLevel( cloudsView, smpLinearClamp, uv, 0.0 ), vec4f( 0.0 ) );
		let above = smoothstep( -0.05, -0.03, dir.y );
		return vec4f( v.rgb * above, 1.0 - min( v.a, 1.0 ) * above );
	}
	return cloudsSample( dir );
}
`,
		} );

	}

	// ------------------------------------------------------------ kernels

	_buildKernels() {

		const MAIN = '@compute @workgroup_size( WG_X, WG_Y, WG_Z ) fn main( @builtin( global_invocation_id ) id: vec3u )';
		const K = ( label, modules, bindings, code ) => new ComputeKernel( { label, modules, bindings, code, workgroupSize: [ 8, 8, 1 ] } );

		this.weatherKernel = K( 'Cloud Weather', [ this.uniformModule ], { scOut: { storageTexture: this.weatherMap } }, WEATHER_WGSL + /* wgsl */`
${ MAIN } {
	let size = textureDimensions( scOut );
	if ( any( id.xy >= size ) ) { return; }
	let uv = vec2f( id.xy ) / vec2f( size );
	let mass = clamp( ( scFbm( uv, scs.weatherMass ) - 0.5 ) * scs.weatherMass.w + 0.5, 0.0, 1.0 );
	let detail = ( scFbm( uv, scs.weatherDetail ) * 2.0 - 1.0 ) * scs.weatherDetail.w;
	textureStore( scOut, id.xy, vec4f( clamp( mass + detail + scs.weather.x - 0.5, 0.0, 1.0 ), 0.0, 0.0, 1.0 ) );
}` );

		this.boundsKernel = K( 'Cloud Weather Bounds', [ this.coreModule ], { scOut: { storageTexture: this.weatherBounds } }, /* wgsl */`
${ MAIN } {
	let size = textureDimensions( scOut );
	if ( any( id.xy >= size ) ) { return; }
	let sourceSize = vec2i( textureDimensions( scWeatherMap ) );
	let scale = vec2f( sourceSize ) / vec2f( size );
	// both bilinear neighbours at cell boundaries, including the repeat seam
	let lo = vec2i( floor( vec2f( id.xy ) * scale - 0.5 ) );
	let hi = vec2i( ceil( vec2f( id.xy + 1u ) * scale - 0.5 ) );
	var maximum = 0.0;
	for ( var y = lo.y; y <= hi.y; y++ ) {
		for ( var x = lo.x; x <= hi.x; x++ ) {
			let p = ( ( vec2i( x, y ) % sourceSize ) + sourceSize ) % sourceSize;
			maximum = max( maximum, textureLoad( scWeatherMap, p, 0 ).r );
		}
	}
	textureStore( scOut, id.xy, vec4f( min( 1.0, maximum + 1.0 / 255.0 ), 0.0, 0.0, 1.0 ) );
}` );

		// the view: one lattice slot of every block per frame
		this.traceKernel = K( 'Clouds Trace', [ this.marchModule ], {
			scBlue: { texture: this.blue },
			scOutColor: { storageTexture: this.source },
			scOutMeta: { storageTexture: this.sourceMeta },
		}, /* wgsl */`
${ MAIN } {
	let size = textureDimensions( scOutColor );
	if ( any( id.xy >= size ) ) { return; }
	let uv = scSourceUV( vec2f( id.xy ) );
	let dir = scRay( uv );
	let noise = textureLoad( scBlue, vec2i( id.xy % 64u ), 0 ).r;
	let dither = select( 0.5, fract( noise + scf.clock.x * 0.61803398875 ), scf.temporal.x > 0.0 );
	let pixelConeAngle = 2.0 * scf.position.w / scf.viewport.y;
	let stepConeAngle = 2.0 * scf.position.w / scf.viewport.w;
	let m = scMarch( scf.position.xyz, dir, dither, pixelConeAngle, stepConeAngle, u32( scf.march.y ), scf.display.y > 0.0 );
	textureStore( scOutColor, id.xy, vec4f( m.color, m.alpha ) );
	// km depth fits half float; the metadata also records the normalized primary sample cost
	textureStore( scOutMeta, id.xy, vec4f( m.depth * 0.001, 1.0, f32( m.steps ) / scf.march.y, 0.0 ) );
}` );

		// temporal reconstruction (sky-pro temporal.wgsl), ping-pong history
		const cur = () => this.colors[ this._pp ], curM = () => this.metas[ this._pp ];
		const prev = () => this.colors[ 1 - this._pp ], prevM = () => this.metas[ 1 - this._pp ];
		this.temporalKernel = new ComputeKernel( {
			label: 'Clouds Resolve',
			modules: [ this.coreModule ],
			workgroupSize: [ 8, 8, 1 ],
			bindings: {
				scCurrentColor: { texture: this.source },
				scCurrentMeta: { texture: this.sourceMeta },
				scPreviousColor: { texture: prev },
				scPreviousMeta: { texture: prevM },
				scOutputColor: { storageTexture: cur },
				scOutputMeta: { storageTexture: curM },
			},
			code: /* wgsl */`
var<workgroup> scTileColor: array<vec4f, 121>;
var<workgroup> scTileMeta: array<vec4f, 121>;
fn scSourceClamp( p: vec2i ) -> vec2i { return clamp( p, vec2i( 0 ), vec2i( textureDimensions( scCurrentColor ) ) - 1 ); }
fn scTileIndex( p: vec2i, origin: vec2i, width: u32 ) -> u32 {
	let local = vec2u( scSourceClamp( p ) - origin );
	return local.y * width + local.x;
}
fn scHistoryAt( uv: vec2f, size: vec2f ) -> vec4f {
	// five tap Catmull-Rom: detail survives repeated history warps
	let position = uv * size;
	let center = floor( position - 0.5 ) + 0.5;
	let fr = position - center;
	let w0 = fr * ( fr * ( -0.5 * fr + 1.0 ) - 0.5 );
	let w1 = fr * fr * ( 1.5 * fr - 2.5 ) + 1.0;
	let w2 = fr * ( fr * ( -1.5 * fr + 2.0 ) + 0.5 );
	let w3 = fr * fr * ( 0.5 * fr - 0.5 );
	let w12 = w1 + w2;
	let uv0 = ( center - 1.0 ) / size;
	let uv3 = ( center + 2.0 ) / size;
	let uv12 = ( center + w2 / w12 ) / size;
	let weights = vec4f( w12.x * w0.y, w0.x * w12.y, w12.x * w12.y, w3.x * w12.y );
	let bottomWeight = w12.x * w3.y;
	let value = textureSampleLevel( scPreviousColor, smpLinearClamp, vec2f( uv12.x, uv0.y ), 0.0 ) * weights.x
		+ textureSampleLevel( scPreviousColor, smpLinearClamp, vec2f( uv0.x, uv12.y ), 0.0 ) * weights.y
		+ textureSampleLevel( scPreviousColor, smpLinearClamp, uv12, 0.0 ) * weights.z
		+ textureSampleLevel( scPreviousColor, smpLinearClamp, vec2f( uv3.x, uv12.y ), 0.0 ) * weights.w
		+ textureSampleLevel( scPreviousColor, smpLinearClamp, vec2f( uv12.x, uv3.y ), 0.0 ) * bottomWeight;
	return value / ( dot( weights, vec4f( 1.0 ) ) + bottomWeight );
}
fn scFreshHistoryWeight( color: vec4f, depth: f32 ) -> f32 {
	let retain = select( mix( 0.25, 0.65, smoothstep( 8.0, 30.0, depth ) ), 0.25, color.a < 0.0001 );
	return min( scf.temporal.x, retain ) * ( 1.0 - scf.temporal.y );
}
fn scResolve( pixel: vec2u, color: vec4f, depth: f32, carriedDepth: f32, cost: f32, weight: f32 ) {
	textureStore( scOutputColor, pixel, vec4f( max( color.rgb, vec3f( 0.0 ) ), clamp( color.a, 0.0, 1.0 ) ) );
	textureStore( scOutputMeta, pixel, vec4f( depth, carriedDepth, cost, weight ) );
}
@compute @workgroup_size( WG_X, WG_Y, WG_Z )
fn main( @builtin( global_invocation_id ) id: vec3u, @builtin( local_invocation_index ) thread: u32, @builtin( workgroup_id ) group: vec3u ) {
	let size = textureDimensions( scOutputColor );
	let tileWidth = u32( ceil( 8.0 / scf.sampling.z ) ) + 3u;
	let tileOrigin = vec2i( floor( ( vec2f( group.xy * 8u ) - scf.sampling.xy ) / scf.sampling.z ) ) - 1;
	for ( var index = thread; index < tileWidth * tileWidth; index += 64u ) {
		let p = scSourceClamp( tileOrigin + vec2i( i32( index % tileWidth ), i32( index / tileWidth ) ) );
		scTileColor[ index ] = textureLoad( scCurrentColor, p, 0 );
		scTileMeta[ index ] = textureLoad( scCurrentMeta, p, 0 );
	}
	workgroupBarrier();
	if ( any( id.xy >= size ) ) { return; }
	let uv = ( vec2f( id.xy ) + 0.5 ) / vec2f( size );
	let lattice = u32( scf.sampling.z );
	let fresh = all( id.xy % lattice == vec2u( scf.sampling.xy ) );
	let source = ( vec2f( id.xy ) - scf.sampling.xy ) / scf.sampling.z;
	let center = scSourceClamp( vec2i( round( source ) ) );
	let metadata = scTileMeta[ scTileIndex( center, tileOrigin, tileWidth ) ];
	let central = scTileColor[ scTileIndex( center, tileOrigin, tileWidth ) ];
	let currentDepth = max( metadata.x, 0.001 );
	let stored = textureLoad( scPreviousMeta, vec2i( id.xy ), 0 );
	let historyValid = scf.sampling.w > 0.5 && scf.temporal.x > 0.0;

	// a still view: untouched slots keep their colour and depth exactly
	if ( scf.temporal.z > 0.5 && historyValid && stored.y >= 0.001 ) {
		let history = textureLoad( scPreviousColor, vec2i( id.xy ), 0 );
		if ( fresh ) {
			let weight = scFreshHistoryWeight( central, currentDepth );
			scResolve( id.xy, mix( central, history, weight ), currentDepth, currentDepth, metadata.z, weight );
		} else {
			scResolve( id.xy, history, stored.x, stored.y, stored.z, 1.0 );
		}
		return;
	}

	var color = vec4f( 0.0 ); var weightSum = 0.0;
	let base = vec2i( floor( source ) ); let fraction = fract( source );
	for ( var y = 0; y < 2; y++ ) {
		for ( var x = 0; x < 2; x++ ) {
			let pos = scSourceClamp( base + vec2i( x, y ) );
			let index = scTileIndex( pos, tileOrigin, tileWidth );
			let tap = scTileColor[ index ]; let depth = scTileMeta[ index ].x;
			let bilinear = select( 1.0 - fraction.x, fraction.x, x == 1 ) * select( 1.0 - fraction.y, fraction.y, y == 1 );
			let weight = bilinear * exp( -abs( depth - metadata.x ) / max( 0.1, metadata.x * 0.1 ) - abs( tap.a - central.a ) * 4.0 );
			color += tap * weight; weightSum += weight;
		}
	}
	color = select( central, color / max( weightSum, 0.00001 ), weightSum > 0.00001 );
	if ( fresh ) { color = central; }
	if ( ! historyValid ) {
		scResolve( id.xy, color, currentDepth, currentDepth, metadata.z, 0.0 );
		return;
	}

	var low = color; var high = color;
	var reprojectionDepth = select( SC_FAR * 0.001, stored.y, stored.y >= 0.001 );
	for ( var y = -1; y <= 1; y++ ) {
		for ( var x = -1; x <= 1; x++ ) {
			let tap = scTileColor[ scTileIndex( center + vec2i( x, y ), tileOrigin, tileWidth ) ];
			low = min( low, tap ); high = max( high, tap );
			let neighbor = clamp( vec2i( id.xy ) + vec2i( x, y ), vec2i( 0 ), vec2i( size ) - 1 );
			let depth = textureLoad( scPreviousMeta, neighbor, 0 ).y;
			if ( depth >= 0.001 ) { reprojectionDepth = min( reprojectionDepth, depth ); }
		}
	}
	if ( stored.y < 0.001 ) { reprojectionDepth = min( reprojectionDepth, currentDepth ); }
	var world = scf.position.xyz + scRay( uv ) * ( reprojectionDepth * 1000.0 );
	world -= vec3f( scf.windDelta.x, 0.0, scf.windDelta.y );
	let previous = scProjectPrevious( world );
	let previousPixel = clamp( vec2i( previous.xy * vec2f( size ) ), vec2i( 0 ), vec2i( size ) - 1 );
	let oldMeta = textureLoad( scPreviousMeta, previousPixel, 0 );
	let valid = previous.z > 0.0 && all( previous.xy >= vec2f( 0.0 ) ) && all( previous.xy <= vec2f( 1.0 ) ) && oldMeta.y >= 0.001;
	var carriedDepth = currentDepth; var historyFraction = 0.0;
	if ( valid ) {
		let history = clamp( scHistoryAt( previous.xy, vec2f( size ) ), low, high );
		let motionPixels = length( ( previous.xy - uv ) * vec2f( size ) );
		historyFraction = select( 1.0, scFreshHistoryWeight( central, currentDepth ), fresh );
		color = mix( color, history, historyFraction );
		let expectedDepth = length( world - scf.previousPosition.xyz ) * 0.001;
		if ( ! fresh && ( motionPixels <= 0.5 || abs( oldMeta.y - expectedDepth ) < max( 0.001, expectedDepth * 0.15 ) ) ) {
			carriedDepth = oldMeta.y;
		}
	}
	scResolve( id.xy, color, currentDepth, carriedDepth, metadata.z, historyFraction );
}`,
		} );

		// panorama (reflections, environment, Snell's window): one lattice slot per frame, all after a reset
		this.panoKernel = K( 'Clouds Panorama', [ this.marchModule ], { scPano: { storageTexture: this.panorama } }, /* wgsl */`
${ MAIN } {
	let size = textureDimensions( scPano );
	let texel = id.xy * u32( scf.pano.z ) + vec2u( scf.pano.xy );
	if ( any( texel >= size ) ) { return; }
	let uv = ( vec2f( texel ) + 0.5 ) / vec2f( size );
	let elev = uv.y * uv.y * ${ f( 94 * DEG ) } - ${ f( 4 * DEG ) };
	let az = uv.x * ${ f( 2 * Math.PI ) };
	let dir = vec3f( cos( elev ) * cos( az ), sin( elev ), cos( elev ) * sin( az ) );
	let cone = ${ f( 2 * Math.PI / PANO_W ) };
	let m = scMarch( scf.position.xyz, dir, 0.5, cone, cone, 128u, true );
	textureStore( scPano, texel, vec4f( m.color, 1.0 - m.alpha ) );
}` );

		// cloud shadow on the ground (sea level) around the camera: optical depth along the key light
		this.shadowKernel = K( 'Clouds Shadow', [ this.marchModule ], { scShadow: { storageTexture: this.shadowMap } }, /* wgsl */`
${ MAIN } {
	let size = textureDimensions( scShadow );
	// a quarter of the rows per frame (w = phase), or all of them (w < 0)
	let full = scf.shadow.w < 0.0;
	let texel = select( vec2u( id.x, id.y * 4u + u32( max( scf.shadow.w, 0.0 ) ) ), id.xy, full );
	if ( any( texel >= size ) ) { return; }
	let xz = scf.shadow.xy + ( ( vec2f( texel ) + 0.5 ) / vec2f( size ) - 0.5 ) * scf.shadow.z;
	let L = frame.sunDir;
	let ly = max( L.y, 0.08 );
	let t0 = scs.shell.x / ly;
	let t1 = ( scs.shell.x + scs.shell.y ) / ly;
	let n = 16;
	let dt = ( t1 - t0 ) / f32( n );
	var tau = 0.0;
	for ( var i = 0; i < n; i++ ) {
		let t = t0 + ( f32( i ) + 0.5 ) * dt;
		let p = vec3f( xz.x, 0.0, xz.y ) + vec3f( L.x, ly, L.z ) * t;
		tau += scLightDensity( p, scs.shell.w, vec2f( 2.0, 2.0 ), false ) * scs.shell.z * dt;
		if ( tau > 12.0 ) { break; }
	}
	// multiple scattering lets some light through even thick cloud (as the view's octaves do)
	let T = exp( -tau ) * 0.8 + exp( -tau * 0.25 ) * 0.2;
	textureStore( scShadow, texel, vec4f( T, 0.0, 0.0, 1.0 ) );
}` );

	}

	// ------------------------------------------------------------ frame

	_drawingBufferSize() {

		if ( this.outputSize ) return this.outputSize;
		const o = FrameUniforms.fields.outputResolution.value;
		if ( o && o.x > 0 ) return o;
		const c = GPU.canvas;
		return { x: c ? c.width : 1280, y: c ? c.height : 720 };

	}

	_allocate( w, h ) {

		const q = QUALITY;
		const scale = this.resolutionScale;
		this.sourceWidth = Math.max( 1, Math.ceil( w * scale / q.historyDivisor / q.lattice ) );
		this.sourceHeight = Math.max( 1, Math.ceil( h * scale / q.historyDivisor / q.lattice ) );
		this.historyWidth = this.sourceWidth * q.lattice;
		this.historyHeight = this.sourceHeight * q.lattice;
		this.source.resize( this.sourceWidth, this.sourceHeight );
		this.sourceMeta.resize( this.sourceWidth, this.sourceHeight );
		for ( const t of [ ...this.colors, ...this.metas ] ) t.resize( this.historyWidth, this.historyHeight );
		this.historyValid = false;

	}

	update( dt, camera ) {

		const q = QUALITY, P = PRESET, F = this.F, S = this.S;
		dt = Math.min( 0.1, Math.max( 0, dt ) );

		// ---- output size
		const size = this._drawingBufferSize();
		if ( size.x !== this._w || size.y !== this._h || this.resolutionScale !== this._scale ) {

			this._w = size.x; this._h = size.y; this._scale = this.resolutionScale;
			this._allocate( size.x, size.y );

		}

		// ---- settings: coverage, wind direction
		const cov = this.coverage.value;
		if ( cov !== this._lastCoverage ) {

			S.shell.value[ 3 ] = cov;
			this._lastCoverage = cov;
			this.historyValid = false;
			this.panoWarm = true;

		}

		const wd = G.windDir.value;
		const wl = Math.hypot( wd.x, wd.y ) || 1;
		const wx = wd.x / wl, wz = wd.y / wl;
		S.wind.value[ 0 ] = wx; S.wind.value[ 1 ] = wz;

		if ( this.weatherDirty ) {

			const W = this.weatherMap.width;
			this.weatherKernel.dispatch( [ W / 8, W / 8, 1 ] );
			this.boundsKernel.dispatch( [ 8, 8, 1 ] );
			this.weatherDirty = false;

		}

		// ---- camera
		camera.updateMatrixWorld();
		const e = camera.matrixWorld.elements;
		const cp = camera.position;
		const tanY = Math.tan( MathUtils.degToRad( camera.fov * 0.5 ) ) / ( camera.zoom || 1 );
		const aspect = camera.aspect;
		const right = [ e[ 0 ], e[ 1 ], e[ 2 ] ], up = [ e[ 4 ], e[ 5 ], e[ 6 ] ], fwd = [ - e[ 8 ], - e[ 9 ], - e[ 10 ] ];
		const nrm = ( v ) => {

			const l = Math.hypot( v[ 0 ], v[ 1 ], v[ 2 ] ) || 1;
			return [ v[ 0 ] / l, v[ 1 ] / l, v[ 2 ] / l ];

		};

		const R = nrm( right ), Up = nrm( up ), Fw = nrm( fwd );
		const cur = { position: [ cp.x, cp.y, cp.z, tanY ], right: [ ...R, aspect ], up: [ ...Up, 0 ], forward: [ ...Fw, 0 ] };
		const prev = this._prevCam;
		// camera cuts: teleports, big turns, zoom
		if ( ! prev
			|| Math.hypot( cp.x - prev.position[ 0 ], cp.y - prev.position[ 1 ], cp.z - prev.position[ 2 ] ) > 1000
			|| Fw[ 0 ] * prev.forward[ 0 ] + Fw[ 1 ] * prev.forward[ 1 ] + Fw[ 2 ] * prev.forward[ 2 ] < 0.7
			|| Math.abs( tanY - prev.position[ 3 ] ) > 0.01 ) this.historyValid = false;
		const L = G.sunDir.value;
		if ( L.dot( this._prevLight ) < 0.999 ) {

			this.historyValid = false;
			this.panoWarm = true;

		}

		this._prevLight.copy( L );
		const src = this.historyValid && prev ? prev : cur;
		F.position.value = cur.position; F.right.value = cur.right; F.up.value = cur.up; F.forward.value = cur.forward;
		F.previousPosition.value = src.position; F.previousRight.value = src.right; F.previousUp.value = src.up; F.previousForward.value = src.forward;
		this._prevCam = cur;

		// ---- sampling lattice (Morton-style permutation over the 4x4 cycle)
		const lat = q.lattice, index = this.frameIndex % ( lat * lat );
		let lx = 0, ly = 0;
		for ( let bit = 0; ( 1 << bit ) < lat; bit ++ ) {

			const pair = ( index >> ( bit * 2 ) ) & 3;
			lx |= ( ( pair >> 1 ) ^ ( pair & 1 ) ) << ( Math.log2( lat ) - bit - 1 );
			ly |= ( pair & 1 ) << ( Math.log2( lat ) - bit - 1 );

		}

		F.viewport.value = [ size.x * this.resolutionScale, size.y * this.resolutionScale, this.historyWidth, this.historyHeight ];
		F.sampling.value = [ lx, ly, lat, this.historyValid ? 1 : 0 ];

		// ---- clock and wind
		this._elapsed += dt;
		const speed = P.wind.speed;
		const dx = wx * speed * dt, dz = wz * speed * dt;
		this._windX += dx; this._windZ += dz; this._evolution += P.wind.evolutionSpeed * dt;
		F.clock.value = [ this.frameIndex % 4096, this._elapsed, dt, 0 ];
		F.wind.value = [ this._windX, this._windZ, this._evolution, 0 ];
		F.windDelta.value = [ dx, dz, 0, 0 ];
		F.march.value = [ q.stepMeters, q.maxSteps, q.lightTaps, q.fullLightingAlpha ];
		F.temporal.value = [ q.historyWeight, Math.min( 1, P.wind.evolutionSpeed * dt / 100 ), 0, 0 ];
		F.display.value = [ 0, q.lightReuseSteps, 0, 0 ];

		// ---- light march taps: a 25 m local segment, then geometric growth to ~2.5 km over a cone
		const lxd = L.x, lyd = L.y, lzd = L.z;
		let tx = lzd, ty = 0, tz = - lxd;
		if ( Math.abs( lyd ) > 0.99 ) {

			tx = 0; ty = - lzd; tz = lyd;

		}

		const inv = 1 / Math.hypot( tx, ty, tz );
		tx *= inv; ty *= inv; tz *= inv;
		const bx = lyd * tz - lzd * ty, by = lzd * tx - lxd * tz, bz = lxd * ty - lyd * tx;
		const off = F.lightOffsets.value, lods = F.lightLods.value;
		off[ 0 ] = 0; off[ 1 ] = 0; off[ 2 ] = 0; off[ 3 ] = 25;
		const sh = P.shape;
		for ( let i = 1; i < 8; i ++ ) {

			const growth = 1.7 ** i, mid = 25 * ( ( growth - 1 ) / 0.7 + growth * 0.5 );
			const angle = i * 2.399963, radius = Math.sqrt( ( i + 0.5 ) / q.lightTaps );
			const u = Math.cos( angle ) * radius * 0.05 * mid, v = Math.sin( angle ) * radius * 0.05 * mid;
			const o = i * 4;
			off[ o ] = lxd * mid + tx * u + bx * v; off[ o + 1 ] = lyd * mid + ty * u + by * v; off[ o + 2 ] = lzd * mid + tz * u + bz * v; off[ o + 3 ] = 25 * growth;
			const footprint = mid * 0.1;
			lods[ o ] = Math.max( 0, Math.log2( footprint * 64 / sh.baseScale ) );
			lods[ o + 1 ] = Math.max( 0, Math.log2( footprint * 64 / ( sh.baseScale * sh.erosionScaleBaseMultiplier ) ) );

		}

		// ---- shadow map: a quarter of the rows per frame around a snapped centre
		const phase = this.frameIndex % 4;
		if ( phase === 0 || ! this._shadowInit ) {

			const cell = this.shadowSize.value / SHADOW_RES * 4;
			this.shadowCenter.value.set( Math.round( cp.x / cell ) * cell, Math.round( cp.z / cell ) * cell );

		}

		F.shadow.value = [ this.shadowCenter.value.x, this.shadowCenter.value.y, this.shadowSize.value, phase ];

		// ---- dispatches
		const underwater = G.cameraUnderwater && G.cameraUnderwater.value > 0.5;
		if ( ! this._shadowInit ) {

			// the whole map once
			F.shadow.value = [ this.shadowCenter.value.x, this.shadowCenter.value.y, this.shadowSize.value, - 1 ];
			this.shadowKernel.dispatch( [ SHADOW_RES / 8, SHADOW_RES / 8, 1 ] );
			this._shadowInit = true;

		} else this.shadowKernel.dispatch( [ SHADOW_RES / 8, SHADOW_RES / 32, 1 ] );

		if ( this.panoWarm ) {

			F.pano.value = [ 0, 0, 1, 0 ];
			this.panoKernel.dispatch( [ PANO_W / 8, PANO_H / 8, 1 ] );
			this.panoWarm = false;

		} else {

			const k = this.frameIndex % ( PANO_LATTICE * PANO_LATTICE );
			F.pano.value = [ k % PANO_LATTICE, Math.floor( k / PANO_LATTICE ), PANO_LATTICE, 0 ];
			this.panoKernel.dispatch( [ Math.ceil( PANO_W / PANO_LATTICE / 8 ), Math.ceil( PANO_H / PANO_LATTICE / 8 ), 1 ] );

		}

		if ( underwater ) {

			// the sky is only seen through Snell's window (panorama)
			this.viewValid.value = 0;
			this.historyValid = false;

		} else {

			this.traceKernel.dispatch( [ Math.ceil( this.sourceWidth / 8 ), Math.ceil( this.sourceHeight / 8 ), 1 ] );
			this.temporalKernel.dispatch( [ Math.ceil( this.historyWidth / 8 ), Math.ceil( this.historyHeight / 8 ), 1 ] );
			this.viewTex = this.colors[ this._pp ];
			this._pp = 1 - this._pp;
			const V = this.viewCam;
			V.right.value.set( R[ 0 ], R[ 1 ], R[ 2 ] );
			V.up.value.set( Up[ 0 ], Up[ 1 ], Up[ 2 ] );
			V.fwd.value.set( Fw[ 0 ], Fw[ 1 ], Fw[ 2 ] );
			V.tan.value.set( tanY * aspect, tanY );
			this.viewValid.value = 1;
			this.historyValid = true;

		}

		this.frameIndex ++;

	}

	resetHistory() {

		this.historyValid = false;

	}

	invalidate() {

		this.panoWarm = true;
		this.resetHistory();

	}

}
