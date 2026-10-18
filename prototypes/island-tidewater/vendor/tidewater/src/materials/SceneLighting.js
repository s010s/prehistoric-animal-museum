// The scene lighting model lives in the engine now (render/wgsl/lighting.js): sun / moon with
// cascaded shadows, IBL, clearcoat / sheen, and the hooks installed by the systems
// (SceneLighting.set( name, ShaderModule )):
//   directModulation  fn hookDirectModulation( P, N ) -> vec3f   caustics, water column, cloud / hill shadow
//   ambientModulation fn hookAmbientModulation( P, N ) -> vec3f  underwater tint / attenuation
//   bounce            fn hookBounce( P, N ) -> vec3f             sunlight bounced off the ground (GroundBounce.js)
//   localLights       fn hookLocalLights( s, P, N, V, acc )      lanterns, windows, boat lights (LocalLights.js)
// Materials that need an extra multiplier on the key light (the former TerrainLightingModel) define
// MATERIAL_SUN_MODULATION and a `fn materialSunModulation( P: vec3f, N: vec3f ) -> vec3f` in one of
// their modules (see Terrain.js terrainLightingModule).
export { SceneLighting } from '../engine/render/wgsl/lighting.js';
