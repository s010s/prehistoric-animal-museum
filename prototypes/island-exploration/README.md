# Bounded island world experiment

This prototype is a research workspace for the next-generation bounded island world. Its current purpose is visual and architectural evaluation, not production integration. The scene is a standalone Three.js environment with free flight and a guided island tour; it includes a life-size Apatosaurus encounter and does not alter the production museum experience.

## Run locally

From the product repository root, with its dependencies installed:

```sh
node prototypes/island-exploration/build.mjs
python3 -m http.server --bind 127.0.0.1 4383 --directory prototypes/island-exploration/.review-dist
```

Open `http://127.0.0.1:4383`. The build output is ignored local review material. It uses the repository's Three.js and Vite dependencies.

## Scene and controls

The 20.48 km world extends the museum's fixed coastal-valley sampler (seed 193706) into one authored island. The terrain field defines the coastline, watershed, main river, tributary, wetlands, lakes, prairie, uplands and western crags. Terrain and vegetation stay anchored to world coordinates while the camera moves. A 22-metre Apatosaurus stands in the riverside clearing.

Use the on-screen joystick and height controls on a phone. On desktop, use WASD to move, Q/E to change height, drag to look around and Shift to accelerate. The map lists the island's destinations; the guided tour crosses its major biomes.

The height field and waterways are authored visual approximations rather than a geomorphology or hydrology simulation. Water shading, wakes and foam are visual effects rather than a fluid solver. Vegetation models are modern visual proxies, not authenticated prehistoric flora. Desktop emulation does not establish real-phone GPU performance.

## Implementation notes

The base coastline and valley use the project's shared deterministic sampler in `src/flight-experience/world.ts`; island-specific terrain and hydrology are composed in `field.js`. A worker builds a fixed, spatially chunked terrain mesh, avoiding camera-centered terrain regeneration. Flow and local vegetation data are prepared by workers. Sky, water reflection and cloud shadows share a generated 3D density field. Daylight direction is defined once in `lighting-config.js` and reused by surface lighting, baked terrain horizons and canopy shadows. Three.js and asset credits are in [`public/THIRD_PARTY_NOTICES.txt`](public/THIRD_PARTY_NOTICES.txt); licensing scopes are described in [`../../LICENSING.md`](../../LICENSING.md).

This prototype is intended to support continued world-layout, water, geology, vegetation and performance research on this branch. Changes here remain separate from production integration until they are evaluated.

## Repeatable visual review

Add `?quality=high&place=forest&benchmark=1` to the preview URL. Review mode freezes the world at 60 seconds, records the camera pose and source/assets hashes, and provides an eleven-place runtime tour, a 12-second lateral camera replay, a recorded ground-level trail walk and a 42-second shore cycle. Export includes original canvas frames and timing; passing runtime checks is not a visual verdict. `pose=x,y,z,yaw,pitch` restores a custom camera on initial load.

Terrain ecology uses the same path mask for ground, trees and undergrowth. `tools/bake-light.mjs` generates the horizon and habitat fields after terrain changes; run it with `node --import tsx prototypes/island-exploration/tools/bake-light.mjs`. Rebuild afterward. `tools/bake-shore.mjs` updates the coast field when coastal terrain changes. The tree atlas uses the same branch geometry as nearby trees; the 45–90 metre stochastic handover should be assessed in movement.


The water material uses two mipmapped spectral slope fields (64 quadrature modes, not an FFT), depth-dependent extinction and scattering, shared sky radiance and a bounded planar reflection for nearby land. Its surf lace generator is adapted from Tidewater's MIT-licensed `SurfFoam.js`; attribution is retained in the generator and notices. It does not implement Tidewater's FFT ocean or full shoreline fluid simulation. `tools/extract-fir-bark.mjs` extracts the existing CC0 tree asset's albedo, normal and roughness maps without resampling. Private comparison captures and source archives live outside the prototype in the product's ignored research directory.

The review UI includes repeatable ground-level forest walking, a close rock-shore camera, a beach-eye camera and a 42-second shore cycle. Near-ground vegetation hands over to the terrain between 32 and 85 metres in high quality. The cloud density follows the current Tidewater SkyProClouds construction; ocean glints use unresolved-slope GGX roughness. `ocean-spectrum.js` caches the directional JONSWAP short-wave field in two 128² textures, removing repeated wave summation from water pixels. The wave geometry, its slope and foam share the same spatially warped phase. These changes do not constitute visual parity with the reference.

Cloud weather is generated independently of shape noise with `node prototypes/island-exploration/tools/bake-cloud-weather.mjs`. The periodic 1024² linear data map uses Tidewater’s two FBM profiles and coverage offset. Cloud panorama alpha carries transmittance to occlude the sun. Panorama strips use render-target texel coordinates, so fractional canvas pixel ratios cannot leave stale rows.

With `?benchmark=1&reviewDpr=1.6`, the highland sky view, 24-second recorded orbit and pixel-ratio switching checks are available. The stripe check compares all 9,437,184 half-float channels of the last published panorama to an independent full-frame render at its frozen camera and weather phase. The ratio sequence includes 0.73, 1, 1.6 and 2. This checks cache correctness; visual quality still requires reviewing the captured world views and motion.

The authored shore uses centimetre-scale swash films with horizontal front distances, draining backwash and a refracted thin-film absorption path. Carrier triangles extend past the analytic front, keeping the leading edge independent of the two-metre grid. The review UI can isolate reflection, foam, normal and water-body shading. Distant sea haze integrates the same altitude-dependent extinction as the visible water to avoid a separate dark horizon belt.

### Continuous-motion review

The review UI also records a 24-second, 90-metre forward/backward route with a small turn, and provides ground-clearance, spring and marsh viewpoints. JSON samples include visible-triangle clearance, fixed daylight exposure, and cloud cache blend state. Navigation sweeps the actual rendered terrain triangles and a near-plane footprint. Clouds reproject continuously between three protected panorama targets; reflections refresh each rendered frame, using the matching tree atlas in the bounded mirror while the main view and shadows retain near branch geometry. Tree representations share a 45–90 m stochastic transition and stable view-independent foliage normals.

The shore height atlas covers the east bay and estuary using their own sampled terrain. Regenerate with `node --import tsx prototypes/island-exploration/tools/bake-shore.mjs`. Water uses a bounded spectral quadrature, refracted absorption path and dual-phase local flow; this is not a full fluid simulation. A complete review must include motion recordings: still images and runtime checks cannot establish temporal stability.
