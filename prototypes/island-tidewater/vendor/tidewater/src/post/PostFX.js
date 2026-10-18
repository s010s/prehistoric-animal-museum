import { GPU } from '../engine/gpu/GPU.js';
import { UniformBlock } from '../engine/gpu/Shader.js';
import { ComputeKernel } from '../engine/gpu/Compute.js';
import { RenderTarget, StorageBuffer, Texture } from '../engine/gpu/Texture.js';
import { FullscreenPass } from '../engine/render/FullscreenPass.js';
import { FrameUniforms, G, setFrameCamera } from '../engine/render/Frame.js';
import { LENS_REACH } from './Underwater.js';
import { commonModule } from '../engine/render/wgsl/common.js';
import { Matrix4, Vector2, Vector3 } from '../engine/math/index.js';
import { GTAO } from './GTAO.js';
import { AntiAlias } from './AntiAlias.js';
import { TemporalUpscale } from './TemporalUpscale.js';
import { LensDroplets } from './LensDroplets.js';
import { LensFlare } from './LensFlare.js';
import { MotionBlur } from './MotionBlur.js';

// full-screen passes overwrite every pixel: clear instead of load (no tile load of the old contents on
// tile-based GPUs)
const CLR = [ 0, 0, 0, 0 ];

// Post chain (internal resolution = drawing buffer * scale up to the TAAU resolve):
//   scene (HDR + velocity) -> GTAO (half internal res, temporally rotated)
//   -> AO composite + underwater / waterline (one pass)
//   -> TAAU (anti-aliasing + upscale to the output resolution)
//   -> bloom (13-tap downsample / tent upsample chain from half res)
//   -> grading (saturation, contrast, warmth) + vignette + grain -> ACES (renderOutput)
//
// Per frame (App): beginFrame() (internal size, TAAU jitter, the frame camera: setFrameCamera), the
// scene, flare.kernel.dispatch( 1 ), render() (records the chain, the last pass draws into the canvas
// texture, or `outputTexture` when set: headless tests), endFrame().
// Tone mapping: three's ACESFilmicToneMapping with frame.exposure (G.exposure, the app's exposure
// setting) times the auto exposure, then the sRGB transfer (renderOutput) for the canvas format.

// three's ACES fitted curve (sRGB => XYZ => D65_2_D60 => AP1 => RRT_SAT, RRT + ODT fit,
// ODT_SAT => XYZ => D60_2_D65 => sRGB), clamped
const ACES = /* wgsl */`
fn RRTAndODTFit( v: vec3f ) -> vec3f {
	let a = v * ( v + 0.0245786 ) - 0.000090537;
	let b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
fn acesFilmicToneMapping( colorIn: vec3f, exposure: f32 ) -> vec3f {
	let ACESInputMat = transpose( mat3x3f(
		0.59719, 0.35458, 0.04823,
		0.07600, 0.90834, 0.01566,
		0.02840, 0.13383, 0.83777 ) );
	let ACESOutputMat = transpose( mat3x3f(
		1.60475, -0.53108, -0.07367,
		-0.10208, 1.10813, -0.00605,
		-0.00327, -0.07276, 1.07602 ) );
	var color = colorIn * exposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return clamp( color, vec3f( 0.0 ), vec3f( 1.0 ) );
}
`;

export class PostFX {

	constructor( renderer, { sceneRenderer, camera, underwater, clouds = null, sunDir = null, haze = null } ) {

		this.renderer = renderer;
		this.camera = camera;
		this.sceneRenderer = sceneRenderer;
		this.underwater = underwater;
		this.scale = 1;
		// headless / tests: a Texture to draw into instead of the canvas, and its size
		this.outputTexture = null;
		this.outputSize = null;
		this.outputFormat = GPU.context ? GPU.format : 'rgba8unorm';

		this.uniforms = new UniformBlock( 'PostParams', {
			aoStrength: [ 'f32', 1.0 ],
			bloom: [ 'f32', 0.05 ],
			vignette: [ 'f32', 0.28 ],
			saturation: [ 'f32', 1.06 ],
			contrast: [ 'f32', 1.04 ],
			warmth: [ 'f32', 0.02 ],
			grain: [ 'f32', 0.012 ],
			sharpen: [ 'f32', 0.45 ], // RCAS strength (0 = off, 1 = strong)
		}, { label: 'post' } );
		this.params = this.uniforms.fields;

		// ---- auto exposure (eye adaptation), metered on the GPU from the 1/16 bloom level
		this.aeUniforms = new UniformBlock( 'AutoExposureParams', {
			enabled: [ 'f32', 1 ],
			refLum: [ 'f32', 0.25 ], // scene average luminance that needs no correction
			min: [ 'f32', 0.6 ],
			max: [ 'f32', 6.0 ],
			up: [ 'f32', 1.6 ], // adaptation rates (1/s): brightening, darkening
			down: [ 'f32', 1.1 ],
		}, { label: 'autoExposure' } );
		// (`ref` is a WGSL keyword: the field is refLum, aliased as autoExposure.ref)
		this.autoExposure = { ...this.aeUniforms.fields, ref: this.aeUniforms.fields.refLum };
		this.exposure = new StorageBuffer( { label: 'autoExposure', count: 1, type: 'f32', data: new Float32Array( [ 1 ] ) } );

		const sceneRT = sceneRenderer.sceneRT;
		const opaque = sceneRenderer.opaqueCopy;
		this.sceneColor = sceneRT.texture;
		this.opaqueDepth = opaque.depthTexture;
		this.finalDepth = sceneRT.depthTexture;

		// ---- ambient occlusion on the opaque depth (normals reconstructed from depth)
		// GTAO reads a half-resolution depth copy (one texel per AO pixel): its horizon taps spread
		// over a large screen radius, and the full-res reads were mostly cache misses. Half float: the
		// taps are bandwidth bound, and reversed-Z depth keeps its relative precision in fp16 (~5 mm at
		// 10 m) where the AO radius matters
		this.aoDepth = new RenderTarget( 1, 1, { colors: [ 'r16float' ], label: 'aoDepth' } );
		this._aoDepthPass = new FullscreenPass( {
			label: 'AO depth',
			colorFormats: [ 'r16float' ],
			bindings: { aoFullDepth: { texture: () => this.opaqueDepth }, aoFinalDepth: { texture: () => this.finalDepth } },
			code: /* wgsl */`
// negative where the water covers the opaque surface: its AO is never shown (the beauty pass skips
// covered pixels), so GTAO leaves those texels alone; everything else reads the magnitude
fn fragment( in: FSIn ) -> vec4f {
	let s = vec2i( textureDimensions( aoFullDepth ) );
	let p = min( vec2i( in.pos.xy ) * 2, s - 1 );
	let d = textureLoad( aoFullDepth, p, 0 );
	let covered = textureLoad( aoFinalDepth, p, 0 ) > d + 1e-7;
	return vec4f( select( d, - d, covered ), 0.0, 0.0, 1.0 );
}
`,
		} );
		this.aoPass = new GTAO( this.aoDepth.texture, camera, { samples: 12, depthIsColor: true } );
		this.aoPass.resolutionScale = 0.5;
		this.aoPass.radius.value = 2.2;
		this.aoPass.thickness.value = 2.0;
		this.aoPass.distanceExponent.value = 1.4;
		this.aoPass.scale.value = 1.6;
		this.aoPass.samples.value = 12;
		this.aoPass.useTemporalFiltering = true;
		// spatial denoise at the AO resolution (separable 5 + 5 taps, depth-aware): GTAO rotates its
		// directions over a 5x5 pattern and jitters its steps per pixel and per frame, which only the
		// temporal resolve averaged out; where it can't accumulate (the rocking helm, fast turns) that
		// noise flickered
		this.aoBlurX = new RenderTarget( 1, 1, { colors: [ 'r16float' ], label: 'aoBlurX' } );
		this.aoBlurY = new RenderTarget( 1, 1, { colors: [ 'r16float' ], label: 'aoBlurY' } );
		const aoBlur = ( src, dx, dy ) => {

			let taps = '';
			for ( let k = - 2; k <= 2; k ++ ) taps += /* wgsl */`
	{
		let uvK = in.uv + vec2f( ${ dx * k }.0, ${ dy * k }.0 ) / size;
		let rel = abs( postDepthOpaque( uvK ) - dC ) / max( dC, 1e-7 );
		let w = 1.0 / pow2( rel * 40.0 + 1.0 );
		sum += textureSampleLevel( aoSrc, smpLinearClamp, uvK, 0.0 ).r * w;
		wSum += w;
	}`;
			return new FullscreenPass( {
				label: 'AO blur ' + ( dx ? 'x' : 'y' ),
				colorFormats: [ 'r16float' ],
				// the half resolution depth copy (one texel per AO texel): the full resolution depth taps
				// were mostly cache misses
				bindings: { aoSrc: { texture: src }, postAODepth: { texture: () => this.aoDepth.texture } },
				code: /* wgsl */`
fn postDepthOpaque( uv: vec2f ) -> f32 {
	let s = vec2i( textureDimensions( postAODepth ) );
	return abs( textureLoad( postAODepth, clamp( vec2i( floor( uv * vec2f( s ) ) ), vec2i( 0 ), s - 1 ), 0 ).r );
}
fn fragment( in: FSIn ) -> vec4f {
	let size = vec2f( textureDimensions( aoSrc ) );
	let dC = postDepthOpaque( in.uv );
	var sum = 0.0; var wSum = 0.0;
${ taps }
	return vec4f( sum / wSum, 0.0, 0.0, 1.0 );
}
`,
			} );

		};

		this._aoBlurXPass = aoBlur( () => this.aoPass.texture, 1, 0 );
		this._aoBlurYPass = aoBlur( () => this.aoBlurX.texture, 0, 1 );

		// medium at the near clip plane per pixel (the waterline on the lens), then the composite
		this.medium = new RenderTarget( 1, 1, { colors: [ 'r8unorm' ], label: 'medium' } );
		underwater.mediumTexture = this.medium.texture;
		// air: aerial perspective, marine haze and volumetric sun shafts (AirHaze) on the lit scene
		this.haze = haze;
		if ( haze ) haze.mediumTexture = this.medium.texture;
		this.beauty = new RenderTarget( 1, 1, { colors: [ 'rgba16float' ], label: 'beauty' } );

		// ---- temporal anti-aliasing + upscale
		// 'smaataa' (SMAA T2x style): SMAA on each jittered frame, the TAA accumulates the result
		this.smaaIn = new RenderTarget( 1, 1, { colors: [ 'rgba16float' ], label: 'smaaBeforeTAA' } );
		this.taau = new TemporalUpscale( () => ( this.aaMode === 'smaataa' ? this.smaaIn.texture : this.beauty.texture ), this.finalDepth, sceneRenderer.velocityTexture, camera, sceneRenderer.waterMaskTexture, this.exposure );
		// anti-aliasing: 'taa' (the temporal upscaler, jittered camera), 'smaataa' (SMAA, then the TAA:
		// crisp stable geometric edges from SMAA, sub-pixel detail and dithering from the TAA) or a
		// spatial filter ('smaa', 'fxaa', 'none') writing the same resolved image (AntiAlias.js)
		this.aaMode = 'taa';
		this.aa = new AntiAlias( { src: () => this.beauty.texture, exposure: this.exposure } );

		// ---- camera + object motion blur on the resolved image (gathered in the final pass, before
		// bloom and the screen-fixed lens effects)
		this.motionBlur = new MotionBlur( { velocityTexture: sceneRenderer.velocityTexture, depthTexture: sceneRT.depthTexture, color: () => this.taau.output } );

		// ---- sun flare in the lens (screen-fixed, after the temporal resolve; its visibility is measured
		// from the scene depth by a compute pass the app runs after the scene)
		this.flare = sunDir ? new LensFlare( { depthTexture: sceneRT.depthTexture, clouds, sunDir } ) : null;

		// ---- water on the lens after surfacing (screen-fixed, so after the temporal resolve)
		this.lens = new LensDroplets();

		this._outW = 0;
		this._outH = 0;
		this._inW = 0;
		this._inH = 0;
		this._prevVP = new Matrix4();
		this._prevCamPos = new Vector3();
		this._hasPrev = false;
		this._size = new Vector2();
		this._built = false;
		this.profiler = null; // core/Profiler: every pass is tracked when the chain is built

	}

	// ---------------------------------------------------------------- build (lazy: other systems' modules)

	_build() {

		this._built = true;
		const uw = this.underwater;
		const haze = this.haze;

		// the medium of each pixel's lens
		this._mediumPass = new FullscreenPass( {
			label: 'medium', colorFormats: [ 'r8unorm' ], modules: [ uw.module ],
			code: 'fn fragment( in: FSIn ) -> vec4f { return vec4f( underwaterMedium( in.uv ), 0.0, 0.0, 1.0 ); }',
		} );

		// scene color with AO applied to opaque pixels that aren't behind water, then the haze, then
		// the underwater / waterline composite
		this._beautyPass = new FullscreenPass( {
			label: 'beauty (AO + haze + underwater)',
			colorFormats: [ 'rgba16float' ],
			modules: [ uw.compositeModule, haze ? haze.compositeModule : null ].filter( Boolean ),
			defines: haze ? haze._defines() : {},
			bindings: {
				post: { uniform: this.uniforms },
				postScene: { texture: () => this.sceneColor },
				postOpaqueDepth: { texture: () => this.opaqueDepth },
				postFinalDepth: { texture: () => this.finalDepth },
				postAO: { texture: () => this.aoBlurY.texture },
				postAODepth: { texture: () => this.aoDepth.texture },
			},
			code: /* wgsl */`
fn postDepthLoad( uv: vec2f, which: i32 ) -> f32 {
	if ( which == 0 ) {
		let s = vec2i( textureDimensions( postOpaqueDepth ) );
		return textureLoad( postOpaqueDepth, clamp( vec2i( floor( uv * vec2f( s ) ) ), vec2i( 0 ), s - 1 ), 0 );
	}
	let s = vec2i( textureDimensions( postFinalDepth ) );
	return textureLoad( postFinalDepth, clamp( vec2i( floor( uv * vec2f( s ) ) ), vec2i( 0 ), s - 1 ), 0 );
}

fn postColorAO( uv: vec2f ) -> vec3f {
	let c = textureSampleLevel( postScene, smpLinearClamp, uv, 0.0 ).rgb;
	let dO = postDepthLoad( uv, 0 );
	let dF = postDepthLoad( uv, 1 );
	// reversed depth: sky = 0; water in front of the opaque surface has a larger depth value
	let isSky = dO < 1e-7;
	let covered = dF > dO + 1e-7;
	// no AO there (k = 0 below): skip the upsample
	if ( isSky || covered ) { return c; }
	// depth-aware upsample of the half-res AO: the 4 nearest AO texels, weighted by how close
	// their depth is to this pixel's (no dark halos bleeding across depth edges)
	// (the AO texels' depths: the half resolution copy the AO was computed from)
	let aoSizeI = vec2i( textureDimensions( postAO ) );
	let pa = uv * vec2f( aoSizeI ) - 0.5;
	let i0 = floor( pa );
	let fr = pa - i0;
	var aSum = 0.0; var wSum = 1e-4;
	for ( var k = 0; k < 4; k++ ) {
		let o = vec2i( k & 1, k >> 1u );
		let pT = clamp( vec2i( i0 ) + o, vec2i( 0 ), aoSizeI - 1 );
		let dT = abs( textureLoad( postAODepth, pT, 0 ).r );
		let wBil = select( 1.0 - fr.x, fr.x, o.x == 1 ) * select( 1.0 - fr.y, fr.y, o.y == 1 );
		// reversed-Z depth ~ near / z, so the relative depth difference ~ |dT - dO| / dO
		let rel = abs( dT - dO ) / max( dO, 1e-7 );
		let wDepth = 1.0 / pow2( rel * 40.0 + 1.0 );
		let wt = wBil * wDepth + 1e-5;
		aSum += textureLoad( postAO, pT, 0 ).r * wt;
		wSum += wt;
	}
	let a = aSum / wSum;
	// multi-bounce approximation (Jimenez 2016) for a typical outdoor albedo of ~0.35
	let aMB = max( a, ( ( a * 0.382 - 1.036 ) * a + 1.654 ) * a );
	// AO only removes ambient light: full effect where the pixel is lit by the sky alone,
	// a third of it on sunlit surfaces (still grounds objects without dirty halos)
	let ambientOnly = 1.0 - smoothstep( 0.12, 0.9, luminance( c ) );
	let k = select( post.aoStrength * mix( 0.35, 1.0, ambientOnly ), 0.0, isSky || covered );
	return c * mix( 1.0, aMB, k );
}

fn postSceneSample( uv: vec2f ) -> vec3f {
	${ haze ? 'return hazeApply( uv, vec4f( postColorAO( uv ), 1.0 ) ).rgb;' : 'return postColorAO( uv );' }
}

fn fragment( in: FSIn ) -> vec4f {
	return underwaterComposite( in.uv, in.pos.xy );
}
`,
		} );

		// build the lazily built passes now (the profiler tracks them after beginFrame)
		if ( ! this.aoPass._pass ) this.aoPass._build();
		if ( haze && ! haze._passes ) haze._build();
		if ( uw.renderShafts ) void uw.shaftPass;

		// ---- bloom
		this._buildBloom();
		this._buildMeter();
		this._buildFinal();
		// GPU timestamps per pass (core/Profiler): set `post.profiler = profiler` before the first frame
		if ( this.profiler ) for ( const [ n, p ] of this.passes() ) this.profiler.track( 'post ' + n, p );

	}

	// Physically-motivated bloom (Jimenez 2014): 13-tap downsamples (Karis average on the first
	// one so single bright glints can't flicker), then 3x3 tent upsamples accumulating each level.
	_buildBloom() {

		const mk = ( name ) => new RenderTarget( 1, 1, { colors: [ 'rgba16float' ], label: name } );
		this.bloomScales = [ 0.5, 0.25, 0.125, 0.0625, 0.03125 ];
		this.bloomDown = this.bloomScales.map( ( s, i ) => mk( 'bloomDown' + ( i + 1 ) ) );
		this.bloomUp = this.bloomScales.slice( 0, 4 ).map( ( s, i ) => mk( 'bloomUp' + ( i + 1 ) ) );

		const TAPS = /* wgsl */`
fn bTap( uv: vec2f, texel: vec2f, x: f32, y: f32 ) -> vec3f { return textureSampleLevel( bSrc, smpLinearClamp, uv + texel * vec2f( x, y ), 0.0 ).rgb; }
fn karis( c: vec3f ) -> vec3f { return c / ( luminance( c ) + 1.0 ); }
`;
		const down = ( src, first ) => new FullscreenPass( {
			label: 'bloom down', colorFormats: [ 'rgba16float' ], bindings: { bSrc: { texture: src } },
			code: TAPS + /* wgsl */`
fn fragment( in: FSIn ) -> vec4f {
	let uv = in.uv;
	let texel = 1.0 / vec2f( textureDimensions( bSrc ) );
	let a = bTap( uv, texel, -2.0, -2.0 ); let b = bTap( uv, texel, 0.0, -2.0 ); let c = bTap( uv, texel, 2.0, -2.0 );
	let d = bTap( uv, texel, -2.0, 0.0 ); let e = bTap( uv, texel, 0.0, 0.0 ); let f = bTap( uv, texel, 2.0, 0.0 );
	let g = bTap( uv, texel, -2.0, 2.0 ); let h = bTap( uv, texel, 0.0, 2.0 ); let i = bTap( uv, texel, 2.0, 2.0 );
	let j = bTap( uv, texel, -1.0, -1.0 ); let k = bTap( uv, texel, 1.0, -1.0 ); let l = bTap( uv, texel, -1.0, 1.0 ); let m = bTap( uv, texel, 1.0, 1.0 );
${ first ? /* wgsl */`
	// weighted groups of four (Karis average) suppress fireflies
	let g0 = karis( ( j + k + l + m ) * 0.25 ) * 0.5;
	let g1 = karis( ( a + b + d + e ) * 0.25 ) * 0.125;
	let g2 = karis( ( b + c + e + f ) * 0.25 ) * 0.125;
	let g3 = karis( ( d + e + g + h ) * 0.25 ) * 0.125;
	let g4 = karis( ( e + f + h + i ) * 0.25 ) * 0.125;
	let s = g0 + g1 + g2 + g3 + g4;
	// undo the Karis tonemap on the result
	return vec4f( s / max( 1.0 - luminance( s ), 0.02 ), 1.0 );` : /* wgsl */`
	let s = e * 0.125 + ( a + c + g + i ) * 0.03125 + ( b + d + f + h ) * 0.0625 + ( j + k + l + m ) * 0.125;
	return vec4f( s, 1.0 );` }
}
`,
		} );

		const up = ( small, base ) => new FullscreenPass( {
			label: 'bloom up', colorFormats: [ 'rgba16float' ], bindings: { bSrc: { texture: small }, bBase: { texture: base } },
			code: TAPS + /* wgsl */`
fn fragment( in: FSIn ) -> vec4f {
	let uv = in.uv;
	let texel = 1.0 / vec2f( textureDimensions( bSrc ) );
	let s = ( bTap( uv, texel, 0.0, 0.0 ) * 4.0
		+ ( bTap( uv, texel, -1.0, 0.0 ) + bTap( uv, texel, 1.0, 0.0 ) + bTap( uv, texel, 0.0, -1.0 ) + bTap( uv, texel, 0.0, 1.0 ) ) * 2.0
		+ ( bTap( uv, texel, -1.0, -1.0 ) + bTap( uv, texel, 1.0, -1.0 ) + bTap( uv, texel, -1.0, 1.0 ) + bTap( uv, texel, 1.0, 1.0 ) ) ) / 16.0;
	return vec4f( textureSampleLevel( bBase, smpLinearClamp, uv, 0.0 ).rgb + s, 1.0 );
}
`,
		} );

		const D = this.bloomDown, U = this.bloomUp;
		this._bloomPasses = [
			[ down( () => this.taau.texture, true ), D[ 0 ] ],
			[ down( () => D[ 0 ].texture, false ), D[ 1 ] ],
			[ down( () => D[ 1 ].texture, false ), D[ 2 ] ],
			[ down( () => D[ 2 ].texture, false ), D[ 3 ] ],
			[ down( () => D[ 3 ].texture, false ), D[ 4 ] ],
			[ up( () => D[ 4 ].texture, () => D[ 3 ].texture ), U[ 3 ] ],
			[ up( () => U[ 3 ].texture, () => D[ 2 ].texture ), U[ 2 ] ],
			[ up( () => U[ 2 ].texture, () => D[ 1 ].texture ), U[ 1 ] ],
			[ up( () => U[ 1 ].texture, () => D[ 0 ].texture ), U[ 0 ] ],
		];
		this.bloomTex = U[ 0 ];
		this.half = D[ 0 ];
		this.meterRT = D[ 3 ];

	}

	// Average log luminance (centre weighted) of a small copy of the frame, one workgroup; the
	// adapted exposure multiplier lives in a storage buffer read by the grading pass next frame.
	_buildMeter() {

		const W = 256;
		let reduce = '';
		for ( let s = W / 2; s > 0; s >>= 1 ) reduce += /* wgsl */`
	if ( t < ${ s }u ) {
		sumL[ t ] += sumL[ t + ${ s }u ];
		sumW[ t ] += sumW[ t + ${ s }u ];
	}
	workgroupBarrier();`;

		this.meterKernel = new ComputeKernel( {
			label: 'Auto Exposure',
			modules: [ commonModule ],
			bindings: {
				ae: { uniform: this.aeUniforms },
				aeTex: { texture: () => this.meterRT.texture },
				aeExposure: { storage: this.exposure, access: 'read_write' },
			},
			workgroupSize: [ W, 1, 1 ],
			code: /* wgsl */`
var<workgroup> sumL: array<f32, ${ W }>;
var<workgroup> sumW: array<f32, ${ W }>;
@compute @workgroup_size( WG_X, 1, 1 )
fn main( @builtin( local_invocation_id ) lid: vec3u ) {
	let t = lid.x;
	let size = textureDimensions( aeTex );
	let n = size.x * size.y;
	var accL = 0.0; var accW = 0.0;
	for ( var i = 0u; i < 160u; i++ ) {
		let idx = t + i * ${ W }u;
		if ( idx < n ) {
			let x = idx % size.x; let y = idx / size.x;
			let c = textureLoad( aeTex, vec2i( i32( x ), i32( y ) ), 0 ).rgb;
			let l = log2( max( luminance( c ), 1e-4 ) );
			let uvc = vec2f( ( f32( x ) + 0.5 ) / f32( size.x ), ( f32( y ) + 0.5 ) / f32( size.y ) ) - 0.5;
			let w = max( 1.0 - length( uvc * vec2f( 1.0, 1.4 ) ) * 1.2, 0.15 );
			accL += l * w;
			accW += w;
		}
	}
	sumL[ t ] = accL;
	sumW[ t ] = accW;
	workgroupBarrier();
${ reduce }
	if ( t == 0u ) {
		let avg = exp2( sumL[ 0 ] / max( sumW[ 0 ], 1e-4 ) );
		// the eye only partly compensates: dark scenes stay darker (dusk and night must not
		// look like day), and at night at most one extra stop
		let ratio = ae.refLum / avg;
		let partial = select( ratio, pow( ratio, 0.8 ), ratio > 1.0 );
		let tgt = clamp( partial, ae.min, mix( ae.max, 2.0, frame.night ) );
		let cur = aeExposure[ 0 ];
		let rate = select( ae.down, ae.up, tgt > cur );
		let k = 1.0 - exp( - frame.dt * rate );
		let next = exp2( mix( log2( max( cur, 1e-3 ) ), log2( tgt ), k ) );
		aeExposure[ 0 ] = select( 1.0, next, ae.enabled > 0.5 );
	}
}
`,
		} );

	}

	_buildFinal() {

		const modules = [ commonModule, this.motionBlur.module, this.lens.module ];
		if ( this.flare ) modules.push( this.flare.module );
		this._finalPass = new FullscreenPass( {
			label: 'final (grade + tonemap)',
			colorFormats: [ this.outputFormat ],
			modules,
			bindings: {
				post: { uniform: this.uniforms },
				postResolved: { texture: () => this.taau.output },
				postBloom: { texture: () => this.bloomTex.texture },
				postHalf: { texture: () => this.half.texture },
				postExposure: { storage: this.exposure, access: 'read' },
			},
			code: ACES + /* wgsl */`
fn tm( c: vec3f ) -> vec3f { return c / ( max( c.r, max( c.g, c.b ) ) + 1.0 ); }
fn loadResolved( p: vec2i ) -> vec3f { return textureLoad( postResolved, p, 0 ).rgb; }

// RCAS (AMD FSR1 robust contrast-adaptive sharpening) on the resolved image: TAA converges to a
// slightly soft image, RCAS restores the detail without halos (the lobe is limited by local
// contrast). Done on a tonemapped proxy of the HDR values and inverted afterwards.
fn rcas( uvIn: vec2f ) -> vec3f {
	let size = vec2i( textureDimensions( postResolved ) );
	let pc = clamp( vec2i( uvIn * vec2f( size ) ), vec2i( 1 ), size - 2 );
	let e = tm( loadResolved( pc ) );
	let b = tm( loadResolved( pc + vec2i( 0, -1 ) ) ); let d = tm( loadResolved( pc + vec2i( -1, 0 ) ) );
	let f = tm( loadResolved( pc + vec2i( 1, 0 ) ) ); let h = tm( loadResolved( pc + vec2i( 0, 1 ) ) );
	let mn4 = min( min( b, d ), min( f, h ) );
	let mx4 = max( max( b, d ), max( f, h ) );
	let hitMin = min( mn4, e ) / ( mx4 * 4.0 + 1e-5 );
	let hitMax = ( vec3f( 1.0 ) - max( mx4, e ) ) / ( mn4 * 4.0 - 4.0 );
	let lobeRGB = max( - hitMin, hitMax );
	// the sky (depth 0) is only sharpened lightly: clouds and cirrus are soft by nature, and the lobe
	// turned their sampling noise into fine grain (mbDepth: the scene depth, bound by the blur module)
	let dS = textureLoad( mbDepth, clamp( vec2i( uvIn * vec2f( textureDimensions( mbDepth ) ) ), vec2i( 0 ), vec2i( textureDimensions( mbDepth ) ) - 1 ), 0 );
	let skyK = select( 1.0, 0.3, dS < 1e-7 );
	let lobe = max( ${ - ( 0.25 - 1.0 / 16.0 ) }, min( max( lobeRGB.r, max( lobeRGB.g, lobeRGB.b ) ), 0.0 ) ) * post.sharpen * skyK;
	let r = max( ( ( b + d + f + h ) * lobe + e ) / ( lobe * 4.0 + 1.0 ), vec3f( 0.0 ) );
	// back to HDR (inverse of the max-channel Reinhard)
	return r / max( 1.0 - max( r.r, max( r.g, r.b ) ), 1e-3 );
}

// integer hash (per pixel and frame) -> [0, 1)
fn postHash( p: vec2u, f: u32 ) -> f32 {
	var x = p.x * 1664525u + p.y * 1013904223u + f * 2654435761u;
	x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
	return f32( x >> 8u ) / 16777216.0;
}

fn bloomAt( uv: vec2f ) -> vec3f { return textureSampleLevel( postBloom, smpLinearClamp, uv, 0.0 ).rgb * post.bloom; }

fn lensSharp( uv: vec2f ) -> vec3f {
	var c = mbApply( rcas( uv ), uv ) + bloomAt( uv );
${ this.flare ? '	c += flareLight( uv );' : '' }
	return c;
}
fn lensBlurred( uv: vec2f ) -> vec3f { return textureSampleLevel( postHalf, smpLinearClamp, uv, 0.0 ).rgb + bloomAt( uv ); }

fn fragment( in: FSIn ) -> vec4f {
	let uv = in.uv;
	var c = lensDroplets( uv ) * postExposure[ 0 ];
	// white balance nudge + saturation + contrast around mid grey (in linear HDR)
	c = c * vec3f( 1.0 + post.warmth, 1.0, 1.0 - post.warmth );
	let l = luminance( c );
	c = mix( vec3f( l ), c, post.saturation );
	c = pow( max( c, vec3f( 0.0 ) ) / 0.18, vec3f( post.contrast ) ) * 0.18;
	// vignette (elliptical, soft)
	let dv = ( uv - 0.5 ) * vec2f( 1.0, 0.8 );
	let v = 1.0 - smoothstep( 0.25, 0.75, length( dv ) ) * post.vignette;
	c = c * v;
	// fine film grain (luminance-weighted): triangular white noise on the real pixel grid, new every
	// frame (a fixed pattern on a fixed grid showed as diagonal hatching in dark gradients)
	let px = vec2u( in.pos.xy );
	let fi = frame.frameIndex;
	let n = ( postHash( px, fi ) + postHash( px + vec2u( 7919u, 104729u ), fi ) - 1.0 ) * 0.5;
	c = c + c * ( n * post.grain );
	// renderOutput: ACES filmic tone mapping with the exposure, sRGB transfer
	let t = acesFilmicToneMapping( c, frame.exposure );
	// +-1 LSB triangular dither before the 8-bit output: no banding in the sky gradients
	let dq = ( postHash( px + vec2u( 31337u, 271u ), fi ) + postHash( px + vec2u( 1013u, 65537u ), fi ) - 1.0 ) / 255.0;
	return vec4f( linearToSrgb( t ) + vec3f( dq ), 1.0 );
}
`,
		} );

	}

	// ---------------------------------------------------------------- sizes

	_outputSize() {

		if ( this.outputSize ) return this.outputSize;
		const r = this.renderer;
		if ( r && r.width ) return { width: r.width, height: r.height };
		if ( GPU.canvas ) return { width: GPU.canvas.width, height: GPU.canvas.height };
		return { width: 1, height: 1 };

	}

	_resize() {

		const { width: ow, height: oh } = this._outputSize();
		const iw = Math.max( 1, Math.round( ow * this.scale ) ), ih = Math.max( 1, Math.round( oh * this.scale ) );
		if ( ow === this._outW && oh === this._outH && iw === this._inW && ih === this._inH ) return;
		this._outW = ow; this._outH = oh; this._inW = iw; this._inH = ih;
		this.sceneRenderer.setSize( iw, ih );
		this.beauty.setSize( iw, ih );
		this.smaaIn.setSize( iw, ih );
		this.medium.setSize( iw, ih );
		if ( this.underwater.setSize ) this.underwater.setSize( iw, ih );
		// rtt resolution scales of the original are relative to the drawing buffer (output) size
		this.aoPass.resolutionScale = 0.5 * this.scale;
		this.aoPass.setSize( ow, oh );
		const aw = Math.round( ow * 0.5 * this.scale ), ah = Math.round( oh * 0.5 * this.scale );
		this.aoDepth.setSize( aw, ah );
		this.aoBlurX.setSize( aw, ah );
		this.aoBlurY.setSize( aw, ah );
		if ( this.haze ) this.haze.setSize( ow, oh );
		this.taau.setSize( ow, oh );
		if ( this.bloomDown ) {

			this.bloomScales.forEach( ( s, i ) => this.bloomDown[ i ].setSize( Math.round( ow * s ), Math.round( oh * s ) ) );
			this.bloomScales.slice( 0, 4 ).forEach( ( s, i ) => this.bloomUp[ i ].setSize( Math.round( ow * s ), Math.round( oh * s ) ) );

		}

		if ( this.flare ) this.flare.setDepthHeight( ih );
		this.lens.aspect.value = ow / oh;

	}

	// internal render resolution (0.5 .. 1) for dynamic resolution
	setScale( s ) {

		if ( s === this.scale ) return;
		this.scale = s;
		this.sceneRenderer.scale = s;
		if ( this.haze ) this.haze.setScale( s );

	}

	setBloom( v ) {

		this.params.bloom.value = v;

	}

	// the internal (scene) size of this frame
	internalSize( target = new Vector2() ) {

		return target.set( this._inW, this._inH );

	}

	// size the targets, jitter the camera for this frame and write it into the frame uniforms (call
	// before rendering the scene)
	beginFrame() {

		if ( ! this._built ) {

			this._build();
			this._outW = 0; // bloom targets now exist

		}

		this._resize();
		const cam = this.camera;
		cam.updateMatrixWorld();
		if ( cam.matrixWorldInverse ) cam.matrixWorldInverse.copy( cam.matrixWorld ).invert();
		this.motionBlur.updateCamera( cam );
		this.taau.advance();
		const [ jx, jy ] = this.aaMode === 'taa' || this.aaMode === 'smaataa' ? this.taau.jitter() : [ 0, 0 ];
		// three's setViewOffset( w, h, jx, jy, w, h ) moves the view window by +jx px right / +jy px down,
		// i.e. a clip-space translation of ( -2 jx / w, +2 jy / h )
		setFrameCamera( cam, this._inW, this._inH, {
			jitterX: - jx, jitterY: jy,
			prevViewProj: this._hasPrev ? this._prevVP : null,
			prevCameraPos: this._hasPrev ? this._prevCamPos : null,
		} );
		const F = FrameUniforms.fields;
		F.outputResolution.value.set( this._outW, this._outH );
		this._prevVP.copy( F.viewProjNoJitter.value );
		this._prevCamPos.copy( F.cameraPos.value );
		this._hasPrev = true;

	}

	render() {

		if ( ! this._built ) this.beginFrame();
		const T = this._timers || null;
		this.motionBlur.compute( this._outW, this._outH );
		this._aoDepthPass.render( { colorViews: [ this.aoDepth.texture ], clear: CLR } );
		this.aoPass.render();
		this._aoBlurXPass.render( { colorViews: [ this.aoBlurX.texture ], clear: CLR } );
		this._aoBlurYPass.render( { colorViews: [ this.aoBlurY.texture ], clear: CLR } );
		this._mediumPass.render( { colorViews: [ this.medium.texture ], clear: CLR } );
		// caustic shafts / torch beam march (half res): only while the lens can be under water (the CPU
		// water height lags the GPU's by a frame: 1 m of margin)
		if ( this.underwater.renderShafts ) this.underwater.renderShafts( this.camera.position.y < G.cameraWaterHeight.value + LENS_REACH + 1.0 );
		if ( this.haze ) {

			this.haze.update();
			this.haze.render();

		}

		this._beautyPass.render( { colorViews: [ this.beauty.texture ], clear: CLR } );
		if ( this.aaMode === 'taa' || this.aaMode === 'smaataa' ) {

			if ( this.aaMode === 'smaataa' ) this.aa.render( 'smaa', this.smaaIn.texture );
			this.taau.render();

		} else {

			// into the upscaler's other history target (the resolved image); it restarts when TAA returns
			const t = this.taau, dst = 1 - t._cur;
			this.aa.render( this.aaMode, t.history[ dst ].textures[ 0 ] );
			t._cur = dst;
			t._needsRestart = true;

		}
		for ( const [ pass, rt ] of this._bloomPasses ) pass.render( { colorViews: [ rt.texture ], clear: CLR } );
		const out = this.outputTexture ? this.outputTexture.view( { dimension: '2d', mipLevelCount: 1 } ) : GPU.context.getCurrentTexture().createView();
		this._finalPass.render( { colorViews: [ out ], clear: CLR } );
		// meter this frame's image; the result is used from the next frame on
		this.meterKernel.dispatch( [ 1, 1, 1 ] );
		void T;

	}

	endFrame() {

		this.taau.clearViewOffset();
		this.taau.endFrame();

	}

	// every pass with its GPU object, for the profiler: [ name, pass ]
	passes() {

		const list = [ [ 'motion blur tiles', this.motionBlur.tileKernel ], [ 'motion blur neighbours', this.motionBlur.neighborKernel ],
			[ 'GTAO', this.aoPass._pass ], [ 'AO blur x', this._aoBlurXPass ], [ 'AO blur y', this._aoBlurYPass ], [ 'medium', this._mediumPass ] ];
		if ( this.haze && this.haze._passes ) {

			list.push( [ 'haze march', this.haze._passes.march ], [ 'haze sun mask', this.haze._passes.mask ] );
			this.haze._passes.blur.forEach( ( p, i ) => list.push( [ 'haze god rays ' + i, p ] ) );

		}

		if ( this.underwater._shaftPass ) list.push( [ 'underwater shafts', this.underwater._shaftPass ] );
		list.push( [ 'beauty', this._beautyPass ], [ 'TAAU', this.taau._resolve[ 0 ] ], [ 'TAAU ', this.taau._resolve[ 1 ] ] );
		this._bloomPasses.forEach( ( [ p ], i ) => list.push( [ 'bloom ' + i, p ] ) );
		list.push( [ 'final', this._finalPass ], [ 'auto exposure', this.meterKernel ] );
		if ( this.flare ) list.push( [ 'flare visibility', this.flare.kernel ] );
		return list;

	}

}

export { Texture };
// the game's tone curve, for other views that present HDR (the catch card's fish portrait)
export { ACES as ACES_WGSL };
