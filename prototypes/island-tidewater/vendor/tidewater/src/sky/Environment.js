import { ShaderModule, UniformBlock } from '../engine/gpu/Shader.js';
import { ComputeKernel } from '../engine/gpu/Compute.js';
import { Texture, StorageBuffer } from '../engine/gpu/Texture.js';
import { ComputeMips } from '../ocean/ComputeMips.js';
import { SceneLighting } from '../engine/render/wgsl/lighting.js';
import { commonModule } from '../engine/render/wgsl/common.js';
import { Vector3 } from '../engine/math/index.js';

// Renders the sky (atmosphere + clouds, no sun disk) into a cube map and prefilters it for image based
// lighting (installs the SceneLighting hooks envSpecular / envDiffuse). Refreshed when the sun moves or
// periodically so drifting clouds stay in sync. The work is spread over frames so none pays for a
// whole refresh: one cube face per frame, then the GGX prefilter one roughness level per frame into a
// back buffer, then the irradiance, and the back buffer becomes the lit one once complete.
//
// Port notes: three's PMREM (cubeUV atlas, sequential blur) is replaced by a mipmapped radiance cube and
// a GGX prefiltered cube (roughness r at mip r * ( LEVELS - 1 ), filtered importance sampling, Karis
// 2013), and the diffuse irradiance by 9 SH coefficients of the cosine-convolved radiance (Ramamoorthi
// & Hanrahan 2001) instead of PMREM's roughest level.
//
// Hooks:
//   fn hookEnvSpecular( R: vec3f, roughness: f32 ) -> vec3f   prefiltered radiance
//   fn hookEnvDiffuse( N: vec3f ) -> vec3f                    irradiance / PI

const LEVELS = 6; // prefiltered mips: 128 .. 4 texels, roughness 0, 0.2, .. 1
const SH_RES = 32; // source mip read for the irradiance (texels per face edge)

const f = ( x ) => {

	const s = String( x );
	return s.includes( '.' ) || s.includes( 'e' ) ? s : s + '.0';

};

// cube face texel -> direction (WebGPU / D3D cube conventions; y down in the face)
const CUBE_DIR = /* wgsl */`
fn envCubeDir( face: u32, x: u32, y: u32, size: u32 ) -> vec3f {
	let u = ( f32( x ) + 0.5 ) / f32( size ) * 2.0 - 1.0;
	let v = ( f32( y ) + 0.5 ) / f32( size ) * 2.0 - 1.0;
	var d: vec3f;
	switch ( face ) {
		case 0u: { d = vec3f( 1.0, -v, -u ); }
		case 1u: { d = vec3f( -1.0, -v, u ); }
		case 2u: { d = vec3f( u, 1.0, v ); }
		case 3u: { d = vec3f( u, -1.0, -v ); }
		case 4u: { d = vec3f( u, -v, 1.0 ); }
		default: { d = vec3f( -u, -v, -1.0 ); }
	}
	return normalize( d );
}
`;

export class Environment {

	constructor( renderer, scene, sky, size = 128 ) {

		this.renderer = renderer;
		this.scene = scene;
		this.sky = sky;
		this.size = size;
		if ( scene ) scene.environmentIntensity = 1;

		// radiance of the sky (mipmapped for the filtered importance sampling)
		this.source = new Texture( { label: 'envSource', width: size, height: size, dimension: 'cube', format: 'rgba16float', mips: true, usage: [ 'sample', 'storage', 'render' ] } );
		// prefiltered specular: front (lit) / back (being filtered)
		const spec = ( n ) => new Texture( { label: n, width: size, height: size, dimension: 'cube', format: 'rgba16float', mips: LEVELS, usage: [ 'sample', 'storage' ] } );
		this.targets = [ spec( 'envSpecularA' ), spec( 'envSpecularB' ) ];
		this.front = 0;
		// SH irradiance: front / back (9 x vec4)
		this.sh = [ new StorageBuffer( { label: 'envSH_A', count: 9, type: 'vec4f', data: defaultSH() } ), new StorageBuffer( { label: 'envSH_B', count: 9, type: 'vec4f' } ) ];

		this.lastSun = new Vector3( 0, - 2, 0 );
		this.timer = 0;
		this.interval = 3;
		this.step = - 1; // progress of the refresh under way (-1: idle)
		this.primed = false;

		this._build();
		this.steps = this._buildSteps();

	}

	_build() {

		const sky = this.sky;
		const size = this.size;

		// ---- sky -> source cube, one face per dispatch
		this.faceParams = [];
		this.faceKernels = [];
		for ( let i = 0; i < 6; i ++ ) {

			this.faceKernels.push( new ComputeKernel( {
				label: 'Env Face ' + i,
				modules: [ commonModule, sky.module ],
				bindings: { outCube: { storageTexture: this.source, viewDimension: '2d-array' } },
				workgroupSize: [ 8, 8, 1 ],
				code: /* wgsl */`${ CUBE_DIR }
@compute @workgroup_size( WG_X, WG_Y, WG_Z ) fn main( @builtin( global_invocation_id ) gid: vec3u ) {
	if ( gid.x >= ${ size }u || gid.y >= ${ size }u ) { return; }
	let dir = envCubeDir( ${ i }u, gid.x, gid.y, ${ size }u );
	// no sun or moon disk: the key light is lit directly
	textureStore( outCube, gid.xy, ${ i }, vec4f( skyRadianceWithClouds( dir, false ), 1.0 ) );
}`,
			} ) );

		}

		// ---- GGX prefilter of level m (roughness m / ( LEVELS - 1 )) into the back target
		this.filterKernels = [ [], [] ];
		for ( let t = 0; t < 2; t ++ ) for ( let m = 0; m < LEVELS; m ++ ) {

			const rough = m / ( LEVELS - 1 );
			const lsize = size >> m;
			this.filterKernels[ t ].push( new ComputeKernel( {
				label: 'Env GGX ' + m,
				modules: [ commonModule ],
				bindings: {
					srcCube: { texture: this.source, viewDimension: 'cube' },
					outCube: { storageTexture: this.targets[ t ], view: { dimension: '2d-array', baseMipLevel: m, mipLevelCount: 1 } },
				},
				workgroupSize: [ 8, 8, 1 ],
				code: /* wgsl */`${ CUBE_DIR }
fn hammersley( i: u32, n: u32 ) -> vec2f {
	var b = i;
	b = ( b << 16u ) | ( b >> 16u );
	b = ( ( b & 0x55555555u ) << 1u ) | ( ( b & 0xAAAAAAAAu ) >> 1u );
	b = ( ( b & 0x33333333u ) << 2u ) | ( ( b & 0xCCCCCCCCu ) >> 2u );
	b = ( ( b & 0x0F0F0F0Fu ) << 4u ) | ( ( b & 0xF0F0F0F0u ) >> 4u );
	b = ( ( b & 0x00FF00FFu ) << 8u ) | ( ( b & 0xFF00FF00u ) >> 8u );
	return vec2f( f32( i ) / f32( n ), f32( b ) * 2.3283064365386963e-10 );
}
@compute @workgroup_size( WG_X, WG_Y, WG_Z ) fn main( @builtin( global_invocation_id ) gid: vec3u ) {
	if ( gid.x >= ${ lsize }u || gid.y >= ${ lsize }u ) { return; }
	let N = envCubeDir( gid.z, gid.x, gid.y, ${ lsize }u );
${ m === 0 ? /* wgsl */`
	textureStore( outCube, gid.xy, gid.z, vec4f( textureSampleLevel( srcCube, smpLinearClamp, N, 0.0 ).rgb, 1.0 ) );
}` : /* wgsl */`
	// filtered importance sampling (Karis 2013 / GPU Gems 3 ch. 20), N = V = R
	let alpha = ${ f( rough * rough ) };
	let a2 = alpha * alpha;
	let tb = basis( N );
	const COUNT = 96u;
	let saTexel = ${ f( 4 * Math.PI / ( 6 * size * size ) ) };
	var sum = vec3f( 0.0 );
	var wsum = 0.0;
	for ( var i = 0u; i < COUNT; i++ ) {
		let xi = hammersley( i, COUNT );
		let phi = TWO_PI * xi.x;
		let cosT = sqrt( ( 1.0 - xi.y ) / ( 1.0 + ( a2 - 1.0 ) * xi.y ) );
		let sinT = sqrt( 1.0 - cosT * cosT );
		let H = tb * vec3f( sinT * cos( phi ), sinT * sin( phi ), cosT );
		let L = 2.0 * dot( N, H ) * H - N;
		let NdotL = dot( N, L );
		if ( NdotL > 0.0 ) {
			let NdotH = cosT;
			let d = NdotH * NdotH * ( a2 - 1.0 ) + 1.0;
			let D = a2 / ( PI * d * d );
			let pdf = D * 0.25; // D * NdotH / ( 4 VdotH ), N = V
			let saSample = 1.0 / ( f32( COUNT ) * pdf + 1e-4 );
			let lod = clamp( 0.5 * log2( saSample / saTexel ) + 1.0, 0.0, ${ f( Math.log2( size ) ) } );
			sum += textureSampleLevel( srcCube, smpLinearClamp, L, lod ).rgb * NdotL;
			wsum += NdotL;
		}
	}
	textureStore( outCube, gid.xy, gid.z, vec4f( sum / max( wsum, 1e-4 ), 1.0 ) );
}` }`,
			} ) );

		}

		// ---- irradiance: SH9 of the radiance (one workgroup reduction), convolved with the clamped cosine
		const srcMip = Math.max( 0, Math.log2( size / SH_RES ) );
		this.shKernels = [ 0, 1 ].map( ( t ) => new ComputeKernel( {
			label: 'Env SH',
			modules: [ commonModule ],
			bindings: { srcCube: { texture: this.source, viewDimension: '2d-array' }, shOut: { storage: this.sh[ t ], access: 'read_write' } },
			workgroupSize: [ 128, 1, 1 ],
			code: /* wgsl */`${ CUBE_DIR }
var<workgroup> acc: array<array<vec3f, 9>, 128>;
@compute @workgroup_size( 128 ) fn main( @builtin( local_invocation_index ) li: u32 ) {
	var c: array<vec3f, 9>;
	for ( var k = 0; k < 9; k++ ) { c[ k ] = vec3f( 0.0 ); }
	let total = ${ 6 * SH_RES * SH_RES }u;
	for ( var idx = li; idx < total; idx += 128u ) {
		let face = idx / ${ SH_RES * SH_RES }u;
		let r = idx % ${ SH_RES * SH_RES }u;
		let x = r % ${ SH_RES }u; let y = r / ${ SH_RES }u;
		let d = envCubeDir( face, x, y, ${ SH_RES }u );
		// solid angle of the texel
		let u = ( f32( x ) + 0.5 ) / ${ f( SH_RES ) } * 2.0 - 1.0;
		let v = ( f32( y ) + 0.5 ) / ${ f( SH_RES ) } * 2.0 - 1.0;
		let tmp = 1.0 + u * u + v * v;
		let w = 4.0 / ( sqrt( tmp ) * tmp ) * ${ f( 1 / ( SH_RES * SH_RES ) ) };
		let L = textureLoad( srcCube, vec2u( x, y ), face, ${ srcMip } ).rgb * w;
		c[ 0 ] += L * 0.282095;
		c[ 1 ] += L * 0.488603 * d.y;
		c[ 2 ] += L * 0.488603 * d.z;
		c[ 3 ] += L * 0.488603 * d.x;
		c[ 4 ] += L * 1.092548 * d.x * d.y;
		c[ 5 ] += L * 1.092548 * d.y * d.z;
		c[ 6 ] += L * 0.315392 * ( 3.0 * d.z * d.z - 1.0 );
		c[ 7 ] += L * 1.092548 * d.x * d.z;
		c[ 8 ] += L * 0.546274 * ( d.x * d.x - d.y * d.y );
	}
	acc[ li ] = c;
	workgroupBarrier();
	for ( var s = 64u; s > 0u; s >>= 1u ) {
		if ( li < s ) { for ( var k = 0; k < 9; k++ ) { acc[ li ][ k ] += acc[ li + s ][ k ]; } }
		workgroupBarrier();
	}
	if ( li == 0u ) {
		// cosine lobe convolution (A0 = PI, A1 = 2 PI / 3, A2 = PI / 4), stored as irradiance / PI
		let A = array<f32, 9>( 1.0, 0.6666667, 0.6666667, 0.6666667, 0.25, 0.25, 0.25, 0.25, 0.25 );
		for ( var k = 0; k < 9; k++ ) { shOut[ k ] = vec4f( acc[ 0 ][ k ] * A[ k ], 0.0 ); }
	}
}`,
		} ) );

		// ---- hooks (read the front target)
		this.envUniforms = new UniformBlock( 'EnvParams', { levels: [ 'f32', LEVELS - 1 ] }, { label: 'env' } );
		SceneLighting.set( 'envSpecular', new ShaderModule( {
			name: 'hook-envSpecular',
			deps: [ commonModule ],
			uniforms: this.envUniforms,
			uniformName: 'envParams',
			bindings: { envSpecularCube: { texture: () => this.targets[ this.front ], viewDimension: 'cube' } },
			code: /* wgsl */`
fn hookEnvSpecular( R: vec3f, roughness: f32 ) -> vec3f {
	return textureSampleLevel( envSpecularCube, smpLinearClamp, R, roughness * envParams.levels ).rgb * frame.envIntensity;
}
`,
		} ) );
		SceneLighting.set( 'envDiffuse', new ShaderModule( {
			name: 'hook-envDiffuse',
			deps: [ commonModule ],
			bindings: { envSH: { storage: () => this.sh[ this.front ], access: 'read', type: 'vec4f' } },
			code: /* wgsl */`
fn hookEnvDiffuse( N: vec3f ) -> vec3f {
	let d = N;
	var e = envSH[ 0 ].rgb * 0.282095
		+ envSH[ 1 ].rgb * 0.488603 * d.y + envSH[ 2 ].rgb * 0.488603 * d.z + envSH[ 3 ].rgb * 0.488603 * d.x
		+ envSH[ 4 ].rgb * 1.092548 * d.x * d.y + envSH[ 5 ].rgb * 1.092548 * d.y * d.z
		+ envSH[ 6 ].rgb * 0.315392 * ( 3.0 * d.z * d.z - 1.0 ) + envSH[ 7 ].rgb * 1.092548 * d.x * d.z
		+ envSH[ 8 ].rgb * 0.546274 * ( d.x * d.x - d.y * d.y );
	return max( e, vec3f( 0.0 ) ) * frame.envIntensity;
}
`,
		} ) );

	}

	// the refresh as a list of small units of work
	_buildSteps() {

		const steps = [];
		const size = this.size;
		for ( let i = 0; i < 6; i ++ ) steps.push( () => this.faceKernels[ i ].dispatch( [ size / 8, size / 8, 1 ] ) );
		// box mips in compute: 2 dispatches instead of 42 render passes in one frame
		const mips = this._mips || ( this._mips = new ComputeMips( this.source, 'envSource' ) );
		steps.push( () => mips.dispatch() );
		for ( let m = 0; m < LEVELS; m ++ ) {

			const n = Math.max( 1, Math.ceil( ( size >> m ) / 8 ) );
			steps.push( () => this.filterKernels[ 1 - this.front ][ m ].dispatch( [ n, n, 6 ] ) );

		}

		steps.push( () => this.shKernels[ 1 - this.front ].dispatch( 1 ) );
		// the filtered back buffer becomes the lit one
		steps.push( () => {

			this.front = 1 - this.front;

		} );
		return steps;

	}

	update( dt, force = false ) {

		this.timer -= dt;
		const sun = this.sky.atmosphere.sunDir.value;

		// first use (or forced): the whole refresh at once
		if ( force || ! this.primed ) {

			this.primed = true;
			this.timer = this.interval;
			this.lastSun.copy( sun );
			for ( const s of this.steps ) s();
			this.step = - 1;
			return;

		}

		if ( this.step < 0 ) {

			const moved = sun.angleTo( this.lastSun ) > 0.004;
			if ( ! moved && this.timer > 0 ) return;
			this.timer = this.interval;
			this.lastSun.copy( sun );
			this.step = 0;

		}

		this.steps[ this.step ++ ]();
		if ( this.step === this.steps.length ) this.step = - 1;

	}

	// the prefiltered environment (debug views)
	get texture() {

		return this.targets[ this.front ];

	}

}

// a neutral sky-blue irradiance until the first refresh
function defaultSH() {

	const d = new Float32Array( 36 );
	const c = [ 0.3, 0.4, 0.6 ];
	for ( let i = 0; i < 3; i ++ ) d[ i ] = c[ i ] / 0.282095;
	return d;

}
