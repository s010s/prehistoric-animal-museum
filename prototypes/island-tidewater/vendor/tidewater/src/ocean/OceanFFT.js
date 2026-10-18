import { Vector4, MathUtils } from '../engine/index.js';
import { GPU, UniformBlock, Texture, StorageBuffer, ShaderModule, ComputeKernel, GRAVITY } from '../engine/webgpu.js';
import { commonModule } from '../engine/render/wgsl/common.js';

// Multi-cascade FFT ocean (Tessendorf) with a Horvath/JONSWAP spectrum.
//
// Each frame runs exactly two compute dispatches for all cascades:
//   1. row pass: time-evolves the spectrum (h0 -> h(k,t)), builds 4 packed complex
//      fields and performs a 256-point radix-2 IFFT per row in workgroup memory.
//   2. column pass: IFFT per column, sign correction, Jacobian based foam
//      accumulation, and writes displacement / derivative array textures.
//
// Packed complex fields (two real fields per complex IFFT):
//   c0 = Dx  + i Dz        c1 = Dy   + i dDx/dz
//   c2 = dDy/dx + i dDy/dz c3 = dDx/dx + i dDz/dz
//
// WGSL module (`fft.module`, prefix `ocean`):
//   bindings  oceanDisplacement: texture_2d_array<f32>  (Dx, Dy, Dz, foam) per cascade layer, mipmapped
//             oceanDerivatives:  texture_2d_array<f32>  (dDy/dx, dDy/dz, dDx/dx, dDz/dz)
//   uniforms  ocean: OceanParams — sizes[ c ].x (cascade tile size, m), cuts[ c ].xy (spectrum band),
//             choppiness, foamBias, foamGain, foamDecay, foamAdd, time, depth, seed, sysA[ 2 ], sysB[ 2 ]
//   const     OCEAN_CASCADES: i32, OCEAN_FFT_SIZE: f32
//   fn oceanSampleDisplacement( xz: vec2f, level: f32 ) -> vec3f   sum of all cascades (explicit lod)
//   fn oceanSampleDisplacementWeighted( xz: vec2f, level: f32, w: vec4f ) -> vec3f   per-cascade weights

export const FFT_SIZE = 256;
const N = FFT_SIZE;
const LOG2N = 8;
const HALF = N / 2;

// Non-integer ratios between cascade sizes avoid visible repetition.
export const DEFAULT_CASCADE_SIZES = [ 733, 157, 33.3, 7.1 ];

const TWO_PI = Math.PI * 2;

export class WaveSystem {

	constructor( o = {} ) {

		this.scale = o.scale ?? 1;
		this.windSpeed = o.windSpeed ?? 8; // m/s
		this.windDirection = o.windDirection ?? 20; // degrees
		this.fetch = o.fetch ?? 200; // km
		this.spreadBlend = o.spreadBlend ?? 0.9;
		this.swell = o.swell ?? 0.2;
		this.peakEnhancement = o.peakEnhancement ?? 3.3;
		this.shortWavesFade = o.shortWavesFade ?? 0.01;

	}

}

// WGSL shared by the kernels: PCG hash, complex helpers
const FFT_COMMON = /* wgsl */`
const FFT_N: u32 = ${ N }u;
const FFT_HALF: u32 = ${ HALF }u;
const FFT_G: f32 = ${ GRAVITY };

fn fftBitReverse8( v: u32 ) -> u32 {
	var r = v;
	r = ( ( r & 0x55u ) << 1u ) | ( ( r >> 1u ) & 0x55u );
	r = ( ( r & 0x33u ) << 2u ) | ( ( r >> 2u ) & 0x33u );
	r = ( ( r & 0x0Fu ) << 4u ) | ( ( r >> 4u ) & 0x0Fu );
	return r;
}

// complex multiply of two packed complex numbers (v.xy, v.zw) by scalar complex w
fn fftCmul2( v: vec4f, w: vec2f ) -> vec4f {
	return vec4f( v.x * w.x - v.y * w.y, v.x * w.y + v.y * w.x, v.z * w.x - v.w * w.y, v.z * w.y + v.w * w.x );
}

// PCG hash
fn fftPcg( v: u32 ) -> u32 {
	let state = v * 747796405u + 2891336453u;
	let word = ( ( state >> ( ( state >> 28u ) + 4u ) ) ^ state ) * 277803737u;
	return ( word >> 22u ) ^ word;
}
fn fftToUnit( h: u32 ) -> f32 { return f32( h >> 8u ) * ( 1.0 / 16777216.0 ) + ( 0.5 / 16777216.0 ); }
`;

export class OceanFFT {

	constructor( renderer, options = {} ) {

		this.renderer = renderer;
		this.cascades = options.cascades ?? 4;
		this.sizes = ( options.sizes ?? DEFAULT_CASCADE_SIZES ).slice( 0, this.cascades );
		this.depth = options.depth ?? 500;

		this.local = new WaveSystem( options.local ?? { windSpeed: 7, windDirection: 25, fetch: 120, spreadBlend: 0.85, swell: 0.05 } );
		this.swell = new WaveSystem( options.swell ?? { scale: 0.48, windSpeed: 6, windDirection: 5, fetch: 1200, spreadBlend: 1.0, swell: 0.9, shortWavesFade: 0.1 } );

		const C = this.cascades;
		this.params = new UniformBlock( 'OceanParams', {
			// per cascade: x = tile size (m)
			sizes: [ 'vec4f[4]', [ 0, 1, 2, 3 ].map( ( i ) => new Vector4( this.sizes[ i ] ?? 1, 0, 0, 0 ) ) ],
			// per cascade: x = low wavenumber cut, y = high cut
			cuts: [ 'vec4f[4]', [ 0, 1, 2, 3 ].map( () => new Vector4() ) ],
			// per system: [scale, angle, spreadBlend, swell] [alpha, peakOmega, gamma, shortWavesFade]
			sysA: [ 'vec4f[2]', [ new Vector4(), new Vector4() ] ],
			sysB: [ 'vec4f[2]', [ new Vector4(), new Vector4() ] ],
			choppiness: [ 'f32', options.choppiness ?? 0.9 ],
			// foam starts where a cascade compresses the surface below this Jacobian (per-cascade J
			// stays close to 1: 0.85 gives ~0.3% whitecap cover at 7 m/s, 0.9 several % in fresh wind)
			foamBias: [ 'f32', 0.58 ],
			foamGain: [ 'f32', 3.0 ],
			foamDecay: [ 'f32', 0.35 ],
			foamAdd: [ 'f32', 2.5 ],
			time: [ 'f32', 0 ],
			depth: [ 'f32', this.depth ],
			seed: [ 'u32', 1337 ],
		}, { label: 'ocean' } );
		const F = this.params.fields;
		// three-style { value } handles (same names as the TSL version)
		this.choppiness = F.choppiness;
		this.foamBias = F.foamBias;
		this.foamGain = F.foamGain;
		this.foamDecay = F.foamDecay;
		this.foamAdd = F.foamAdd;
		this.time = F.time;
		this.uDepth = F.depth;
		this.uSeed = F.seed;
		this.timeScale = 1;

		const total = N * N * C;

		this.h0 = new StorageBuffer( { label: 'fftH0', count: total, type: 'vec4f' } );
		this.waveData = new StorageBuffer( { label: 'fftWave', count: total, type: 'vec4f' } );
		this.tmp = new StorageBuffer( { label: 'fftTmp', count: total * 2, type: 'vec4f' } );
		this.foam = new StorageBuffer( { label: 'fftFoam', count: total, type: 'f32' } );
		// level 0 of both textures (interleaved) for the compute mip chain, and the 8x8 level 5
		this.mipSrc = new StorageBuffer( { label: 'fftMipSrc', count: total * 2, type: 'vec4f' } );
		this.mipMid = new StorageBuffer( { label: 'fftMipMid', count: 64 * C * 2, type: 'vec4f' } );

		const makeTex = ( name ) => new Texture( {
			label: name, width: N, height: N, depth: C, dimension: '2d-array', format: 'rgba16float',
			// allocate the full chain; filled by the compute mip kernels (sampled repeat + trilinear)
			mips: true, usage: [ 'sample', 'storage', 'copyDst', 'copySrc' ], sampler: 'linearRepeat',
		} );

		this.displacementTexture = makeTex( 'oceanDisplacement' ); // (Dx, Dy, Dz, foam)
		this.derivativeTexture = makeTex( 'oceanDerivatives' ); // (dDy/dx, dDy/dz, dDx/dx, dDz/dz)

		this.module = new ShaderModule( {
			name: 'ocean',
			deps: [ commonModule ],
			uniforms: this.params,
			uniformName: 'ocean',
			bindings: {
				oceanDisplacement: { texture: this.displacementTexture, viewDimension: '2d-array' },
				oceanDerivatives: { texture: this.derivativeTexture, viewDimension: '2d-array' },
			},
			code: /* wgsl */`
const OCEAN_CASCADES: i32 = ${ C };
const OCEAN_FFT_SIZE: f32 = ${ N }.0;

// Sample all cascades' displacement at world xz (explicit mip level).
fn oceanSampleDisplacement( xz: vec2f, level: f32 ) -> vec3f {
	var sum = vec3f( 0.0 );
	for ( var c = 0; c < OCEAN_CASCADES; c++ ) {
		sum += textureSampleLevel( oceanDisplacement, smpLinearRepeat, xz / ocean.sizes[ c ].x, c, level ).xyz;
	}
	return sum;
}

// ... with a weight per cascade
fn oceanSampleDisplacementWeighted( xz: vec2f, level: f32, w: vec4f ) -> vec3f {
	var sum = vec3f( 0.0 );
	for ( var c = 0; c < OCEAN_CASCADES; c++ ) {
		sum += textureSampleLevel( oceanDisplacement, smpLinearRepeat, xz / ocean.sizes[ c ].x, c, level ).xyz * w[ c ];
	}
	return sum;
}
`,
		} );

		this._buildKernels();
		this.updateSpectrumUniforms();
		this.needsSpectrum = true;

	}

	// the per-cascade tile sizes (three version: uniformArray; `.array` kept for callers)
	get uSizes() {

		return { array: this.sizes };

	}

	setCascadeSizes( sizes ) {

		this.sizes = sizes.slice( 0, this.cascades );
		this.updateSpectrumUniforms();

	}

	updateSpectrumUniforms() {

		const C = this.cascades;
		const P = this.params.fields;

		for ( let i = 0; i < C; i ++ ) {

			const low = i === 0 ? 0.0001 : ( TWO_PI / this.sizes[ i ] ) * 6;
			const high = i === C - 1 ? 9999 : ( TWO_PI / this.sizes[ i + 1 ] ) * 6;
			P.cuts.value[ i ].set( low, high, 0, 0 );
			P.sizes.value[ i ].set( this.sizes[ i ], 0, 0, 0 );

		}

		P.depth.value = this.depth;

		const sys = [ this.local, this.swell ];

		for ( let i = 0; i < 2; i ++ ) {

			const s = sys[ i ];
			const fetchM = Math.max( 1, s.fetch ) * 1000;
			const U = Math.max( 0.1, s.windSpeed );
			const alpha = 0.076 * Math.pow( GRAVITY * fetchM / ( U * U ), - 0.22 );
			const peakOmega = 22 * Math.pow( U * fetchM / ( GRAVITY * GRAVITY ), - 0.33 );
			P.sysA.value[ i ].set( s.scale, MathUtils.degToRad( s.windDirection ), s.spreadBlend, s.swell );
			P.sysB.value[ i ].set( alpha, peakOmega, s.peakEnhancement, s.shortWavesFade );

		}

		this.params.set( 'cuts', P.cuts.value );
		this.params.set( 'sizes', P.sizes.value );
		this.params.set( 'sysA', P.sysA.value );
		this.params.set( 'sysB', P.sysB.value );
		this.needsSpectrum = true;

	}

	_buildKernels() {

		const C = this.cascades;
		const oceanU = { ocean: { uniform: this.params } };
		const rw = ( b ) => ( { storage: b, access: 'read_write' } );

		// ---------- spectrum helpers ----------

		const SPECTRUM = /* wgsl */`
fn dispersion( k: f32 ) -> f32 { return sqrt( k * FFT_G * tanh( min( k * ocean.depth, 20.0 ) ) ); }

fn dispersionDerivative( k: f32 ) -> f32 {
	let kd = min( k * ocean.depth, 20.0 );
	let th = tanh( kd );
	let ch = cosh( kd );
	return FFT_G * ( ocean.depth * k / ( ch * ch ) + th ) / dispersion( k ) * 0.5;
}

fn tmaCorrection( omega: f32 ) -> f32 {
	let omegaH = omega * sqrt( ocean.depth / FFT_G );
	let a = omegaH * omegaH * 0.5;
	let b = 1.0 - pow( 2.0 - omegaH, 2.0 ) * 0.5;
	return select( select( 1.0, b, omegaH < 2.0 ), a, omegaH <= 1.0 );
}

fn jonswap( omega: f32, sysA: vec4f, sysB: vec4f ) -> f32 {
	let alpha = sysB.x; let peakOmega = sysB.y; let gamma = sysB.z;
	let sigma = select( 0.09, 0.07, omega <= peakOmega );
	let d = omega - peakOmega;
	let r = exp( - d * d / ( sigma * sigma * peakOmega * peakOmega * 2.0 ) );
	let inv = 1.0 / omega;
	let po = peakOmega * inv;
	return sysA.x * tmaCorrection( omega ) * alpha * ( FFT_G * FFT_G )
		* pow( inv, 5.0 )
		* exp( pow( po, 4.0 ) * -1.25 )
		* pow( abs( gamma ), r );
}

fn normalisationFactor( s: f32 ) -> f32 {
	let s2 = s * s; let s3 = s2 * s; let s4 = s3 * s;
	let lo = s4 * -0.000564 + s3 * 0.00776 - s2 * 0.044 + s * 0.192 + 0.163;
	let hi = s4 * -4.80e-08 + s3 * 1.07e-05 - s2 * 9.53e-04 + s * 5.90e-02 + 3.93e-01;
	return select( hi, lo, s < 5.0 );
}

fn directionSpectrum( theta: f32, omega: f32, sysA: vec4f, sysB: vec4f ) -> f32 {
	let peakOmega = sysB.y;
	let ratio = omega / peakOmega;
	let spreadPower = select( pow( abs( ratio ), 5.0 ) * 6.97, pow( abs( ratio ), -2.5 ) * 9.77, omega > peakOmega );
	let s = spreadPower + tanh( min( ratio, 20.0 ) ) * 16.0 * sysA.w * sysA.w;
	let dTheta = theta - sysA.y;
	let cos2s = normalisationFactor( s ) * pow( abs( cos( dTheta * 0.5 ) ), s * 2.0 );
	let cosT = cos( dTheta );
	let base = cosT * cosT * ( 2.0 / PI ) * select( 0.0, 1.0, cosT > 0.0 );
	return mix( base, cos2s, sysA.z );
}

fn shortWavesFade( k: f32, sysB: vec4f ) -> f32 { return exp( - sysB.w * sysB.w * k * k ); }
`;

		// ---------- init spectrum ----------

		this.initSpectrumKernel = new ComputeKernel( {
			label: 'Ocean Init Spectrum',
			modules: [ commonModule ],
			bindings: { ...oceanU, h0: rw( this.h0 ), waveData: rw( this.waveData ) },
			workgroupSize: [ 16, 16, 1 ],
			code: FFT_COMMON + SPECTRUM + /* wgsl */`
@compute @workgroup_size( WG_X, WG_Y, WG_Z )
fn main( @builtin( global_invocation_id ) gid: vec3u ) {
	let x = i32( gid.x ); let y = i32( gid.y ); let c = i32( gid.z );
	let idx = c * ${ N * N } + y * ${ N } + x;

	let L = ocean.sizes[ c ].x;
	let dk = TWO_PI / L;
	let kx = f32( x - ${ HALF } ) * dk;
	let kz = f32( y - ${ HALF } ) * dk;
	let kLen = length( vec2f( kx, kz ) );

	var outH = vec4f( 0.0 );
	var outW = vec4f( kx, kz, 0.0, 0.0 );

	if ( kLen >= ocean.cuts[ c ].x && kLen <= ocean.cuts[ c ].y ) {
		let omega = dispersion( kLen );
		let dOmega = dispersionDerivative( kLen );
		let theta = atan2( kz, kx );

		let sa0 = ocean.sysA[ 0 ]; let sb0 = ocean.sysB[ 0 ];
		let sa1 = ocean.sysA[ 1 ]; let sb1 = ocean.sysB[ 1 ];

		let S0 = jonswap( omega, sa0, sb0 ) * directionSpectrum( theta, omega, sa0, sb0 ) * shortWavesFade( kLen, sb0 );
		let S1 = jonswap( omega, sa1, sb1 ) * directionSpectrum( theta, omega, sa1, sb1 ) * shortWavesFade( kLen, sb1 );
		let S = max( S0 + S1, 0.0 );

		// E|h0|^2 = S(k) dk^2 / 2 so that var(height) = sum S(k) dk^2 (h has both +k and -k terms)
		let amp = sqrt( S * abs( dOmega ) / kLen * dk * dk ) * 0.5;

		// gaussian random pair (Box-Muller)
		let seed = u32( idx ) * 4u + ocean.seed * 7919u;
		let u1 = fftToUnit( fftPcg( seed ) );
		let u2 = fftToUnit( fftPcg( seed + 1u ) );
		let r = sqrt( log( u1 ) * -2.0 );
		let g0 = r * cos( u2 * TWO_PI );
		let g1 = r * sin( u2 * TWO_PI );

		outH = vec4f( g0 * amp, g1 * amp, 0.0, 0.0 );
		outW = vec4f( kx, kz, 1.0 / kLen, omega );
	}

	h0[ idx ] = outH;
	waveData[ idx ] = outW;
}`,
		} );

		this.conjugateKernel = new ComputeKernel( {
			label: 'Ocean Conjugate',
			bindings: { h0: rw( this.h0 ), tmp: rw( this.tmp ) },
			workgroupSize: [ 16, 16, 1 ],
			code: /* wgsl */`
@compute @workgroup_size( WG_X, WG_Y, WG_Z )
fn main( @builtin( global_invocation_id ) gid: vec3u ) {
	let x = i32( gid.x ); let y = i32( gid.y ); let c = i32( gid.z );
	let base = c * ${ N * N };
	let idx = base + y * ${ N } + x;
	let xm = ( ${ N } - x ) % ${ N };
	let ym = ( ${ N } - y ) % ${ N };
	let idxm = base + ym * ${ N } + xm;
	let hm = h0[ idxm ].xy;
	let cur = h0[ idx ].xy;
	tmp[ idx ] = vec4f( cur.x, cur.y, hm.x, - hm.y );
}`,
		} );

		this.copyH0Kernel = new ComputeKernel( {
			label: 'Ocean Copy H0',
			bindings: { h0: rw( this.h0 ), tmp: rw( this.tmp ), foam: rw( this.foam ) },
			workgroupSize: [ 16, 16, 1 ],
			code: /* wgsl */`
@compute @workgroup_size( WG_X, WG_Y, WG_Z )
fn main( @builtin( global_invocation_id ) gid: vec3u ) {
	let idx = gid.z * ${ N * N }u + gid.y * ${ N }u + gid.x;
	h0[ idx ] = tmp[ idx ];
	foam[ idx ] = 0.0;
}`,
		} );

		// ---------- IFFT ----------

		let stages = '';
		for ( let s = 0; s < LOG2N; s ++ ) {

			const half = 1 << s;
			stages += /* wgsl */`
	{
		let pos = t & ${ half - 1 }u;
		let i = ( ( t >> ${ s }u ) << ${ s + 1 }u ) | pos;
		let j = i + ${ half }u;
		let ang = f32( pos ) * ${ ( Math.PI / half ).toFixed( 12 ) };
		let w = vec2f( cos( ang ), sin( ang ) );
		let i2 = i * 2u; let j2 = j * 2u;
		let a0 = fftShared[ i2 ]; let a1 = fftShared[ i2 + 1u ];
		let b0 = fftCmul2( fftShared[ j2 ], w ); let b1 = fftCmul2( fftShared[ j2 + 1u ], w );
		fftShared[ i2 ] = a0 + b0;
		fftShared[ i2 + 1u ] = a1 + b1;
		fftShared[ j2 ] = a0 - b0;
		fftShared[ j2 + 1u ] = a1 - b1;
		workgroupBarrier();
	}`;

		}

		const SHARED = `var<workgroup> fftShared: array<vec4f, ${ N * 2 }>;\n`;

		this.rowKernel = new ComputeKernel( {
			label: 'Ocean FFT Rows',
			modules: [ commonModule ],
			bindings: { ...oceanU, h0: rw( this.h0 ), waveData: rw( this.waveData ), tmp: rw( this.tmp ) },
			workgroupSize: [ HALF, 1, 1 ],
			code: FFT_COMMON + SHARED + /* wgsl */`
@compute @workgroup_size( WG_X, WG_Y, WG_Z )
fn main( @builtin( local_invocation_id ) lid: vec3u, @builtin( workgroup_id ) wid: vec3u ) {
	let t = lid.x;
	let row = wid.x;
	let c = wid.y;
	let base = c * ${ N * N }u + row * ${ N }u;
	let time = ocean.time;

	for ( var e = 0u; e < 2u; e++ ) {
		let x = t + e * FFT_HALF;
		let idx = base + x;
		let w = waveData[ idx ];
		let hv = h0[ idx ];
		let ph = w.w * time;
		let cs = cos( ph ); let sn = sin( ph );

		// h = h0 * e^{i w t} + conj(h0(-k)) * e^{-i w t}
		let hr = hv.x * cs - hv.y * sn + hv.z * cs + hv.w * sn;
		let hi = hv.x * sn + hv.y * cs - hv.z * sn + hv.w * cs;

		let kx = w.x; let kz = w.y; let ik = w.z;
		let fx = kx * ik; let fz = kz * ik;

		// Dx_hat = i kx/k h, Dz_hat = i kz/k h  ->  c0 = Dx + i Dz
		let c0 = vec2f( - ( fx * hi + fz * hr ), fx * hr - fz * hi );
		// c1 = Dy + i dDx/dz,  dDx/dz_hat = -kx kz / k h
		let q = - ( kx * kz * ik );
		let c1 = vec2f( hr - q * hi, hi + q * hr );
		// c2 = dDy/dx + i dDy/dz
		let c2 = vec2f( - ( kx * hi + kz * hr ), kx * hr - kz * hi );
		// c3 = dDx/dx + i dDz/dz
		let a = - ( kx * kx * ik ); let b = - ( kz * kz * ik );
		let c3 = vec2f( a * hr - b * hi, a * hi + b * hr );

		let r = fftBitReverse8( x ) * 2u;
		fftShared[ r ] = vec4f( c0, c1 );
		fftShared[ r + 1u ] = vec4f( c2, c3 );
	}

	workgroupBarrier();
${ stages }

	for ( var e = 0u; e < 2u; e++ ) {
		let x = t + e * FFT_HALF;
		let o = ( base + x ) * 2u;
		tmp[ o ] = fftShared[ x * 2u ];
		tmp[ o + 1u ] = fftShared[ x * 2u + 1u ];
	}
}`,
		} );

		const level = ( tex, l ) => ( { storageTexture: tex, access: 'write', view: { dimension: '2d-array', baseMipLevel: l, mipLevelCount: 1 } } );

		this.columnKernel = new ComputeKernel( {
			label: 'Ocean FFT Columns',
			modules: [ commonModule ],
			bindings: {
				...oceanU, tmp: rw( this.tmp ), foam: rw( this.foam ), mipSrc: rw( this.mipSrc ),
				dispOut: level( this.displacementTexture, 0 ), derivOut: level( this.derivativeTexture, 0 ),
			},
			workgroupSize: [ HALF, 1, 1 ],
			code: FFT_COMMON + SHARED + /* wgsl */`
@compute @workgroup_size( WG_X, WG_Y, WG_Z )
fn main( @builtin( local_invocation_id ) lid: vec3u, @builtin( workgroup_id ) wid: vec3u ) {
	let t = lid.x;
	let col = wid.x;
	let c = wid.y;
	let base = c * ${ N * N }u;

	for ( var e = 0u; e < 2u; e++ ) {
		let y = t + e * FFT_HALF;
		let idx = base + y * ${ N }u + col;
		let r = fftBitReverse8( y ) * 2u;
		fftShared[ r ] = tmp[ idx * 2u ];
		fftShared[ r + 1u ] = tmp[ idx * 2u + 1u ];
	}

	workgroupBarrier();
${ stages }

	let lambda = ocean.choppiness;
	for ( var e = 0u; e < 2u; e++ ) {
		let y = t + e * FFT_HALF;
		let idx = base + y * ${ N }u + col;
		let sign = select( -1.0, 1.0, ( ( col + y ) & 1u ) == 0u );
		let A = fftShared[ y * 2u ] * sign;
		let B = fftShared[ y * 2u + 1u ] * sign;

		let Dx = A.x; let Dz = A.y; let Dy = A.z; let Dxz = A.w;
		let Dyx = B.x; let Dyz = B.y; let Dxx = B.z; let Dzz = B.w;

		let jxx = lambda * Dxx + 1.0;
		let jzz = lambda * Dzz + 1.0;
		let jxz = lambda * Dxz;
		let J = jxx * jzz - jxz * jxz;

		// Persistent foam: generated where the surface compresses (J < bias),
		// then slowly decays so whitecaps leave trailing foam patches.
		let prev = foam[ idx ];
		let gen = sat( ( ocean.foamBias - J ) * ocean.foamGain );
		let f = prev * exp( - ocean.foamDecay * frame.dt ) + gen * ocean.foamAdd * frame.dt;
		let fNew = clamp( max( f, gen * 0.5 ), 0.0, 1.5 );
		foam[ idx ] = fNew;

		let uv = vec2u( col, y );
		let vDisp = vec4f( lambda * Dx, Dy, lambda * Dz, fNew );
		let vDeriv = vec4f( Dyx, Dyz, lambda * Dxx, lambda * Dzz );
		textureStore( dispOut, uv, c, vDisp );
		textureStore( derivOut, uv, c, vDeriv );
		mipSrc[ idx * 2u ] = vDisp;
		mipSrc[ idx * 2u + 1u ] = vDeriv;
	}
}`,
		} );

		// ---- mip chains in compute (instead of 2 textures x 4 layers x 8 levels of render passes)
		// A: 16x16 threads per 32x32 texel tile of level 0 -> levels 1..5 through workgroup memory
		// B: one 8x8 workgroup per layer -> levels 6..8

		// threads (lx, ly) < width reduce a 2x2 block of `from` (row length 2*width) into `to`
		const reduce = ( from, to, width, lvl, t ) => {

			const w2 = width * 2;
			let dst = '';
			if ( to ) dst = `${ to }[ ly * ${ width }u + lx ] = v;`;
			else if ( lvl === 5 ) dst = `mipMid[ ( c * 64u + gy * 8u + gx ) * 2u + ${ t }u ] = v;`;
			return /* wgsl */`
	if ( lx < ${ width }u && ly < ${ width }u ) {
		let i = ly * ${ 2 * w2 }u + lx * 2u;
		let v = ( ${ from }[ i ] + ${ from }[ i + 1u ] + ${ from }[ i + ${ w2 }u ] + ${ from }[ i + ${ w2 + 1 }u ] ) * 0.25;
		textureStore( out${ lvl }, vec2u( gx * ${ width }u + lx, gy * ${ width }u + ly ), c, v );
		${ dst }
	}`;

		};

		const mipA = ( tex, t ) => new ComputeKernel( {
			label: 'Ocean Mips A',
			bindings: {
				mipSrc: rw( this.mipSrc ), mipMid: rw( this.mipMid ),
				out1: level( tex, 1 ), out2: level( tex, 2 ), out3: level( tex, 3 ), out4: level( tex, 4 ), out5: level( tex, 5 ),
			},
			workgroupSize: [ 16, 16, 1 ],
			code: /* wgsl */`
var<workgroup> s1: array<vec4f, 256>;
var<workgroup> s2: array<vec4f, 64>;
var<workgroup> s3: array<vec4f, 16>;
var<workgroup> s4: array<vec4f, 4>;
fn src( c: u32, x: u32, y: u32 ) -> vec4f { return mipSrc[ ( c * ${ N * N }u + y * ${ N }u + x ) * 2u + ${ t }u ]; }
@compute @workgroup_size( WG_X, WG_Y, WG_Z )
fn main( @builtin( local_invocation_id ) lid: vec3u, @builtin( workgroup_id ) wid: vec3u ) {
	let lx = lid.x; let ly = lid.y;
	let gx = wid.x; let gy = wid.y; let c = wid.z;
	let x1 = gx * 16u + lx; let y1 = gy * 16u + ly;
	let x0 = x1 * 2u; let y0 = y1 * 2u;
	let v1 = ( src( c, x0, y0 ) + src( c, x0 + 1u, y0 ) + src( c, x0, y0 + 1u ) + src( c, x0 + 1u, y0 + 1u ) ) * 0.25;
	textureStore( out1, vec2u( x1, y1 ), c, v1 );
	s1[ ly * 16u + lx ] = v1;
	workgroupBarrier();
${ reduce( 's1', 's2', 8, 2, t ) }
	workgroupBarrier();
${ reduce( 's2', 's3', 4, 3, t ) }
	workgroupBarrier();
${ reduce( 's3', 's4', 2, 4, t ) }
	workgroupBarrier();
${ reduce( 's4', null, 1, 5, t ) }
}`,
		} );

		const mipB = ( tex, t ) => new ComputeKernel( {
			label: 'Ocean Mips B',
			bindings: { mipMid: rw( this.mipMid ), out6: level( tex, 6 ), out7: level( tex, 7 ), out8: level( tex, 8 ) },
			workgroupSize: [ 8, 8, 1 ],
			code: /* wgsl */`
var<workgroup> s5: array<vec4f, 64>;
var<workgroup> s6: array<vec4f, 16>;
var<workgroup> s7: array<vec4f, 4>;
@compute @workgroup_size( WG_X, WG_Y, WG_Z )
fn main( @builtin( local_invocation_id ) lid: vec3u, @builtin( workgroup_id ) wid: vec3u ) {
	let lx = lid.x; let ly = lid.y; let c = wid.z;
	let gx = 0u; let gy = 0u;
	s5[ ly * 8u + lx ] = mipMid[ ( c * 64u + ly * 8u + lx ) * 2u + ${ t }u ];
	workgroupBarrier();
${ reduce( 's5', 's6', 4, 6, t ) }
	workgroupBarrier();
${ reduce( 's6', 's7', 2, 7, t ) }
	workgroupBarrier();
${ reduce( 's7', null, 1, 8, t ) }
}`,
		} );

		this.mipKernelsA = [ mipA( this.displacementTexture, 0 ), mipA( this.derivativeTexture, 1 ) ];
		this.mipKernelsB = [ mipB( this.displacementTexture, 0 ), mipB( this.derivativeTexture, 1 ) ];

	}

	update( dt ) {

		const C = this.cascades;

		if ( this.needsSpectrum ) {

			this.needsSpectrum = false;
			const d = [ N / 16, N / 16, C ];
			this.initSpectrumKernel.dispatch( d );
			this.conjugateKernel.dispatch( d );
			this.copyH0Kernel.dispatch( d );

		}

		this.time.value += dt * this.timeScale;
		GPU.computePass( 'Ocean FFT', ( pass ) => {

			this.rowKernel.dispatch( [ N, C, 1 ], { pass } );
			this.columnKernel.dispatch( [ N, C, 1 ], { pass } );
			for ( const k of this.mipKernelsA ) k.dispatch( [ N / 32, N / 32, C ], { pass } );
			for ( const k of this.mipKernelsB ) k.dispatch( [ 1, 1, C ], { pass } );

		} );

	}

	// ---------- sampling helpers ----------

	// WGSL expression summing all cascades' displacement at `worldXZ` (a WGSL vec2f expression);
	// `level` optional WGSL f32 expression, `weights` optional per-cascade WGSL f32 expressions.
	// Needs `fft.module` in the shader.
	sampleDisplacement( worldXZ, level = null, weights = null ) {

		const terms = [];
		for ( let c = 0; c < this.cascades; c ++ ) {

			let s = `textureSampleLevel( oceanDisplacement, smpLinearRepeat, ( ${ worldXZ } ) / ocean.sizes[ ${ c } ].x, ${ c }, ${ level ?? '0.0' } ).xyz`;
			if ( weights ) s += ` * ( ${ weights[ c ] } )`;
			terms.push( s );

		}

		return '( ' + terms.join( ' + ' ) + ' )';

	}

}
