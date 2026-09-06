import { applyAuthoredGroundMaterial } from '../../../viewer/scale-encounter-authored-ground'
import {
  BackSide,
  Color,
  DataTexture,
  DirectionalLight,
  Fog,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  PMREMGenerator,
  RedFormat,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  UnsignedByteType,
  Vector2,
  type Material,
  type Texture,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from 'three'

import { alpineDemUrl } from 'virtual:scale-encounter-glacier-assets'
import {
  createMammothPalaeoenvironmentCandidate,
  type MammothPalaeoenvironmentCandidate,
} from './mammoth-palaeoenvironment-candidate'

export const MAMMOTH_ACCEPTED_SNOW_ENVIRONMENT_ID =
  'mammoth-real-dem-snow-valley-accepted-v1'

const ANIMAL_X = 1.8
const ANIMAL_Z = 0

export interface MammothAcceptedSnowEnvironment {
  readonly candidate: MammothPalaeoenvironmentCandidate
  readonly environmentIntensity: number
  readonly environmentMap: Texture | null
  readonly fog: Fog
  readonly groundHeightAtWorld: (x: number, z: number) => number
  readonly root: Group
  readonly skyDome: Mesh
  dispose(): void
  update(elapsedSeconds: number): void
}

/**
 * Keeps the approved Snowflow basin and replaces its near-field props with scans.
 * The walkable near field uses the existing matched snow scan; a real Mapzen Terrarium DEM
 * supplies only elevation for the distant Three.js mountain basin. No modern
 * photograph, road, building or dam is present in the rendered environment.
 */
export function createMammothAcceptedSnowEnvironment(
  renderer?: WebGLRenderer,
): MammothAcceptedSnowEnvironment {
  const candidate = createMammothPalaeoenvironmentCandidate('C', 'balanced')
  hideSupersededCandidateLayers(candidate)
  tightenHeroShadow(candidate.root)

  const heroZone = createHeroZone()
  const terrain = createAuthenticAlpineTerrain()
  const sky = createAlpineSkyDome()
  candidate.root.add(heroZone.root, terrain.mesh, sky.mesh)
  candidate.root.userData.scaleEncounterAcceptedEnvironment = {
    defaultCandidate: true,
    id: MAMMOTH_ACCEPTED_SNOW_ENVIRONMENT_ID,
    elevationSource: 'mapzen-terrarium-z12-2139-1449',
    modernPhotography: false,
    baseOwnerVisualApproval: '2026-08-19',
    localRevision: 'scanned-snow-and-rocks-2026-09-05',
  }

  const environmentTarget = renderer
    ? createSnowEnvironmentMap(renderer)
    : null

  return {
    candidate,
    environmentIntensity: 0.76,
    environmentMap: environmentTarget?.texture ?? null,
    fog: new Fog('#bdd8e4', 950, 3_600),
    groundHeightAtWorld: mammothAcceptedGroundHeightAtWorld,
    root: candidate.root,
    skyDome: sky.mesh,
    dispose: () => {
      candidate.dispose()
      heroZone.textures.forEach((texture) => texture.dispose())
      terrain.heightMap.dispose()
      sky.cloudMap.dispose()
      environmentTarget?.dispose()
    },
    update: (elapsedSeconds) => candidate.update(elapsedSeconds),
  }
}

function hideSupersededCandidateLayers(
  candidate: MammothPalaeoenvironmentCandidate,
): void {
  candidate.layers.groundSurface.visible = false
  candidate.layers.snowLayer.visible = false
  candidate.layers.nearGround.visible = false
  candidate.layers.midSteppe.visible = false
  candidate.layers.farIceMass.visible = false
  candidate.layers.farLandform.visible = false
  candidate.layers.atmosphere.visible = false

  const hiddenBackgroundObjects = new Set([
    'glacier-background-atmosphere-sky',
    'glacier-rear-snow-peak-range',
    'glacier-far-rock-ridge',
    'glacier-front-moraine-ridge',
    'glacier-background-horizon-haze',
  ])
  candidate.layers.background.traverse((object) => {
    if (hiddenBackgroundObjects.has(object.name)) object.visible = false
  })
}

function createHeroZone(): {
  readonly root: Group
  readonly textures: readonly Texture[]
} {
  const root = new Group()
  root.name = 'scale-encounter-mammoth-accepted-hero-zone'
  const loader = new TextureLoader()
  const albedo = loader.load(new URL(
    '../../assets/environments/surface-snow-albedo-1024.webp', import.meta.url,
  ).href)
  const normal = loader.load(new URL(
    '../../assets/environments/surface-snow-normal-1024.webp', import.meta.url,
  ).href)
  const roughness = loader.load(new URL(
    '../../assets/environments/surface-snow-roughness-1024.webp', import.meta.url,
  ).href)
  const soil = loader.load(new URL(
    '../../assets/environments/surface-land-albedo-1024.webp', import.meta.url,
  ).href)
  const soilNormal = loader.load(new URL(
    '../../assets/environments/surface-land-normal-1024.webp', import.meta.url,
  ).href)
  albedo.colorSpace = SRGBColorSpace
  soil.colorSpace = SRGBColorSpace
  const colourMap = loader.load(new URL(
    '../../assets/environments/snow-earth-patches-v3.webp', import.meta.url,
  ).href)
  colourMap.colorSpace = SRGBColorSpace
  colourMap.anisotropy = 8
  const textures = [albedo, normal, roughness, soil, soilNormal]
  for (const texture of textures) {
    texture.wrapS = texture.wrapT = RepeatWrapping
    texture.repeat.set(72, 72) // The source scan covers two metres.
    texture.anisotropy = 4
  }
  const material = new MeshStandardMaterial({
    color: '#ffffff',
    map: albedo,
    normalMap: normal,
    normalScale: new Vector2(0.24, 0.24),
    roughnessMap: roughness,
    roughness: 0.94,
    metalness: 0,
    transparent: true,
    depthWrite: true,
  })
  material.name = 'scale-encounter-mammoth-scanned-snow-pbr'
  applyAuthoredGroundMaterial(material, {
    colourMap,
    widthMeters: 112,
    detailMeters: 1.3,
    farColour: '#e5e9e6',
    grainStrength: 0.06,
    colourMipLevel: 1,
  })
  const authoredCompile = material.onBeforeCompile.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    authoredCompile(shader, renderer)
    shader.uniforms.uExposedSoil = { value: soil }
    shader.uniforms.uExposedSoilNormal = { value: soilNormal }
    shader.fragmentShader = shader.fragmentShader
      .replace('uniform sampler2D uGroundColourPlate;', `uniform sampler2D uGroundColourPlate;
uniform sampler2D uExposedSoil;
uniform sampler2D uExposedSoilNormal;`)
      // The authored image defines snow coverage, not metre-wide blurred
      // pebbles. Both surfaces retain the physical grain of the source scans.
      .replace('diffuseColor.rgb *= groundColour;', `
vec3 snowPlate = textureLod(uGroundColourPlate, groundPlateUv, 0.0).rgb;
float snowCover = smoothstep(.34, .62, dot(snowPlate, vec3(.2126, .7152, .0722)));
snowCover = mix(1.0, snowCover, groundPlateFade);
vec3 soilColour = sampleGroundScan(uExposedSoil, groundDetailUv).rgb * .4;
vec3 snowColour = vec3(.73, .79, .81) * mix(.94, 1.06, groundGrain);
diffuseColor.rgb *= mix(soilColour, snowColour, snowCover);`)
      .replaceAll('sampleGroundScan( normalMap, groundDetailUv )',
        'mix(sampleGroundScan(uExposedSoilNormal, groundDetailUv), sampleGroundScan(normalMap, groundDetailUv), snowCover)')
      .replace('#include <opaque_fragment>', `
diffuseColor.a *= 1.0 - smoothstep(64.0, 78.0, length(vAuthoredGroundWorld.xz));
#include <opaque_fragment>`)
  }
  material.customProgramCacheKey = () => 'mammoth-patchy-snow-ground-v3'
  const geometry = new PlaneGeometry(164, 164, 164, 164)
  geometry.rotateX(-Math.PI / 2)
  const positions = geometry.getAttribute('position')
  for (let i = 0; i < positions.count; i += 1) {
    positions.setY(i, mammothAcceptedGroundHeightAtWorld(positions.getX(i), positions.getZ(i)))
  }
  geometry.computeVertexNormals()
  const ground = new Mesh(geometry, material)
  ground.name = 'scale-encounter-mammoth-continuous-snow-drifts'
  ground.receiveShadow = true
  root.add(ground)
  return { root, textures: [...textures, colourMap] }
}

function createAlpineSkyDome(): {
  readonly cloudMap: DataTexture
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>
} {
  const cloudMap = createCloudMaskTexture()
  const material = new ShaderMaterial({
    depthWrite: false,
    fog: false,
    side: BackSide,
    toneMapped: false,
    uniforms: {
      cloudColour: { value: new Color('#f8fbfc') },
      cloudMap: { value: cloudMap },
      horizonColour: { value: new Color('#c2e0ed') },
      middleColour: { value: new Color('#79b9dc') },
      zenithColour: { value: new Color('#438fc2') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vSkyDirection;
      varying vec2 vSkyUv;
      void main() {
        vSkyDirection = normalize(position);
        vSkyUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 cloudColour;
      uniform sampler2D cloudMap;
      uniform vec3 horizonColour;
      uniform vec3 middleColour;
      uniform vec3 zenithColour;
      varying vec3 vSkyDirection;
      varying vec2 vSkyUv;
      void main() {
        vec3 direction = normalize(vSkyDirection);
        float height = direction.y;
        vec3 sky = mix(
          horizonColour,
          middleColour,
          smoothstep(-0.04, 0.42, height)
        );
        sky = mix(sky, zenithColour, smoothstep(0.38, 0.92, height));
        float cloudBand = smoothstep(0.03, 0.13, height) *
          (1.0 - smoothstep(0.62, 0.82, height));
        float cloud = texture2D(cloudMap, vSkyUv).r * cloudBand;
        float cloudLight = 0.82 + max(direction.y, 0.0) * 0.18;
        sky = mix(sky, cloudColour * cloudLight, cloud * 0.52);
        gl_FragColor = vec4(sky, 1.0);
        #include <colorspace_fragment>
      }
    `,
  })
  material.name = 'scale-encounter-mammoth-clear-blue-sky'
  const mesh = new Mesh(new SphereGeometry(2_300, 64, 32), material)
  mesh.name = 'scale-encounter-mammoth-accepted-sky-dome'
  mesh.frustumCulled = false
  mesh.renderOrder = -100
  return { cloudMap, mesh }
}

function createCloudMaskTexture(): DataTexture {
  const width = 512
  const height = 256
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width
      const broad = periodicValueNoise(u * 6, v * 3, 6, 3, 0x29d3)
      const middle = periodicValueNoise(u * 13, v * 7, 13, 7, 0x51a7)
      const detail = periodicValueNoise(u * 29, v * 15, 29, 15, 0x7f4d)
      const field = broad * 0.56 + middle * 0.3 + detail * 0.14
      data[y * width + x] = Math.round(smoothstep(0.59, 0.73, field) * 255)
    }
  }
  const texture = new DataTexture(
    data,
    width,
    height,
    RedFormat,
    UnsignedByteType,
  )
  texture.name = 'scale-encounter-mammoth-seamless-cloud-mask'
  texture.wrapS = RepeatWrapping
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

function periodicValueNoise(
  x: number,
  y: number,
  periodX: number,
  periodY: number,
  seed: number,
): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const blendX = smoothstep(0, 1, x - x0)
  const blendY = smoothstep(0, 1, y - y0)
  const a = periodicCloudHash(x0, y0, periodX, periodY, seed)
  const b = periodicCloudHash(x0 + 1, y0, periodX, periodY, seed)
  const c = periodicCloudHash(x0, y0 + 1, periodX, periodY, seed)
  const d = periodicCloudHash(x0 + 1, y0 + 1, periodX, periodY, seed)
  return mix(mix(a, b, blendX), mix(c, d, blendX), blendY)
}

function periodicCloudHash(
  x: number,
  y: number,
  periodX: number,
  periodY: number,
  seed: number,
): number {
  const wrappedX = ((x % periodX) + periodX) % periodX
  const wrappedY = ((y % periodY) + periodY) % periodY
  let value = seed ^ Math.imul(wrappedX + 1, 0x45d9f3b)
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
  value ^= Math.imul(wrappedY + 1, 0x27d4eb2d)
  value = Math.imul(value ^ (value >>> 15), 0x85ebca6b)
  return ((value ^ (value >>> 16)) >>> 0) / 4_294_967_295
}

function createAuthenticAlpineTerrain(): {
  readonly heightMap: Texture
  readonly mesh: Mesh<PlaneGeometry, MeshStandardMaterial>
} {
  const terrainSize = 6_740
  const terrainOriginUv = new Vector2(176.5 / 256, 1 - 80.5 / 256)
  const terrainOriginLocal = new Vector2(
    (terrainOriginUv.x - 0.5) * terrainSize,
    (terrainOriginUv.y - 0.5) * terrainSize,
  )
  const heightMap = new TextureLoader().load(alpineDemUrl)
  heightMap.name = 'scale-encounter-mapzen-alpine-elevation'
  heightMap.generateMipmaps = false
  heightMap.magFilter = LinearFilter
  heightMap.minFilter = LinearFilter

  const geometry = new PlaneGeometry(terrainSize, terrainSize, 255, 255)
  const material = new MeshStandardMaterial({
    color: '#ffffff',
    envMapIntensity: 0.62,
    metalness: 0,
    roughness: 0.9,
  })
  material.name = 'scale-encounter-real-dem-snow-mountain-material'
  material.onBeforeCompile = (shader) => {
    shader.uniforms.alpineHeightMap = { value: heightMap }
    shader.uniforms.alpineOriginLocal = { value: terrainOriginLocal }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D alpineHeightMap;
uniform vec2 alpineOriginLocal;
varying float vAlpineRelief;
varying vec3 vAlpineWorld;
varying vec3 vAlpineWorldNormal;

float alpineElevationAt(vec2 sampleUv) {
  vec3 encoded = texture2D(alpineHeightMap, sampleUv).rgb;
  return encoded.r * 65280.0 + encoded.g * 255.0 + encoded.b * 0.99609375 - 32768.0;
}

float alpineReliefAt(vec2 sampleUv, vec2 localPosition) {
  float relativeElevation = (alpineElevationAt(sampleUv) - 2537.59375) * 0.44;
  float localRadius = length(localPosition - alpineOriginLocal);
  return relativeElevation * smoothstep(62.0, 420.0, localRadius);
}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
const vec2 alpineTexel = vec2(1.0 / 256.0);
const float alpineCellSize = 26.328125;
vAlpineRelief = alpineReliefAt(uv, position.xy);
transformed.z += vAlpineRelief;
float alpineLeft = alpineReliefAt(
  uv - vec2(alpineTexel.x, 0.0),
  position.xy - vec2(alpineCellSize, 0.0)
);
float alpineRight = alpineReliefAt(
  uv + vec2(alpineTexel.x, 0.0),
  position.xy + vec2(alpineCellSize, 0.0)
);
float alpineDown = alpineReliefAt(
  uv - vec2(0.0, alpineTexel.y),
  position.xy - vec2(0.0, alpineCellSize)
);
float alpineUp = alpineReliefAt(
  uv + vec2(0.0, alpineTexel.y),
  position.xy + vec2(0.0, alpineCellSize)
);
vec3 alpineLocalNormal = normalize(vec3(
  -(alpineRight - alpineLeft) / (alpineCellSize * 2.0),
  -(alpineUp - alpineDown) / (alpineCellSize * 2.0),
  1.0
));
vAlpineWorldNormal = normalize(mat3(modelMatrix) * alpineLocalNormal);
vAlpineWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vAlpineRelief;
varying vec3 vAlpineWorld;
varying vec3 vAlpineWorldNormal;

float alpineHash(vec2 value) {
  return fract(sin(dot(value, vec2(127.1, 311.7))) * 43758.5453123);
}

float alpineValueNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 blend = fract(point);
  blend = blend * blend * (3.0 - 2.0 * blend);
  float a = alpineHash(cell);
  float b = alpineHash(cell + vec2(1.0, 0.0));
  float c = alpineHash(cell + vec2(0.0, 1.0));
  float d = alpineHash(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
vec3 alpineWorldNormal = normalize(vAlpineWorldNormal);
float alpineUpward = smoothstep(0.90, 0.995, alpineWorldNormal.y);
float alpineAltitude = smoothstep(40.0, 430.0, vAlpineRelief);
float alpineMacro = alpineValueNoise(vAlpineWorld.xz * 0.0045);
float alpineDetail = alpineValueNoise(vAlpineWorld.xz * 0.035);
float alpineSnowCoverage = clamp(
  alpineUpward * 0.72 + alpineAltitude * 0.42 +
  (alpineMacro - 0.5) * 0.22 + (alpineDetail - 0.5) * 0.08,
  0.0,
  1.0
);
vec3 alpineRock = mix(
  vec3(0.115, 0.135, 0.155),
  vec3(0.255, 0.285, 0.31),
  alpineMacro
);
vec3 alpineSnow = mix(
  vec3(0.54, 0.62, 0.68),
  vec3(0.77, 0.84, 0.9),
  alpineDetail * 0.42 + 0.46
);
vec3 alpineSurface = mix(
  alpineRock,
  alpineSnow,
  smoothstep(0.22, 0.82, alpineSnowCoverage)
);
diffuseColor.rgb *= alpineSurface;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
normal = normalize((viewMatrix * vec4(alpineWorldNormal, 0.0)).xyz);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(0.82, 0.96, alpineSnowCoverage);`,
      )
  }
  material.customProgramCacheKey = () =>
    'scale-encounter-real-dem-alpine-terrain-v1'

  const mesh = new Mesh(geometry, material)
  mesh.name = 'scale-encounter-real-dem-continuous-alpine-terrain'
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(
    ANIMAL_X - terrainOriginLocal.x,
    -0.08,
    ANIMAL_Z + terrainOriginLocal.y,
  )
  mesh.receiveShadow = true
  return { heightMap, mesh }
}

function createSnowEnvironmentMap(
  renderer: WebGLRenderer,
): WebGLRenderTarget {
  const environmentScene = new Scene()
  const dome = new Mesh(
    new SphereGeometry(24, 48, 24),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: {
        horizon: { value: new Color('#cbdde5').convertSRGBToLinear() },
        zenith: { value: new Color('#6591ad').convertSRGBToLinear() },
        ground: { value: new Color('#8a938e').convertSRGBToLinear() },
      },
      vertexShader: `
        varying vec3 vDirection;
        void main() {
          vDirection = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vDirection;
        uniform vec3 horizon;
        uniform vec3 zenith;
        uniform vec3 ground;
        void main() {
          float up = smoothstep(-0.02, 0.88, vDirection.y);
          vec3 colour = mix(ground, horizon, smoothstep(-0.55, 0.08, vDirection.y));
          colour = mix(colour, zenith, up);
          gl_FragColor = vec4(colour, 1.0);
        }
      `,
    }),
  )
  environmentScene.add(dome)
  const generator = new PMREMGenerator(renderer)
  const target = generator.fromScene(environmentScene, 0.04, 0.1, 60)
  generator.dispose()
  dome.geometry.dispose()
  ;(dome.material as Material).dispose()
  return target
}

function tightenHeroShadow(root: Group): void {
  root.traverse((object) => {
    if (
      !(object instanceof DirectionalLight) ||
      object.name !== 'glacier-world-sun'
    ) {
      return
    }
    object.shadow.mapSize.set(2048, 2048)
    object.shadow.camera.left = -15
    object.shadow.camera.right = 15
    object.shadow.camera.top = 13
    object.shadow.camera.bottom = -13
    object.shadow.camera.near = 28
    object.shadow.camera.far = 142
    object.shadow.bias = -0.00012
    object.shadow.normalBias = 0.012
    object.shadow.radius = 1.6
    object.shadow.camera.updateProjectionMatrix()
  })
}

// Broad individually placed drifts form one surface. Keep the animal's feet
// and the child's observation rail level, then rise gently on both sides.
const SNOW_DRIFTS = [
  [-17, -10, 14, 5, 1.05, -0.35],
  [16, 12, 18, 6, 1.32, -0.46],
  [28, -22, 23, 8, 1.8, -0.25],
  [-31, 24, 20, 7, 1.5, -0.55],
  [-8, -38, 31, 10, 1.7, -0.32],
  [39, 39, 24, 11, 2.05, -0.6],
] as const

export function mammothAcceptedGroundHeightAtWorld(x = 0, z = 0): number {
  let height = 0
  for (const [cx, cz, width, depth, rise, yaw] of SNOW_DRIFTS) {
    const dx = x - cx
    const dz = z - cz
    const u = (dx * Math.cos(yaw) + dz * Math.sin(yaw)) / width
    const v = (-dx * Math.sin(yaw) + dz * Math.cos(yaw)) / depth
    height += rise * Math.exp(-(u * u + v * v) * 2)
  }
  const footClearance = smoothstep(3.8, 7.5, Math.abs(z))
  const outerBlend = 1 - smoothstep(58, 78, Math.hypot(x, z))
  return -0.035 + height * footClearance * outerBlend
}

function smoothstep(start: number, end: number, value: number): number {
  const amount = Math.min(1, Math.max(0, (value - start) / (end - start)))
  return amount * amount * (3 - 2 * amount)
}

function mix(a: number, b: number, amount: number): number {
  return a + (b - a) * amount
}
