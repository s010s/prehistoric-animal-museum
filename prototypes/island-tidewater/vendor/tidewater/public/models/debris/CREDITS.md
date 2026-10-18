# Debris models: credits and licences

All scanned debris assets are from [Poly Haven](https://polyhaven.com) and are licensed
**CC0 1.0 (public domain)**. No attribution is required; credited here for provenance.

| Files | Poly Haven asset | Licence | Processing |
|---|---|---|---|
| `dead_quiver_trunk.glb`, `dead_quiver_trunk_{albedo,normal,arm}.jpg` | [Dead Quiver Trunk](https://polyhaven.com/a/dead_quiver_trunk) | CC0 | Blender 5.2: joined, long axis to +X, centred, decimated to LODs of 4000 / 700 / 160 triangles (source 18k); 1K textures unchanged |
| `dead_quiver_branch_01.glb`, `dead_quiver_branch_01_{albedo,normal,arm}.jpg` | [Dead Quiver Branch 01](https://polyhaven.com/a/dead_quiver_branch_01) | CC0 | LODs 2600 / 500 / 120 (source 15k) |
| `dead_quiver_branch_02.glb`, `dead_quiver_branch_02_{albedo,normal,arm}.jpg` | [Dead Quiver Branch 02](https://polyhaven.com/a/dead_quiver_branch_02) | CC0 | LODs 2600 / 500 / 120 (source 14k) |
| `lambis_shell.glb`, `lambis_shell_{albedo,normal,arm}.jpg` | [Lambis Shell](https://polyhaven.com/a/lambis_shell) | CC0 | LODs 1400 / 300 / 80 (source 12.5k) |

Textures: albedo (sRGB), OpenGL tangent-space normal, ARM (R ambient occlusion, G roughness,
B metalness), 1024 x 1024 JPEG. The GLBs hold geometry only (meshes `LOD0`, `LOD1`, `LOD2`).
Loaded and packed into 2 x 2 texture atlases by `src/world/debris/ScannedDebris.js`.
