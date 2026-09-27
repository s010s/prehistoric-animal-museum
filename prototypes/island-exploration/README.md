# Bounded island world experiment

This PR is a research workspace for the next-generation bounded island world. Its current purpose is visual and architectural evaluation, not production integration. The scene is a standalone Three.js environment with free flight and a guided island tour; it contains no animals and does not alter the production museum experience.

## Run locally

From the product repository root, with its dependencies installed:

```sh
node prototypes/island-exploration/build.mjs
python3 -m http.server --bind 127.0.0.1 4382 --directory prototypes/island-exploration/.review-dist
```

Open `http://127.0.0.1:4382`. The build output is ignored local review material. It uses the repository's Three.js and Vite dependencies.

## Scene and controls

The 20.48 km world extends the museum's fixed coastal-valley sampler (seed 193706) into one authored island. The terrain field defines the coastline, watershed, main river, tributary, wetlands, lakes, prairie, uplands and western crags. Terrain and vegetation stay anchored to world coordinates while the camera moves. No dinosaurs are present.

Use the on-screen joystick and height controls on a phone. On desktop, use WASD to move, Q/E to change height, drag to look around and Shift to accelerate. The map lists the island's destinations; the guided tour crosses its major biomes.

The height field and waterways are authored visual approximations rather than a geomorphology or hydrology simulation. Water shading, wakes and foam are visual effects rather than a fluid solver. Vegetation models are modern visual proxies, not authenticated prehistoric flora. Desktop emulation does not establish real-phone GPU performance.

## Implementation notes

The base coastline and valley use the project's shared deterministic sampler in `src/flight-experience/world.ts`; island-specific terrain and hydrology are composed in `field.js`. A worker builds a fixed, spatially chunked terrain mesh, avoiding camera-centered terrain regeneration. Flow and local vegetation data are prepared by workers. The sky and water share the project's cloud radiance code, with a generated density atlas and no photographic sky background. Three.js and asset credits are in [`public/THIRD_PARTY_NOTICES.txt`](public/THIRD_PARTY_NOTICES.txt); licensing scopes are described in [`../../LICENSING.md`](../../LICENSING.md).

This prototype is intended to support continued world-layout, water, geology, vegetation and performance research on this branch. Changes here remain separate from production integration until they are evaluated.
