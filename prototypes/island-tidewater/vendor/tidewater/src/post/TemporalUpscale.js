import { GPU } from '../engine/gpu/GPU.js';
import { UniformBlock } from '../engine/gpu/Shader.js';
import { RenderTarget, StorageBuffer, Texture } from '../engine/gpu/Texture.js';
import { FullscreenPass } from '../engine/render/FullscreenPass.js';
import { FrameUniforms } from '../engine/render/Frame.js';
import { Matrix4, Vector2 } from '../engine/math/index.js';

// full-screen passes overwrite every pixel: clear instead of load (no tile load of the old contents on
// tile-based GPUs)
const CLR = [ 0, 0, 0, 0 ];

// Temporal anti-aliasing / upscaling: the accumulation of AMD FidelityFX Super Resolution 2
// (FSR2 2.2, ffx_fsr2_accumulate.h, _upsample.h, _lock.h, _postprocess_lock_status.h, MIT licence),
// in one pass. The depth dilation, reprojection and disocclusion test stay three's TAAUNode ones.
//  - the current frame is reconstructed at the output pixel with a Lanczos-2 kernel over the 3x3
//    input taps around it, and weighs by how close its jittered samples fall to the pixel: history
//    and frame blend by their accumulated sample weights, not by a fixed share
//  - the history is clamped to the neighbourhood's variance box (intersected with its extent), and
//    a clamp drops the accumulated weight, so the new frames take over quickly
//  - except where the clamp would destroy real detail:
//      locks: a pixel that is a one-pixel ridge in the current frame (brighter or darker than all its
//        dissimilar neighbours, with no 2x2 block of similar ones: thin rails, wires, plank gaps)
//        is locked; while the lock lives and the local shading doesn't change, its history is kept
//        instead of clamped
//      luma instability: the local luma of the last 4 frames is kept per pixel; a value that
//        returns to an older one instead of the last (oscillation: sub-pixel detail hit and missed
//        by the jitter) keeps the history instead of clamping it
//  - history resampling is a 5-tap Catmull-Rom (FSR2: Lanczos-2), in motion the accumulation is
//    capped (fast response) and the box is tightened
// Two changes for native resolution, measured against a 16x supersampled reference walking the pier
// (test/taa-pier.mjs): a wider box while still, and an accumulation cap by the history's resampling
// blur (see the resolve).
// FSR2's reactive and transparency masks are not used. The water surface (it moves on its own and its
// motion vectors only carry the camera's) keeps its history through the disocclusion test.
// Jitter: FSR2's Halton (2, 3) with 8 x (output / input)^2 phases, driven by the post chain:
// PostFX.beginFrame() takes jitter() for the frame's camera (setFrameCamera) and endFrame() calls
// clearViewOffset() to advance it. The history is ping-ponged (the resolve writes the other target).
// Inputs: beauty (internal res, getter), the scene's reversed-Z depth, velocity (uv motion, current -
// previous, y down: history uv = uv - velocity), water mask (g = 1 on water surface pixels), the
// exposure (a storage buffer, times frame.exposure: FSR2's thresholds are in display-referred units).

function halton( index, base ) {

	let fraction = 1;
	let result = 0;
	while ( index > 0 ) {

		fraction /= base;
		result += fraction * ( index % base );
		index = Math.floor( index / base );

	}

	return result;

}

export class TemporalUpscale {

	static DEBUG_VIEWS = [ 'Off', 'Locks (green: holding, blue: new)', 'Luma instability (red)', 'Clamped (red) / kept (green)', 'New frame weight', 'Motion (px / frame)', 'Resampling blur (blue)', 'Still pixels kept (yellow)' ];

	constructor( beauty, depthTexture, velocityTexture, camera, waterMaskTexture = null, exposure = null ) {

		this.beauty = beauty; // Texture or getter
		this.depthTexture = depthTexture;
		this.velocityTexture = velocityTexture;
		this.waterMaskTexture = waterMaskTexture;
		this.camera = camera;
		this.exposure = exposure || new StorageBuffer( { label: 'taauExposure', count: 1, type: 'f32', data: new Float32Array( [ 1 ] ) } );

		this.uniforms = new UniformBlock( 'TAAUParams', {
			prevInvViewProj: [ 'mat4x4f', new Matrix4() ],
			jitterOffset: [ 'vec2f', new Vector2() ],
			cameraNearFar: [ 'vec2f', new Vector2( 0.1, 1000 ) ],
			depthThreshold: [ 'f32', 0.0005 ],
			edgeDepthDiff: [ 'f32', 0.001 ],
			hasWaterMask: [ 'f32', waterMaskTexture ? 1 : 0 ],
			jitterPhases: [ 'f32', 8 ],
			reset: [ 'f32', 1 ],
			debugView: [ 'f32', 0 ],
			// tuning (see settings)
			boxStill: [ 'f32', 3 ],
			boxMotion: [ 'f32', 1 ],
			maxAccumulation: [ 'f32', 2 ],
			motionAccumulation: [ 'f32', 10 ],
			blurComp: [ 'f32', 0.5 ],
			locks: [ 'f32', 1 ],
			instability: [ 'f32', 1 ],
			lockThreshold: [ 'f32', 1.05 ],
			staticKeep: [ 'f32', 1 ],
		}, { label: 'taau' } );
		// tuning uniforms (.value), for the UI:
		//  boxStill / boxMotion: clamp box half size in standard deviations, still (FSR2: 1 at native) /
		//    at 20 px per frame and above
		//  maxAccumulation: history length (FSR2 1: ~13 frames; 2 here, a still image steadier); motionAccumulation: its cap in motion,
		//    in frames' weights (FSR2 10)
		//  blurComp: accumulation cap by the history's resampling blur (0 = FSR2)
		//  locks / instability: FSR2's thin-feature locks and luma instability (1 on, 0 off)
		//  staticKeep: still pixels keep their history unless the local luma changed (0 = FSR2)
		//  lockThreshold: luma ratio under which a neighbour counts as similar to the centre (FSR2 1.05)
		this.settings = this.uniforms.fields;
		// jitter phases, the anti-aliasing sample count (0: FSR2's 8 x (output / input)^2; 4 here, the
		// UI's default); debug view (DEBUG_VIEWS index)
		this.jitterPhaseOverride = 4;
		// jitter amplitude (1: the full pixel, FSR2; less: steadier sub-pixel detail, less anti-aliasing;
		// 0.5 here: the distant deck boards shimmered at the full pixel)
		this.jitterScale = 0.5;
		// jitter amplitude while the camera moves (times jitterScale): in motion the jitter's frame to
		// frame change of sub-pixel detail (distant plank gaps hit on one frame, missed on the next) adds
		// to the motion's own and flickers, while the motion already moves the samples over the pixels.
		// Full amplitude from still up to ~0.1 m or ~0.03 degrees per frame, this from ~0.6 m/s walking.
		this.jitterMoving = 0.35;
		this._camMotion = 0;
		this._camPrev = null;
		this.debugView = 0;
		const U = this.uniforms.fields;
		this._jitterOffset = U.jitterOffset;
		this._jitterIndex = 0;
		this._outW = 1;

		// history: the resolved colour; lock status (x: lifetime remaining, y: shading luma when locked,
		// z: temporal reactive factor, < 0 in motion, w: the history's resampling blur); the local luma
		// of the last 4 frames
		const hist = () => ( { colors: [
			{ format: 'rgba16float', name: 'color' }, { format: 'rgba16float', name: 'lock' }, { format: 'rgba8unorm', name: 'lumaHistory' },
		], label: 'taauHistory' } );
		this.history = [ new RenderTarget( 1, 1, hist() ), new RenderTarget( 1, 1, hist() ) ];
		this._cur = 0;
		this._prevDepth = new Texture( { label: 'taauPrevDepth', width: 1, height: 1, format: 'depth32float', usage: [ 'sample', 'copyDst' ] } );
		this._hasPrevInvVP = false;
		this._needsRestart = true;
		this._build();

	}

	// resolved image of this frame (output resolution)
	get texture() {

		return this.history[ this._cur ].textures[ 0 ];

	}

	// what the post chain shows: the resolved image, or the debug view
	get output() {

		return this.debugView > 0 && this._debugTarget ? this._debugTarget.texture : this.texture;

	}

	getTextureNode() {

		return this.texture;

	}

	setSize( w, h ) {

		const a = this.history[ 0 ].setSize( w, h );
		this.history[ 1 ].setSize( w, h );
		this._outW = w;
		if ( a ) this._needsRestart = true;

	}

	_beautyTexture() {

		return typeof this.beauty === 'function' ? this.beauty() : this.beauty;

	}

	// jitter (input pixels) for this frame's camera, as three's setViewOffset( w, h, jx, jy, w, h )
	jitter() {

		// FSR2 ffxFsr2GetJitterPhaseCount / ffxFsr2GetJitterOffset
		const b = this._beautyTexture();
		const ratio = b && b.width ? this._outW / b.width : 1;
		const phases = this.jitterPhaseOverride || Math.max( 1, Math.ceil( 8 * ratio * ratio ) );
		this.uniforms.fields.jitterPhases.value = phases;
		const i = this._jitterIndex % phases;
		const k = this.jitterScale * ( 1 + ( this.jitterMoving - 1 ) * this._cameraMotion() );
		this.jitterNow = k; // (the UI shows it)
		const jx = ( halton( i + 1, 2 ) - 0.5 ) * k, jy = ( halton( i + 1, 3 ) - 0.5 ) * k;
		this._jitterOffset.value.set( jx, jy );
		return [ jx, jy ];

	}

	// 0 (still) .. 1 (moving) from the camera's world matrix since the last frame, eased out over a few
	// frames so a pause mid-walk doesn't switch the jitter back and forth
	_cameraMotion() {

		const m = this.camera && this.camera.matrixWorld;
		if ( ! m ) return 0;
		const e = m.elements;
		const cur = [ e[ 12 ], e[ 13 ], e[ 14 ], e[ 8 ], e[ 9 ], e[ 10 ] ];
		let target = 0;
		if ( this._camPrev ) {

			const p = this._camPrev;
			const dPos = Math.hypot( cur[ 0 ] - p[ 0 ], cur[ 1 ] - p[ 1 ], cur[ 2 ] - p[ 2 ] );
			const dDir = Math.hypot( cur[ 3 ] - p[ 3 ], cur[ 4 ] - p[ 4 ], cur[ 5 ] - p[ 5 ] ); // ~ angle (rad)
			target = Math.min( 1, Math.max( ( dPos - 0.002 ) / 0.008, ( dDir - 0.0005 ) / 0.0015 ) );
			target = Math.max( 0, target );

		}

		this._camPrev = cur;
		this._camMotion = target > this._camMotion ? target : this._camMotion + ( target - this._camMotion ) * 0.15;
		return this._camMotion;

	}

	clearViewOffset() {

		this._jitterIndex = ( this._jitterIndex + 1 ) % 1024;

	}

	_build() {

		const beautyTex = () => this._beautyTexture();
		const bindings = ( src ) => ( {
			taau: { uniform: this.uniforms },
			taauBeauty: { texture: beautyTex },
			taauDepth: { texture: () => this.depthTexture },
			taauPrevDepth: { texture: () => this._prevDepth },
			taauVelocity: { texture: () => this.velocityTexture },
			taauMask: { texture: () => this.waterMaskTexture || this.velocityTexture },
			taauHistory: { texture: () => this.history[ src ].textures[ 0 ] },
			taauLock: { texture: () => this.history[ src ].textures[ 1 ] },
			taauLumaHistory: { texture: () => this.history[ src ].textures[ 2 ] },
			taauExposure: { storage: this.exposure, access: 'read' },
		} );

		const code = /* wgsl */`
const TAAU_EPS = 1e-3;
const TAAU_LANCZOS_WEIGHT_SCALE = 1.0 / 12.0;
const TAAU_AVG_LANCZOS_WEIGHT_PER_FRAME = 0.74 / 12.0;

fn taauToYCoCg( c: vec3f ) -> vec3f {
	return vec3f( dot( c, vec3f( 0.25, 0.5, 0.25 ) ), dot( c, vec3f( 0.5, 0.0, -0.5 ) ), dot( c, vec3f( -0.25, 0.5, -0.25 ) ) );
}
fn taauFromYCoCg( c: vec3f ) -> vec3f { return vec3f( c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z ); }
// FSR2 Tonemap / InverseTonemap (max channel Reinhard)
fn taauTonemap( c: vec3f ) -> vec3f { return c / ( max( max( 0.0, c.r ), max( c.g, c.b ) ) + 1.0 ); }
fn taauTonemapInverse( c: vec3f ) -> vec3f { return c / max( 1e-4, 1.0 - max( c.r, max( c.g, c.b ) ) ); }
fn taauMinDivMax( a: f32, b: f32 ) -> f32 { let m = max( a, b ); return select( 0.0, min( a, b ) / m, m != 0.0 ); }
// Lanczos-2 of the squared distance (FSR2 Lanczos2ApproxSq)
fn taauLanczos2Sq( x2In: f32 ) -> f32 {
	let x2 = min( x2In, 4.0 );
	let a = 0.4 * x2 - 1.0;
	let b = 0.25 * x2 - 1.0;
	return ( 1.5625 * a * a - 0.5625 ) * ( b * b );
}
// luma for the lock logic (FSR2 ComputeLockInputLuma: perceived lightness of the tone mapped colour, ^1/6)
fn taauLockLuma( rgb: vec3f ) -> f32 {
	let l = luminance( taauTonemap( rgb ) );
	let p = select( pow( l, 1.0 / 3.0 ) * 116.0 - 16.0, l * ( 24389.0 / 27.0 ), l <= 216.0 / 24389.0 ) * 0.01;
	return pow( max( p, 0.0 ), 1.0 / 6.0 );
}

// Catmull-Rom history lookup with 5 bilinear taps (the 4 corner taps are dropped)
fn taauSampleHistory( uvIn: vec2f ) -> vec4f {
	let size = vec2f( textureDimensions( taauHistory ) );
	let samplePos = uvIn * size;
	let texPos1 = floor( samplePos - 0.5 ) + 0.5;
	let f = samplePos - texPos1;
	let w0 = f * ( f * ( f * -0.5 + 1.0 ) - 0.5 );
	let w1 = f * f * ( f * 1.5 - 2.5 ) + 1.0;
	let w2 = f * ( f * ( f * -1.5 + 2.0 ) + 0.5 );
	let w3 = f * f * ( f * 0.5 - 0.5 );
	let w12 = w1 + w2;
	let tp0 = ( texPos1 - 1.0 ) / size;
	let tp3 = ( texPos1 + 2.0 ) / size;
	let tp12 = ( texPos1 + w2 / w12 ) / size;
	let wa = w12.x * w0.y; let wb = w0.x * w12.y; let wc = w12.x * w12.y; let wd = w3.x * w12.y; let we = w12.x * w3.y;
	let sum = textureSampleLevel( taauHistory, smpLinearClamp, vec2f( tp12.x, tp0.y ), 0.0 ) * wa
		+ textureSampleLevel( taauHistory, smpLinearClamp, vec2f( tp0.x, tp12.y ), 0.0 ) * wb
		+ textureSampleLevel( taauHistory, smpLinearClamp, vec2f( tp12.x, tp12.y ), 0.0 ) * wc
		+ textureSampleLevel( taauHistory, smpLinearClamp, vec2f( tp3.x, tp12.y ), 0.0 ) * wd
		+ textureSampleLevel( taauHistory, smpLinearClamp, vec2f( tp12.x, tp3.y ), 0.0 ) * we;
	return max( sum / ( wa + wb + wc + wd + we ), vec4f( 0.0 ) );
}

fn taauLoadBeauty( p: vec2i ) -> vec4f {
	let s = vec2i( textureDimensions( taauBeauty ) );
	return textureLoad( taauBeauty, clamp( p, vec2i( 0 ), s - 1 ), 0 );
}

// standard (0 near .. 1 far) perspective depth of the reversed-Z buffer at p (clamped)
fn taauDepthAt( p: vec2i ) -> f32 {
	let s = vec2i( textureDimensions( taauDepth ) );
	return 1.0 - textureLoad( taauDepth, clamp( p, vec2i( 0 ), s - 1 ), 0 );
}

// last frame's depth at uv, reprojected into this frame's camera (standard perspective depth)
fn taauPreviousDepth( uv: vec2f ) -> f32 {
	let s = vec2i( textureDimensions( taauPrevDepth ) );
	let d = textureLoad( taauPrevDepth, clamp( vec2i( uv * vec2f( s ) ), vec2i( 0 ), s - 1 ), 0 );
	let pw = taau.prevInvViewProj * vec4f( uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, d, 1.0 );
	let world = pw.xyz / pw.w;
	let viewZ = ( frame.view * vec4f( world, 1.0 ) ).z;
	let near = taau.cameraNearFar.x; let far = taau.cameraNearFar.y;
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}

fn taauInside( uv: vec2f ) -> bool { return all( uv >= vec2f( 0.0 ) ) && all( uv <= vec2f( 1.0 ) ); }

struct TaauOut { @location( 0 ) color: vec4f, @location( 1 ) lock: vec4f, @location( 2 ) lumaHistory: vec4f, DEBUG_FIELD };
@fragment fn fs( in: FSIn ) -> TaauOut {
	let uv = in.uv;
	let inSize = vec2f( textureDimensions( taauBeauty ) );
	let outSize = vec2f( textureDimensions( taauHistory ) );
	let downscale = inSize / outSize; // FSR2 DownscaleFactor (render / display)
	let exposure = taauExposure[ 0 ] * frame.exposure;

	// output pixel centre in input pixels; the input tap whose jittered sample is closest
	let pIn = uv * inSize;
	let closestTap = vec2i( round( pIn - ( vec2f( 0.5 ) + taau.jitterOffset ) ) );

	// ---- reprojection (three's TAAUNode): velocity of the nearest depth in the 3x3, disocclusion
	var closestDepth = 2.0;
	var closestPositionTexel = vec2i( 0 );
	var farthestDepth = -1.0;
	for ( var y = -1; y <= 1; y++ ) {
		for ( var x = -1; x <= 1; x++ ) {
			let neighbor = closestTap + vec2i( x, y );
			let depth = taauDepthAt( neighbor );
			if ( depth < closestDepth ) {
				closestDepth = depth;
				closestPositionTexel = neighbor;
			}
			farthestDepth = max( farthestDepth, depth );
		}
	}
	let vs = vec2i( textureDimensions( taauVelocity ) );
	let velocity = textureLoad( taauVelocity, clamp( closestPositionTexel, vec2i( 0 ), vs - 1 ), 0 ).xy;
	let historyUV = uv - velocity;
	let hrVelocity = length( velocity * outSize ); // output pixels per frame
	let isEdge = farthestDepth - closestDepth > taau.edgeDepthDiff;
	let isDisocclusion = closestDepth - taauPreviousDepth( historyUV ) > taau.depthThreshold;
	// the water surface keeps its history (its depth changes with the waves, not with occlusion)
	let ms = vec2i( textureDimensions( taauMask ) );
	let isWater = taau.hasWaterMask > 0.5 && textureLoad( taauMask, clamp( closestTap, vec2i( 0 ), ms - 1 ), 0 ).g > 0.5;
	let isExistingSample = taauInside( historyUV );
	let depthClip = select( 0.0, 1.0, isDisocclusion && ! isEdge && ! isWater );
	let isNewSample = ! isExistingSample || taau.reset > 0.5;

	// ---- history (FSR2 ReprojectHistoryColor / ReprojectHistoryLockStatus)
	var historyColor = vec3f( 0.0 );
	var lockStatus = vec2f( 0.0 );
	var temporalReactive = 0.0;
	var inMotionLastFrame = false;
	var blurPrev = 0.0;
	if ( ! isNewSample ) {
		historyColor = taauToYCoCg( min( taauSampleHistory( historyUV ).rgb * exposure, vec3f( 65504.0 ) ) );
		let ls = textureSampleLevel( taauLock, smpLinearClamp, historyUV, 0.0 );
		lockStatus = ls.xy;
		temporalReactive = sat( abs( ls.z ) );
		inMotionLastFrame = ls.z < 0.0;
		blurPrev = ls.w;
	}

	// ---- the 3x3 input taps: prepared (exposed) YCoCg colour, lock luma
	var samples: array<vec3f, 9>;
	var lumas: array<f32, 9>;
	var lumaSum = 0.0;
	for ( var i = 0; i < 9; i++ ) {
		let tap = closestTap + vec2i( i % 3 - 1, i / 3 - 1 );
		let rgb = min( max( taauLoadBeauty( tap ).rgb, vec3f( 0.0 ) ) * exposure, vec3f( 65504.0 ) );
		samples[ i ] = taauToYCoCg( rgb );
		lumas[ i ] = taauLockLuma( rgb );
		lumaSum += lumas[ i ];
	}

	// ---- new lock: the centre tap is a thin feature (FSR2 ComputeThinFeatureConfidence)
	var newLock = false;
	{
		let nucleus = lumas[ 4 ];
		var mask = 1u << 4u;
		var dMin = 3.4e38;
		var dMax = 0.0;
		for ( var i = 0; i < 9; i++ ) {
			if ( i == 4 ) { continue; }
			let l = lumas[ i ];
			let diff = max( l, nucleus ) / min( l, nucleus );
			if ( diff > 0.0 && diff < taau.lockThreshold ) { mask |= 1u << u32( i ); } else { dMin = min( dMin, l ); dMax = max( dMax, l ); }
		}
		let isRidge = nucleus > dMax || nucleus < dMin;
		let q0 = ( 1u << 0u ) | ( 1u << 1u ) | ( 1u << 3u ) | ( 1u << 4u );
		let q1 = ( 1u << 1u ) | ( 1u << 2u ) | ( 1u << 4u ) | ( 1u << 5u );
		let q2 = ( 1u << 3u ) | ( 1u << 4u ) | ( 1u << 6u ) | ( 1u << 7u );
		let q3 = ( 1u << 4u ) | ( 1u << 5u ) | ( 1u << 7u ) | ( 1u << 8u );
		newLock = isRidge && ( mask & q0 ) != q0 && ( mask & q1 ) != q1 && ( mask & q2 ) != q2 && ( mask & q3 ) != q3;
	}

	// ---- lock status (FSR2 UpdateLockStatus). The shading change luma is the local mean lock luma
	// (FSR2 reads a coarse mip of the luma)
	var thisFrameReactive = temporalReactive;
	let shadingLuma = lumaSum / 9.0;
	if ( lockStatus.y == 0.0 ) { lockStatus.y = shadingLuma; }
	let luminanceDiff = 1.0 - taauMinDivMax( lockStatus.y, shadingLuma );
	if ( newLock ) {
		lockStatus.y = shadingLuma;
		lockStatus.x = select( 1.0, 2.0, lockStatus.x != 0.0 );
	} else if ( lockStatus.x <= 1.0 ) {
		lockStatus.y = mix( lockStatus.y, shadingLuma, 0.5 );
	} else if ( luminanceDiff > 0.1 ) {
		lockStatus.x = 0.0;
	}
	thisFrameReactive = max( thisFrameReactive, sat( ( luminanceDiff - 0.1 ) * 10.0 ) );
	lockStatus.x *= 1.0 - thisFrameReactive;
	lockStatus.x *= select( 0.0, 1.0, depthClip < 0.1 );
	let lockContribution = sat( sat( sat( lockStatus.x - 1.0 ) * 4.0 ) * sat( taauMinDivMax( lockStatus.y, shadingLuma ) ) ) * taau.locks;

	// ---- this frame at the output pixel: Lanczos-2 over the 3x3 taps, and the rectification box
	// (FSR2 ComputeUpsampledColorAndWeight)
	let kernelReactive = max( thisFrameReactive, select( 0.0, 1.0, isNewSample ) );
	let maxKernelWeight = min( 1.99, 1.0 + ( 1.0 / downscale.x - 1.0 ) );
	let kernelBiasMax = maxKernelWeight * ( 1.0 - kernelReactive );
	let kernelBiasMin = max( 1.0, ( 1.0 + kernelBiasMax ) * 0.3 );
	let kernelBias = mix( kernelBiasMax, kernelBiasMin, max( 0.25 * depthClip, kernelReactive ) );
	let rectCurveBias = mix( -2.0, -3.0, sat( hrVelocity / 50.0 ) );
	var colorSum = vec3f( 0.0 );
	var weightSum = 0.0;
	var boxCenter = vec3f( 0.0 );
	var boxVec = vec3f( 0.0 );
	var boxWeight = 0.0;
	var aabbMin = vec3f( 3.4e38 );
	var aabbMax = vec3f( -3.4e38 );
	let iSize = vec2i( inSize );
	for ( var i = 0; i < 9; i++ ) {
		let tap = closestTap + vec2i( i % 3 - 1, i / 3 - 1 );
		let offset = vec2f( tap ) + vec2f( 0.5 ) + taau.jitterOffset - pIn; // sample position - output position
		let onScreen = all( tap >= vec2i( 0 ) ) && all( tap < iSize );
		let ob = offset * kernelBias;
		let w = select( 0.0, taauLanczos2Sq( dot( ob, ob ) ), onScreen );
		let c = samples[ i ];
		colorSum += c * w;
		weightSum += w;
		let bw = exp( rectCurveBias * dot( offset, offset ) );
		boxCenter += c * bw;
		boxVec += c * c * bw;
		boxWeight += bw;
		aabbMin = min( aabbMin, c );
		aabbMax = max( aabbMax, c );
	}
	boxCenter /= boxWeight;
	boxVec = sqrt( abs( boxVec / boxWeight - boxCenter * boxCenter ) );
	var upsampledWeight = select( 0.0, weightSum, weightSum > TAAU_EPS );
	var upsampled = vec3f( 0.0 );
	if ( upsampledWeight > TAAU_EPS ) {
		// deringing: the Lanczos lobes can't leave the neighbourhood's range
		upsampled = clamp( colorSum / upsampledWeight, aabbMin, aabbMax );
		upsampledWeight *= TAAU_LANCZOS_WEIGHT_SCALE;
	}

	// ---- luma instability (FSR2 ComputeLumaInstabilityFactor): the local luma returning to an older
	// value instead of the last one
	var lumaInstability = 0.0;
	var lumaHist = vec4f( 0.0 );
	var staticKeep = 0.0;
	{
		var curLuma = boxCenter.x / ( 1.0 + max( 0.0, boxCenter.x ) );
		curLuma = round( curLuma * 255.0 ) / 255.0;
		let sampleHist = max( depthClip, luminanceDiff ) < 0.1 && ! isNewSample;
		if ( sampleHist ) { lumaHist = textureSampleLevel( taauLumaHistory, smpLinearClamp, historyUV, 0.0 ); }
		let d0 = curLuma - lumaHist.x;
		var dmin = abs( d0 );
		if ( dmin >= 1.0 / 255.0 ) {
			for ( var i = 1; i < 4; i++ ) {
				let d1 = curLuma - lumaHist[ i ];
				if ( sign( d0 ) == sign( d1 ) ) { dmin = min( dmin, abs( d1 ) ); }
			}
			let boxSizeFactor = pow( sat( boxVec.x / 0.1 ), 6.0 );
			lumaInstability = select( 0.0, 1.0, dmin != abs( d0 ) ) * boxSizeFactor;
			lumaInstability = select( 0.0, 1.0, lumaInstability > 1.0 / 255.0 );
		}
		lumaInstability *= select( 0.0, 1.0, lumaHist.w != 0.0 ) * taau.instability;
		// Still pixels (not in FSR2): with the camera and the surface still, a clamp can only be the
		// jitter's doing (a sub-pixel plank gap that the 3x3 misses in this frame's samples), unless the
		// lighting changed. A real change (a shadow moving in) leaves the local luma away from all of
		// the last 4 frames'; the jitter brings it back to one of them. Such pixels keep their history.
		let dAll = min( min( abs( curLuma - lumaHist.x ), abs( curLuma - lumaHist.y ) ), min( abs( curLuma - lumaHist.z ), abs( curLuma - lumaHist.w ) ) );
		staticKeep = taau.staticKeep * select( 0.0, 1.0, hrVelocity < 0.05 && lumaHist.w != 0.0 && ! isWater ) * sat( 1.0 - ( dAll - 0.01 ) / 0.03 );
		lumaHist = vec4f( curLuma, lumaHist.xyz );
	}

	// ---- accumulation weight (FSR2 ComputeBaseAccumulationWeight)
	var accumulation = taau.maxAccumulation * select( 0.0, 1.0, isExistingSample ) * ( 1.0 - thisFrameReactive ) * ( 1.0 - depthClip );
	accumulation = min( accumulation, mix( accumulation, upsampledWeight * taau.motionAccumulation, max( select( 0.0, 1.0, inMotionLastFrame ), sat( hrVelocity * 10.0 ) ) ) );
	accumulation = min( accumulation, mix( accumulation, upsampledWeight, sat( hrVelocity / 20.0 ) ) );

	// Resampling blur (not in FSR2): even the Catmull-Rom loses fine detail when it samples between
	// texels, and in motion the history is resampled that way every frame (at 0.2 px ~80% of the
	// finest detail survives a resample). The blur the history has gathered (the variance its
	// resamples added, f (1 - f) per axis, decayed by the blend) caps the accumulation, so a blurred
	// history takes a larger share of the sharp new frame; a still camera resamples at texel centres.
	let hf = fract( historyUV * outSize - 0.5 );
	let hv = hf * ( 1.0 - hf );
	let blurAcc = blurPrev + hv.x + hv.y;
	let blurAlpha = min( blurAcc * taau.blurComp, select( 1.0, 0.15, isWater ) );
	accumulation = min( accumulation, upsampledWeight * ( 1.0 - blurAlpha ) / max( blurAlpha, 1e-3 ) );

	var outColor: vec3f;
	var alphaOut = 1.0;
	var dbgClamp = vec2f( 0.0 );
	if ( isNewSample ) {
		outColor = taauFromYCoCg( upsampled );
	} else {
		// rectify (FSR2 RectifyHistory): clamp to the variance box, but keep locked and oscillating
		// pixels' history; a clamp drops the accumulated weight
		// FSR2 widens the box while still by the upscale factor (1 at native: a 1 sigma box that clamped
		// the sub-pixel plank gaps out of the history, frame after frame); at least 3 sigma here
		let scaleInfluence = max( taau.boxStill, min( 20.0, pow( 1.0 / abs( downscale.x * downscale.y ), 3.0 ) ) );
		let boxScaleT = max( depthClip, sat( hrVelocity / 20.0 ) );
		let boxScale = mix( scaleInfluence, taau.boxMotion, boxScaleT );
		let boxMin = max( aabbMin, boxCenter - boxVec * boxScale );
		let boxMax = min( aabbMax, boxCenter + boxVec * boxScale );
		if ( any( boxMin > historyColor ) || any( historyColor > boxMax ) ) {
			let clamped = clamp( historyColor, boxMin, boxMax );
			// (not on the water: its glints move on their own and would leave trails)
			let contribution = select( sat( max( max( lumaInstability, lockContribution ), staticKeep ) ), 0.0, isWater );
			dbgClamp = vec2f( length( clamped - historyColor ) / max( boxVec.x * 2.0, 0.02 ), contribution );
			historyColor = mix( clamped, historyColor, contribution );
			accumulation = mix( min( accumulation, 0.1 ), accumulation, contribution );
		}
		// accumulate (FSR2 Accumulate), blending tone mapped colours
		let acc = max( TAAU_EPS, accumulation + upsampledWeight );
		let alpha = upsampledWeight / acc;
		alphaOut = alpha;
		let up = taauToYCoCg( taauTonemap( taauFromYCoCg( upsampled ) ) );
		let hi = taauToYCoCg( taauTonemap( taauFromYCoCg( historyColor ) ) );
		outColor = taauTonemapInverse( taauFromYCoCg( mix( hi, up, alpha ) ) );
	}

	// ---- lock lifetime (FSR2 FinalizeLockStatus)
	if ( ! taauInside( uv + velocity ) ) {
		lockStatus.x = 0.0;
	} else {
		lockStatus.x = max( 0.0, lockStatus.x - upsampledWeight / ( taau.jitterPhases * TAAU_AVG_LANCZOS_WEIGHT_PER_FRAME ) );
	}

	// ---- temporal reactive factor for the next frame (FSR2 ComputeTemporalReactiveFactor)
	var newReactive = min( 0.99, thisFrameReactive );
	newReactive = max( newReactive, mix( newReactive, 0.4, sat( hrVelocity ) ) );
	newReactive = max( newReactive * newReactive, depthClip * 0.1 );
	newReactive = select( newReactive, 1.0, isNewSample );
	if ( sat( hrVelocity * 10.0 ) >= 1.0 ) { newReactive = -max( TAAU_EPS, newReactive ); }

	var out: TaauOut;
	out.color = vec4f( max( outColor, vec3f( 0.0 ) ) / exposure, 1.0 );
	out.lock = vec4f( lockStatus, newReactive, select( blurAcc * ( 1.0 - alphaOut ), 0.0, isNewSample ) );
	out.lumaHistory = lumaHist;
DEBUG_OUTPUT
	return out;
}
`;

		const formats = [ 'rgba16float', 'rgba16float', 'rgba8unorm' ];
		// resolve[ i ] reads history i and writes history 1 - i
		const plain = code.replace( ', DEBUG_FIELD', '' ).replace( 'DEBUG_OUTPUT\n', '' );
		this._resolve = [ 0, 1 ].map( ( src ) => new FullscreenPass( { label: 'TAAU', bindings: bindings( src ), colorFormats: formats, code: plain } ) );
		// the debug view: the same resolve with a fourth target, the view (built when first shown)
		this._buildDebug = () => {

			const dbg = code.replace( 'DEBUG_FIELD', '@location( 3 ) debug: vec4f' ).replace( 'DEBUG_OUTPUT', /* wgsl */`
	// grey image, the chosen quantity over it (colours are divided by the exposure: the final pass
	// multiplies them back)
	let gray = vec3f( luminance( taauTonemap( outColor * exposure ) ) * 0.35 );
	let view = u32( taau.debugView );
	var v = gray;
	if ( view == 1u ) { v = gray + vec3f( 0.0, lockContribution, select( 0.0, 1.0, newLock ) ); }
	else if ( view == 2u ) { v = gray + vec3f( lumaInstability, 0.0, 0.0 ); }
	else if ( view == 3u ) { v = gray + vec3f( sat( dbgClamp.x ) * ( 1.0 - dbgClamp.y ), sat( dbgClamp.x ) * dbgClamp.y, 0.0 ); }
	else if ( view == 7u ) { v = gray + vec3f( staticKeep * 0.8, staticKeep * 0.8, 0.0 ); }
	else if ( view == 4u ) { v = vec3f( sat( alphaOut * 3.0 ) ); }
	else if ( view == 5u ) { v = gray + vec3f( sat( hrVelocity / 4.0 ), sat( hrVelocity / 16.0 ), 0.0 ); }
	else if ( view == 6u ) { v = gray + vec3f( 0.0, 0.0, sat( blurAlpha * 2.0 ) ); }
	out.debug = vec4f( v / max( exposure, 1e-4 ), 1.0 );` );
			const f = [ ...formats, 'rgba16float' ];
			this._resolveDebug = [ 0, 1 ].map( ( src ) => new FullscreenPass( { label: 'TAAU debug', bindings: bindings( src ), colorFormats: f, code: dbg } ) );
			this._debugTarget = new RenderTarget( 1, 1, { colors: [ 'rgba16float' ], label: 'taauDebug' } );

		};

	}

	// record the resolve (after the beauty pass of this frame)
	render() {

		const F = FrameUniforms.fields;
		const U = this.uniforms.fields;
		U.cameraNearFar.value.set( F.near.value, F.far.value );
		if ( ! this._hasPrevInvVP ) U.prevInvViewProj.value.copy( F.invViewProj.value );
		this._hasPrevInvVP = true;

		// the previous-depth copy follows the scene depth size (resized before anything binds it this frame)
		const sd = this.depthTexture;
		if ( this._prevDepth.width !== sd.width || this._prevDepth.height !== sd.height ) {

			this._prevDepth.resize( sd.width, sd.height );
			this._needsRestart = true;

		}

		// after a restart (resize, another AA mode) the history is ignored for a frame (FSR2 reset)
		U.reset.value = this._needsRestart ? 1 : 0;
		this._needsRestart = false;

		const dst = 1 - this._cur;
		if ( this.debugView > 0 ) {

			if ( ! this._resolveDebug ) this._buildDebug();
			const h = this.history[ dst ];
			this._debugTarget.setSize( h.textures[ 0 ].width, h.textures[ 0 ].height );
			U.debugView.value = this.debugView;
			this._resolveDebug[ this._cur ].render( { colorViews: [ ...h.textures, this._debugTarget.texture ], clear: CLR } );

		} else {

			this._resolve[ this._cur ].render( { colorViews: this.history[ dst ].textures, clear: CLR } );

		}
		this._cur = dst;

		// Copy the current scene depth into the previous-depth texture (same size as the source)
		const d = this.depthTexture;
		GPU.getEncoder().copyTextureToTexture( { texture: d.getGPU() }, { texture: this._prevDepth.getGPU() }, { width: d.width, height: d.height } );

	}

	// after the frame's passes are recorded: this frame's (jittered) camera becomes the previous one
	endFrame() {

		// the uniform block is uploaded when bound (this frame's value is already packed), so the next
		// frame sees this frame's inverse view-projection
		this._nextPrev = this._nextPrev || new Matrix4();
		this._nextPrev.copy( FrameUniforms.fields.invViewProj.value );

	}

	// called by beginFrame of the next frame before render()
	advance() {

		if ( this._nextPrev ) this.uniforms.fields.prevInvViewProj.value.copy( this._nextPrev );

	}

}
