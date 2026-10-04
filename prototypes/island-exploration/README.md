# Bounded island world experiment

This prototype is a research workspace for the next-generation bounded island world. Its current purpose is visual and architectural evaluation, not production integration. The scene is a standalone Three.js environment with free flight and a guided island tour; it includes life-size Apatosaurus and Triceratops encounters and does not alter the production museum experience.

## Run locally

From the product repository root, with its dependencies installed:

```sh
node prototypes/island-exploration/build.mjs
python3 -m http.server --bind 127.0.0.1 4383 --directory prototypes/island-exploration/.review-dist
```

Open `http://127.0.0.1:4383`. The build output is ignored local review material. It uses the repository's Three.js and Vite dependencies.

## Scene and controls

The 20.48 km world extends the museum's fixed coastal-valley sampler (seed 193706) into one authored island. The terrain field defines the coastline, watershed, main river, tributary, wetlands, lakes, prairie, uplands and western crags. Terrain and vegetation stay anchored to world coordinates while the camera moves. A 22-metre Apatosaurus stands in the riverside clearing; an 8.5-metre Triceratops occupies the adjacent woodland opening. Their scales come from measured model bounds and their existing idle animations stay rooted to the visible terrain.

Use the on-screen joystick and height controls on a phone. On desktop, use WASD to move, Q/E to change height, drag to look around and Shift to accelerate. Enable 地面步行 for a 1.65 m/s pace with eyes 1.75 m above the visible ground. Walking stops before water deeper than 0.65 m; a map destination in deep water switches to flight. The map lists the island's destinations; the guided tour crosses its major biomes.

The height field and waterways are authored visual approximations rather than a geomorphology or hydrology simulation. Water shading, wakes and foam are visual effects rather than a fluid solver. Vegetation models are modern visual proxies, not authenticated prehistoric flora. Desktop emulation does not establish real-phone GPU performance.

## Implementation notes

The base coastline and valley use the project's shared deterministic sampler in `src/flight-experience/world.ts`; island-specific terrain and hydrology are composed in `field.js`. A worker builds a fixed, spatially chunked terrain mesh, avoiding camera-centered terrain regeneration. Flow and local vegetation data are prepared by workers. Sky, water reflection and cloud shadows share a generated 3D density field. Daylight direction is defined once in `lighting-config.js` and reused by surface lighting, baked terrain horizons and canopy shadows. Three.js and asset credits are in [`public/THIRD_PARTY_NOTICES.txt`](public/THIRD_PARTY_NOTICES.txt); licensing scopes are described in [`../../LICENSING.md`](../../LICENSING.md).

This prototype is intended to support continued world-layout, water, geology, vegetation and performance research on this branch. Changes here remain separate from production integration until they are evaluated.

## Repeatable visual review

Add `?quality=high&place=side-spring&benchmark=1&gpuScope=none` to the preview URL. Review UI preserves the workload budget and uses normal animation time; only the new explicit `fixedBenchmark=1` freezes an idle review. It records the camera pose and source/assets hashes, and provides a thirteen-place runtime tour, a 12-second lateral camera replay, a recorded ground-level trail walk and a 42-second shore cycle. Export includes original canvas frames and timing; passing runtime checks is not a visual verdict. `pose=x,y,z,yaw,pitch` restores a custom camera on initial load.

Terrain ecology uses the same path mask for ground, trees and undergrowth. `tools/bake-light.mjs` generates the horizon and habitat fields after terrain changes; run it with `node --import tsx prototypes/island-exploration/tools/bake-light.mjs`. Rebuild afterward. `tools/bake-shore.mjs` updates the coast field when coastal terrain changes. The tree atlas uses the same branch geometry as nearby trees; the 45–90 metre stochastic handover should be assessed in movement.


The water material uses two mipmapped spectral slope fields (64 quadrature modes, not an FFT), depth-dependent extinction and scattering, shared sky radiance and a bounded planar reflection for nearby land. Its surf lace generator is adapted from Tidewater's MIT-licensed `SurfFoam.js`; attribution is retained in the generator and notices. It does not implement Tidewater's FFT ocean or full shoreline fluid simulation. `tools/extract-fir-bark.mjs` extracts the existing CC0 tree asset's albedo, normal and roughness maps without resampling. Private comparison captures and source archives live outside the prototype in the product's ignored research directory.

The review UI includes repeatable ground-level forest walking, a close rock-shore camera, a beach-eye camera and a 42-second shore cycle. Near-ground vegetation hands over to the terrain between 32 and 85 metres in high quality. The cloud density follows the current Tidewater SkyProClouds construction; ocean glints use unresolved-slope GGX roughness. `ocean-spectrum.js` caches the directional JONSWAP short-wave field in two 128² textures, removing repeated wave summation from water pixels. The wave geometry, its slope and foam share the same spatially warped phase. These changes do not constitute visual parity with the reference.

Cloud weather is generated independently of shape noise with `node prototypes/island-exploration/tools/bake-cloud-weather.mjs`. The periodic 1024² linear data map uses Tidewater’s two FBM profiles and coverage offset. Cloud panorama alpha carries transmittance to occlude the sun. Panorama strips use render-target texel coordinates, so fractional canvas pixel ratios cannot leave stale rows.

With `?benchmark=1&reviewDpr=1.6`, the highland sky view, 24-second recorded orbit and pixel-ratio switching checks are available. The explicit stripe check now compares one bounded stripe of the published panorama against the same camera and weather phase. It does not claim a full-image comparison. The ratio sequence includes 0.73, 1, 1.6 and 2. This checks cache correctness; visual quality still requires reviewing the captured world views and motion.

The authored shore uses centimetre-scale swash films with horizontal front distances, draining backwash and a refracted thin-film absorption path. Carrier triangles extend past the analytic front, keeping the leading edge independent of the two-metre grid. The review UI can isolate reflection, foam, normal and water-body shading. Distant sea haze integrates the same altitude-dependent extinction as the visible water to avoid a separate dark horizon belt.

### Continuous-motion review

The review UI also records a 24-second, 90-metre forward/backward route with a small turn, and provides ground-clearance, spring and marsh viewpoints. JSON samples include visible-triangle clearance, fixed daylight exposure, and cloud cache blend state. Navigation sweeps the actual rendered terrain triangles and a near-plane footprint. Clouds reproject continuously between three protected panorama targets; reflections refresh each rendered frame, using the matching tree atlas in the bounded mirror while the main view and shadows retain near branch geometry. Tree representations share a 45–90 m stochastic transition and stable view-independent foliage normals.

The shore height atlas covers the east bay and estuary using their own sampled terrain. Regenerate with `node --import tsx prototypes/island-exploration/tools/bake-shore.mjs`. Water uses a bounded spectral quadrature, refracted absorption path and dual-phase local flow; this is not a full fluid simulation. A complete review must include motion recordings: still images and runtime checks cannot establish temporal stability.

### Side-spring desktop sample

The side spring at z≈−720 and northern source at z≈−4023 have separate destination IDs, `side-spring` and `north-source`. The default entry is the side spring. `sample-region.js` owns the local terrain envelope, shared path mask and versioned `side-spring-loop` route. The v3 review walk keeps the v2 geography and ecology mask fixed. It joins creek and animal viewpoints using a bounded ground search, then uses the same visible-terrain, rock, slope, deep-water and animal constraints as ordinary walking. Its duration is derived from the planned distance at 1.55 m/s, rather than speeding up a fixed-duration movie. It advances through pending worker updates and records those frames; a deviation or missed endpoint fails the route. Legacy diagnostic replays retain their fixed tick clock.

Use `gpuScope=none` for this review. It creates no GPU timer-query sample. Timing and video are separate runs; frame evidence includes route identity, version, world/wall time, position, pending state and source/assets hashes. The ground walk shares ordinary animal collision; legacy diagnostic flight routes bypass it. Ordinary WASD/joystick navigation must also be checked. The measurement UI and still checks do not establish visual quality.

Water keeps the opaque/depth image and bounded reflection independent. Current opaque shadows are rendered before reflection; AO, water and spray compose into a separate half-float linear target, then a single fullscreen output applies exposure and display conversion. The target resizes with the actual drawing buffer and is disposed/recreated with its owner. No temporal AA, screen-space reflection or dependency upgrade is included.


### GPU investigation protection (new)

Ordinary and historical review URLs now default to at most 921,600 canvas pixels,
longest edge 1280, and 30 submitted frames per active second. This is a temporary
quality reduction, including 1536×384 / 120-step cloud caches and a 128-face PMREM;
it is not final desktop visual acceptance. Low quality also reduces the cloud cache.
`benchmark=1` enables UI only. `fixedBenchmark=1` explicitly fixes idle world time.
`pixelBudget` can lower the pixel ceiling; `reviewDpr` cannot bypass it.
The new `highLoad=1` explicitly enables a bounded 2.4MP / 60 FPS override with a
20-active-second deadline and visible label. Do not use it for fault investigation.

Pause 3D remains available during loading. Pausing, opening a dialog, hiding the
page or pagehide stops new GPU work, including cache rebuilds and worker-result
installation. Resume discards pacing backlog and excludes paused time from the
world and wall-clock review route. Context restoration permits one automatic
reload per page session, forces low quality, sanitizes diagnostic parameters and
then stops automatic recovery on another loss; the minimal state is exportable.

`workloadReview=1&gpuScope=none` is a new lightweight, explicitly enabled local
E2E/short-sample panel. It wraps public render calls, never GL uploads or GPU timer
queries. Its freeze/cheap variants are diagnostics, never product optimizations.
Timing lasts 12 seconds and auto-pauses. Stills request one bounded frame and are
separate from timing. JSON and PNG evidence can be saved with the local-only
`tools/gpu-review-server.py`; results default to ignored `docs/research/`.
`build-meta.json` identifies the actual served source and assets, including dirtiness.

The explicit local workload review also auto-pauses after 20 active idle seconds,
including while browser control is delayed. Starting a short sample or pressing
Continue rearms this bound. Explicit bounded routes retain their own timeout.
Ordinary preview remains continuous.


### Cloud and water work removal

The density bounds use the actual linear UNORM noise range to skip samples only
when density is provably zero or both erosion smoothsteps are already one.
`验证云优化等价` compares the original and bounded march in an explicit 64×64 GPU
job (8192 rays total, at the same step count), reports radiance error and executed
volume fetches, then pauses. It is separate from timing and uses synchronous
readback only on that explicit action. Old stripe audits also use the frame gate.

Static water bodies use conservative bounds; long rivers and spring runs retain
their exact shared vertices and triangle order in smaller index ranges. The moving
ocean remains exempt from static culling. Planar texture taps are skipped only at
zero contribution and use explicit level zero on the non-mipmapped linear texture.
Reflection still refreshes every rendered frame. Its 4x MSAA is now explicit.
The fullscreen display framebuffer has no AA/depth allocation; the opaque HDR
buffer retains 4x/2x MSAA. This is independent of the temporary pixel/FPS reduction.
Canvas dimensions are physical integer pixels; `effectivePixelRatio` records the
CSS-to-buffer ratio separately. Tree atlas viewports always use target texels.

Record the regional ground walk at its distance-derived duration separately from short timing, then use
`保存游览与资源` to save its route, clearance, pending-work samples, video limit
status and resource snapshot. The optional all-destination inspection runs once at
final delivery. Review recordings use bounded Blob URLs rather than duplicating
large video buffers as base64; they are never started by ordinary preview.

Explicit localhost workload-review recordings also stream their bounded Blob to the
local review sink on completion. Binary video is saved in the ignored results directory;
this does not run for ordinary preview or send data to any external host.

The legacy `dry` direct-render diagnostic retains its default framebuffer AA/depth;
their removal applies only to the fullscreen composite path. Atlas clears also
wait for a startup submission slot. The explicit override deadline covers startup.

The mirror alone uses a fixed 32 m terrain proxy away from water. Sources, river corridors, water-contact cells and their stitching halo retain the original grid, materials and surface attributes. Main terrain, navigation, vegetation and animals retain their original geometry. The mirror still refreshes every submitted frame after the current shadow pass. `reflectionTerrain=full` is a diagnostic comparison, not the default. The review panel can compare both terrain representations at identical canvas, cloud and frame budgets.

Desktop restoration is explicit: `desktopTier=pace` raises the submission target to 60 at the protected pixel budget; `900` permits 1600×900; `1080` permits 1920×1080; `clouds` also restores 3072×768 / 240-step clouds. All tiers keep cloud jobs capped at 12,288 rays per submitted frame. `desktopTrial=1` pauses after 45 active seconds of main rendering, following the finite gated startup sequence. Normal previews remain protected unless a tier is selected. Recovery strips the tier and returns to conservative limits. The setting names describe workload targets, not a guarantee of measured FPS.

A graphics-context interruption invalidates the active observation. Review mode retains the last safe state and partial sample without GL readback, with a short localhost flush and session fallback. Recovery starts paused, strips diagnostic/desktop overrides and permits at most one automatic reload. The recovery page provides a local export even before startup completes. Fault injection is absent from normal review controls and requires the separate `contextLossTest=1` URL.

Short fixed-camera windows also record per-frame workload conditions and evidence activity. Pause, camera movement, resource errors, changed pixel/cloud/RT settings, missing submissions, or concurrent routes, screenshots or video invalidate the window while retaining its raw numbers. Reflection comparisons require valid full/proxy arms with matching source, assets, pose, world phase and workload. These checks establish measurement conditions, not GPU timing or desktop acceptance.

Context interruption stops the visual-review collector and recording tracks. Cancelling a regional walk and exporting its partial evidence use the last safe snapshot; neither rereads GL after loss. A recorder that fails to start also releases its capture stream. Offline CPU/DOM checks are available through `tools/short-observation.test.mjs` and `node --import tsx tools/benchmark-context.test.mjs`; they do not launch a browser or establish real context recovery, motion quality or performance.
