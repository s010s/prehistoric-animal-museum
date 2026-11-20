"""Author island swim and crawl loops on the existing Blender-imported specimens.

Run from the product root:
    blender -b -t 4 --python-exit-code 1 --python \
        prototypes/island-tidewater/tools/author-island-aquatic-motion.py -- --review /tmp/island-aquatic

Only compact motion channels are written back. The runtime meshes, textures,
joint numbering and inverse bind matrices remain the island GLB assets'.
"""

import argparse
import gzip
import json
from math import cos, pi, sin, tau
from pathlib import Path
import struct
import sys
from tempfile import TemporaryDirectory

import bpy
from mathutils import Matrix, Quaternion, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from island_aquatic_motion_module import encode_motion

from io_scene_gltf2.blender.imp.blender_gltf import BlenderGlTF
from io_scene_gltf2.blender.imp.vnode import VNode
from io_scene_gltf2.io.imp.gltf2_io_gltf import glTFImporter

MUSEUM = Path(__file__).resolve().parent.parent / "museum"
CLIP_DIRECTORY = MUSEUM / "aquatic-motion"
AUXILIARY_RIGS = json.loads((CLIP_DIRECTORY / "rig-calibration.json").read_text())
KEY_INTERVAL = 3
DEFAULTS = {
    "translation": (0, 0, 0), "rotation": (0, 0, 0, 1), "scale": (1, 1, 1),
}


def read_island_model(animal, directory):
    """Restore standard glTF morph fields for Blender's import, in scratch."""
    original = gzip.decompress((MUSEUM / "assets/island" / f"{animal}.glb.gz").read_bytes())
    json_size, = struct.unpack_from("<I", original, 12)
    source = json.loads(original[20:20 + json_size])
    for mesh in source["meshes"]:
        for primitive in mesh["primitives"]:
            targets = primitive.get("extras", {}).get("islandMorphTargets")
            if targets:
                primitive["targets"] = targets
    idle = next(clip for clip in source["animations"] if clip["name"] == "Idle")
    morph = idle.get("extras", {}).get("islandMorph")
    if morph:
        idle["channels"].extend(morph["channels"])
    source["animations"] = [idle]
    idle_start = min(
        source["accessors"][idle["samplers"][channel["sampler"]]["input"]]["min"][0]
        for channel in idle["channels"]
    )
    description = json.dumps(source, separators=(",", ":")).encode()
    description += b" " * (-len(description) % 4)
    binary = original[20 + json_size:]
    scratch = directory / f"{animal}.glb"
    scratch.write_bytes(struct.pack("<4sIII4s", b"glTF", 2, 20 + len(description) + len(binary),
                                   len(description), b"JSON") + description + binary)
    return scratch, source, idle_start


def source_pose(source, importer):
    """Map original node ids to their reference pose and anatomical axes."""
    from io_scene_gltf2.io.imp.gltf2_io_binary import BinaryData
    local = [{key: node.get(key, default) for key, default in DEFAULTS.items()} for node in source["nodes"]]
    for channel in source["animations"][0]["channels"]:
        node, path = channel["target"]["node"], channel["target"]["path"]
        if path not in DEFAULTS:
            continue
        sampler = source["animations"][0]["samplers"][channel["sampler"]]
        elements = BinaryData.get_data_from_accessor(importer, sampler["output"])
        local[node][path] = elements[1 if sampler.get("interpolation") == "CUBICSPLINE" else 0]
    parents = {child: i for i, node in enumerate(source["nodes"]) for child in node.get("children", [])}
    world = {}

    def resolve(index):
        if index in world:
            return world[index]
        source_node, pose = source["nodes"][index], local[index]
        if "matrix" in source_node:
            matrix = importer.matrix_gltf_to_blender(source_node["matrix"])
        else:
            matrix = Matrix.LocRotScale(importer.loc_gltf_to_blender(pose["translation"]),
                                        importer.quaternion_gltf_to_blender(pose["rotation"]),
                                        importer.scale_gltf_to_blender(pose["scale"]))
        if index in parents:
            matrix = resolve(parents[index]) @ matrix
        world[index] = matrix
        return matrix

    for index in range(len(source["nodes"])):
        resolve(index)
    return parents, world


class Specimen:
    def __init__(self, animal, metadata, directory):
        self.animal = animal
        self.scene = bpy.context.scene
        self.scene.render.fps = 24
        self.scene.render.fps_base = 1
        scratch, self.source, idle_start = read_island_model(animal, directory)
        defaults = bpy.ops.import_scene.gltf.get_rna_type().properties
        settings = {prop.identifier: prop.default for prop in defaults
                    if prop.type in {"BOOLEAN", "ENUM", "FLOAT", "INT", "STRING"}
                    and hasattr(prop, "default")}
        settings.update(bone_heuristic="TEMPERANCE", import_user_extensions=[], import_pack_images=True)
        self.importer = glTFImporter(str(scratch), settings)
        self.importer.read()
        self.importer.checks()
        BlenderGlTF.create(self.importer)
        self.names = {node["name"]: i for i, node in enumerate(self.source["nodes"])}
        self.parents, self.world = source_pose(self.source, self.importer)
        fx, fz = metadata["forward"]
        calibration = AUXILIARY_RIGS.get(animal, {})
        fx, fz = calibration.get("forward", [fx, fz])
        self.forward = Vector((fx, -fz, 0)).normalized()
        self.up = Vector((0, 0, 1))
        self.right = self.forward.cross(self.up)
        # glTF anatomical pitch corresponds to the negative Blender lateral axis.
        self.axes = {"roll": self.forward, "yaw": self.up, "pitch": -self.right}
        self.meshes = [obj for obj in self.scene.objects if obj.type == "MESH"]
        if animal == "dallasaurus":
            for obj in self.meshes:
                if obj.name.startswith(("LRFlipperCtrl", "RRFlipperCtrl", "shouldersCtrl")):
                    obj.hide_render = True
        self.meshes = [obj for obj in self.meshes if not obj.hide_render]
        self.slots = {}
        frame = idle_start * self.scene.render.fps
        self.scene.frame_set(int(frame), subframe=frame % 1)
        self.baseline = {}
        for i in range(len(self.source["nodes"])):
            target = self.target(i)
            if target:
                self.baseline[target] = {attribute: getattr(target, attribute).copy()
                                         for attribute in ("location", "rotation_quaternion", "scale")}
            keys = self.shape_keys(i)
            if keys:
                self.baseline.update({key: {"value": key.value} for key in keys})
        for target in self.baseline:
            datablock = target.id_data
            if datablock.animation_data:
                datablock.animation_data_clear()
        self.reset_pose()
        self.auxiliary = self.attach_auxiliary(calibration.get("joints", ()))

    def target(self, i):
        node = self.importer.vnodes[i]
        if node.type == VNode.Bone:
            armature = self.importer.vnodes[node.bone_arma].blender_object
            return armature.pose.bones[node.blender_bone_name]
        return getattr(node, "blender_object", None)

    def shape_keys(self, i):
        for vnode in self.importer.vnodes.values():
            if vnode.mesh_node_idx == i:
                obj = vnode.blender_object
                if obj.type == "MESH" and obj.data.shape_keys:
                    return tuple(obj.data.shape_keys.key_blocks)[1:]
        return ()

    def node(self, name):
        return self.names[name] if isinstance(name, str) else name

    def reset_pose(self):
        for target, values in self.baseline.items():
            if target.id_data.animation_data:
                target.id_data.animation_data_clear()
            for attribute, value in values.items():
                setattr(target, attribute, value)
        bpy.context.view_layer.update()

    def parent_inverse(self, i):
        return self.world.get(self.parents.get(i), Matrix.Identity(4)).inverted().to_3x3()

    def rotation(self, i, angles):
        vnode = self.importer.vnodes[i]
        target = self.target(i)
        rest = self.baseline[target]["rotation_quaternion"]
        correction = vnode.rotation_after
        if vnode.type == VNode.Bone:
            correction = vnode.editbone_rot.conjugated() @ correction
        inverse = self.parent_inverse(i)
        rotation = rest.copy()
        for axis, radians in angles.items():
            local_axis = correction @ (inverse @ self.axes[axis]).normalized()
            rotation = Quaternion(local_axis, radians) @ rotation
        return rotation.normalized()

    def location(self, i, delta):
        vnode = self.importer.vnodes[i]
        target = self.target(i)
        correction = vnode.rotation_after
        if vnode.type == VNode.Bone:
            correction = vnode.editbone_rot.conjugated() @ correction
        return self.baseline[target]["location"] + correction @ (self.parent_inverse(i) @ delta)

    def attach_auxiliary(self, joints):
        if not joints:
            return {}
        # The browser uses these same source-space pivots and smooth masks.
        # Evaluate actual armature deformations over the imported shape keys here.
        obj, = self.meshes
        inverse = self.world[0].inverted()
        model = obj.matrix_world.copy()
        mesh = obj.data
        armature = bpy.data.armatures.new("Supplemental anatomy")
        controller = bpy.data.objects.new(armature.name, armature)
        self.scene.collection.objects.link(controller)
        controller.matrix_world = model
        controller.parent = obj
        controller.matrix_parent_inverse = model.inverted()
        bpy.context.view_layer.objects.active = controller
        bpy.ops.object.mode_set(mode="EDIT")
        pivots = {}
        for definition in joints:
            name = definition["name"]
            f, y, lateral = definition["pivot"]
            world = self.forward * f + self.up * y + self.axes["pitch"] * lateral
            pivots[name] = world
            edit = armature.edit_bones.new(name)
            if definition.get("parent"):
                edit.parent = armature.edit_bones[definition["parent"]]
            edit.head = inverse @ world
            edit.tail = edit.head + Vector((0, .02, 0))
        bpy.ops.object.mode_set(mode="OBJECT")
        modifier = obj.modifiers.new("Supplemental skin", "ARMATURE")
        modifier.object = controller

        materials = {}
        for polygon in mesh.polygons:
            name = mesh.materials[polygon.material_index].name
            for i in polygon.vertices:
                materials[i] = name
        original = tuple(obj.data.shape_keys.key_blocks)[0]
        keys = self.shape_keys(0)
        idle = tuple(key.value for key in keys)
        reference = [v.co + sum(((key.data[i].co - v.co) * weight for key, weight in zip(keys, idle)),
                                Vector((0, 0, 0)))
                     for i, v in enumerate(original.data)]
        points = [model @ co for co in reference]
        masks = [(point.dot(self.forward), point.z, point.dot(self.axes["pitch"])) for point in points]
        remaining = [65535] * len(points)
        result = {}
        for definition in reversed(joints):
            name = definition["name"]
            bone = controller.pose.bones[name]
            bone.rotation_mode = "QUATERNION"
            self.baseline[bone] = {"location": bone.location.copy(),
                                   "rotation_quaternion": bone.rotation_quaternion.copy()}
            group = obj.vertex_groups.new(name=name)
            anchor, distance = None, float("inf")
            for i, point in enumerate(masks):
                if definition.get("material") and definition["material"] != materials.get(i):
                    continue
                weight = 1
                for axis, start, end in definition["windows"]:
                    weight *= smoothstep((point[axis] - start) / (end - start))
                share = round(remaining[i] * weight)
                if share:
                    group.add([i], share / 65535, "REPLACE")
                    remaining[i] -= share
                if definition.get("followMorph") and weight > .005:
                    test = (points[i] - pivots[name]).length_squared
                    if test < distance:
                        anchor, distance = i, test
            landmark = None if anchor is None else (
                tuple(key.data[anchor].co - original.data[anchor].co for key in keys), idle,
            )
            result[name] = bone, landmark
        # Blender normalizes bone weights. Include the stationary share as a bone.
        bpy.ops.object.mode_set(mode="EDIT")
        stationary = armature.edit_bones.new("Unarticulated skin")
        stationary.head, stationary.tail = (0, 0, 0), (0, .02, 0)
        bpy.ops.object.mode_set(mode="OBJECT")
        group = obj.vertex_groups.new(name="Unarticulated skin")
        for i, value in enumerate(remaining):
            if value:
                group.add([i], value / 65535, "REPLACE")
        bpy.context.view_layer.update()
        return result

    def auxiliary_rotation(self, motions):
        inverse = self.world[0].inverted().to_3x3()
        rotation = Quaternion()
        for (f, y, lateral), value in motions:
            direction = self.forward * f + self.up * y + self.axes["pitch"] * lateral
            rotation = Quaternion((inverse @ direction).normalized(), value) @ rotation
        return rotation.normalized()

    def channels(self, name, duration, frames, rotations, weights, translations, aux_motion):
        self.reset_pose()
        rotations = {self.node(key): sample for key, sample in rotations.items()}
        translations = {self.node(key): sample for key, sample in translations.items()}
        action = bpy.data.actions.new(f"{self.animal} | {name}")
        action.use_fake_user = True
        layer = action.layers.new("Pose keys")
        strip = layer.strips.new(type="KEYFRAME")
        slots = {}

        def animate(target, attribute, width, sample):
            datablock = target.id_data
            if datablock not in slots:
                slot = action.slots.new(datablock.id_type, datablock.name)
                animation = datablock.animation_data_create()
                animation.action = action
                animation.action_slot = slot
                slots[datablock] = strip.channelbag(slot, ensure=True)
            bag = slots[datablock]
            path = attribute if target == datablock else target.path_from_id(attribute)
            period = list(range(0, frames, KEY_INTERVAL))
            poses = [sample(tau * frame / frames) for frame in period]
            period.append(frames)
            poses.append(poses[0])
            for index in range(width):
                curve = bag.fcurves.new(path, index=index)
                curve.keyframe_points.add(len(period))
                for point, frame, pose in zip(curve.keyframe_points, period, poses):
                    point.co = frame, pose[index]
                    point.handle_left_type = point.handle_right_type = "AUTO"
                curve.modifiers.new("CYCLES")
                curve.update()

        for i, sample in rotations.items():
            animate(self.target(i), "rotation_quaternion", 4,
                    lambda t: self.rotation(i, sample(t)))
        for i, sample in translations.items():
            animate(self.target(i), "location", 3,
                    lambda t: self.location(i, sample(t)))
        for i, sample in weights.items():
            for k, key in enumerate(self.shape_keys(i)):
                animate(key, "value", 1, lambda t: (sample(t)[k],))

        for label, sample in aux_motion.items():
            bone, anchor = self.auxiliary[label]
            animate(bone, "rotation_quaternion", 4, lambda t: self.auxiliary_rotation(sample(t)))
            if anchor:
                def follow_morph(t):
                    deltas, idle_weights = anchor
                    delta = sum((direction * (current - reference)
                                 for direction, current, reference in zip(deltas, weights[0](t), idle_weights)),
                                Vector((0, 0, 0)))
                    return delta - self.auxiliary_rotation(sample(t)) @ delta
                animate(bone, "location", 3, follow_morph)

        channels = {"duration": duration, "frames": frames}
        if aux_motion:
            channels["auxiliary"] = {label: [] for label in aux_motion}
        if rotations:
            channels["rotations"] = {i: [] for i in rotations}
        if translations:
            channels["translations"] = {i: [] for i in translations}
        if weights:
            channels["weights"] = {i: [] for i in weights}
        for frame in range(frames):
            self.scene.frame_set(frame)
            for i in rotations:
                node = self.importer.vnodes[i]
                pose = self.target(i).rotation_quaternion.normalized()
                if node.type == VNode.Bone:
                    pose = node.editbone_rot @ pose
                w, x, y, z = node.rotation_after.conjugated() @ pose @ node.rotation_before.conjugated()
                channels["rotations"][i].extend(round(v * 32767) for v in (x, z, -y, w))
            for i in translations:
                node = self.importer.vnodes[i]
                pose = self.target(i).location
                if node.type == VNode.Bone:
                    pose = node.editbone_rot @ pose + node.editbone_trans
                elif node.parent is not None and self.importer.vnodes[node.parent].type == VNode.Bone:
                    pose = pose + Vector((0, self.importer.vnodes[node.parent].bone_length, 0))
                x, y, z = node.rotation_after.conjugated() @ pose
                channels["translations"][i].extend(round(v * 100000) for v in (x, z, -y))
            for i in weights:
                channels["weights"][i].extend(round(key.value * 10000) for key in self.shape_keys(i))
            for label in aux_motion:
                w, x, y, z = self.auxiliary[label][0].rotation_quaternion.normalized()
                channels["auxiliary"][label].extend(round(v * 32767) for v in (x, z, -y, w))
        self.slots[name] = (action, {owner: owner.animation_data.action_slot for owner in slots}, frames)
        return channels

    def review_blend(self, names, phase):
        def capture(name):
            self.review_action(name, phase)
            return {target: {key: getattr(target, key).copy() if key != "value" else target.value
                             for key in values}
                    for target, values in self.baseline.items()}
        first, second = (capture(name) for name in names)
        for target, attributes in first.items():
            if target.id_data.animation_data:
                target.id_data.animation_data_clear()
            for key, start in attributes.items():
                end = second[target][key]
                if key == "rotation_quaternion":
                    result = start.slerp(end, .5)
                elif key == "value":
                    result = (start + end) * .5
                else:
                    result = start.lerp(end, .5)
                setattr(target, key, result)
        bpy.context.view_layer.update()

    def review_action(self, name, phase):
        self.reset_pose()
        action, owners, frames = self.slots[name]
        for datablock, slot in owners.items():
            animation = datablock.animation_data_create()
            animation.action = action
            animation.action_slot = slot
        frame = phase * frames
        self.scene.frame_set(int(frame), subframe=frame % 1)


def pulse(t, bias=.18):
    """Rounded fast power stroke and slower return, without a phase kink."""
    return sin(t) + bias * sin(2 * t - .6)


def paired(rig, rotations, limbs, amplitude, sweep, phase, spread=.06, bend=None):
    for limb in limbs:
        i = rig.node(limb)
        side = 1 if rig.world[i].translation.dot(rig.axes["pitch"]) > 0 else -1
        lag = phase + spread * side
        rotations[limb] = lambda t, side=side, lag=lag: {
            "roll": side * amplitude * pulse(t + lag, .21),
            "yaw": side * sweep * cos(t + lag - .50),
            "pitch": (bend if bend is not None else .13 * amplitude) * sin(t + lag - .88),
        }


def spine(rotations, names, amplitudes, lag, power, pitch=0):
    for index, (name, amplitude) in enumerate(zip(names, amplitudes)):
        rotations[name] = lambda t, amplitude=amplitude, index=index: {
            "yaw": power * amplitude * pulse(t - index * lag, .075),
            "pitch": pitch * amplitude * cos(t - index * lag - .5),
        }


def shallow_heave(rig, root, amount):
    """In-place recoil. Route movement owns sustained displacement."""
    return {root: lambda t: rig.up * amount * cos(2 * t - .55)}


def anomalocaris(rig, power):
    rotations = {}
    for name, i in rig.names.items():
        if name.startswith("Flap_"):
            side = 1 if rig.world[i].translation.dot(rig.axes["pitch"]) > 0 else -1
            order = int(name[5:7])
            lag = (13 - order) * .64 + side * .07
            # Tail fan lobes are flatter and steer; larger forward lobes do more work.
            angle = (.18 + .21 * sin(pi * (order + .5) / 19)) * power
            rotations[name] = lambda t, side=side, lag=lag, angle=angle: {
                "roll": side * angle * pulse(t - lag, .25),
                "yaw": side * .24 * angle * cos(t - lag - .6),
                "pitch": .075 * angle * cos(t - lag),
            }
        elif name.startswith("Frontal_") and (index := int(name[8:10])) < 8:
            side = 1 if name.endswith(".L") else -1
            rotations[name] = lambda t, index=index, side=side: {
                "pitch": (.020 + .020 * power) * cos(t - .42 * index + side * .25),
                "yaw": side * (.014 + .017 * sin(t - .31 * index)),
            }
    rotations["Root"] = lambda t: {"pitch": .026 * power * cos(t - .25), "roll": .025 * power * sin(t + .6)}
    return rotations, {}, shallow_heave(rig, "Root", .009 * power)


def opabinia(rig, power):
    rotations = {}
    for i, pair in enumerate((("BodyA.R_016", "BodyA.L_015"), ("BodyB.R_014", "BodyB.L_013"),
                             ("BodyC.R_012", "BodyC.L_011"))):
        paired(rig, rotations, pair, (.29 + .046 * i) * power, .075 * power, -i * .91)
    for i, joint in enumerate(("Body.02_08", "Body.03_09", "Body.04_010")):
        rotations[joint] = lambda t, i=i: {"pitch": .025 * (1 + i) * power * sin(t - .75 * i)}
    for i, name in enumerate(("Probo.01_01", "Probo.02_02", "Probo.03_03", "Probo.04_04")):
        rotations[name] = lambda t, i=i: {
            "pitch": (-.025 - .014 * i) * cos(t - i * .53),
            "yaw": (.034 + .012 * i) * sin(t - i * .43),
        }
    for name, side in (("Pincer.R_06", 1), ("Pincer.L_05", -1)):
        rotations[name] = lambda t, side=side: {"yaw": -.10 * side * (1 + cos(t - .9))}
    rotations["_rootJoint"] = lambda t: {"pitch": .029 * power * cos(t - .28)}
    return rotations, {}, {}


def cycle_step(phase):
    duty = .71
    step = (phase / tau) % 1
    if step < duty:
        u = step / duty
        return -.32 + .64 * u, 0
    u = (step - duty) / (1 - duty)
    return .32 * cos(pi * u), sin(pi * u) ** 2


def hallucigenia(rig, power):
    rotations = {}
    chains = []
    for i, node in enumerate(rig.source["nodes"]):
        parent = rig.source["nodes"][rig.parents[i]] if i in rig.parents else {}
        if not (parent.get("name", "").startswith(("Body", "Neck")) and node["name"].startswith("Bone")):
            continue
        chain = [i]
        while len(rig.source["nodes"][chain[-1]].get("children", [])) == 1:
            chain.append(rig.source["nodes"][chain[-1]]["children"][0])
        # Four and five section limbs have a proximal bone shared with a spine.
        if len(chain) >= 4:
            chains.append((rig.world[i].translation.dot(rig.forward), "_L" in node["name"], chain[-3:]))
    ahead, behind = max(row[0] for row in chains), min(row[0] for row in chains)
    for position, left, chain in chains:
        lag = (ahead - position) / (ahead - behind) * tau * 1.71 + (0 if left else pi)
        first, middle, terminal = chain
        def upper(t, lag=lag, left=left):
            reach, lift = cycle_step(t - lag)
            return {"pitch": reach + .18 * lift, "roll": (.05 if left else -.05) * lift}
        rotations[first] = upper
        rotations[middle] = lambda t, lag=lag: {"pitch": -.49 * cycle_step(t - lag)[1]}
        rotations[terminal] = lambda t, lag=lag: {"pitch": -.23 * cycle_step(t - lag)[1]}
    rotations["Neck.001_012"] = lambda t: {"pitch": .028 * sin(t - .7), "yaw": .057 * cos(t - .84)}
    rotations["Head_014"] = lambda t: {"pitch": -.020 * cos(t + .3)}
    return rotations, {}, {}


def tullimonstrum(rig, power):
    rotations = {}
    spine(rotations, ("Bone.002_011", "Bone.001_012"), (.235, .053), .86, power, .075)
    # Tail membranes share the peduncle. Spread the wave across their sockets.
    for i, angle in enumerate((.028, .037, .048, .054, .030, .018, .029, .040, .052, .057), 1):
        rotations[i] = lambda t, i=i, angle=angle: {"yaw": power * angle * pulse(t - .8 - .045 * i)}
    for i, joint in enumerate(("Bone.004_02", "Bone.005_03", "Bone.006_04",
                               "Bone.007_05", "Bone.008_06", "Bone.009_07")):
        rotations[joint] = lambda t, i=i: {
            "pitch": -.033 * sin(t - .41 * i), "yaw": .035 * sin(t + 1.2 - .47 * i),
        }
    rotations["Bone.010_09"] = lambda t: {"pitch": .065 * (1 - cos(t - 1.5)) ** 2 / 2}
    return rotations, {}, {}


def dakosaurus(rig, power):
    rotations = {}
    spine(rotations, ("TailBase", "TailTip"), (.117, .254), .89, power, .082)
    paired(rig, rotations, ("FrontFinR", "FrontFinL"), .116 * power, .125 * power, .79, .19)
    paired(rig, rotations, ("RearFinR", "RearFinL"), .143 * power, .12 * power, -.96, .20)
    rotations["Head"] = lambda t: {"yaw": -.045 * power * sin(t + .42),
                                   "pitch": -.024 * power * sin(2 * t + .4)}
    rotations["Torso"] = lambda t: {"roll": .043 * power * cos(t - .43), "pitch": .024 * power * sin(2 * t)}
    return rotations, {}, {}


def ichthyosaur(rig, power):
    rotations = {}
    spine(rotations, [f"tail_{i:02d}" for i in range(1, 7)], (.025, .045, .089, .147, .187, .199),
          .42, power, .086)
    paired(rig, rotations, ("front_fin_R", "front_fin_L"), .142 * power, .10 * power, .38, .20)
    paired(rig, rotations, ("rear_fin_R", "rear_fin_L"), .089 * power, .062 * power, -.67, .16)
    rotations["body"] = lambda t: {"roll": .035 * power * cos(t - .30)}
    rotations["neck"] = lambda t: {"yaw": -.021 * power * sin(t + .22)}
    rotations["head"] = lambda t: {"pitch": .017 * power * cos(t - .23), "yaw": -.011 * power * sin(t - .22)}
    return rotations, {}, {}


def ammonite(rig, _power):
    rotations = {}
    for i, name in enumerate(("tentacles1_01", "tentacles2_02", "tentacles3_03")):
        rotations[name] = lambda t, i=i: {
            "pitch": (.095 + .03 * i) * pulse(t - .57 * i, .28),
            "yaw": (.042 + .023 * i) * cos(t - .67 * i),
        }
    # The common body joint gives the shell and crown a tiny, coherent recoil.
    rotations["body3_00"] = lambda t: {"pitch": .034 * pulse(t + .63), "yaw": .022 * cos(t + .7)}
    return rotations, {}, {}


def sarcosuchus(rig, power):
    rotations = {}
    spine(rotations, ("TailBase", "TailMid", "TailTip"), (.11, .221, .319), .88, power, .043)
    rotations["Body"] = lambda t: {"roll": .026 * power * sin(t - .35)}
    rotations["Neck"] = lambda t: {"yaw": -.030 * power * pulse(t + .37)}
    rotations["Head"] = lambda t: {"pitch": .022 * power * cos(t - .35)}
    return rotations, {}, {}


def dallasaurus(rig, power):
    rotations = {}
    ordered = [name for name in rig.names if name.startswith("j_spine_")
               and int(name.split("_")[2]) >= 6]
    ordered.sort(key=lambda name: int(name.split("_")[2]))
    strength = [.008 + .071 * (i / (len(ordered) - 1)) ** 1.57 for i in range(len(ordered))]
    spine(rotations, ordered, strength, .231, power, .078)
    paired(rig, rotations, ("j_leftFrontFlipper_02_093", "j_rightFrontFlipper_010_086"),
           .16 * power, .105 * power, .44, .23)
    paired(rig, rotations, ("j_leftRearFlipper_01_Bind_065", "j_rightRearFlipper_01_Bind_034"),
           .090 * power, .077 * power, -.75, .22)
    return rotations, {}, {}


def styxosaurus(rig, power):
    rotations = {}
    paired(rig, rotations, ("FrontFlipperR", "FrontFlipperL"), .401 * power, .235 * power, .26, .04, .093 * power)
    paired(rig, rotations, ("RearFlipperR", "RearFlipperL"), .355 * power, .222 * power, -1.33, .055, .087 * power)
    rotations["Body"] = lambda t: {"pitch": .036 * power * cos(t - .14), "roll": .019 * power * sin(t + .61)}
    rotations["NeckBase"] = lambda t: {"pitch": -.023 * power * cos(t - .26), "yaw": .025 * power * sin(t - .71)}
    rotations["NeckMid"] = lambda t: {"pitch": -.019 * power * cos(t - .46)}
    rotations["NeckTip"] = lambda t: {"pitch": .020 * power * cos(t - .61), "yaw": -.020 * power * sin(t - .92)}
    rotations["Head"] = lambda t: {"pitch": -.021 * power * sin(t - .45)}
    rotations["TailBase"] = lambda t: {"pitch": .061 * power * cos(t - 1.1)}
    rotations["TailTip"] = lambda t: {"pitch": .049 * power * cos(t - 1.66)}
    return rotations, {}, {}


def megalodon(rig, power):
    rotations = {}
    spine(rotations, ("Bone.003_Armature_5", "Bone.002_Armature_4", "Bone.004_Armature_3"),
          (.094, .195, .335), .77, power, .045)
    for i, name in enumerate(("Bone.024_Armature_1", "Bone.025_Armature_2")):
        rotations[name] = lambda t, i=i: {"yaw": (.082 - .019 * i) * power * sin(t - 2.10 - .13 * i)}
    paired(rig, rotations, ("Bone.012_Armature_25", "Bone.011_Armature_22"),
           .052 * power, .063 * power, .27, .25)
    rotations["Bone.001_Armature_13"] = lambda t: {"yaw": -.018 * power * cos(t + .13)}
    return rotations, {}, {}


def smoothstep(value):
    value = min(1, max(0, value))
    return value * value * (3 - 2 * value)


def plesiosaurus(rig, power):
    def weights(t):
        # Source shapes contain four discrete flipper attitudes. Hold a legible
        # catch and recovery before transferring load to the other pair.
        phase = (t / tau + .053 * sin(t - .56)) % 1 * 4
        base = int(phase)
        blend = smoothstep((phase - base - .09) / .82)
        strength = .62 * power
        values = [(.91 - strength), 0.0, 0.0, 0.0]
        values[base] += strength * (1 - blend)
        values[(base + 1) % 4] += strength * blend
        return values
    rotations = {0: lambda t: {"pitch": .025 * power * cos(t - .35), "roll": .022 * power * sin(t - .82)}}
    return rotations, {0: weights}, {}


def mosasaurus(rig, power):
    def weights(t):
        stroke = pulse(t - .14, .075)
        trim = pulse(2 * t - 1.01, .13)
        return [.97 - .055 * (.5 + .5 * cos(t - .52)), power * max(0, stroke),
                power * max(0, -stroke), .51 * power * max(0, trim), .63 * power * max(0, -trim)]
    rotations = {0: lambda t: {"roll": .045 * power * cos(t - .23), "pitch": .023 * power * cos(2 * t - .3)}}
    return rotations, {0: weights}, {}


def auxiliary_motion(animal, power):
    pitch, yaw = (0, 0, 1), (0, 1, 0)
    if animal == "mosasaurus":
        motions = {}
        for fore in (True, False):
            for side in (-1, 1):
                name = f"{'fore' if fore else 'hind'} flipper {side}"
                axis = (-.59, -.27, side * .75) if fore else (-.70, -.17, side * .69)
                amplitude, lag = (.167, -.37) if fore else (.129, -1.25)
                motions[name] = lambda t, axis=axis, amplitude=amplitude, lag=lag, side=side: (
                    (axis, side * (.31 + .69 * power) * amplitude * pulse(2 * t + lag, .135)),
                    (yaw, side * power * .035 * cos(2 * t + lag - .54)),
                )
        return motions
    if animal == "plesiosaurus":
        return {
            "neck base": lambda t: ((pitch, .100 + .037 * power * sin(t + .3)),
                                    (yaw, .012 + .026 * power * sin(t - .2))),
            "middle neck": lambda t: ((pitch, .142 + .052 * power * pulse(t - .56)),
                                      (yaw, -.032 + .059 * power * cos(t - .61))),
            "head": lambda t: ((pitch, .034 - .053 * power * pulse(t - .88)),
                               (yaw, -.015 - .029 * power * cos(t - .94))),
        }
    return {}


CLIP_BANK = {
    "anomalocaris": (anomalocaris, ("Swim", 1.14, 1, 30), ("Hover", 1.68, .56, 30)),
    "opabinia": (opabinia, ("Swim", 1.23, 1, 30), ("Hover", 1.90, .62, 30)),
    "hallucigenia": (hallucigenia, ("Crawl", .49, 1, 36)),
    "tullimonstrum": (tullimonstrum, ("Swim", 1.39, 1, 30), ("Hover", 2.06, .58, 30)),
    "ammonite": (ammonite, ("Hover", 3.77, 1, 30)),
    "dakosaurus": (dakosaurus, ("Swim", 1.96, 1, 30), ("Hover", 2.84, .46, 30)),
    "ichthyosaur": (ichthyosaur, ("Swim", 1.57, 1, 30), ("Hover", 2.54, .37, 30)),
    "sarcosuchus": (sarcosuchus, ("Swim", 2.41, 1, 30)),
    "dallasaurus": (dallasaurus, ("Swim", 1.37, 1, 30), ("Hover", 1.93, .40, 30)),
    "styxosaurus": (styxosaurus, ("Swim", 2.33, 1, 30), ("Hover", 3.54, .39, 30)),
    "megalodon": (megalodon, ("Swim", 2.51, 1, 30), ("Hover", 3.62, .46, 30)),
    "mosasaurus": (mosasaurus, ("Swim", 2.19, .92, 36), ("Hover", 3.19, .48, 36)),
    "plesiosaurus": (plesiosaurus, ("Swim", 2.08, .91, 36), ("Hover", 3.13, .54, 36)),
}


def review(rig, clips, destination):
    """Render evaluated skin and shape keys at four phases from two views."""
    scene = rig.scene
    points = [obj.matrix_world @ Vector(corner) for obj in rig.meshes for corner in obj.bound_box]
    center = (Vector(tuple(min(point[i] for point in points) for i in range(3)))
              + Vector(tuple(max(point[i] for point in points) for i in range(3)))) * .5
    span = max((point - center).length for point in points) * 2
    cell_width, cell_height = 1.17, .59
    columns = 5
    idle = None
    poses = (idle, .125, .375, .625, .875)
    views = (rig.right, (rig.right * .8 - rig.forward * .62 + rig.up * .54).normalized())
    views_of_clips = list(clips)
    if "Swim" in clips and "Hover" in clips:
        views_of_clips.append("Swim/Hover")
    row_count = len(views_of_clips) * len(views)
    skin_report = {}
    original_edges = {}
    for clip_index, name in enumerate(views_of_clips):
        for column, phase in enumerate(poses):
            if phase is None:
                rig.reset_pose()
            elif name == "Swim/Hover":
                rig.review_blend(("Swim", "Hover"), phase)
            else:
                rig.review_action(name, phase)
            graph = bpy.context.evaluated_depsgraph_get()
            for obj in rig.meshes:
                evaluated = obj.evaluated_get(graph)
                mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=graph)
                mesh.transform(evaluated.matrix_world)
                # Large, isolated changes signal detached skin or a folding hinge.
                if phase is None:
                    original_edges[obj] = [ (mesh.vertices[a].co - mesh.vertices[b].co).length
                                            for a, b in (edge.vertices for edge in mesh.edges) ]
                else:
                    ratios = []
                    for edge, baseline in zip(mesh.edges, original_edges[obj]):
                        if baseline < span * .0001:
                            continue
                        a, b = edge.vertices
                        ratios.append((mesh.vertices[a].co - mesh.vertices[b].co).length / baseline)
                    if ratios:
                        ratios.sort()
                        material = obj.name
                        skin_report.setdefault(name, {})[material] = max(
                            skin_report[name].get(material, 1) if name in skin_report else 1,
                            ratios[int(.99 * (len(ratios) - 1))],
                        )
                for view_index, direction in enumerate(views):
                    row = clip_index * len(views) + view_index
                    duplicate = bpy.data.objects.new("Review skin", mesh)
                    scene.collection.objects.link(duplicate)
                    orientation = direction.to_track_quat("Z", "Y").to_matrix().to_4x4()
                    offset = Vector(((column - (columns - 1) / 2) * cell_width,
                                     ((row_count - 1) / 2 - row) * cell_height, 0))
                    duplicate.matrix_world = (Matrix.Translation(offset) @ Matrix.Scale(1 / span, 4)
                                              @ orientation.inverted() @ Matrix.Translation(-center))

    for obj in rig.meshes:
        obj.hide_render = True
    camera = bpy.data.cameras.new("Review contact sheet")
    camera.type = "ORTHO"
    camera.ortho_scale = columns * cell_width
    camera.clip_end = 16000
    camera.clip_start = .002
    camera_object = bpy.data.objects.new(camera.name, camera)
    scene.collection.objects.link(camera_object)
    camera_object.location = (0, 0, 12)
    scene.camera = camera_object
    scene.render.engine = "BLENDER_WORKBENCH"
    shade = scene.display.shading
    shade.light = "STUDIO"
    shade.color_type = "TEXTURE"
    shade.background_type = "WORLD"
    scene.world = bpy.data.worlds.new("Review background")
    scene.world.color = (.044, .061, .068)
    shade.show_shadows = False
    shade.show_cavity = True
    shade.cavity_type = "BOTH"
    scene.render.resolution_x = 1800
    scene.render.resolution_y = round(1800 * row_count * cell_height / (columns * cell_width))
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(destination / f"{rig.animal}.png")
    bpy.ops.render.render(write_still=True)
    simplified = {name: {obj: round(ratio, 3) for obj, ratio in ratios.items() if ratio > 1.055}
                  for name, ratios in skin_report.items()}
    print(f"SKIN {rig.animal} {json.dumps(simplified, separators=(',', ':'))}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review", type=Path, help="Write side and elevated review sheets to this directory")
    parser.add_argument("--species", action="append", choices=CLIP_BANK)
    parser.add_argument("--check", action="store_true", help="Verify the checked-in channels match the bake")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    animals = args.species or CLIP_BANK
    metadata = json.loads((MUSEUM / "island-museum-models.lock.json").read_text())["animals"]
    CLIP_DIRECTORY.mkdir(exist_ok=True)
    if args.review:
        args.review.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix="island-aquatic-") as temporary:
        for animal in animals:
            bpy.ops.wm.read_factory_settings(use_empty=True)
            rig = Specimen(animal, metadata[animal], Path(temporary))
            author, *config = CLIP_BANK[animal]
            clips = {}
            for name, duration, power, frames in config:
                rotations, weights, translations = author(rig, power)
                auxiliary = auxiliary_motion(animal, power)
                clips[name] = rig.channels(name, duration, frames, rotations, weights, translations, auxiliary)
            path = CLIP_DIRECTORY / f"{animal}.js"
            packed = encode_motion(clips)
            if args.check:
                if path.read_text() != packed:
                    raise ValueError(f"Stale Blender motion data: {path}")
            else:
                path.write_text(packed)
            if args.review:
                review(rig, clips, args.review)
            print(f"AUTHORED {animal}: " + ", ".join(f"{name} {clip['duration']:.2f}s"
                                                      for name, clip in clips.items()), flush=True)


if __name__ == "__main__":
    main()
