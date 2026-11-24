"""Run with Blender --background --factory-startup --python this-file.

Own geometry, metres, native Y-up export. Working .blend/audit stay private.
This is a weathered granite landform study, not a scanned geological specimen.
"""
import bpy, bmesh, json, math, hashlib, random
from pathlib import Path
from mathutils import noise, Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
parts = []


def stratified_block(name, center, scale, seed, yaw=0.0, dip_x=0.08, dip_z=-0.06, cuts=4, angularity=1.0):
    """Build a closed manifold fractured stratified rock block in native Y-up mapped to Blender."""
    rng = random.Random(seed * 7919 + 17)
    bpy.ops.mesh.primitive_cube_add(size=2.0)
    obj = bpy.context.object
    obj.name = name
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)

    # Pre-choose 4 random fracture cleavage planes per block for crisp geological facets
    planes = []
    for k in range(4):
        ang = rng.uniform(0.0, math.tau)
        elev = rng.uniform(-0.45, 0.65)
        n = Vector((math.cos(ang) * math.cos(elev), math.sin(elev), math.sin(ang) * math.cos(elev))).normalized()
        offset = rng.uniform(0.66, 0.96)
        planes.append((n, offset))

    seed_v = Vector((seed * 0.37, seed * 0.61, seed * 0.19))
    rot_y = Matrix.Rotation(yaw, 3, 'Y')
    for v in bm.verts:
        # Native local space: X right, Y up, Z forward
        p = Vector((v.co.x, v.co.z, -v.co.y))
        # Taper slightly upward for natural seated bedrock silhouette
        taper = 1.0 - max(0.0, p.y) * 0.16 + max(0.0, -p.y) * 0.14
        p.x *= taper
        p.z *= taper
        # Sheared cleavage facets
        for pn, po in planes:
            d = p.dot(pn)
            if d > po:
                p -= pn * ((d - po) * (0.72 * angularity))
        # Stepped horizontal/dipping bedding strata
        strata_h = p.y + p.x * dip_x + p.z * dip_z
        step_wave = math.sin(strata_h * 7.2 + seed * 0.5)
        ledge = math.copysign(abs(step_wave) ** 0.55, step_wave) * 0.085 * angularity
        horiz = Vector((p.x, 0.0, p.z))
        if horiz.length > 1e-4:
            p += horiz.normalized() * ledge
        # Multi-scale fractured surface roughness
        q = p * 1.45 + seed_v
        broad = noise.noise(q, noise_basis='PERLIN_ORIGINAL')
        crag = abs(noise.noise(q * 2.9 + Vector((7.3, 2.1, 5.4)), noise_basis='PERLIN_ORIGINAL')) - 0.35
        fine = noise.noise(q * 5.6 + Vector((19.0, 3.7, 11.2)), noise_basis='PERLIN_ORIGINAL')
        p.x *= 1.0 + broad * 0.16 + crag * 0.10 + fine * 0.03
        p.y *= 1.0 + broad * 0.12 + fine * 0.025
        p.z *= 1.0 + broad * 0.16 + crag * 0.10 + fine * 0.03
        # Apply non-uniform block scale, yaw, and world offset relative to origin
        p = Vector((p.x * scale[0], p.y * scale[1], p.z * scale[2]))
        p = rot_y @ p
        w = Vector((p.x + center[0], p.y + center[1], p.z + center[2]))
        # Native [x, y, z] -> Blender [x, -z, y]
        v.co = (w.x, -w.z, w.y)

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    # Flat-faceted bedrock crevices give crisp geological planes (no soap-blob smoothing!)
    for face in obj.data.polygons:
        face.use_smooth = False
    obj.select_set(False)
    parts.append(obj)


# 1. Recessed fractured headwall + overhanging cap ledge above the dark spring fissure
stratified_block('headwall lower strata', [-0.28, 0.58, -3.55], [2.45, 1.05, 1.85], 41, yaw=0.14, dip_x=0.12, dip_z=-0.08, cuts=5)
stratified_block('headwall overhang cap', [-0.45, 1.38, -3.95], [2.15, 0.62, 1.75], 47, yaw=-0.09, dip_x=0.09, dip_z=-0.05, cuts=4)
stratified_block('headwall right shoulder', [1.95, 0.72, -3.20], [1.45, 0.92, 1.55], 53, yaw=0.42, dip_x=-0.08, dip_z=-0.10, cuts=4)

# 2. Left fractured bedrock buttress + lower stepped bank shelf framing the rill
stratified_block('left fractured buttress', [-1.88, 0.42, -1.78], [1.65, 1.12, 1.75], 14, yaw=-0.22, dip_x=0.14, dip_z=0.06, cuts=5)
stratified_block('left lower strata ledge', [-1.52, -0.08, -0.35], [1.15, 0.54, 1.25], 19, yaw=0.18, dip_x=0.10, dip_z=0.05, cuts=4)
stratified_block('left back rib', [-2.95, 0.35, -2.85], [1.28, 0.78, 1.35], 23, yaw=-0.35, dip_x=0.12, dip_z=-0.06, cuts=3)

# 3. Right fractured joint block + stepped flank framing the fissure gap
stratified_block('right joint pillar', [1.32, 0.12, -1.48], [1.18, 0.86, 1.52], 21, yaw=0.28, dip_x=-0.12, dip_z=0.05, cuts=5)
stratified_block('right lower shelf', [1.48, -0.26, 0.25], [0.95, 0.42, 1.15], 29, yaw=-0.15, dip_x=-0.09, dip_z=0.04, cuts=4)

# 4. Embedded channel apron slabs & angular cobbles along the emerging spring rill
# Rill exits from (0, 0, -1.2) toward (-1.8, -0.35, +2.6) -> (-3.0, -0.25, +4.0)
apron_stones = [
    ('apron left slab', [-1.22, -0.26, 0.92], [0.78, 0.36, 1.05], 64, 0.35),
    ('apron right slab', [1.04, -0.36, 0.82], [0.68, 0.32, 0.94], 87, -0.28),
    ('rill left ledge 1', [-1.85, -0.42, 2.05], [0.66, 0.28, 0.82], 101, 0.52),
    ('rill left ledge 2', [-2.75, -0.58, 3.10], [0.58, 0.24, 0.72], 107, 0.44),
    ('rill right cobble 1', [0.42, -0.44, 1.72], [0.46, 0.22, 0.56], 113, -0.62),
    ('rill right cobble 2', [-0.38, -0.48, 2.55], [0.42, 0.20, 0.52], 127, 0.24),
    ('rill right cobble 3', [-1.18, -0.56, 3.45], [0.48, 0.21, 0.58], 131, -0.41),
    ('channel bed stone 1', [-0.42, -0.36, 0.38], [0.28, 0.14, 0.34], 139, 0.85),
    ('channel bed stone 2', [-0.96, -0.44, 1.55], [0.25, 0.12, 0.30], 149, -0.52),
    ('channel bed stone 3', [-1.62, -0.52, 2.62], [0.26, 0.13, 0.28], 151, 0.18),
    ('bank talus left 1', [-2.55, -0.18, 0.85], [0.55, 0.26, 0.62], 157, -0.33),
    ('bank talus left 2', [-3.15, -0.32, 1.92], [0.44, 0.22, 0.50], 163, 0.71),
    ('bank talus right 1', [2.15, -0.22, -0.42], [0.56, 0.28, 0.64], 173, 0.62),
    ('bank talus right 2', [1.75, -0.42, 1.48], [0.40, 0.19, 0.48], 179, -0.48),
    ('fissure throat stone', [0.36, -0.22, -0.48], [0.34, 0.22, 0.42], 181, 0.15),
    ('headwall talus', [-2.45, 0.12, -0.78], [0.58, 0.32, 0.66], 191, -0.55),
    ('fore slope slab right', [2.10, -0.46, 2.35], [0.58, 0.19, 0.52], 197, 0.22),
    ('fore slope cobble right', [1.18, -0.52, 2.85], [0.34, 0.16, 0.38], 211, -0.66),
    ('fore slope slab left', [-2.95, -0.52, 3.85], [0.62, 0.21, 0.54], 223, 0.48),
]
for name, center, sc, sd, yw in apron_stones:
    stratified_block(name, center, sc, sd, yaw=yw, cuts=2, angularity=0.9)

positions = []
normals = []
uv = []
indices = []
report = []
crease_cos = math.cos(math.radians(40.0))
for obj in parts:
    mesh = obj.data
    mesh.calc_loop_triangles()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    nonmanifold = sum(not e.is_manifold for e in bm.edges)
    bm.free()
    if nonmanifold:
        raise RuntimeError(f'{obj.name}: {nonmanifold} nonmanifold edges')
    lo = [min(v.co[i] for v in mesh.vertices) for i in range(3)]
    hi = [max(v.co[i] for v in mesh.vertices) for i in range(3)]
    report.append({'name': obj.name, 'vertices': len(mesh.vertices), 'triangles': len(mesh.loop_triangles), 'nonmanifoldEdges': nonmanifold, 'blenderBounds': [lo, hi]})
    # Crease-angle weighted vertex normals: smooth gently within strata faces (<40 deg), crisp across fracture edges (>=40 deg).
    vert_tris = [[] for _ in range(len(mesh.vertices))]
    for ti, tri in enumerate(mesh.loop_triangles):
        for vi in tri.vertices:
            vert_tris[vi].append(tri)
    for tri in mesh.loop_triangles:
        fn = tri.normal
        for vi in tri.vertices:
            acc = Vector((0.0, 0.0, 0.0))
            for other in vert_tris[vi]:
                if fn.dot(other.normal) >= crease_cos:
                    acc += other.normal * max(other.area, 1e-6)
            wn = acc.normalized() if acc.length > 1e-6 else fn
            v = mesh.vertices[vi].co
            p = [v.x, v.z, -v.y]
            normal = [wn.x, wn.z, -wn.y]
            positions.extend(round(q, 6) for q in p)
            normals.extend(round(q, 6) for q in normal)
            uv.extend([round(p[0] / 3.7, 6), round((p[1] + p[2] * 0.25) / 3.7, 6)])
            indices.append(len(indices))

asset = {'schema': 'museum-authored-mesh-v1', 'name': 'stratified fractured fissure outcrop', 'units': 'metres', 'up': 'Y', 'origin': [-642, 55, -500], 'position': positions, 'normal': normals, 'uv': uv, 'index': indices}
out = ROOT / 'creek/assets/sample-fissure.json'
out.write_text(json.dumps(asset, separators=(',', ':')) + '\n')
sha = hashlib.sha256(out.read_bytes()).hexdigest()
previous = json.loads((ROOT / 'creek/sample.lock.json').read_text()) if (ROOT / 'creek/sample.lock.json').exists() else {}
lock = {'schema': 'museum-sample-authoring-v1', 'blender': bpy.app.version_string, 'method': 'closed native-scale fractured stratified bedrock ledges, recessed fissure headwall and angular spring-apron cobbles; flat-faceted geological cleavage with checked manifold topology; no external scan', 'scientificStatus': 'authored stratified bedrock/fracture spring analogy; visible recess is an outcrop gap, not a measured aquifer aperture', 'assets': [{'path': 'assets/sample-fissure.json', 'sha256': sha, 'bytes': out.stat().st_size}], 'objects': report, 'triangles': len(indices) // 3, 'units': 'metres', 'basis': 'x,z,-y from Blender to native Y-up', 'copyright': 'Museum-authored geometry; product AGPL-3.0'}
lock['assets'] += [a for a in previous.get('assets', []) if a['path'] != 'assets/sample-fissure.json']
(ROOT / 'creek/sample.lock.json').write_text(json.dumps(lock, indent=2) + '\n')
print(json.dumps({'asset': str(out), 'sha256': sha, 'triangles': len(indices) // 3, 'objects': len(parts), 'nonmanifoldEdges': sum(r['nonmanifoldEdges'] for r in report)}))
