"""Bake Blender pose and shape-key Actions onto the island's existing two aquatic rigs.

Run from the island prototype directory:
  blender -b --python-exit-code 1 --python tools/island-aquatic-source-remotion.py
Add `-- --review-dir /tmp/island-aquatic-review` for Cycles contact sheets and strain measurements.
"""

import argparse
import gzip
import json
import math
import struct
import sys
import tempfile
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from island_aquatic_motion_module import encode_motion


ISLAND = Path(__file__).resolve().parent.parent
MODELS = ISLAND / "museum" / "assets" / "island"
OUTPUT = ISLAND / "museum" / "aquatic-motion"
GLTF_TO_BLENDER = Quaternion((1, 0, 0), math.pi / 2)
AXES = ((0, -1, 0), (0, 0, 1), (-1, 0, 0))
FRAMES = 32
KEY_SPACING = 4
ACTION_FRAMES = 64

FISH_SPINE = {
    "j_spine_04_bind_012": (0.022, 0.00),
    "j_spine_05_bind_013": (0.032, 0.24),
    "j_spine_06_bind_014": (0.049, 0.50),
    "j_spine_07_bind_015": (0.065, 0.77),
    "j_spine_08_bind_020": (0.097, 1.04),
    "j_spine_09_bind_021": (0.112, 1.34),
    "j_spine_10_bind_022": (0.141, 1.66),
    "j_spine_11_bind_023": (0.168, 1.97),
}
FISH_LOBES = (
    ("j_tail1_01_bind_024", "j_tail1_02_bind_025", "j_tail1_03_bind_026"),
    ("j_tail2_01_bind_032", "j_tail2_02_bind_033", "j_tail2_03_bind_034"),
)
FISH_FINS = (
    (-1, 0.16, 0.27, ("j_leftFlipper1_01_bind_0106", "j_leftFlipper1_02_bind_0107")),
    (1, 0.43, 0.27, ("j_rightFlipper1_01_bind_0110", "j_rightFlipper1_02_bind_0111")),
    (-1, -0.66, 0.15, ("j_leftFlipper2_01_bind_016", "j_leftFlipper2_02_bind_017")),
    (1, -0.39, 0.15, ("j_rightFlipper2_01_bind_094", "j_rightFlipper2_02_bind_095")),
)
WHALE_TAIL = (
    ("Root.007_15", 0.019, 0.19), ("Root.005_14", 0.032, 0.43),
    ("Root.009_13", 0.059, 0.67), ("Root.004_12", 0.088, 0.92),
    ("Root.008_11", 0.112, 1.14), ("Root.006_10", 0.149, 1.36),
    ("Root.010_9", 0.194, 1.59),
)


def fish_pose(t, power, hover):
    pose = {}
    # The head and gills share separate branches. Keep their common seam settled
    # and build the lateral wave from the back of the chest into the peduncle.
    for name, (amplitude, lag) in FISH_SPINE.items():
        beat = t - lag
        wave = math.sin(beat) + .13 * math.sin(2 * beat - .3)
        pose[name] = (0, power * amplitude * (.827 * wave + .11), 0)

    # The fin lobes share the same stroke at the base and feather progressively
    # behind it. Opposite pitch trim flexes the trailing edges, not their seam.
    for side, names in zip((1, -1), FISH_LOBES):
        for i, name in enumerate(names):
            p = t - 2.16 - i * .21
            pose[name] = (side * .017 * power * math.sin(p), (.026 + i * .014) * power * math.sin(p), 0)

    for side, offset, extent, (base, edge) in FISH_FINS:
        p = t + offset
        force = extent * (1.18 if hover else power)
        pose[base] = (force * .12 * math.sin(p + .35), side * force * .29 * math.cos(p),
                      side * force * (.46 * math.sin(p) + .08 * math.sin(2 * p)))
        pose[edge] = (0, side * force * .13 * math.sin(p - .45),
                      side * force * .16 * math.sin(p - .48))

    pose["j_fin1_01_bind_091"] = (0, 0, .038 * power * math.sin(t - 1.41))
    pose["j_fin1_02_bind_092"] = (0, 0, .025 * power * math.sin(t - 1.63))
    pose["j_fin3_01_bind_087"] = (0, 0, -.036 * power * math.sin(t - 1.54))

    breath = .5 - .5 * math.cos(t)
    for side, groups in (
        (-1, ("j_left_gill_01_bind_0121", "j_left_gill_03_bind_0127")),
        (1, ("j_right_gill_05_bind_0123", "j_right_gill_03_bind_0125")),
    ):
        for name, amplitude in zip(groups, (.028, .034)):
            pose[name] = (0, side * amplitude * breath, side * .009 * breath)
    pose["j_jaw_01_bind_0134"] = (-.018 * breath, 0, 0)
    return pose


def whale_pose(t, power, hover):
    # The broad flukes travel up and down across one shared hinge. The smaller
    # delayed harmonic gives the downstroke a quicker catch and the upstroke a longer recovery.
    def beat(phase):
        return math.sin(phase) + .19 * math.sin(2 * phase - .49)

    trims = 1.15 if hover else 1
    trim_lift = .17 if hover else .29
    pose = {
        "Root.003_16": (power * .010 * beat(t), 0, 0),
        # Match the sibling's tiny chest pitch at the shared start of the neck.
        "Root.002_8": (power * .010 * beat(t), 0, 0),
        "Root.011_7": (-power * .021 * beat(t - .1), 0, 0),
        "LowerJaw_6": (-.024 - .013 * (.5 - .5 * math.cos(t - .4)), 0, 0),
    }
    for name, amplitude, lag in WHALE_TAIL:
        p = t - lag
        pose[name] = (amplitude * (trim_lift + .76 * power * beat(p)),
                      .01 * amplitude * power * math.sin(p - .26), 0)
    for side, name, p in ((-1, "PectoralL", t + .38), (1, "PectoralR", t + .62)):
        pose[name] = (.045 * trims * math.cos(p), side * .033 * trims * math.sin(p),
                      side * .08 * trims * (math.sin(p - .21) + .09 * math.sin(2 * p)))
    return pose


def mouth_weights(species, t, hover):
    # The two paired source targets support the corners of the mouth and its
    # inner geometry. A small pulse keeps both correction components in sync.
    breath = (.5 - .5 * math.cos(t - .25)) ** 2
    strength = (.10 if hover else .06) if species == "xiphactinus" else (.085 if hover else .045)
    return strength * breath, (strength * breath) ** 2


SPECIES = {
    "xiphactinus": (fish_pose, (("Swim", 2.24, 1), ("Hover", 3.05, .36))),
    "livyatan": (whale_pose, (("Swim", 3.22, 1), ("Hover", 4.30, .29))),
}


def source_data(species):
    source = gzip.decompress((MODELS / f"{species}.glb.gz").read_bytes())
    size = struct.unpack_from("<I", source, 12)[0]
    return json.loads(source[20:20 + size]), source[20 + size:]


def glb_for_blender(data, binary):
    # Restore the island renderer's sidecar shape target accessors for Blender.
    # The authored shape action starts from the mesh's display defaults.
    data["animations"] = [clip for clip in data["animations"] if clip["name"] == "Idle"]
    for mesh in data["meshes"]:
        for primitive in mesh["primitives"]:
            targets = primitive.get("extras", {}).get("islandMorphTargets")
            if targets:
                primitive["targets"] = targets
    packed = json.dumps(data, separators=(",", ":")).encode()
    packed += b" " * (-len(packed) % 4)
    return struct.pack("<4sIII4s", b"glTF", 2, 20 + len(packed) + len(binary),
                       len(packed), b"JSON") + packed + binary


def first_values(data, binary, index):
    accessor = data["accessors"][index]
    view = data["bufferViews"][accessor["bufferView"]]
    width = {"VEC3": 3, "VEC4": 4}[accessor["type"]]
    offset = 8 + view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    return struct.unpack_from(f"<{width}f", binary, offset)


def from_xyzw(values):
    x, y, z, w = values
    return Quaternion((w, x, y, z)).normalized()


def reference_transforms(data, binary):
    poses = [dict(node) for node in data["nodes"]]
    (idle,) = data["animations"]
    for channel in idle["channels"]:
        pointer = idle["samplers"][channel["sampler"]]["output"]
        target = channel["target"]
        poses[target["node"]][target["path"]] = first_values(data, binary, pointer)
    parents = {}
    local = []
    for pose in poses:
        local.append((Vector(pose.get("translation", (0, 0, 0))),
                      from_xyzw(pose.get("rotation", (0, 0, 0, 1))),
                      Vector(pose.get("scale", (1, 1, 1)))))

    def visit(i, parent):
        pose = poses[i]
        matrix = Matrix.LocRotScale(*local[i])
        parents[i] = parent.to_quaternion()
        world = parent @ matrix
        for child in pose.get("children", []):
            visit(child, world)

    for root in data["scenes"][data.get("scene", 0)]["nodes"]:
        visit(root, Matrix.Identity(4))
    return local, parents


def curves(owner):
    animation = owner.animation_data
    action = animation.action
    layer = action.layers[0]
    return layer.strips[0].channelbag(animation.action_slot).fcurves


def create_actions(scene, rig, meshes, rest, orientation, species, name, pose, power):
    rig.animation_data.action = None
    for bone in rig.pose.bones:
        bone.matrix_basis = rest[bone.name]
        bone.rotation_mode = "QUATERNION"
    for mesh in meshes.values():
        mesh.data.shape_keys.animation_data_clear()
    hover = name == "Hover"
    used = pose(0, power, hover)
    for frame in range(-KEY_SPACING, ACTION_FRAMES + KEY_SPACING + 1, KEY_SPACING):
        phase = math.tau * frame / ACTION_FRAMES
        for joint, angles in pose(phase, power, hover).items():
            delta = Quaternion()
            for axis, angle in zip(AXES, angles):
                delta = Quaternion(axis, angle) @ delta
            bone = rig.pose.bones[joint]
            axes = orientation[joint]
            rotation = rest[joint].to_quaternion()
            bone.rotation_quaternion = rotation @ axes.inverted() @ delta @ axes
            bone.keyframe_insert(data_path="rotation_quaternion", frame=frame, group=joint)
        weights = mouth_weights(species, phase, hover)
        for mesh in meshes.values():
            for key, weight in zip(list(mesh.data.shape_keys.key_blocks)[1:], weights):
                key.value = weight
                key.keyframe_insert(data_path="value", frame=frame)

    rig.animation_data.action.name = f"{species} {name}"
    for owner in (rig, *(mesh.data.shape_keys for mesh in meshes.values())):
        for curve in curves(owner):
            for key in curve.keyframe_points:
                key.interpolation = "BEZIER"
                key.handle_left_type = key.handle_right_type = "AUTO_CLAMPED"
            curve.update()
    scene.frame_set(0)
    return used


def check_pose(rig, nodes, roots, local, rotation_overrides, bones, frames):
    positions = {}
    def visit(i, parent):
        translation, rotation, scale = local[i]
        world = parent @ Matrix.LocRotScale(translation, rotation_overrides.get(i, rotation), scale)
        if i in bones:
            native = rig.matrix_world @ bones[i].matrix
            distance = (native.translation - GLTF_TO_BLENDER @ world.translation).length
            if distance > .001:
                raise ValueError(f"{bones[i].name}: Blender and baked glTF differ by {distance:.4f} units")
            positions[i] = native.translation
            authored = GLTF_TO_BLENDER @ world.to_quaternion()
            if i in frames:
                if abs((authored @ frames[i]).dot(native.to_quaternion())) < .999999:
                    raise ValueError(f"{bones[i].name}: Blender and baked glTF rotations differ")
            else:
                frames[i] = authored.inverted() @ native.to_quaternion()
        for child in nodes[i].get("children", []):
            visit(child, world)

    for root in roots:
        visit(root, Matrix.Identity(4))
    return positions


def bake(scene, rig, meshes, used, indices, rest, orientation, local, parents, data, duration, frames):
    nodes = data["nodes"]
    roots = data["scenes"][data.get("scene", 0)]["nodes"]
    bones = {indices[bone.name]: bone for bone in rig.pose.bones}
    rotations = {indices[name]: [] for name in used}
    weights = {i: [] for i in meshes}
    caudal = []
    for frame in range(FRAMES):
        scene.frame_set(frame * ACTION_FRAMES // FRAMES)
        rotation_overrides = {}
        for name in used:
            i = indices[name]
            source = rig.pose.bones[name].rotation_quaternion
            delta = orientation[name] @ rest[name].to_quaternion().inverted() @ source @ orientation[name].inverted()
            delta = GLTF_TO_BLENDER.inverted() @ delta @ GLTF_TO_BLENDER
            reference = local[i][1]
            quaternion = (parents[i].inverted() @ delta @ parents[i] @ reference).normalized()
            if quaternion.dot(reference) < 0:
                quaternion.negate()
            quantized = [round(v * 32767) for v in (quaternion.x, quaternion.y, quaternion.z, quaternion.w)]
            rotations[i].extend(quantized)
            rotation_overrides[i] = from_xyzw(quantized)
        positions = check_pose(rig, nodes, roots, local, rotation_overrides, bones, frames)
        if "Root.010_9" in indices:
            caudal.append(positions[indices["Root.010_9"]].z)
        else:
            caudal.append(sum(positions[indices[lobe[-1]]].y for lobe in FISH_LOBES) / 2)
        for i, mesh in meshes.items():
            weights[i].extend(round(key.value * 10000) for key in list(mesh.data.shape_keys.key_blocks)[1:])
    print(f"  {duration:.2f} s, caudal joint span {max(caudal) - min(caudal):.3f} native model units")
    return {"duration": duration, "frames": FRAMES, "rotations": rotations, "weights": weights}


def edge_lengths(obj, depsgraph, reference=None):
    import numpy as np

    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        points = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
        mesh.vertices.foreach_get("co", points)
        points = points.reshape((-1, 3))
        if reference is None:
            indices = np.empty(len(mesh.edges) * 2, dtype=np.int32)
            mesh.edges.foreach_get("vertices", indices)
            indices = indices.reshape((-1, 2))
        else:
            indices = reference[0]
        lengths = np.linalg.norm(points[indices[:, 0]] - points[indices[:, 1]], axis=1)
        return indices, lengths
    finally:
        evaluated.to_mesh_clear()


def review_pose(species, meshes, copies, row, col, angle, scale, center, reference):
    import numpy as np

    graph = bpy.context.evaluated_depsgraph_get()
    ratio = []
    placement = Matrix.Translation(Vector(((col - 1.5) * 1.12, 0, (2 - row) * .46)))
    orient = Matrix.Rotation(angle, 4, "Z") @ Matrix.Rotation(.21 if angle else 0, 4, "X")
    placement = placement @ Matrix.Scale(scale, 4) @ orient @ Matrix.Translation(-center)
    for index, source in meshes.items():
        evaluated = source.evaluated_get(graph)
        originally = reference[index]
        _, current = edge_lengths(source, graph, originally)
        usable = originally[1] > originally[1].max() * .018
        if usable.any():
            ratio.extend(current[usable] / originally[1][usable])
        mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=graph)
        sample = bpy.data.objects.new(f"{source.name} {row} {col}", mesh)
        copies.objects.link(sample)
        sample.matrix_world = placement @ source.matrix_world
    percentiles = np.quantile(ratio, (.01, .99))
    print(f"{species} review row {row + 1}, phase {col}/4: 1st/99th edge ratios {percentiles.round(3)}")


def render_review(scene, sources, species, directory):
    for source in sources:
        source.hide_render = True

    def area(name, location, energy, size):
        light = bpy.data.lights.new(name, "AREA")
        light.energy = energy
        light.shape, light.size = "DISK", size
        obj = bpy.data.objects.new(name, light)
        scene.collection.objects.link(obj)
        obj.location = location
        obj.rotation_euler = (-obj.location).to_track_quat("-Z", "Y").to_euler()

    area("Soft key", (-2, -4, 5), 730, 7)
    area("Fin edge", (3, 2, 4), 840, 6)
    area("Water fill", (3, -4, -2), 200, 6)
    camera = bpy.data.objects.new("Orthographic side", bpy.data.cameras.new("Orthographic side"))
    scene.collection.objects.link(camera)
    camera.location = (0, -10, 0)
    camera.rotation_euler = (math.pi / 2, 0, 0)
    camera.data.type, camera.data.ortho_scale = "ORTHO", 4.5
    scene.camera = camera
    scene.world = bpy.data.worlds.new("Aquatic review")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (.053, .098, .108, 1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = .65
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 16
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1760, 950
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(directory / f"{species}.png")
    bpy.ops.render.render(write_still=True)


def review_blend(species, rig, meshes, copies, scale, center, original, phases):
    # The island skin mixer normalizes the weighted quaternion sum. Both
    # actions use the same hemisphere, so this models their equal-weight pose.
    rig.animation_data.action = None
    for mesh in meshes.values():
        mesh.data.shape_keys.animation_data_clear()
    for phase, (swim, hover) in enumerate(zip(*phases)):
        for name, rotation in swim[0].items():
            other = hover[0][name]
            if rotation.dot(other) < 0:
                other = other.copy()
                other.negate()
            rig.pose.bones[name].rotation_quaternion = ((rotation + other) * .5).normalized()
        for i, mesh in meshes.items():
            for key, a, b in zip(list(mesh.data.shape_keys.key_blocks)[1:], swim[1][i], hover[1][i]):
                key.value = (a + b) * .5
        bpy.context.view_layer.update()
        review_pose(species, meshes, copies, 4, phase, -.63, scale, center, original)


def author(species, temporary, directory):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    path = temporary / f"{species}.glb"
    data, binary = source_data(species)
    path.write_bytes(glb_for_blender(data, binary))
    bpy.ops.import_scene.gltf(filepath=str(path))
    scene = bpy.context.scene
    (rig,) = (obj for obj in scene.objects if obj.type == "ARMATURE")
    rig.animation_data.use_nla = False
    idle = bpy.data.actions.get("Idle")
    rig.animation_data.action = idle
    rig.animation_data.action_slot = next(slot for slot in idle.slots if slot.target_id_type == "OBJECT")
    scene.frame_set(0)
    rest = {bone.name: bone.matrix_basis.copy() for bone in rig.pose.bones}
    orientation = {bone.name: (rig.matrix_world @ bone.matrix).to_quaternion() for bone in rig.pose.bones}
    indices = {node["name"]: i for i, node in enumerate(data["nodes"])}
    meshes = {i: bpy.data.objects[node["name"]] for i, node in enumerate(data["nodes"]) if "mesh" in node}
    local, parents = reference_transforms(data, binary)
    roots = data["scenes"][data.get("scene", 0)]["nodes"]
    frames = {}
    check_pose(rig, data["nodes"], roots, local, {}, {indices[bone.name]: bone for bone in rig.pose.bones}, frames)

    if directory:
        phases = []
        graph = bpy.context.evaluated_depsgraph_get()
        original = {i: edge_lengths(mesh, graph) for i, mesh in meshes.items()}
        sources = list(scene.objects)
        copies = bpy.data.collections.new("Evaluated animation poses")
        scene.collection.children.link(copies)
        lock = json.loads((ISLAND / "museum" / "island-museum-models.lock.json").read_text())
        bounds = lock["animals"][species]["bounds"]
        center = GLTF_TO_BLENDER @ ((Vector(bounds["min"]) + Vector(bounds["max"])) / 2)
        scale = 1 / (bounds["max"][0] - bounds["min"][0])
    result = {}
    pose, clips = SPECIES[species]
    for clip, (name, duration, power) in enumerate(clips):
        used = create_actions(scene, rig, meshes, rest, orientation, species, name, pose, power)
        result[name] = bake(scene, rig, meshes, used, indices, rest, orientation, local, parents, data, duration, frames)
        if directory:
            phases.append([])
            for phase in range(4):
                scene.frame_set(ACTION_FRAMES * phase // 4)
                rotations = {name: rig.pose.bones[name].rotation_quaternion.copy() for name in used}
                weights = {
                    i: [key.value for key in list(mesh.data.shape_keys.key_blocks)[1:]] for i, mesh in meshes.items()
                }
                phases[-1].append((rotations, weights))
                for rear in range(2):
                    review_pose(species, meshes, copies, 2 * clip + rear, phase,
                                -.63 if rear else 0, scale, center, original)
    if directory:
        review_blend(species, rig, meshes, copies, scale, center, original, phases)
        render_review(scene, sources, species, directory)
    return encode_motion(result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review-dir", type=Path)
    parser.add_argument("--id", choices=tuple(SPECIES))
    parser.add_argument("--check", action="store_true", help="Compare to checked-in motion samples.")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    if args.review_dir:
        args.review_dir.mkdir(parents=True, exist_ok=True)
    if not args.check:
        OUTPUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="island-aquatic-") as directory:
        for species in (args.id,) if args.id else SPECIES:
            samples = author(species, Path(directory), args.review_dir)
            output = OUTPUT / f"{species}.js"
            if args.check:
                if samples != output.read_text():
                    raise ValueError(f"{output} differs from Blender bake")
            else:
                output.write_text(samples)
            print(f"{species}: {len(samples)} motion bytes")


if __name__ == "__main__":
    main()
