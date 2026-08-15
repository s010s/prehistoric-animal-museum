import {
  Color,
  type ColorRepresentation,
  type MeshStandardMaterial,
} from 'three'

/**
 * PROTOTYPE — hybrid forest-floor material study for the existing scale
 * encounter route. A/B/C remain selected by `?variant=` in the host page.
 *
 * The source scan is physically only two metres wide. Sampling it once at that
 * scale over a 720 m floor exposes the same marks hundreds of times, while a
 * conventional transparent radial fade can uncover the panorama directly
 * below a distant portrait camera. This patch keeps a depth-writing floor,
 * mixes the albedo at three incommensurate scales, and only softens alpha
 * where a fragment is far from both the subject clearing and current camera.
 */

const PROTOTYPE_REVISION = 'hybrid-ground-antitile-v1'
const PROTOTYPE_USER_DATA_KEY = 'scaleEncounterHybridGroundPrototype'

export interface ScaleEncounterHybridGroundMaterialPrototypeOptions {
  /** Distance from the encounter origin before the terrain may start fading. */
  readonly subjectFadeStartMeters?: number
  /** Distance from the encounter origin where the terrain can fully fade. */
  readonly subjectFadeEndMeters?: number
  /** Camera-space distance before any ordered fade is permitted. */
  readonly cameraFadeStartMeters?: number
  /** Camera-space distance where the camera-distance mask reaches full strength. */
  readonly cameraFadeEndMeters?: number
  /** Linear-space colour the surviving distant terrain approaches. */
  readonly horizonColour?: ColorRepresentation
  /** Maximum amount of distant colour grading before the ordered fade. */
  readonly horizonColourStrength?: number
  /** Upper bound for discarded far-ground coverage. */
  readonly maximumCoverageLoss?: number
  /** Relative UV frequency of the first rotated albedo sample. */
  readonly secondaryUvScale?: number
  /** Relative UV frequency of the broadest rotated albedo sample. */
  readonly tertiaryUvScale?: number
}

interface ResolvedPrototypeOptions {
  readonly cameraFadeEndMeters: number
  readonly cameraFadeStartMeters: number
  readonly horizonColour: Color
  readonly horizonColourStrength: number
  readonly maximumCoverageLoss: number
  readonly secondaryUvScale: number
  readonly subjectFadeEndMeters: number
  readonly subjectFadeStartMeters: number
  readonly tertiaryUvScale: number
}

type GroundShader = Parameters<MeshStandardMaterial['onBeforeCompile']>[0]

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function resolveOptions(
  options: ScaleEncounterHybridGroundMaterialPrototypeOptions,
): ResolvedPrototypeOptions {
  const subjectFadeStartMeters = Math.max(
    24,
    finiteOr(options.subjectFadeStartMeters, 34),
  )
  const cameraFadeStartMeters = Math.max(
    12,
    finiteOr(options.cameraFadeStartMeters, 64),
  )
  return {
    cameraFadeEndMeters: Math.max(
      cameraFadeStartMeters + 1,
      finiteOr(options.cameraFadeEndMeters, 172),
    ),
    cameraFadeStartMeters,
    horizonColour: new Color(options.horizonColour ?? '#43533e'),
    horizonColourStrength: Math.max(
      0,
      Math.min(1, finiteOr(options.horizonColourStrength, 0.62)),
    ),
    maximumCoverageLoss: Math.max(
      0,
      Math.min(0.98, finiteOr(options.maximumCoverageLoss, 0.82)),
    ),
    secondaryUvScale: Math.max(
      0.05,
      finiteOr(options.secondaryUvScale, 0.431),
    ),
    subjectFadeEndMeters: Math.max(
      subjectFadeStartMeters + 1,
      finiteOr(options.subjectFadeEndMeters, 126),
    ),
    subjectFadeStartMeters,
    tertiaryUvScale: Math.max(
      0.025,
      finiteOr(options.tertiaryUvScale, 0.137),
    ),
  }
}

function addPrototypeVarying(vertexShader: string): string {
  return vertexShader
    .replace(
      'varying vec3 vViewPosition;',
      `varying vec3 vViewPosition;
varying vec2 vScaleEncounterGroundLocalPosition;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
	vScaleEncounterGroundLocalPosition = position.xy;`,
    )
}

function createAntiTileMapFragment(config: ResolvedPrototypeOptions): string {
  return `
#ifdef USE_MAP

	// The original 2 m scan remains the fine-frequency layer. Two rotated,
	// irrationally scaled reads prevent its distinctive marks from lining up
	// into the same rows at overview distance. A slow local-space field changes
	// their weights without allocating another texture or cache entry.
	vec2 scaleEncounterWarp = vec2(
		sin(vScaleEncounterGroundLocalPosition.y * 0.047) +
			sin((vScaleEncounterGroundLocalPosition.x + vScaleEncounterGroundLocalPosition.y) * 0.019),
		cos(vScaleEncounterGroundLocalPosition.x * 0.041) +
			cos((vScaleEncounterGroundLocalPosition.x - vScaleEncounterGroundLocalPosition.y) * 0.023)
	) * 0.085;
	vec2 scaleEncounterPrimaryUv = vMapUv + scaleEncounterWarp;
	mat2 scaleEncounterSecondaryRotation = mat2(0.738, -0.675, 0.675, 0.738);
	mat2 scaleEncounterTertiaryRotation = mat2(0.852, 0.523, -0.523, 0.852);
	vec2 scaleEncounterSecondaryUv =
		scaleEncounterSecondaryRotation * vMapUv * ${config.secondaryUvScale.toFixed(6)} +
		vec2(17.371, 41.239);
	vec2 scaleEncounterTertiaryUv =
		scaleEncounterTertiaryRotation * vMapUv * ${config.tertiaryUvScale.toFixed(6)} +
		vec2(63.113, 9.731);

	vec4 scaleEncounterPrimarySample = texture2D(map, scaleEncounterPrimaryUv);
	vec4 scaleEncounterSecondarySample = texture2D(map, scaleEncounterSecondaryUv);
	vec4 scaleEncounterTertiarySample = texture2D(map, scaleEncounterTertiaryUv);
	float scaleEncounterMacroField =
		0.5 +
		sin(dot(vScaleEncounterGroundLocalPosition, vec2(0.037, 0.061)) + 0.8) * 0.22 +
		cos(dot(vScaleEncounterGroundLocalPosition, vec2(-0.019, 0.043)) - 1.4) * 0.16;
	float scaleEncounterSecondaryWeight =
		mix(0.32, 0.68, smoothstep(0.2, 0.8, scaleEncounterMacroField));
	vec4 sampledDiffuseColor = mix(
		scaleEncounterPrimarySample,
		scaleEncounterSecondarySample,
		scaleEncounterSecondaryWeight
	);
	float scaleEncounterBroadWeight =
		0.1 + 0.12 * smoothstep(0.28, 0.76, 1.0 - scaleEncounterMacroField);
	sampledDiffuseColor = mix(
		sampledDiffuseColor,
		scaleEncounterTertiarySample,
		scaleEncounterBroadWeight
	);

	#ifdef DECODE_VIDEO_TEXTURE

		sampledDiffuseColor = sRGBTransferEOTF(sampledDiffuseColor);

	#endif

	diffuseColor *= sampledDiffuseColor;

#endif
`
}

const GROUND_EDGE_FRAGMENT = `
	// Preserve a solid floor around either observer. The two masks only overlap
	// in remote middle distance, where ordered rejection reveals the panorama
	// gradually without putting a transparent second floor beneath the camera.
	float scaleEncounterLocalRadius = length(vScaleEncounterGroundLocalPosition);
	float scaleEncounterIrregularRadius =
		scaleEncounterLocalRadius +
		sin(vScaleEncounterGroundLocalPosition.x * 0.071 +
			vScaleEncounterGroundLocalPosition.y * 0.043) * 7.0 +
		cos(vScaleEncounterGroundLocalPosition.x * 0.029 -
			vScaleEncounterGroundLocalPosition.y * 0.057) * 4.0;
	float scaleEncounterSubjectFade = smoothstep(
		uScaleEncounterSubjectFade.x,
		uScaleEncounterSubjectFade.y,
		scaleEncounterIrregularRadius
	);
	float scaleEncounterCameraFade = smoothstep(
		uScaleEncounterCameraFade.x,
		uScaleEncounterCameraFade.y,
		length(vViewPosition)
	);
	float scaleEncounterAtmosphere =
		saturate(scaleEncounterSubjectFade * scaleEncounterCameraFade * 1.18);
	diffuseColor.rgb = mix(
		diffuseColor.rgb,
		uScaleEncounterHorizonColour,
		scaleEncounterAtmosphere * uScaleEncounterHorizonColourStrength
	);

	float scaleEncounterCoverageLoss = smoothstep(
		0.08,
		0.96,
		scaleEncounterSubjectFade * scaleEncounterCameraFade
	) * uScaleEncounterMaximumCoverageLoss;
	diffuseColor.a *= 1.0 - scaleEncounterCoverageLoss;
`

function patchPrototypeShader(
  shader: GroundShader,
  config: ResolvedPrototypeOptions,
): void {
  shader.uniforms.uScaleEncounterSubjectFade = {
    value: [config.subjectFadeStartMeters, config.subjectFadeEndMeters],
  }
  shader.uniforms.uScaleEncounterCameraFade = {
    value: [config.cameraFadeStartMeters, config.cameraFadeEndMeters],
  }
  shader.uniforms.uScaleEncounterHorizonColour = {
    value: config.horizonColour,
  }
  shader.uniforms.uScaleEncounterHorizonColourStrength = {
    value: config.horizonColourStrength,
  }
  shader.uniforms.uScaleEncounterMaximumCoverageLoss = {
    value: config.maximumCoverageLoss,
  }
  shader.vertexShader = addPrototypeVarying(shader.vertexShader)
  shader.fragmentShader = shader.fragmentShader
    .replace(
      'varying vec3 vViewPosition;',
      `varying vec3 vViewPosition;
varying vec2 vScaleEncounterGroundLocalPosition;
uniform vec2 uScaleEncounterSubjectFade;
uniform vec2 uScaleEncounterCameraFade;
uniform vec3 uScaleEncounterHorizonColour;
uniform float uScaleEncounterHorizonColourStrength;
uniform float uScaleEncounterMaximumCoverageLoss;`,
    )
    .replace('#include <map_fragment>', createAntiTileMapFragment(config))
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
${GROUND_EDGE_FRAGMENT}`,
    )
}

/**
 * Applies the C-variant ground study to an ordinary MeshStandardMaterial.
 * The returned material is the same instance and keeps depth writes enabled.
 * Its transparency is dual-distance gated so the camera's local floor remains
 * fully solid while only remote terrain can blend into the panorama.
 */
export function applyScaleEncounterHybridGroundMaterialPrototype(
  material: MeshStandardMaterial,
  options: ScaleEncounterHybridGroundMaterialPrototypeOptions = {},
): MeshStandardMaterial {
  if (material.userData[PROTOTYPE_USER_DATA_KEY] === PROTOTYPE_REVISION) {
    return material
  }

  const config = resolveOptions(options)
  const previousOnBeforeCompile = material.onBeforeCompile.bind(material)
  const previousProgramCacheKey = material.customProgramCacheKey.bind(material)

  material.transparent = true
  material.depthWrite = true
  material.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile(shader, renderer)
    patchPrototypeShader(shader, config)
  }
  material.customProgramCacheKey = () =>
    `${previousProgramCacheKey()}|${PROTOTYPE_REVISION}|${config.secondaryUvScale.toFixed(6)}|${config.tertiaryUvScale.toFixed(6)}|${config.maximumCoverageLoss.toFixed(2)}`
  material.userData[PROTOTYPE_USER_DATA_KEY] = PROTOTYPE_REVISION
  material.needsUpdate = true
  return material
}
