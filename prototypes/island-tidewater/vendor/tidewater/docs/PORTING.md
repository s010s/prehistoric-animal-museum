# Porting Tidewater from three.js/TSL to raw WebGPU + WGSL

Branch `webgpu-native`. Goal: no `three` import anywhere in `src/`, same look and behaviour as `main`.
The three.js version (on `main`, and at `../threejs-water-claude`) is the reference: read the original file
before porting it, keep its structure, names, constants and comments, and translate TSL to WGSL faithfully.
Don't simplify effects away. If something can't be ported 1:1, write down why in the file.

## Engine (src/engine)

CPU side, three-compatible (`import * as THREE from '../engine/index.js'` works as a stopgap, but prefer
named imports): math (Vector2/3/4, Matrix3/4, Quaternion, Euler, Color, Box3, Sphere, Plane, Frustum, Ray,
Spherical, MathUtils, CatmullRomCurve3, ShapeUtils, Timer, DataUtils), scene (Object3D, Group, Scene, Mesh,
InstancedMesh, PerspectiveCamera, OrthographicCamera, Layers), geometry (BufferGeometry, all attribute
classes, Plane/Box/Sphere/Cylinder/Cone/Circle/Torus/Lathe/Icosahedron/Tube/RoundedBox geometries,
mergeGeometries/mergeVertices). Cameras use reversed-Z WebGPU projections (depth 1 at near, 0 at far).

GPU side, `src/engine/webgpu.js`:

| three / TSL | engine |
|---|---|
| `renderer`, `renderer.backend.device` | `GPU` singleton: `GPU.device`, `GPU.queue`, `GPU.getEncoder()`, `GPU.submit()` |
| `uniform( v )`, `uniformArray` | `UniformBlock( 'StructName', { name: [ 'vec3f', value ], arr: [ 'vec4f[8]', [...] ] } )`; `block.fields.name.value` is the three-style `{ value }` handle |
| `G.*` (core/Globals.js) | `G` from `render/Frame.js` — same names; in WGSL `frame.sunDir`, `frame.time`, … |
| camera nodes (`cameraPosition`, `cameraProjectionMatrix`, …) | `frame.cameraPos`, `frame.view`, `frame.proj`, `frame.viewProj` (jittered), `frame.viewProjNoJitter`, `frame.prevViewProjNoJitter`, `frame.invViewProj`, `frame.near`, `frame.far`, `frame.resolution` |
| `instancedArray`, `StorageBufferAttribute` | `StorageBuffer( { count, type: 'vec4f' } )` |
| `DataTexture`, `StorageTexture`, `StorageArrayTexture`, `Data3DTexture`, `RenderTarget` | `Texture( { width, height, depth, dimension, format, mips, usage: [ 'sample', 'storage', 'render', 'copySrc', 'copyDst' ], data } )`, `RenderTarget( w, h, { colors, depth } )` |
| `Fn( … )().compute( n )`, `renderer.compute()` | `ComputeKernel( { modules, bindings, code, workgroupSize } )`, `kernel.dispatch( groups )` (records into the frame encoder) |
| TSL helper functions shared between systems | `ShaderModule( { name, deps, code, bindings, uniforms } )` (see below) |
| `NodeMaterial` / `MeshStandardNodeMaterial` / `SceneMaterial` / `MeshBasicNodeMaterial` | `Material( { vertex, surface, output, uniforms, textures, storage, varyings, attributes, … } )` — see the header of `render/Material.js` |
| `positionNode` (local) | `vertex` snippet: `v.position`, `v.normal`, `v.worldOffset`, or `v.useWorld = true; v.worldPos = …` |
| `colorNode`, `roughnessNode`, `normalNode`, `aoNode`, `emissiveNode`, `opacityNode`, `maskNode` | `surface` snippet writing `s.albedo`, `s.roughness`, `s.normal` (world space!), `s.ao`, `s.emissive`, `s.alpha` (+ `alphaTest`) |
| `outputNode`, `mrtNode` | `output` snippet: `r.color`, `r.velocity`, `r.mask` |
| `material.translucencyNode` | `s.translucency` (vec3, multiplied by the light colour) |
| `SceneLighting.directModulation` etc. | `SceneLighting.set( 'directModulation', module )` with `fn hookDirectModulation( P, N ) -> vec3f` — see `render/wgsl/lighting.js` |
| `material.underwaterLighting`, `appliesHillShadow`, `localLightsCheap` | same material options; hooks read them as defines `UNDERWATER_LIGHTING` (0/1/2), `HILL_SHADOW_SELF`, `LOCAL_LIGHTS_CHEAP` |
| `useStaticVelocity( obj )` | `obj.staticVelocity = true` (per object; previous model matrix = current) |
| CSM / `SoftCSMShadowNode` | `SunShadows` (render/Shadows.js); receivers sample `sunShadow( P, N, pixel )` automatically in `shadeSurface` |
| post passes (`rtt`, `pass`, QuadMesh) | `FullscreenPass( { code, bindings, colorFormats } )`, or a compute kernel |
| `renderer.render( scene, camera )` into a target | `meshRenderer.render( scene, { camera, kind: 'color', colorViews, colorFormats, depthView, … } )` |
| `GLTFLoader` + `SkinnedMesh` / `AnimationMixer` | `loadGLB( url )` (engine/loaders/GLTF.js) + `SkinnedModel.create( gltf )` (engine/render/Skinning.js): `model.group`, `model.play( clip, { fade, loop, speed } )`, `model.update( dt )`; GPU skinning in the material vertex hook (attributes `skinIndex` vec4u / `skinWeight` vec4f, joints in a storage buffer with last frame's joints for the motion vectors), shadows skin the same way |
| async readback (`getArrayBufferAsync`) | `Readback` (ring of staging buffers), `readBuffer` / `readTexture` for one-offs |
| `mx_noise_float`, `mx_fractal_noise_float`, `mx_worley_noise_vec2`, `mx_cell_noise_float`, `hash`, `interleavedGradientNoise`, `vogelDiskSample`, `luminance`, `perturbNormal` | `commonModule` (render/wgsl/common.js): `mx_noise_float3/2`, `mx_fractal_noise_float3`, `mx_worley_noise_vec2_3/2`, `mx_cell_noise_float3/2`, `hash11/21/31/22/33`, `interleavedGradientNoise`, `vogelDiskSample`, `luminance`, `perturbNormalByHeight`, `perturbNormalByMap`, depth helpers `viewDepth`, `worldFromDepth`, `projectToUv` |

Bind groups: group 0 = `frame` + shared samplers (`smpLinearRepeat`, `smpLinearClamp`, `smpLinearMirror`,
`smpAnisoRepeat`, `smpAnisoClamp`, `smpNearestClamp`, `smpNearestRepeat`, `smpShadow`) — use these instead of
per-texture samplers. Group 1 = module + material resources (composed automatically). Group 2 = per-draw.

Velocity convention (sceneRT.textures[1]): xy = uv-space motion, current minus previous (uv y down).

Depth: reversed-Z, `depth32float`, cleared to 0; sky pixels have depth 0. Linear distance: `viewDepth( d )`.

## Shared WGSL between systems: ShaderModule naming

Where a system used to hand other systems TSL functions (`terrainGPU.heightAt( xz )`, `clouds.shadow( xz )`,
`shoreSim.sample( xz )`, …), its instance now exposes `this.module` (a `ShaderModule`) and the WGSL function
is named `<prefix><Method>` with the prefix below. Structs are `<Prefix><Name>`, bindings and uniform blocks
are prefixed the same way (bindings share one namespace per shader). Return a struct where TSL returned an
object (`shore.evaluate` → `fn shoreEvaluate( … ) -> ShoreSample`). Document the module's functions in a
comment at the top of the file.

| instance | prefix | examples |
|---|---|---|
| TerrainGPU | `terrain` | `terrainHeightAt( xz: vec2f ) -> f32`, `terrainSunShadowAt( P: vec3f ) -> f32`, `terrainNormalAt`, `terrainNormalRock`, `terrainShoreSample`, `terrainUvOf` |
| OceanFFT | `ocean` | bindings `oceanDisplacement`, `oceanDerivatives` (texture_2d_array), uniforms `oceanParams` |
| WaterSurface | `waterSurface` | `waterSurfaceCascadeAttenuation( c: i32, depth: f32 ) -> f32`, `waterSurfaceVertex` |
| ShoreWaves | `shore` | `shoreEvaluate`, `shorePhaseAt`, `shoreShape`, `shoreDirAt`, … |
| ShoreSim | `shoreSim` | `shoreSimSample( xz ) -> vec4f`, `shoreSimInside`, `shoreSimUvOf`, `shoreSimSandFoam` |
| SurfFoam | `surfFoam` | `surfFoamShading` |
| Caustics | `caustics` | `causticsSample` |
| SeaDetail | `seaDetail` | `seaDetailSample` |
| WakeSim | `wake` | `wakeDisplacement` |
| WaterQuery | `waterQuery` | `waterQueryCameraState() -> vec4f`, `waterQueryHeightAt( slot: u32 ) -> f32` |
| Spray | `spray` | `sprayEmit…` (GPU emitters used by other kernels) |
| Atmosphere | `atmosphere` | `atmosphereSkyLuminance`, transmittance / sky-view LUT bindings |
| Sky | `sky` | `skyRadianceWithClouds( dir: vec3f, withSun: bool ) -> vec3f`, `skyReflectionRadiance` |
| Clouds | `clouds` | `cloudsShadow( xz: vec2f ) -> f32`, `cloudsSample`, `cloudsSampleView` |
| Underwater | `underwater` | |
| LocalLights | `localLights` | installs the `localLights` hook |

If you consume a module owned by another stream that isn't ported yet, call it by the name above and stub it
in your test harness. Keep the constructor signatures and public CPU methods of every class the same, so
App.js ports by changing imports.

## WGSL pitfalls

- Derivatives (`dpdx`, `textureSample` without `Level`) only in uniform control flow: compute them before any
  branch on per-pixel data; inside branches use `textureSampleLevel` / `textureSampleGrad`.
- Uniform arrays need 16-byte element stride: use `vec4f[N]` and index `.x`.
- `queue.writeBuffer` data lands before the whole frame's command buffer: a buffer written twice in a frame
  keeps the last value. Give each pass that needs different values its own block (e.g. `createViewUniforms`).
- `r32float` / `rgba32float` are only filterable when `GPU.hasFloat32Filterable`; prefer `rgba16float` or
  `textureLoad` for 32-bit data.
- Storage textures: `rgba16float`, `rgba32float`, `r32float`, `rgba8unorm`, `r32uint` … are fine; `rg16float`
  as storage is not core WebGPU.
- Keep sampled textures per material under ~16 (the limit we request is 32, but fewer is faster).

## Testing

Headless WebGPU (Dawn): `import './headless.mjs'` first in a test (see `test/engine-smoke.mjs`), then
`GPU.init( { headless: true } )`; write images with `writePNG` and look at them. Put your test scripts in
`test/` named after your stream. Compare against the three.js version: the reference app can be rendered
headless the same way from `../threejs-water-claude` (see its memory notes), or read its shaders.
Never start a dev server on 5188 or touch `../threejs-water-claude` (the user's live app).
