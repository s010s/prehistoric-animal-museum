import { UniformBlock } from '../engine/gpu/Shader.js';
import { RenderTarget, Texture } from '../engine/gpu/Texture.js';
import { FullscreenPass } from '../engine/render/FullscreenPass.js';
import { FrameUniforms } from '../engine/render/Frame.js';
import { Matrix4, Vector2, Vector3 } from '../engine/math/index.js';

// Ground Truth Ambient Occlusion: a port of three's GTAONode addon (r186, three/addons/tsl/display/
// GTAONode.js) with the same slice / horizon search, the closed-form cosine-weighted integral, the
// 5x5 magic-square rotation noise and the temporal rotation / offset sequences
// (Activision GTAO paper: https://www.activision.com/cdn/research/s2016_pbs_activision_occlusion.pptx).
// Normals are reconstructed from depth (three's getNormalFromDepth). The camera matrices are this
// frame's jittered projection (as three's camera during the post pipeline). Output: r8unorm AO
// (1 = unoccluded), cleared to white where the depth is at the near plane (the discard of the original).
// `distanceExponent` and `distanceFallOff` exist for API parity; like three's r186 node they are unused.

// From Activision GTAO paper
const _temporalRotations = [ 60, 300, 180, 240, 120, 0 ];
const _spatialOffsets = [ 0, 0.5, 0.25, 0.75 ];

export class GTAO {

	// depthIsColor: the depth comes in a single-channel colour texture (e.g. an r32float half-res copy)
	// instead of a depth texture
	constructor( depthTexture, camera, { samples = 16, depthIsColor = false } = {} ) {

		this.depthTexture = depthTexture;
		this.depthIsColor = depthIsColor;
		this.camera = camera;
		this.resolutionScale = 1;
		this.useTemporalFiltering = false;
		this.uniforms = new UniformBlock( 'GTAOParams', {
			proj: [ 'mat4x4f', new Matrix4() ],
			invProj: [ 'mat4x4f', new Matrix4() ],
			resolution: [ 'vec2f', new Vector2() ],
			radius: [ 'f32', 0.25 ],
			thickness: [ 'f32', 1 ],
			distanceExponent: [ 'f32', 1 ],
			distanceFallOff: [ 'f32', 1 ],
			scale: [ 'f32', 1 ],
			temporalDirection: [ 'f32', 0 ],
			temporalOffset: [ 'f32', 0 ],
			resolutionScaleU: [ 'f32', 0 ],
		}, { label: 'gtao' } );
		const U = this.uniforms.fields;
		this.radius = U.radius;
		this.thickness = U.thickness;
		this.distanceExponent = U.distanceExponent;
		this.distanceFallOff = U.distanceFallOff;
		this.scale = U.scale;
		this.samples = { value: samples };
		this.target = new RenderTarget( 1, 1, { colors: [ 'r8unorm' ], label: 'GTAO.AO' } );
		this.noiseTexture = generateMagicSquareNoise();
		this._currentSamples = - 1;
		this._pass = null;
		this._frame = 0;
		this._jp = new Matrix4();

	}

	get texture() {

		return this.target.texture;

	}

	getTextureNode() {

		return this.target.texture;

	}

	// width, height: drawing buffer (output) size; the AO runs at resolutionScale of it
	setSize( width, height ) {

		width = Math.round( this.resolutionScale * width );
		height = Math.round( this.resolutionScale * height );
		this.uniforms.fields.resolutionScaleU.value = this.resolutionScale;
		this.uniforms.fields.resolution.value.set( width, height );
		this.target.setSize( width, height );

	}

	_build() {

		// The sample count is baked into the shader so loop unrolling works
		const SAMPLES = this.samples.value;
		const DIRECTIONS = SAMPLES < 30 ? 3 : 5;
		const STEPS = Math.ceil( SAMPLES / DIRECTIONS );
		this._pass = new FullscreenPass( {
			label: 'GTAO',
			colorFormats: [ 'r8unorm' ],
			bindings: {
				gtao: { uniform: this.uniforms },
				gtaoDepth: { texture: () => this.depthTexture },
				gtaoNoise: { texture: this.noiseTexture },
			},
			code: /* wgsl */`
const GTAO_DIRECTIONS: i32 = ${ DIRECTIONS };
const GTAO_STEPS: i32 = ${ STEPS };

// (a colour depth copy may mark texels negative: under the water, no AO wanted; see PostFX)
fn gtaoSampleDepthRaw( uv: vec2f ) -> f32 {
	let s = vec2i( textureDimensions( gtaoDepth ) );
	return textureLoad( gtaoDepth, clamp( vec2i( floor( uv * vec2f( s ) ) ), vec2i( 0 ), s - 1 ), 0 )${ this.depthIsColor ? '.x' : '' };
}
fn gtaoSampleDepth( uv: vec2f ) -> f32 { return abs( gtaoSampleDepthRaw( uv ) ); }
fn gtaoLoad( p: vec2i ) -> f32 {
	let s = vec2i( textureDimensions( gtaoDepth ) );
	return abs( textureLoad( gtaoDepth, clamp( p, vec2i( 0 ), s - 1 ), 0 )${ this.depthIsColor ? '.x' : '' } );
}
// three's getViewPosition (WebGPU coordinate system)
fn gtaoViewPosition( uv: vec2f, depth: f32 ) -> vec3f {
	let sp = vec2f( uv.x, 1.0 - uv.y ) * 2.0 - 1.0;
	let v = gtao.invProj * vec4f( sp, depth, 1.0 );
	return v.xyz / v.w;
}
fn gtaoScreenFromClip( c: vec4f ) -> vec2f {
	let s = c.xy / c.w * 0.5 + 0.5;
	return vec2f( s.x, 1.0 - s.y );
}
// three's getNormalFromDepth
fn gtaoNormalFromDepth( uv: vec2f ) -> vec3f {
	let size = vec2f( textureDimensions( gtaoDepth ) );
	let p = vec2i( uv * size );
	let c0 = gtaoLoad( p );
	let l2 = gtaoLoad( p - vec2i( 2, 0 ) ); let l1 = gtaoLoad( p - vec2i( 1, 0 ) );
	let r1 = gtaoLoad( p + vec2i( 1, 0 ) ); let r2 = gtaoLoad( p + vec2i( 2, 0 ) );
	let b2 = gtaoLoad( p + vec2i( 0, 2 ) ); let b1 = gtaoLoad( p + vec2i( 0, 1 ) );
	let t1 = gtaoLoad( p - vec2i( 0, 1 ) ); let t2 = gtaoLoad( p - vec2i( 0, 2 ) );
	let dl = abs( ( 2.0 * l1 - l2 ) - c0 );
	let dr = abs( ( 2.0 * r1 - r2 ) - c0 );
	let db = abs( ( 2.0 * b1 - b2 ) - c0 );
	let dt = abs( ( 2.0 * t1 - t2 ) - c0 );
	let ce = gtaoViewPosition( uv, c0 );
	let dpdx = select( - ce + gtaoViewPosition( uv + vec2f( 1.0 / size.x, 0.0 ), r1 ), ce - gtaoViewPosition( uv - vec2f( 1.0 / size.x, 0.0 ), l1 ), dl < dr );
	let dpdy = select( - ce + gtaoViewPosition( uv - vec2f( 0.0, 1.0 / size.y ), t1 ), ce - gtaoViewPosition( uv + vec2f( 0.0, 1.0 / size.y ), b1 ), db < dt );
	return normalize( cross( dpdx, dpdy ) );
}
fn gtaoRand( uv: vec2f ) -> f32 {
	let dt = dot( uv, vec2f( 12.9898, 78.233 ) );
	let sn = dt - PI * floor( dt / PI );
	return fract( sin( sn ) * 43758.5453 );
}

fn fragment( in: FSIn ) -> vec4f {
	let uvNode = in.uv;
	// Sidestep the nearest-rounding during depth access for the unjittered center pixel to avoid banding
	var depth: f32;
	if ( gtao.resolutionScaleU < 1.0 ) {
		let g = abs( textureGather( ${ this.depthIsColor ? '0, ' : '' }gtaoDepth, smpNearestClamp, uvNode ) );
		depth = min( min( g.x, g.y ), min( g.z, g.w ) );
	} else {
		depth = gtaoSampleDepth( uvNode );
	}
	// nothing there (sky: the depth is reversed-Z, 0 at infinity): unoccluded, and never shown
	if ( depth <= 0.0 || gtaoSampleDepthRaw( uvNode ) < 0.0 ) { return vec4f( 1.0 ); }
	let viewPosition = gtaoViewPosition( uvNode, depth );
	let viewNormal = gtaoNormalFromDepth( uvNode );
	let radius = gtao.radius;
	let invRadius = 1.0 / radius;
	let viewDir = normalize( - viewPosition );
	let clipPosition = gtao.proj * vec4f( viewPosition, 1.0 );

	// 5x5 magic square rotation noise (nearest, repeat)
	let noiseRes = vec2f( textureDimensions( gtaoNoise ) );
	let noiseUv = vec2f( uvNode.x, 1.0 - uvNode.y ) * ( gtao.resolution / noiseRes );
	let nt = vec2i( floor( fract( noiseUv ) * noiseRes ) );
	let noiseTexel = textureLoad( gtaoNoise, nt, 0 );
	let randomVec = noiseTexel.xyz * 2.0 - 1.0;
	let tangent = normalize( vec3f( randomVec.xy, 0.0 ) );
	let bitangent = vec3f( - tangent.y, tangent.x, 0.0 );
	let kernelMatrix = mat3x3f( tangent, bitangent, vec3f( 0.0, 0.0, 1.0 ) );

	let invSteps = 1.0 / f32( GTAO_STEPS );
	var ao = 0.0;
	// Per-step phase jitter for spatio-temporal decorrelation.
	let noiseJitterIdx = gtao.temporalDirection * 0.02;
	let stepJitter = interleavedGradientNoise( in.pos.xy + gtao.temporalOffset ) + gtaoRand( ( uvNode + noiseJitterIdx ) * 2.0 - 1.0 );

	// Each iteration analyzes one vertical "slice" of the 3D space around the fragment.
	for ( var i = 0; i < GTAO_DIRECTIONS; i++ ) {
		let angle = f32( i ) / f32( GTAO_DIRECTIONS ) * PI + gtao.temporalDirection;
		let sampleDir = kernelMatrix * vec3f( cos( angle ), sin( angle ), 0.0 );
		let clipDirRadius = gtao.proj * vec4f( sampleDir, 0.0 ) * radius;
		let sliceBitangent = normalize( cross( sampleDir, viewDir ) );
		let sliceTangent = cross( sliceBitangent, viewDir );
		// Project the view normal onto the slice plane (remove component along sliceBitangent).
		// The unnormalized length is the foreshortening weight applied at slice integration.
		// (Activision GTAO paper, Section 3.2 "Per-pixel sampling".)
		let projNRaw = viewNormal - sliceBitangent * dot( viewNormal, sliceBitangent );
		let projNLen = length( projNRaw );
		let projN = projNRaw / max( projNLen, 0.0001 );
		// gamma: angle of projN within the slice plane, signed by the tangent direction.
		let nSin = dot( projN, sliceTangent );
		let nCos = clamp( dot( projN, viewDir ), 0.0, 1.0 );
		let signNSin = select( -1.0, 1.0, nSin >= 0.0 );
		let angleN = signNSin * acos( nCos );
		let tangentToNormalInSlice = cross( projN, sliceBitangent );
		let cosHorizon = dot( viewDir, tangentToNormalInSlice );
		var cosHorizons = vec2f( cosHorizon, - cosHorizon );
		// For each slice, the inner loop performs ray marching to find the horizons.
		for ( var j = 0; j < GTAO_STEPS; j++ ) {
			// Quadratic step distribution ( sampleDist = t^2 ) concentrates samples in the
			// near-field. (Blender's Eevee adaptation)
			let t = ( f32( j ) + 1.0 + stepJitter ) * invSteps;
			let sampleDist = t * t;
			let clipOffset = clipDirRadius * sampleDist;
			// The loop marches in two opposite directions (x and y) along the slice's line to find the horizon on both sides.
			// x
			let sampleScreenPositionX = gtaoScreenFromClip( clipPosition + clipOffset );
			let sampleDepthX = gtaoSampleDepth( sampleScreenPositionX );
			let viewDeltaX = gtaoViewPosition( sampleScreenPositionX, sampleDepthX ) - viewPosition;
			let lenX = length( viewDeltaX );
			// Manual normalize guards against zero-length delta.
			let sHX = dot( viewDir, viewDeltaX ) / max( lenX, 0.0001 );
			// Sphere falloff: ( dist / radius )^2 fades the sample's horizon contribution
			// back toward the prior horizon as it approaches the radius boundary.
			// (squared variant of the paper's near-field attenuation;
			// Activision GTAO paper, Section 4.3 "Bounding the sampling area")
			let distFacX = min( lenX * invRadius, 1.0 );
			let distFacSqX = distFacX * distFacX;
			if ( abs( viewDeltaX.z ) < gtao.thickness ) {
				cosHorizons.x = mix( max( cosHorizons.x, sHX ), cosHorizons.x, distFacSqX );
			}
			// y
			let sampleScreenPositionY = gtaoScreenFromClip( clipPosition - clipOffset );
			let sampleDepthY = gtaoSampleDepth( sampleScreenPositionY );
			let viewDeltaY = gtaoViewPosition( sampleScreenPositionY, sampleDepthY ) - viewPosition;
			let lenY = length( viewDeltaY );
			let sHY = dot( viewDir, viewDeltaY ) / max( lenY, 0.0001 );
			let distFacY = min( lenY * invRadius, 1.0 );
			let distFacSqY = distFacY * distFacY;
			if ( abs( viewDeltaY.z ) < gtao.thickness ) {
				cosHorizons.y = mix( max( cosHorizons.y, sHY ), cosHorizons.y, distFacSqY );
			}
		}
		// Cosine-weighted inner integral, closed-form (Activision GTAO paper, Eq. 7).
		// Per horizon h_i:    term_i = -cos( 2 h_i - gamma ) + cos( gamma ) + 2 h_i sin( gamma )
		// The 0.25 factor is 1/2 (integral normalization) x 1/2 (averaging the two horizons).
		// In this slice setup sliceTangent = cross( sliceBitangent, viewDir ) works out
		// opposite to sampleDir, so the +sampleDir samples (cosHorizons.x) live on the
		// -T side of the slice and -sampleDir samples (cosHorizons.y) on the +T side.
		// gamma is signed by +T (sliceTangent), so hPos must read from cosHorizons.y.
		let hPos = acos( clamp( cosHorizons.y, -1.0, 1.0 ) );
		let hNeg = - acos( clamp( cosHorizons.x, -1.0, 1.0 ) );
		let termPos = - cos( hPos * 2.0 - angleN ) + nCos + hPos * 2.0 * nSin;
		let termNeg = - cos( hNeg * 2.0 - angleN ) + nCos + hNeg * 2.0 * nSin;
		let a = ( termPos + termNeg ) * 0.25;
		// |projN| is the foreshortening weight from the per-slice normal projection.
		ao += projNLen * a;
	}
	ao = clamp( ao / f32( GTAO_DIRECTIONS ), 0.0, 1.0 );
	ao = pow( ao, gtao.scale );
	return vec4f( ao, 0.0, 0.0, 1.0 );
}
`,
		} );
		this._currentSamples = SAMPLES;

	}

	// record the AO pass (camera matrices of this frame: jittered projection)
	render() {

		// update temporal uniforms
		const U = this.uniforms.fields;
		if ( this.useTemporalFiltering === true ) {

			const frameId = this._frame ++;
			U.temporalDirection.value = _temporalRotations[ frameId % 6 ] / 360;
			U.temporalOffset.value = _spatialOffsets[ frameId % 4 ];

		} else {

			U.temporalDirection.value = 0;
			U.temporalOffset.value = 1;

		}

		// rebuild the pipeline if the sample count has changed
		if ( this.samples.value !== this._currentSamples ) this._build();

		// jittered projection: the frame's translation jitter applied to the projection
		const F = FrameUniforms.fields;
		const j = F.jitter.value;
		this._jp.makeTranslation( j.x, j.y, 0 ).multiply( F.proj.value );
		U.proj.value.copy( this._jp );
		U.invProj.value.copy( this._jp ).invert();
		this._pass.render( { colorViews: [ this.target.texture ], clear: [ 1, 1, 1, 1 ] } );

	}

}

function generateMagicSquareNoise( size = 5 ) {

	const noiseSize = Math.floor( size ) % 2 === 0 ? Math.floor( size ) + 1 : Math.floor( size );
	const magicSquare = generateMagicSquare( noiseSize );
	const noiseSquareSize = magicSquare.length;
	const data = new Uint8Array( noiseSquareSize * 4 );
	for ( let inx = 0; inx < noiseSquareSize; ++ inx ) {

		const iAng = magicSquare[ inx ];
		const angle = ( 2 * Math.PI * iAng ) / noiseSquareSize;
		const randomVec = new Vector3( Math.cos( angle ), Math.sin( angle ), 0 ).normalize();
		data[ inx * 4 ] = ( randomVec.x * 0.5 + 0.5 ) * 255;
		data[ inx * 4 + 1 ] = ( randomVec.y * 0.5 + 0.5 ) * 255;
		data[ inx * 4 + 2 ] = 127;
		data[ inx * 4 + 3 ] = 255;

	}

	return new Texture( { label: 'GTAO.noise', width: noiseSize, height: noiseSize, format: 'rgba8unorm', data, sampler: 'nearestRepeat' } );

}

function generateMagicSquare( size ) {

	const noiseSize = Math.floor( size ) % 2 === 0 ? Math.floor( size ) + 1 : Math.floor( size );
	const noiseSquareSize = noiseSize * noiseSize;
	const magicSquare = Array( noiseSquareSize ).fill( 0 );
	let i = Math.floor( noiseSize / 2 );
	let j = noiseSize - 1;
	for ( let num = 1; num <= noiseSquareSize; ) {

		if ( i === - 1 && j === noiseSize ) {

			j = noiseSize - 2;
			i = 0;

		} else {

			if ( j === noiseSize ) j = 0;
			if ( i < 0 ) i = noiseSize - 1;

		}

		if ( magicSquare[ i * noiseSize + j ] !== 0 ) {

			j -= 2;
			i ++;
			continue;

		} else {

			magicSquare[ i * noiseSize + j ] = num ++;

		}

		j ++;
		i --;

	}

	return magicSquare;

}
