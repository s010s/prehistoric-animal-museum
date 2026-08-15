import type { MeshStandardMaterial, Texture } from 'three'

/**
 * PRODUCTION CANDIDATE — synchronized stochastic PBR sampling for the D
 * environment slice. Unlike the C prototype, this patch uses one stochastic
 * frame for albedo, tangent-space normal and roughness, so the three material
 * signals describe the same randomly transformed patch of ground.
 *
 * It deliberately remains an opaque, depth-writing material. Distant detail is
 * reduced by flattening the normal map instead of fading a second floor through
 * the panorama.
 */

const CANDIDATE_REVISION = 'stochastic-pbr-ground-v17-portrait-overview-earth'
const CANDIDATE_USER_DATA_KEY = 'scaleEncounterStochasticGroundCandidate'

export interface ScaleEncounterStochasticGroundMaterialCandidateOptions {
  /** Physical width covered by one source texture tile. */
  readonly physicalWidthMeters: number
  /** Optional unique RGB control map; alpha blends it over the procedural fallback. */
  readonly macroControlMap?: Texture | null
  /** World-space width covered by the non-repeating control map. */
  readonly macroWorldSizeMeters?: number
  /** Strength of damp/dry/vegetation colour variation. */
  readonly macroVariationStrength?: number
  /** View-space distance at which normal detail starts flattening. */
  readonly normalFadeStartMeters?: number
  /** View-space distance at which the normal map is fully flat. */
  readonly normalFadeEndMeters?: number
  /** Size of one triangular stochastic blend cell in metres. */
  readonly stochasticCellSizeMeters?: number
  /**
   * A genuinely different forest-floor scan for the dry litter domain. Wet
   * humus and moss retain the authored base scan; keeping only a second
   * albedo adds three texture reads instead of tripling the full PBR stack.
   */
  readonly dryLitterAlbedoTexture?: Texture | null
  /**
   * The already-cached panorama used by the dome. Far terrain samples this
   * exact texture in the same projection, so the opaque ground can meet the
   * photograph without a translucent second floor or screen-door dithering.
   */
  readonly panoramaTexture?: Texture | null
  /** Local ground radius where projection-matched panorama colour begins. */
  readonly panoramaBlendStartMeters?: number
  /** Local ground radius where projection-matched panorama colour is complete. */
  readonly panoramaBlendEndMeters?: number
}

interface ResolvedCandidateOptions {
  readonly dryLitterAlbedoTexture: Texture | null
  readonly macroControlMap: Texture | null
  readonly macroVariationStrength: number
  readonly macroWorldSizeMeters: number
  readonly normalFadeEndMeters: number
  readonly normalFadeStartMeters: number
  readonly physicalWidthMeters: number
  readonly stochasticCellSizeMeters: number
  readonly panoramaBlendEndMeters: number
  readonly panoramaBlendStartMeters: number
  readonly panoramaTexture: Texture | null
}

type GroundShader = Parameters<MeshStandardMaterial['onBeforeCompile']>[0]

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function resolveOptions(
  options: ScaleEncounterStochasticGroundMaterialCandidateOptions,
): ResolvedCandidateOptions {
  const physicalWidthMeters = Math.max(
    0.25,
    finiteOr(options.physicalWidthMeters, 2),
  )
  const normalFadeStartMeters = Math.max(
    12,
    finiteOr(options.normalFadeStartMeters, 58),
  )
  const panoramaBlendStartMeters = Math.max(
    24,
    finiteOr(options.panoramaBlendStartMeters, 42),
  )
  return {
    dryLitterAlbedoTexture: options.dryLitterAlbedoTexture ?? null,
    macroControlMap: options.macroControlMap ?? null,
    macroVariationStrength: Math.max(
      0,
      Math.min(0.6, finiteOr(options.macroVariationStrength, 0.24)),
    ),
    macroWorldSizeMeters: Math.max(
      32,
      finiteOr(options.macroWorldSizeMeters, 720),
    ),
    normalFadeEndMeters: Math.max(
      normalFadeStartMeters + 1,
      finiteOr(options.normalFadeEndMeters, 148),
    ),
    normalFadeStartMeters,
    physicalWidthMeters,
    panoramaBlendEndMeters: Math.max(
      panoramaBlendStartMeters + 24,
      finiteOr(options.panoramaBlendEndMeters, 86),
    ),
    panoramaBlendStartMeters,
    panoramaTexture: options.panoramaTexture ?? null,
    stochasticCellSizeMeters: Math.max(
      physicalWidthMeters * 1.5,
      finiteOr(options.stochasticCellSizeMeters, physicalWidthMeters * 3.75),
    ),
  }
}

function addGroundPositionVarying(vertexShader: string): string {
  return vertexShader
    .replace(
      'varying vec3 vViewPosition;',
      `varying vec3 vViewPosition;
varying vec2 vScaleEncounterGroundLocalPosition;
varying float vScaleEncounterGroundLocalHeight;
varying float vScaleEncounterGroundSlope;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
	vScaleEncounterGroundLocalPosition = position.xy;
	vScaleEncounterGroundLocalHeight = position.z;
	// Terrain is authored in local XY with +Z up. Geometric slope anchors
	// ecology before tangent-space detail and never changes with the camera.
	vScaleEncounterGroundSlope = sqrt(max(0.0, 1.0 - normal.z * normal.z));`,
    )
}

function createFragmentHeader(
  withMacroControlMap: boolean,
  withPanoramaTexture: boolean,
  withDryLitterAlbedoTexture: boolean,
): string {
  return `varying vec3 vViewPosition;
varying vec2 vScaleEncounterGroundLocalPosition;
varying float vScaleEncounterGroundLocalHeight;
varying float vScaleEncounterGroundSlope;
uniform vec3 uScaleEncounterGroundMetrics;
uniform vec2 uScaleEncounterGroundNormalFade;
uniform float uScaleEncounterGroundMacroStrength;
uniform sampler2D uScaleEncounterGroundMacroControlMap;
uniform sampler2D uScaleEncounterGroundPanoramaMap;
uniform sampler2D uScaleEncounterGroundDryLitterMap;
uniform vec2 uScaleEncounterGroundPanoramaBlend;
uniform mat4 projectionMatrix;
${withMacroControlMap ? '#define SCALE_ENCOUNTER_USE_MACRO_CONTROL_MAP' : ''}
${withPanoramaTexture ? '#define SCALE_ENCOUNTER_USE_PANORAMA_MATCH' : ''}
${withDryLitterAlbedoTexture ? '#define SCALE_ENCOUNTER_USE_DRY_LITTER_ALBEDO' : ''}

#ifdef SCALE_ENCOUNTER_USE_PANORAMA_MATCH

float scaleEncounterHorizonHash(vec2 value) {
	vec3 hash = fract(vec3(value.xyx) * 0.1031);
	hash += dot(hash, hash.yzx + 33.33);
	return fract((hash.x + hash.y) * hash.z);
}

float scaleEncounterHorizonNoise(vec2 point) {
	vec2 cell = floor(point);
	vec2 blend = fract(point);
	blend = blend * blend * (3.0 - 2.0 * blend);
	float a = scaleEncounterHorizonHash(cell);
	float b = scaleEncounterHorizonHash(cell + vec2(1.0, 0.0));
	float c = scaleEncounterHorizonHash(cell + vec2(0.0, 1.0));
	float d = scaleEncounterHorizonHash(cell + vec2(1.0, 1.0));
	return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}

float scaleEncounterPanoramaBlendAmount(vec2 localPosition) {
	// A low-frequency, non-periodic offset keeps the blend boundary from
	// becoming another screen-horizontal ring when the camera is near ground.
	float boundaryOffset =
		(scaleEncounterHorizonNoise(localPosition / 47.0 + vec2(8.2, -3.7)) - 0.5) * 24.0;
	float radialAmount = smoothstep(
		uScaleEncounterGroundPanoramaBlend.x + boundaryOffset,
		uScaleEncounterGroundPanoramaBlend.y + boundaryOffset,
		length(localPosition)
	);
	// Local radius alone re-enters the blend beneath an overview camera that
	// sits outside the subject clearing. Gate it by actual camera depth so the
	// near lower corners remain PBR even though their world radius is large.
	float cameraDepthAmount = smoothstep(
		72.0,
		148.0,
		length(vViewPosition)
	);
	vec3 worldViewRay = normalize(
		(vec4(-vViewPosition, 0.0) * viewMatrix).xyz
	);
	// Do not force a panorama match at every grazing ray. That previous shortcut
	// sampled photographed ground across a screen-horizontal band and produced
	// the brown/green veil seen in overview and portrait captures. A genuinely
	// distant, downward-looking terrain fragment may blend; the physical near
	// and middle ground stays PBR and depth-writing in every camera mode.
	float lookingDownAmount = smoothstep(-0.005, 0.12, -worldViewRay.y);
	return radialAmount * cameraDepthAmount * lookingDownAmount;
}

vec3 scaleEncounterProjectionMatchedPanorama() {
	// updateScaleEncounterEnvironment centres the ordinary SphereGeometry dome
	// on the camera every frame. Its hit direction is therefore exactly this
	// world-space view ray; reproduce SphereGeometry's UV mapping from it.
	vec3 domeDirection = normalize(
		(vec4(-vViewPosition, 0.0) * viewMatrix).xyz
	);
	vec2 panoramaUv = vec2(
		fract(atan(domeDirection.z, domeDirection.x) * 0.15915494309189535 + 1.0),
		asin(clamp(domeDirection.y, -1.0, 1.0)) * 0.3183098861837907 + 0.5
	);
	return texture2D(uScaleEncounterGroundPanoramaMap, panoramaUv).rgb;
}

#endif

struct ScaleEncounterStochasticFrame {
	vec3 weights;
	vec2 uvA;
	vec2 uvB;
	vec2 uvC;
	float rotationA;
	float rotationB;
	float rotationC;
};

float scaleEncounterHash12(vec2 value) {
	vec3 hash = fract(vec3(value.xyx) * 0.1031);
	hash += dot(hash, hash.yzx + 33.33);
	return fract((hash.x + hash.y) * hash.z);
}

vec2 scaleEncounterHash22(vec2 value) {
	vec3 hash = fract(vec3(value.xyx) * vec3(0.1031, 0.1030, 0.0973));
	hash += dot(hash, hash.yzx + 33.33);
	return fract((hash.xx + hash.yz) * hash.zy);
}

float scaleEncounterValueNoise(vec2 point) {
	vec2 cell = floor(point);
	vec2 blend = fract(point);
	blend = blend * blend * (3.0 - 2.0 * blend);
	float a = scaleEncounterHash12(cell);
	float b = scaleEncounterHash12(cell + vec2(1.0, 0.0));
	float c = scaleEncounterHash12(cell + vec2(0.0, 1.0));
	float d = scaleEncounterHash12(cell + vec2(1.0, 1.0));
	return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}

vec4 scaleEncounterProceduralMacroControl(vec2 localPosition) {
	// Two low-frequency fields warp the domain coordinates before any ecology
	// is resolved. This prevents the previous smooth value-noise contours from
	// reading as broad green/brown ribbons across overview cameras.
	vec2 warp = vec2(
		scaleEncounterValueNoise(localPosition / 41.0 + vec2(9.7, -14.1)),
		scaleEncounterValueNoise(localPosition / 37.0 + vec2(-6.3, 17.8))
	) - 0.5;
	vec2 warpedPosition = localPosition + warp * 13.0;
	float moisture =
		scaleEncounterValueNoise(warpedPosition / 37.0 + vec2(2.7, 8.1)) * 0.50 +
		scaleEncounterValueNoise(warpedPosition / 16.0 + vec2(-14.3, 5.8)) * 0.33 +
		scaleEncounterValueNoise(warpedPosition / 7.5 + vec2(21.4, -8.6)) * 0.17;
	float vegetation =
		scaleEncounterValueNoise(warpedPosition / 26.0 + vec2(19.4, -7.6)) * 0.56 +
		scaleEncounterValueNoise(warpedPosition / 10.0 + vec2(6.2, 23.1)) * 0.44;
	float material =
		scaleEncounterValueNoise(warpedPosition / 21.0 + vec2(-31.8, 11.3)) * 0.50 +
		scaleEncounterValueNoise(warpedPosition / 8.0 + vec2(13.2, -21.7)) * 0.35 +
		scaleEncounterValueNoise(warpedPosition / 53.0 + vec2(4.4, 31.6)) * 0.15;
	return vec4(moisture, vegetation, material, 1.0);
}

vec2 scaleEncounterRotateUv(vec2 uv, float rotation) {
	if (rotation < 0.5) return uv;
	if (rotation < 1.5) return vec2(-uv.y, uv.x);
	if (rotation < 2.5) return -uv;
	return vec2(uv.y, -uv.x);
}

vec2 scaleEncounterRestoreNormalRotation(vec2 normalXy, float rotation) {
	// Sampling at R*uv rotates the tangent gradient by transpose(R).
	if (rotation < 0.5) return normalXy;
	if (rotation < 1.5) return vec2(normalXy.y, -normalXy.x);
	if (rotation < 2.5) return -normalXy;
	return vec2(-normalXy.y, normalXy.x);
}

void scaleEncounterResolveTile(
	vec2 textureUv,
	vec2 tileId,
	out vec2 transformedUv,
	out float rotation
) {
	rotation = floor(scaleEncounterHash12(tileId + vec2(37.2, 91.7)) * 4.0);
	vec2 offset = scaleEncounterHash22(tileId + vec2(11.3, 53.1));
	transformedUv = scaleEncounterRotateUv(textureUv, rotation) + offset;
}

ScaleEncounterStochasticFrame scaleEncounterResolveStochasticFrame(
	vec2 localPosition
) {
	vec2 gridPosition = vec2(
		localPosition.x - localPosition.y * 0.5773502692,
		localPosition.y * 1.1547005384
	) / uScaleEncounterGroundMetrics.y;
	vec2 baseCell = floor(gridPosition);
	vec2 withinCell = fract(gridPosition);
	vec2 tileA;
	vec2 tileB;
	vec2 tileC;
	vec3 weights;
	if (withinCell.x + withinCell.y < 1.0) {
		tileA = baseCell;
		tileB = baseCell + vec2(1.0, 0.0);
		tileC = baseCell + vec2(0.0, 1.0);
		weights = vec3(
			1.0 - withinCell.x - withinCell.y,
			withinCell.x,
			withinCell.y
		);
	} else {
		tileA = baseCell + vec2(1.0, 1.0);
		tileB = baseCell + vec2(0.0, 1.0);
		tileC = baseCell + vec2(1.0, 0.0);
		weights = vec3(
			withinCell.x + withinCell.y - 1.0,
			1.0 - withinCell.x,
			1.0 - withinCell.y
		);
	}
	weights = max(weights, vec3(0.0));
	// Cubic normalisation keeps the transition zone narrow. The previous
	// quadratic blend averaged unrelated height cues across most of every
	// triangle and read as broad, repeated ripples at overview distance.
	weights *= weights * weights;
	weights /= max(dot(weights, vec3(1.0)), 0.0001);

	vec2 textureUv = localPosition / uScaleEncounterGroundMetrics.x;
	ScaleEncounterStochasticFrame frame;
	frame.weights = weights;
	scaleEncounterResolveTile(textureUv, tileA, frame.uvA, frame.rotationA);
	scaleEncounterResolveTile(textureUv, tileB, frame.uvB, frame.rotationB);
	scaleEncounterResolveTile(textureUv, tileC, frame.uvC, frame.rotationC);
	return frame;
}

vec4 scaleEncounterResolveMacroControl(vec2 localPosition) {
	vec4 proceduralControl = scaleEncounterProceduralMacroControl(localPosition);
	#ifdef SCALE_ENCOUNTER_USE_MACRO_CONTROL_MAP
		vec2 controlUv = clamp(
			localPosition / uScaleEncounterGroundMetrics.z + 0.5,
			vec2(0.0),
			vec2(1.0)
		);
		vec4 authoredControl = texture2D(
			uScaleEncounterGroundMacroControlMap,
			controlUv
		);
		return vec4(
			mix(proceduralControl.rgb, authoredControl.rgb, authoredControl.a),
			1.0
		);
	#else
		return proceduralControl;
	#endif
}

vec3 scaleEncounterResolveBiomeWeights(
	vec4 macroControl,
	float localHeight,
	float geometricSlope
) {
	// Moisture, vegetation potential and an independent material field produce
	// small interlocking colonies. Height/slope act as ecological gates instead
	// of broad additive colour terms, so a basin never becomes one moss stripe.
	float lowland = 1.0 - smoothstep(0.45, 3.4, localHeight);
	float slope = smoothstep(0.025, 0.19, geometricSlope);
	float mossSeed =
		macroControl.r * 0.48 +
		macroControl.g * 0.34 +
		(1.0 - macroControl.b) * 0.10 +
		lowland * 0.08 -
		slope * 0.32;
	float drySeed =
		(1.0 - macroControl.r) * 0.52 +
		macroControl.b * 0.35 +
		slope * 0.18 +
		(1.0 - lowland) * 0.08;
	// Thresholds deliberately overlap at their feathered edges, but their
	// independent mid-frequency erosion prevents either result from becoming a
	// broad contour band. Coverage is roughly 34% litter and 29% moss potential;
	// their visible weights remain restrained so humus always connects the floor.
	float mossIsland =
		smoothstep(0.595, 0.745, mossSeed) *
		smoothstep(0.29, 0.60, macroControl.g);
	float dryPatch =
		smoothstep(0.455, 0.635, drySeed) * (1.0 - mossIsland * 0.72);
	float dryWeight = dryPatch * 0.58;
	float mossWeight = mossIsland * 0.42;
	return vec3(
		max(0.22, 1.0 - dryWeight - mossWeight),
		dryWeight,
		mossWeight
	);
}`
}

const STOCHASTIC_FRAME_INITIALIZATION = `
	ScaleEncounterStochasticFrame scaleEncounterGroundFrame =
		scaleEncounterResolveStochasticFrame(
			vScaleEncounterGroundLocalPosition
		);
	vec4 scaleEncounterGroundMacroControl = scaleEncounterResolveMacroControl(
		vScaleEncounterGroundLocalPosition
	);
	vec3 scaleEncounterGroundBiomeWeights = scaleEncounterResolveBiomeWeights(
		scaleEncounterGroundMacroControl,
		vScaleEncounterGroundLocalHeight,
		vScaleEncounterGroundSlope
	);
	// A product of independent moisture and material masks erodes the broad
	// moisture contour into compact, ragged humus pockets. This avoids making
	// one half of a POV uniformly dark while the sunward half reads bleached.
	float scaleEncounterGroundDampPocket =
		smoothstep(0.48, 0.68, scaleEncounterGroundMacroControl.r) *
		smoothstep(0.42, 0.60, 1.0 - scaleEncounterGroundMacroControl.b) *
		(1.0 - scaleEncounterGroundBiomeWeights.y * 0.50) *
		(1.0 - scaleEncounterGroundBiomeWeights.z * 0.22);
	float scaleEncounterGroundNearClearing = 1.0 - smoothstep(
		20.0,
		92.0,
		length(vScaleEncounterGroundLocalPosition)
	);
	float scaleEncounterGroundNormalDetail = 1.0 - smoothstep(
		uScaleEncounterGroundNormalFade.x,
		uScaleEncounterGroundNormalFade.y,
		length(vViewPosition)
	);
	// Portrait overview cameras sit far from the subjects even at their default
	// zoom because horizontal FOV is the limiting fit. The previous detector
	// looked only for the widest optical zoom, so an actual phone viewport could
	// remain grey while a tall desktop emulation at maximum zoom looked fixed.
	// Recover viewport aspect from the perspective matrix and treat every narrow
	// overview as distant; wide screens retain the optical-zoom gate. Camera
	// distance keeps this completely out of the accepted first-person rail.
	float scaleEncounterOverviewCameraAmount = smoothstep(
		28.0,
		52.0,
		length(cameraPosition.xz)
	);
	float scaleEncounterViewportAspect =
		projectionMatrix[1][1] / projectionMatrix[0][0];
	float scaleEncounterPortraitOverviewAmount =
		1.0 - smoothstep(0.72, 1.05, scaleEncounterViewportAspect);
	float scaleEncounterWideOverviewAmount = smoothstep(
		0.372,
		0.405,
		1.0 / projectionMatrix[1][1]
	);
	float scaleEncounterDistantViewAmount =
		scaleEncounterOverviewCameraAmount *
		max(
			scaleEncounterPortraitOverviewAmount,
			scaleEncounterWideOverviewAmount
		);
`

const STOCHASTIC_MAP_FRAGMENT = `
#ifdef USE_MAP

	vec4 scaleEncounterMapA = texture2D(map, scaleEncounterGroundFrame.uvA);
	vec4 scaleEncounterMapB = texture2D(map, scaleEncounterGroundFrame.uvB);
	vec4 scaleEncounterMapC = texture2D(map, scaleEncounterGroundFrame.uvC);
	vec4 sampledDiffuseColor =
		scaleEncounterMapA * scaleEncounterGroundFrame.weights.x +
		scaleEncounterMapB * scaleEncounterGroundFrame.weights.y +
		scaleEncounterMapC * scaleEncounterGroundFrame.weights.z;

	#ifdef DECODE_VIDEO_TEXTURE

		sampledDiffuseColor = sRGBTransferEOTF(sampledDiffuseColor);

	#endif

	vec3 scaleEncounterWetHumus =
		sampledDiffuseColor.rgb * vec3(1.02, 1.03, 0.88) +
		vec3(0.004, 0.004, 0.004);
	scaleEncounterWetHumus *= mix(
		1.0,
		0.76,
		scaleEncounterGroundDampPocket
	);
	vec3 scaleEncounterDryLitter = scaleEncounterWetHumus;
	#ifdef SCALE_ENCOUNTER_USE_DRY_LITTER_ALBEDO
		vec3 scaleEncounterDryA = texture2D(
			uScaleEncounterGroundDryLitterMap,
			scaleEncounterGroundFrame.uvA
		).rgb;
		vec3 scaleEncounterDryB = texture2D(
			uScaleEncounterGroundDryLitterMap,
			scaleEncounterGroundFrame.uvB
		).rgb;
		vec3 scaleEncounterDryC = texture2D(
			uScaleEncounterGroundDryLitterMap,
			scaleEncounterGroundFrame.uvC
		).rgb;
		scaleEncounterDryLitter =
			(scaleEncounterDryA * scaleEncounterGroundFrame.weights.x +
			 scaleEncounterDryB * scaleEncounterGroundFrame.weights.y +
			 scaleEncounterDryC * scaleEncounterGroundFrame.weights.z) *
				vec3(0.44, 0.34, 0.24);
		scaleEncounterDryLitter = mix(
			scaleEncounterWetHumus,
			scaleEncounterDryLitter,
			0.76
		);
	#endif
	float scaleEncounterHumusLuminance = dot(
		sampledDiffuseColor.rgb,
		vec3(0.2126, 0.7152, 0.0722)
	);
	// The humus scan already contains fine moss/fern structure. The moss domain
	// preserves it while lifting its olive response, rather than painting flat
	// green noise over the lit material.
	vec3 scaleEncounterMoss =
		sampledDiffuseColor.rgb * vec3(0.82, 1.04, 0.76) +
		vec3(0.002, 0.004, 0.002) *
			(0.72 + scaleEncounterHumusLuminance * 1.4);
	// Keep the hero clearing predominantly humus/litter. Large saturated moss
	// fields make the open encounter look like a manicured lawn; the wetter
	// green domain belongs under the woodland margins and drainage pockets.
	float scaleEncounterMossTransfer =
		scaleEncounterGroundBiomeWeights.z *
		scaleEncounterGroundNearClearing * 0.28;
	scaleEncounterGroundBiomeWeights.z -= scaleEncounterMossTransfer;
	scaleEncounterGroundBiomeWeights.x += scaleEncounterMossTransfer * 0.46;
	scaleEncounterGroundBiomeWeights.y += scaleEncounterMossTransfer * 0.54;
	vec3 scaleEncounterBiomeAlbedo =
		scaleEncounterWetHumus * scaleEncounterGroundBiomeWeights.x +
		scaleEncounterDryLitter * scaleEncounterGroundBiomeWeights.y +
		scaleEncounterMoss * scaleEncounterGroundBiomeWeights.z;
	// Leave headroom for the 2.65-strength warm sun and 1.24 exposure used by
	// the encounter. Domain identity comes from texture/roughness and hue, not
	// from letting a sun-facing patch climb toward chalky mid-grey.
	scaleEncounterBiomeAlbedo *= 0.96;
	// Desaturate and cool the real terrain progressively toward the far plate.
	// This is origin-anchored (not camera-distance based), so the transition is
	// stable in all views and avoids the former warm-ground/grey-horizon break.
	float scaleEncounterFarCool = smoothstep(
		68.0,
		225.0,
		length(vScaleEncounterGroundLocalPosition)
	);
	float scaleEncounterBiomeLuminance = dot(
		scaleEncounterBiomeAlbedo,
		vec3(0.2126, 0.7152, 0.0722)
	);
	vec3 scaleEncounterFarNeutral =
		scaleEncounterBiomeLuminance * vec3(0.92, 1.0, 0.95);
	scaleEncounterBiomeAlbedo = mix(
		scaleEncounterBiomeAlbedo,
		scaleEncounterFarNeutral,
		scaleEncounterFarCool * 0.34
	);
	// The clearing needs metre-scale accumulation and drainage structure in
	// overview shots. Keep it low contrast so it reads as compacted humus and
	// moss moisture, not a synthetic colour-noise overlay.
	float scaleEncounterClearingMottle =
		scaleEncounterValueNoise(
			vScaleEncounterGroundLocalPosition / 13.0 + vec2(6.1, -9.3)
		) * 0.54 +
		scaleEncounterValueNoise(
			vScaleEncounterGroundLocalPosition / 31.0 + vec2(-4.2, 12.7)
		) * 0.46;
	float scaleEncounterDrainage = smoothstep(
		0.57,
		0.76,
		scaleEncounterGroundMacroControl.r * 0.65 +
			scaleEncounterClearingMottle * 0.35
	);
	vec3 scaleEncounterClearingTint = mix(
		vec3(0.88, 0.86, 0.80),
		vec3(0.76, 0.82, 0.74),
		scaleEncounterDrainage
	);
	scaleEncounterBiomeAlbedo *= mix(
		vec3(0.94),
		scaleEncounterClearingTint,
		0.12 + scaleEncounterClearingMottle * 0.1
	);
	// Macro strength controls how strongly domains depart from the authored
	// humus base, not their fixed world-space placement.
	sampledDiffuseColor.rgb = mix(
		scaleEncounterWetHumus,
		scaleEncounterBiomeAlbedo,
		smoothstep(0.08, 0.42, uScaleEncounterGroundMacroStrength)
	);
	diffuseColor *= sampledDiffuseColor;

#endif
`

const STOCHASTIC_PANORAMA_OUTPUT_FRAGMENT = `
#include <tonemapping_fragment>

#ifdef SCALE_ENCOUNTER_USE_PANORAMA_MATCH

	// Blend after lighting and tone mapping but before output transfer. The
	// panorama dome itself is toneMapped:false, so this is the one point where
	// its decoded texel and the dome's texel are in the same colour space.
	// Alpha and depth stay untouched: this remains one opaque terrain surface.
	float scaleEncounterPanoramaAmount =
		scaleEncounterPanoramaBlendAmount(vScaleEncounterGroundLocalPosition);
	gl_FragColor.rgb = mix(
		gl_FragColor.rgb,
		scaleEncounterProjectionMatchedPanorama(),
		scaleEncounterPanoramaAmount
	);

#endif
`

const STOCHASTIC_GROUND_FOG_FRAGMENT = `
#ifdef USE_FOG

	#ifdef FOG_EXP2

		float scaleEncounterCameraFogFactor = 1.0 - exp(
			-fogDensity * fogDensity * vFogDepth * vFogDepth
		);

	#else

		float scaleEncounterCameraFogFactor = smoothstep(
			fogNear,
			fogFar,
			vFogDepth
		);

	#endif

	// Ordinary camera-space fog makes the same clearing turn grey merely
	// because the overview camera retreats. Ground atmosphere should accumulate
	// only where a fragment is both far from the camera and outside the authored
	// animal/child clearing. This preserves the accepted near/middle material
	// response at every zoom while true outer terrain still merges into the
	// panorama without a hard horizon.
	float scaleEncounterFocusFogFactor = smoothstep(
		82.0,
		238.0,
		length(vScaleEncounterGroundLocalPosition)
	);
	float scaleEncounterGroundFogFactor =
		scaleEncounterCameraFogFactor * scaleEncounterFocusFogFactor;
	gl_FragColor.rgb = mix(
		gl_FragColor.rgb,
		fogColor,
		scaleEncounterGroundFogFactor
	);

	// Restore an actual soil chroma after output conversion and fog. A scalar
	// darkening pass only produced a darker grey because the minified texture
	// had already lost most of its brown/olive separation. Preserve the rendered
	// luminance and detail, then rebuild restrained warm-humus and damp-olive
	// responses from the same stable macro field used by the PBR material.
	float scaleEncounterOutputLuminance = dot(
		gl_FragColor.rgb,
		vec3(0.2126, 0.7152, 0.0722)
	);
	float scaleEncounterDampEarthAmount = smoothstep(
		0.30,
		0.72,
		scaleEncounterGroundMacroControl.r * 0.68 +
			scaleEncounterGroundMacroControl.g * 0.32
	);
	vec3 scaleEncounterFarEarthHue = mix(
		vec3(1.24, 0.91, 0.56),
		vec3(1.02, 0.98, 0.60),
		scaleEncounterDampEarthAmount
	);
	float scaleEncounterFarEarthValue =
		scaleEncounterOutputLuminance *
		mix(0.62, 0.70, scaleEncounterGroundMacroControl.b);
	vec3 scaleEncounterFarEarth =
		scaleEncounterFarEarthHue * scaleEncounterFarEarthValue;
	gl_FragColor.rgb = mix(
		gl_FragColor.rgb,
		scaleEncounterFarEarth,
		scaleEncounterDistantViewAmount * 0.92
	);

#endif
`

const STOCHASTIC_ROUGHNESS_FRAGMENT = `
float roughnessFactor = roughness;

#ifdef USE_ROUGHNESSMAP

	float scaleEncounterRoughness =
		texture2D(roughnessMap, scaleEncounterGroundFrame.uvA).g *
			scaleEncounterGroundFrame.weights.x +
		texture2D(roughnessMap, scaleEncounterGroundFrame.uvB).g *
			scaleEncounterGroundFrame.weights.y +
		texture2D(roughnessMap, scaleEncounterGroundFrame.uvC).g *
			scaleEncounterGroundFrame.weights.z;
	float scaleEncounterRoughnessBias = mix(
		mix(0.92, 0.99, 1.0 - scaleEncounterGroundDampPocket),
		1.10,
		scaleEncounterGroundBiomeWeights.y
	);
	scaleEncounterRoughnessBias *= mix(
		1.0,
		0.95,
		scaleEncounterGroundBiomeWeights.z
	);
	roughnessFactor *= clamp(
		scaleEncounterRoughness * scaleEncounterRoughnessBias,
		0.72,
		1.0
	);

#endif
`

const STOCHASTIC_NORMAL_FRAGMENT = `
#ifdef USE_NORMALMAP_OBJECTSPACE

	vec3 scaleEncounterNormalA =
		texture2D(normalMap, scaleEncounterGroundFrame.uvA).xyz * 2.0 - 1.0;
	vec3 scaleEncounterNormalB =
		texture2D(normalMap, scaleEncounterGroundFrame.uvB).xyz * 2.0 - 1.0;
	vec3 scaleEncounterNormalC =
		texture2D(normalMap, scaleEncounterGroundFrame.uvC).xyz * 2.0 - 1.0;
	scaleEncounterNormalA.xy = scaleEncounterRestoreNormalRotation(
		scaleEncounterNormalA.xy,
		scaleEncounterGroundFrame.rotationA
	);
	scaleEncounterNormalB.xy = scaleEncounterRestoreNormalRotation(
		scaleEncounterNormalB.xy,
		scaleEncounterGroundFrame.rotationB
	);
	scaleEncounterNormalC.xy = scaleEncounterRestoreNormalRotation(
		scaleEncounterNormalC.xy,
		scaleEncounterGroundFrame.rotationC
	);
	normal = normalize(
		scaleEncounterNormalA * scaleEncounterGroundFrame.weights.x +
		scaleEncounterNormalB * scaleEncounterGroundFrame.weights.y +
		scaleEncounterNormalC * scaleEncounterGroundFrame.weights.z
	);
	normal.xy *=
		scaleEncounterGroundNormalDetail *
		mix(1.0, 0.78, scaleEncounterGroundBiomeWeights.z);

	#ifdef FLIP_SIDED

		normal = -normal;

	#endif

	#ifdef DOUBLE_SIDED

		normal = normal * faceDirection;

	#endif

	normal = normalize(normalMatrix * normal);

#elif defined(USE_NORMALMAP_TANGENTSPACE)

	vec3 scaleEncounterNormalA =
		texture2D(normalMap, scaleEncounterGroundFrame.uvA).xyz * 2.0 - 1.0;
	vec3 scaleEncounterNormalB =
		texture2D(normalMap, scaleEncounterGroundFrame.uvB).xyz * 2.0 - 1.0;
	vec3 scaleEncounterNormalC =
		texture2D(normalMap, scaleEncounterGroundFrame.uvC).xyz * 2.0 - 1.0;

	#if defined(USE_PACKED_NORMALMAP)

		scaleEncounterNormalA.z = sqrt(clamp(
			1.0 - dot(scaleEncounterNormalA.xy, scaleEncounterNormalA.xy),
			0.0,
			1.0
		));
		scaleEncounterNormalB.z = sqrt(clamp(
			1.0 - dot(scaleEncounterNormalB.xy, scaleEncounterNormalB.xy),
			0.0,
			1.0
		));
		scaleEncounterNormalC.z = sqrt(clamp(
			1.0 - dot(scaleEncounterNormalC.xy, scaleEncounterNormalC.xy),
			0.0,
			1.0
		));

	#endif

	scaleEncounterNormalA.xy = scaleEncounterRestoreNormalRotation(
		scaleEncounterNormalA.xy,
		scaleEncounterGroundFrame.rotationA
	);
	scaleEncounterNormalB.xy = scaleEncounterRestoreNormalRotation(
		scaleEncounterNormalB.xy,
		scaleEncounterGroundFrame.rotationB
	);
	scaleEncounterNormalC.xy = scaleEncounterRestoreNormalRotation(
		scaleEncounterNormalC.xy,
		scaleEncounterGroundFrame.rotationC
	);
	vec3 mapN = normalize(
		scaleEncounterNormalA * scaleEncounterGroundFrame.weights.x +
		scaleEncounterNormalB * scaleEncounterGroundFrame.weights.y +
		scaleEncounterNormalC * scaleEncounterGroundFrame.weights.z
	);
	mapN.xy *=
		normalScale *
		scaleEncounterGroundNormalDetail *
		mix(1.0, 0.78, scaleEncounterGroundBiomeWeights.z);
	normal = normalize(tbn * mapN);

#elif defined(USE_BUMPMAP)

	normal = perturbNormalArb(
		-vViewPosition,
		normal,
		dHdxy_fwd(),
		faceDirection
	);

#endif
`

function patchCandidateShader(
  shader: GroundShader,
  config: ResolvedCandidateOptions,
): void {
  shader.uniforms.uScaleEncounterGroundMetrics = {
    value: [
      config.physicalWidthMeters,
      config.stochasticCellSizeMeters,
      config.macroWorldSizeMeters,
    ],
  }
  shader.uniforms.uScaleEncounterGroundNormalFade = {
    value: [config.normalFadeStartMeters, config.normalFadeEndMeters],
  }
  shader.uniforms.uScaleEncounterGroundMacroStrength = {
    value: config.macroVariationStrength,
  }
  shader.uniforms.uScaleEncounterGroundMacroControlMap = {
    value: config.macroControlMap,
  }
  shader.uniforms.uScaleEncounterGroundDryLitterMap = {
    value: config.dryLitterAlbedoTexture,
  }
  shader.uniforms.uScaleEncounterGroundPanoramaMap = {
    value: config.panoramaTexture,
  }
  shader.uniforms.uScaleEncounterGroundPanoramaBlend = {
    value: [
      config.panoramaBlendStartMeters,
      config.panoramaBlendEndMeters,
    ],
  }
  shader.vertexShader = addGroundPositionVarying(shader.vertexShader)
  shader.fragmentShader = shader.fragmentShader
    .replace(
      'varying vec3 vViewPosition;',
      createFragmentHeader(
        config.macroControlMap !== null,
        config.panoramaTexture !== null,
        config.dryLitterAlbedoTexture !== null,
      ),
    )
    .replace(
      'vec4 diffuseColor = vec4( diffuse, opacity );',
      `vec4 diffuseColor = vec4( diffuse, opacity );
${STOCHASTIC_FRAME_INITIALIZATION}`,
    )
    .replace('#include <map_fragment>', STOCHASTIC_MAP_FRAGMENT)
    .replace('#include <roughnessmap_fragment>', STOCHASTIC_ROUGHNESS_FRAGMENT)
    .replace('#include <normal_fragment_maps>', STOCHASTIC_NORMAL_FRAGMENT)
    .replace(
      '#include <tonemapping_fragment>',
      STOCHASTIC_PANORAMA_OUTPUT_FRAGMENT,
    )
    .replace('#include <fog_fragment>', STOCHASTIC_GROUND_FOG_FRAGMENT)
}

/**
 * Applies the D-slice material study to an ordinary MeshStandardMaterial.
 * The returned material is the same instance. The map, normalMap and
 * roughnessMap must share the same physical crop and orientation.
 */
export function applyScaleEncounterStochasticGroundMaterialCandidate(
  material: MeshStandardMaterial,
  options: ScaleEncounterStochasticGroundMaterialCandidateOptions,
): MeshStandardMaterial {
  if (material.userData[CANDIDATE_USER_DATA_KEY] === CANDIDATE_REVISION) {
    return material
  }

  const config = resolveOptions(options)
  const previousOnBeforeCompile = material.onBeforeCompile.bind(material)
  const previousProgramCacheKey = material.customProgramCacheKey.bind(material)

  material.alphaMap = null
  material.opacity = 1
  material.transparent = false
  material.depthWrite = true
  material.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile(shader, renderer)
    patchCandidateShader(shader, config)
  }
  material.customProgramCacheKey = () =>
    `${previousProgramCacheKey()}|${CANDIDATE_REVISION}|macro-map:${config.macroControlMap === null ? '0' : '1'}|dry-litter:${config.dryLitterAlbedoTexture === null ? '0' : '1'}|panorama:${config.panoramaTexture === null ? '0' : '1'}`
  material.userData[CANDIDATE_USER_DATA_KEY] = CANDIDATE_REVISION
  material.needsUpdate = true
  return material
}
