import { ShaderModule, UniformBlock } from '../engine/gpu/Shader.js';
import { ComputeKernel } from '../engine/gpu/Compute.js';
import { Texture, StorageBuffer } from '../engine/gpu/Texture.js';
import { Readback } from '../engine/gpu/Readback.js';
import { commonModule } from '../engine/render/wgsl/common.js';
import { Color, Vector3 } from '../engine/math/index.js';

// Physically based sky (Hillaire 2020, "A Scalable and Production Ready Sky and Atmosphere
// Rendering Technique"). All distances in km inside the atmosphere code.
//
// WGSL module (`atmosphere.module`, prefix `atmosphere`):
//   uniform var atmosphereParams: AtmosphereParams (rayleighScale, mieScale, mieG, ozoneScale, groundAlbedo,
//     viewHeight (km), sunIlluminance, sunDir (the real sun, may be below the horizon))
//   fn atmosphereSkyLuminance( dir: vec3f ) -> vec3f             sky luminance (no sun disk), sky view LUT
//   fn atmosphereSampleTransmittance( rKm: f32, mu: f32 ) -> vec3f transmittance LUT
//   fn atmosphereTransmittanceToSpace( dir: vec3f ) -> vec3f      from the viewer toward dir
//   fn atmosphereRaySphereNearest( ro: vec3f, rd: vec3f, radius: f32 ) -> f32
//   const ATMO_RG / ATMO_RT (km)
// `atmosphere.multiScatModule`: fn atmosphereSampleMultiScat( rKm: f32, cosSun: f32 ) -> vec3f

const RG = 6360.0;
const RT = 6460.0;

export const SUN_ILLUMINANCE = 11.0; // scene units (sun irradiance outside the atmosphere)
export const SUN_ANGULAR_RADIUS = 0.004675 * 1.15;

const T_W = 256, T_H = 64;
const MS_RES = 32;
const SV_W = 192, SV_H = 108;
const LOG_STEP = Math.log( 1.02 );

const f = ( x ) => {

	const s = String( x );
	return s.includes( '.' ) || s.includes( 'e' ) ? s : s + '.0';

};

function makeLUT( w, h, name ) {

	return new Texture( { label: name, width: w, height: h, format: 'rgba16float', usage: [ 'sample', 'storage' ] } );

}

// medium, parameterizations and ray / sphere helpers (no textures: usable by the kernels that write the LUTs)
function coreCode() {

	return /* wgsl */`
const ATMO_RG: f32 = ${ f( RG ) };
const ATMO_RT: f32 = ${ f( RT ) };

struct AtmosphereMedium {
	rayScat: vec3f,
	mieScat: f32,
	extinction: vec3f,
	scattering: vec3f,
};

fn atmosphereMedium( hKm: f32 ) -> AtmosphereMedium {
	let rayDensity = exp( - hKm / 8.0 );
	let mieDensity = exp( - hKm / 1.2 );
	let ozoneDensity = max( 0.0, 1.0 - abs( hKm - 25.0 ) / 15.0 );
	var m: AtmosphereMedium;
	m.rayScat = vec3f( 5.802e-3, 13.558e-3, 33.1e-3 ) * rayDensity * atmosphereParams.rayleighScale;
	m.mieScat = 3.996e-3 * mieDensity * atmosphereParams.mieScale;
	let mieExt = 4.440e-3 * mieDensity * atmosphereParams.mieScale;
	let ozoneAbs = vec3f( 0.650e-3, 1.881e-3, 0.085e-3 ) * ozoneDensity * atmosphereParams.ozoneScale;
	m.extinction = m.rayScat + mieExt + ozoneAbs;
	m.scattering = m.rayScat + m.mieScat;
	return m;
}

// (r, mu) -> transmittance LUT uv
fn atmosphereTransmittanceUV( r: f32, mu: f32 ) -> vec2f {
	let H = sqrt( ATMO_RT * ATMO_RT - ATMO_RG * ATMO_RG );
	let rho = sqrt( max( r * r - ATMO_RG * ATMO_RG, 0.0 ) );
	let disc = r * r * ( mu * mu - 1.0 ) + ATMO_RT * ATMO_RT;
	let d = max( 0.0, - r * mu + sqrt( max( disc, 0.0 ) ) );
	let dMin = ATMO_RT - r;
	let dMax = rho + H;
	let xMu = ( d - dMin ) / ( dMax - dMin );
	let xR = rho / H;
	// unit -> sub-uv
	return vec2f( ( xMu + ${ f( 0.5 / T_W ) } ) * ${ f( T_W / ( T_W + 1 ) ) }, ( xR + ${ f( 0.5 / T_H ) } ) * ${ f( T_H / ( T_H + 1 ) ) } );
}

// nearest positive ray-sphere intersection from ro (km, planet centered), -1 if none
fn atmosphereRaySphereNearest( ro: vec3f, rd: vec3f, radius: f32 ) -> f32 {
	let b = dot( ro, rd );
	let c = dot( ro, ro ) - radius * radius;
	let disc = b * b - c;
	let sq = sqrt( max( disc, 0.0 ) );
	let t0 = - b - sq;
	let t1 = - b + sq;
	return select( select( select( -1.0, t1, t1 > 0.0 ), t0, t0 > 0.0 ), -1.0, disc < 0.0 );
}
`;

}

export class Atmosphere {

	constructor( renderer = null ) {

		this.renderer = renderer;
		this.transmittanceLUT = makeLUT( T_W, T_H, 'atmoTransmittance' );
		this.multiScatLUT = makeLUT( MS_RES, MS_RES, 'atmoMultiScat' );
		this.skyViewLUT = makeLUT( SV_W, SV_H, 'atmoSkyView' );

		this.params = new UniformBlock( 'AtmosphereParams', {
			rayleighScale: [ 'f32', 1 ],
			mieScale: [ 'f32', 1 ],
			mieG: [ 'f32', 0.8 ],
			ozoneScale: [ 'f32', 1 ],
			groundAlbedo: [ 'vec3f', new Color( 0.06, 0.08, 0.1 ) ],
			viewHeight: [ 'f32', RG + 0.002 ], // km
			sunIlluminance: [ 'vec3f', new Color( SUN_ILLUMINANCE, SUN_ILLUMINANCE, SUN_ILLUMINANCE ) ],
			pad0: [ 'f32', 0 ],
			// the real sun (may be below the horizon: twilight, night). G.sunDir is the key light, which
			// becomes the moon at night; the sky itself is always scattered sunlight.
			sunDir: [ 'vec3f', new Vector3( 0.3, 0.6, - 0.7 ).normalize() ],
			pad1: [ 'f32', 0 ],
		}, { label: 'atmosphere' } );
		const U = this.params.fields;
		// three-style { value } handles (same names as the TSL version)
		this.rayleighScale = U.rayleighScale;
		this.mieScale = U.mieScale;
		this.mieG = U.mieG;
		this.ozoneScale = U.ozoneScale;
		this.groundAlbedo = U.groundAlbedo;
		this.viewHeight = U.viewHeight;
		this.sunIlluminance = U.sunIlluminance;
		this.sunDir = U.sunDir;

		// small buffer for sky irradiance readback
		this.irrBuffer = new StorageBuffer( { label: 'atmoIrr', count: 4, type: 'vec4f' } );
		this.readback = new Readback( { byteLength: 48, label: 'atmoIrrReadback' } );
		this.readback.onData = ( buf ) => this._onIrradiance( buf );

		this._buildModules();
		this._build();
		this.needsStatic = true;
		this._irrPending = false;
		this._irrTimer = 0;
		this.skyIrradiance = null;
		this.sunTransmittance = null;
		this.horizon = null;
		this.onIrradiance = null;

	}

	_buildModules() {

		this.coreModule = new ShaderModule( {
			name: 'atmosphereCore',
			deps: [ commonModule ],
			uniforms: this.params,
			uniformName: 'atmosphereParams',
			code: coreCode(),
		} );

		this.transmittanceModule = new ShaderModule( {
			name: 'atmosphereTransmittance',
			deps: [ this.coreModule ],
			bindings: { atmosphereTransmittanceLUT: { texture: this.transmittanceLUT } },
			code: /* wgsl */`
fn atmosphereSampleTransmittance( r: f32, mu: f32 ) -> vec3f {
	return textureSampleLevel( atmosphereTransmittanceLUT, smpLinearClamp, atmosphereTransmittanceUV( r, mu ), 0.0 ).rgb;
}
// Transmittance from the viewer toward direction dir (for sun disk / sun light color).
fn atmosphereTransmittanceToSpace( dir: vec3f ) -> vec3f {
	return atmosphereSampleTransmittance( atmosphereParams.viewHeight, dir.y );
}
`,
		} );

		this.multiScatModule = new ShaderModule( {
			name: 'atmosphereMultiScat',
			deps: [ this.coreModule ],
			bindings: { atmosphereMultiScatLUT: { texture: this.multiScatLUT } },
			code: /* wgsl */`
fn atmosphereSampleMultiScat( r: f32, cosSun: f32 ) -> vec3f {
	let uv = vec2f( cosSun * 0.5 + 0.5, ( r - ATMO_RG ) / ( ATMO_RT - ATMO_RG ) );
	let suv = uv * ${ f( ( MS_RES - 1 ) / MS_RES ) } + ${ f( 0.5 / MS_RES ) };
	return textureSampleLevel( atmosphereMultiScatLUT, smpLinearClamp, suv, 0.0 ).rgb;
}
`,
		} );

		// the public module: sky view LUT lookups + transmittance
		this.module = new ShaderModule( {
			name: 'atmosphere',
			deps: [ this.transmittanceModule ],
			bindings: { atmosphereSkyViewLUT: { texture: this.skyViewLUT } },
			code: /* wgsl */`
// Sky luminance (no sun disk) for world direction dir (normalized).
fn atmosphereSkyLuminance( dir: vec3f ) -> vec3f {
	let viewH = atmosphereParams.viewHeight;
	let vHorizon = sqrt( max( viewH * viewH - ATMO_RG * ATMO_RG, 0.0 ) );
	let beta = acos( vHorizon / viewH );
	let zenithHorizonAngle = PI - beta;
	let viewZenithAngle = acos( clamp( dir.y, -1.0, 1.0 ) );

	let vCoordA = ( 1.0 - sqrt( max( 1.0 - viewZenithAngle / zenithHorizonAngle, 0.0 ) ) ) * 0.5;
	let vCoordB = sqrt( max( ( viewZenithAngle - zenithHorizonAngle ) / beta, 0.0 ) ) * 0.5 + 0.5;
	let v = select( vCoordB, vCoordA, viewZenithAngle < zenithHorizonAngle );

	// azimuth relative to sun
	let sunH = normalize( vec2f( atmosphereParams.sunDir.x, atmosphereParams.sunDir.z ) + vec2f( 1e-5, 0.0 ) );
	let dirH = normalize( vec2f( dir.x, dir.z ) + vec2f( 1e-5, 0.0 ) );
	let lightViewCos = dot( sunH, dirH );
	let u = sqrt( clamp( lightViewCos * -0.5 + 0.5, 0.0, 1.0 ) );

	let suv = vec2f( u * ${ f( ( SV_W - 1 ) / SV_W ) } + ${ f( 0.5 / SV_W ) }, v * ${ f( ( SV_H - 1 ) / SV_H ) } + ${ f( 0.5 / SV_H ) } );
	return textureSampleLevel( atmosphereSkyViewLUT, smpLinearClamp, suv, 0.0 ).rgb;
}
`,
		} );

	}

	// ---------------------------------------------------------------- kernels

	_build() {

		// ----- transmittance LUT
		this.transmittanceKernel = new ComputeKernel( {
			label: 'Atmosphere Transmittance',
			modules: [ this.coreModule ],
			bindings: { outLUT: { storageTexture: this.transmittanceLUT } },
			workgroupSize: [ 8, 8, 1 ],
			code: /* wgsl */`
@compute @workgroup_size( WG_X, WG_Y, WG_Z )
fn main( @builtin( global_invocation_id ) gid: vec3u ) {
	let px = gid.xy;
	let uv = ( vec2f( px ) + 0.5 ) / vec2f( ${ f( T_W ) }, ${ f( T_H ) } );
	let xMu = ( uv.x - ${ f( 0.5 / T_W ) } ) * ${ f( T_W / ( T_W - 1 ) ) };
	let xR = ( uv.y - ${ f( 0.5 / T_H ) } ) * ${ f( T_H / ( T_H - 1 ) ) };
	let H = sqrt( ATMO_RT * ATMO_RT - ATMO_RG * ATMO_RG );
	let rho = xR * H;
	let r = sqrt( rho * rho + ATMO_RG * ATMO_RG );
	let dMin = ATMO_RT - r;
	let dMax = rho + H;
	let d = dMin + xMu * ( dMax - dMin );
	let mu = clamp( select( ( H * H - rho * rho - d * d ) / ( 2.0 * r * d ), 1.0, d == 0.0 ), -1.0, 1.0 );

	let ro = vec3f( 0.0, r, 0.0 );
	let rd = vec3f( sqrt( max( 1.0 - mu * mu, 0.0 ) ), mu, 0.0 );
	let tMax = atmosphereRaySphereNearest( ro, rd, ATMO_RT );
	let steps = 40;
	let dt = tMax / f32( steps );
	var od = vec3f( 0.0 );
	for ( var i = 0; i < steps; i++ ) {
		let t = ( f32( i ) + 0.5 ) * dt;
		let p = ro + rd * t;
		let h = length( p ) - ATMO_RG;
		od += atmosphereMedium( h ).extinction * dt;
	}
	textureStore( outLUT, px, vec4f( exp( - od ), 1.0 ) );
}
`,
		} );

		// ----- multiple scattering LUT
		this.multiScatKernel = new ComputeKernel( {
			label: 'Atmosphere MultiScat',
			modules: [ this.transmittanceModule ],
			bindings: { outLUT: { storageTexture: this.multiScatLUT } },
			workgroupSize: [ 8, 8, 1 ],
			code: /* wgsl */`
@compute @workgroup_size( WG_X, WG_Y, WG_Z )
fn main( @builtin( global_invocation_id ) gid: vec3u ) {
	let px = gid.xy;
	let uv = ( ( vec2f( px ) + 0.5 ) / ${ f( MS_RES ) } - ${ f( 0.5 / MS_RES ) } ) * ${ f( MS_RES / ( MS_RES - 1 ) ) };
	let cosSun = uv.x * 2.0 - 1.0;
	let r = ATMO_RG + clamp( uv.y, 0.001, 0.999 ) * ( ATMO_RT - ATMO_RG );
	let sunDir = normalize( vec3f( 0.0, cosSun, - sqrt( max( 1.0 - cosSun * cosSun, 0.0 ) ) ) );
	let ro = vec3f( 0.0, r, 0.0 );

	var Lsum = vec3f( 0.0 );
	var fmsSum = vec3f( 0.0 );
	const SQ = 8;
	let isoPhase = 1.0 / ( 4.0 * PI );

	for ( var i = 0; i < SQ * SQ; i++ ) {
		let ii = ( f32( i % SQ ) + 0.5 ) / f32( SQ );
		let jj = ( f32( i / SQ ) + 0.5 ) / f32( SQ );
		let theta = ii * 2.0 * PI;
		let phi = acos( 1.0 - jj * 2.0 );
		let rd = vec3f( cos( theta ) * sin( phi ), cos( phi ), sin( theta ) * sin( phi ) );

		let tBottom = atmosphereRaySphereNearest( ro, rd, ATMO_RG );
		let tTop = atmosphereRaySphereNearest( ro, rd, ATMO_RT );
		let hitGround = tBottom > 0.0;
		let tMax = select( tTop, tBottom, hitGround );
		let steps = 20;
		let dt = tMax / f32( steps );
		var throughput = vec3f( 1.0 );
		var L = vec3f( 0.0 );
		var fms = vec3f( 0.0 );

		for ( var s = 0; s < steps; s++ ) {
			let t = ( f32( s ) + 0.3 ) * dt;
			let p = ro + rd * t;
			let pr = length( p );
			let m = atmosphereMedium( pr - ATMO_RG );
			let up = p / pr;
			let cosSunP = dot( up, sunDir );
			let Tsun = atmosphereSampleTransmittance( pr, cosSunP );
			let shadowT = atmosphereRaySphereNearest( p, sunDir, ATMO_RG );
			let earthShadow = select( 1.0, 0.0, shadowT > 0.0 );
			let S = Tsun * earthShadow * m.scattering * isoPhase;
			let Tstep = exp( - m.extinction * dt );
			let ext = max( m.extinction, vec3f( 1e-6 ) );
			L += throughput * ( S - S * Tstep ) / ext;
			fms += throughput * ( m.scattering - m.scattering * Tstep ) / ext;
			throughput *= Tstep;
		}

		if ( hitGround ) {
			let p = ro + rd * tMax;
			let up = normalize( p );
			let cosS = dot( up, sunDir );
			let Tsun = atmosphereSampleTransmittance( ATMO_RG, cosS );
			L += Tsun * throughput * max( cosS, 0.0 ) * atmosphereParams.groundAlbedo / PI;
		}

		Lsum += L * ( 4.0 * PI / f32( SQ * SQ ) );
		fmsSum += fms * ( 4.0 * PI / f32( SQ * SQ ) );
	}

	let Lin = Lsum * isoPhase;
	let fmsAvg = fmsSum * isoPhase;
	let Lms = Lin / ( vec3f( 1.0 ) - fmsAvg );
	textureStore( outLUT, px, vec4f( Lms, 1.0 ) );
}
`,
		} );

		// ----- sky view LUT (per frame)
		this.skyViewKernel = new ComputeKernel( {
			label: 'Atmosphere SkyView',
			modules: [ this.transmittanceModule, this.multiScatModule ],
			bindings: { outLUT: { storageTexture: this.skyViewLUT } },
			workgroupSize: [ 8, 8, 1 ],
			code: /* wgsl */`
@compute @workgroup_size( WG_X, WG_Y, WG_Z )
fn main( @builtin( global_invocation_id ) gid: vec3u ) {
	let px = gid.xy;
	if ( px.x >= ${ SV_W }u || px.y >= ${ SV_H }u ) { return; }
	let uv = ( vec2f( px ) + 0.5 ) / vec2f( ${ f( SV_W ) }, ${ f( SV_H ) } );
	let u = ( uv.x - ${ f( 0.5 / SV_W ) } ) * ${ f( SV_W / ( SV_W - 1 ) ) };
	let v = ( uv.y - ${ f( 0.5 / SV_H ) } ) * ${ f( SV_H / ( SV_H - 1 ) ) };

	let viewH = atmosphereParams.viewHeight;
	let vHorizon = sqrt( max( viewH * viewH - ATMO_RG * ATMO_RG, 0.0 ) );
	let beta = acos( vHorizon / viewH );
	let zenithHorizonAngle = PI - beta;

	var vzA = 0.0;
	if ( v < 0.5 ) {
		var c = v * 2.0;
		c = 1.0 - c;
		c = c * c;
		c = 1.0 - c;
		vzA = zenithHorizonAngle * c;
	} else {
		var c = v * 2.0 - 1.0;
		c = c * c;
		vzA = zenithHorizonAngle + beta * c;
	}

	let cosViewZenith = cos( vzA );
	let sinViewZenith = sin( vzA );
	let cu = u * u;
	let lightViewCos = - ( cu * 2.0 - 1.0 );
	let lightViewSin = sqrt( max( 1.0 - lightViewCos * lightViewCos, 0.0 ) );

	// local frame: up = +y, sun azimuth along +x
	let sunCosZ = atmosphereParams.sunDir.y;
	let sunSinZ = sqrt( max( 1.0 - sunCosZ * sunCosZ, 0.0 ) );
	let sunDir = vec3f( sunSinZ, sunCosZ, 0.0 );
	let rd = vec3f( sinViewZenith * lightViewCos, cosViewZenith, sinViewZenith * lightViewSin );
	let ro = vec3f( 0.0, viewH, 0.0 );

	let tBottom = atmosphereRaySphereNearest( ro, rd, ATMO_RG );
	let tTop = atmosphereRaySphereNearest( ro, rd, ATMO_RT );
	let tMax = select( tTop, tBottom, tBottom > 0.0 );
	let steps = 32;
	let cosTheta = dot( rd, sunDir );
	let rayPhase = ${ f( 3 / ( 16 * Math.PI ) ) } * ( cosTheta * cosTheta + 1.0 );
	let g = atmosphereParams.mieG;
	let g2 = g * g;
	// Cornette-Shanks
	let miePhase = ${ f( 3 / ( 8 * Math.PI ) ) } * ( ( 1.0 - g2 ) * ( cosTheta * cosTheta + 1.0 ) )
		/ ( ( g2 + 2.0 ) * pow( max( g2 + 1.0 - g * cosTheta * 2.0, 1e-4 ), 1.5 ) );

	var throughput = vec3f( 1.0 );
	var L = vec3f( 0.0 );

	for ( var i = 0; i < steps; i++ ) {
		// quadratic step distribution
		let t0 = f32( i ) / f32( steps );
		let t1 = ( f32( i ) + 1.0 ) / f32( steps );
		let ta = t0 * t0 * tMax;
		let tb = t1 * t1 * tMax;
		let t = mix( ta, tb, 0.3 );
		let dt = tb - ta;
		let p = ro + rd * t;
		let pr = length( p );
		let m = atmosphereMedium( pr - ATMO_RG );
		let up = p / pr;
		let cosSunP = dot( up, sunDir );
		let Tsun = atmosphereSampleTransmittance( pr, cosSunP );
		let shadowT = atmosphereRaySphereNearest( p, sunDir, ATMO_RG );
		let earthShadow = select( 1.0, 0.0, shadowT > 0.0 );
		let ms = atmosphereSampleMultiScat( pr, cosSunP );
		let phaseScat = m.rayScat * rayPhase + vec3f( m.mieScat * miePhase );
		let S = Tsun * earthShadow * phaseScat + ms * m.scattering;
		let Tstep = exp( - m.extinction * dt );
		let ext = max( m.extinction, vec3f( 1e-6 ) );
		L += throughput * ( S - S * Tstep ) / ext;
		throughput *= Tstep;
	}

	textureStore( outLUT, px, vec4f( L * atmosphereParams.sunIlluminance, 1.0 ) );
}
`,
		} );

		// ----- sky irradiance (cosine weighted hemisphere integral of sky view LUT)
		this.irradianceKernel = new ComputeKernel( {
			label: 'Atmosphere Irradiance',
			modules: [ this.module ],
			bindings: { irr: { storage: this.irrBuffer, access: 'read_write' } },
			workgroupSize: [ 1, 1, 1 ],
			code: /* wgsl */`
@compute @workgroup_size( 1 )
fn main() {
	var sum = vec3f( 0.0 );
	const N = 16;
	for ( var i = 0; i < N * N; i++ ) {
		let a = ( f32( i % N ) + 0.5 ) / f32( N );
		let b = ( f32( i / N ) + 0.5 ) / f32( N );
		// cosine-weighted hemisphere
		let r = sqrt( b );
		let phi = a * 2.0 * PI;
		let dir = vec3f( r * cos( phi ), sqrt( max( 1.0 - b, 0.0 ) ), r * sin( phi ) );
		sum += atmosphereSkyLuminance( dir );
	}
	// E = PI * mean(L) for cosine-weighted samples; store E/PI (radiance-equivalent irradiance)
	irr[ 0 ] = vec4f( sum / f32( N * N ), 1.0 );
	// sun transmittance at sea level for the current sun direction
	let Ts = atmosphereSampleTransmittance( ATMO_RG + 0.001, atmosphereParams.sunDir.y );
	irr[ 1 ] = vec4f( Ts, 1.0 );
	// horizon color (average around the horizon)
	var hs = vec3f( 0.0 );
	for ( var i = 0; i < 16; i++ ) {
		let phi = f32( i ) * ( 2.0 * PI / 16.0 );
		hs += atmosphereSkyLuminance( normalize( vec3f( cos( phi ), 0.03, sin( phi ) ) ) );
	}
	irr[ 2 ] = vec4f( hs / 16.0, 1.0 );
}
`,
		} );

	}

	// ---------------------------------------------------------------- update

	update( dt, cameraY ) {

		// camera height quantized (2 m near the sea, 2 % higher up): the sky view LUT is rebuilt only
		// when a parameter changes, not every frame the camera bobs
		const y = Math.max( 0.5, cameraY + 0.5 );
		const yq = y < 100 ? Math.round( y / 2 ) * 2 : Math.exp( Math.round( Math.log( y ) / LOG_STEP ) * LOG_STEP );
		this.viewHeight.value = RG + Math.max( 0.001, yq / 1000 );

		let dirty = false;
		if ( this.needsStatic ) {

			this.needsStatic = false;
			dirty = true;
			this.transmittanceKernel.dispatch( [ T_W / 8, T_H / 8, 1 ] );
			this.multiScatKernel.dispatch( [ MS_RES / 8, MS_RES / 8, 1 ] );

		}

		// sky view LUT: only when the parameters (sun, height, scattering) changed
		this.params._pack();
		const cur = this.params.u32;
		const last = this._svLast || ( this._svLast = new Uint32Array( cur.length ) );
		for ( let i = 0; i < cur.length && ! dirty; i ++ ) dirty = cur[ i ] !== last[ i ];
		if ( dirty || ! this._svValid ) {

			last.set( cur );
			this._svValid = true;
			this.skyViewKernel.dispatch( [ SV_W / 8, Math.ceil( SV_H / 8 ), 1 ] );

		}

		// periodically integrate irradiance and read it back for CPU-side uniforms/lights
		this._irrTimer -= dt;
		if ( this._irrTimer <= 0 && ! this._irrPending ) {

			this._irrTimer = 0.25;
			this.irradianceKernel.dispatch( 1 );
			if ( this.readback.request( this.irrBuffer ) ) this._irrPending = true;

		}

	}

	_onIrradiance( buf ) {

		const f = new Float32Array( buf );
		this.skyIrradiance = [ f[ 0 ], f[ 1 ], f[ 2 ] ];
		this.sunTransmittance = [ f[ 4 ], f[ 5 ], f[ 6 ] ];
		this.horizon = [ f[ 8 ], f[ 9 ], f[ 10 ] ];
		this._irrPending = false;
		if ( this.onIrradiance ) this.onIrradiance( this );

	}

	invalidate() {

		this.needsStatic = true;
		this._svValid = false;

	}

}
