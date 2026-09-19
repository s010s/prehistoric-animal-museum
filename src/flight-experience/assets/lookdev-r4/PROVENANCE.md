# Finite R4 lookdev samples — needs review

This pack contains four project-original tree variants, two lower-vegetation
silhouettes, two angular rock/talus groups and one stepped, jointed cliff group.
It is a finite comparison scene. It does not replace the flight world's current
landscape pack or change scatter species. The vegetation is artistic and is not
identified as a paleobotanical reconstruction.

Geometry and authored bark/foliage materials: project original, CC-BY-NC-SA-4.0.
Geological base colour and roughness use **Poly Haven rock_01, CC0**, through the
512px derivatives documented in `../lookdev-materials/manifest.json`. That record
contains the original source, download URLs, licences and hashes. No raw scan or
high-poly source mesh is included in the public candidate.

The executable recipes are `scripts/flight/assets/create-lookdev-r4.py`,
`bake-lookdev-r4.py`, and `optimize-lookdev-r4.mjs`. Blender 5.2.0 LTS was actually
queried and run in background mode. It wrote new, private source and baked Blender
files; neither the original Pteranodon nor the existing landscape GLB was overwritten.

The low mesh is UV-unwrapped. A separate high surface adds subdivision and actual
small-scale displacement; high geometry has at least 16 times the low triangle count.
Source shaders add spatial bark/leaf colour and roughness variation, while rock
materials use the licensed geological source. Base colour is baked without direct
sunlight. Tangent normals are selected-high-to-active-low bakes; roughness is baked
from varying source shaders rather than filled with a constant. AO is a separate
channel. Source atlases are 1k; the candidate retains tree/cliff base colour at 1k
and uses 512px for remaining maps. LOD1/2 retain the source UVs. Meshopt/WebP optimization preserves node
names, authored LOD topology counts and metre scale.

`manifest.json` records byte size, SHA-256, source/LOD triangle counts, physical
heights and conservative footprint radii. glTF uses Y-up; the explicitly named
`boundsBlender` field is Z-up. `groundAnchor` is expressed in glTF axes.

This pack is not approved. The first browser comparison found paper-like large
blades and sparse crowns. The next finite candidate replaces each four-face large
blade with a smaller, eight-face curved leaf and raised midrib; triples leaf count,
tightens cluster radius, increases vertical foliage volume and uses a narrower
high-to-low bake cage to reduce intersections with neighbouring leaves. The four
trees now use about 12.4k / 5.6k / 1.85k triangles across LOD0/1/2. This increased
lookdev budget is not authorized for global scatter. The replacement candidate still
requires the same browser and human review; its new geometry is not a visual pass. Projected canopy coverage across 24 viewpoints, each
LOD and above/level/below views still requires full visual review. The mesh LOD2
is a review comparator, not approval for a new world-wide impostor rollout.
