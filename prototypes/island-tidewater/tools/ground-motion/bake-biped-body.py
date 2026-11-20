"""Bake gait-synchronized upper bodies on the eleven actual island skins.

node tools/ground-motion/export-biped-blender.mjs /tmp/biped-bind
blender -b -t 4 --python-exit-code 1 --python tools/ground-motion/bake-biped-body.py -- /tmp/biped-bind
"""
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

# Each line describes this mesh's shoulder countertwist, ribcage pitch, neck
# pitch, head counterpitch, shoulder/elbow travel, tail-base yaw, distal
# compliance, and lag in strides. Angles are degrees at a normal walk.
STYLE = {
    'carnotaurus': (3.3, 1.6, 2.8, -2.1, 9.5, 4.6, 3.8, 2.6, .10),
    'dilophosaurus': (4.2, 2.4, 4.5, -3.7, 13.5, 6.5, 4.8, 3.6, .075),
    'allosaurus-pandras': (2.2, 1.6, 0, -1.0, 8.0, 0, 2.6, 3.6, .13),
    'baryonyx': (2.4, 1.25, 2.1, -1.8, 7.8, 4.2, 2.9, 2.4, .13),
    'spinosaurus': (1.8, .9, 1.65, -1.6, 5.2, 2.7, 3.5, 2.3, .15),
    'pachycephalosaurus': (3.0, 2.0, 3.0, -2.8, 12, 5.7, 3.3, 1.9, .09),
    'gallimimus': (3.2, 2.35, 5.4, -4.1, 15.3, 7.5, 4.0, 2.9, .055),
    'gigantoraptor': (2.45, 1.65, 3.7, -3.15, 10.5, 5.05, 3.2, 1.9, .12),
    'therizinosaurus': (2.1, 1.4, 2.2, -2.25, 6.2, 3.1, 3.45, 2.6, .145),
    'phorusrhacos': (0, 0, 6.4, -5.6, 5.6, 0, 3.2, 0, .067),
    'tyrannosaurus-rex': (2.55, 1.35, 2.7, -2.35, 6.3, 0, 3.05, 2.1, .14),
}

# Left touchdown, load, single support, toe-off, right touchdown, and return.
# A limb swings forward as its opposite leg accepts weight. The forward and
# backward extrema have different release intervals. Neck pitch uses two
# loading impulses per stride while shoulder and tail yaw use a full stride.
SWEEP = (.88, .98, .43, -.46, -.88, -.98, -.43, .46)
LOAD = (-.32, .79, .48, -.82, -.32, .79, .48, -.82)
LATERAL = (.34, .93, .76, .11, -.34, -.93, -.76, -.11)
PERIOD = 64
SAMPLES = 24


def periodic(values, u):
    # Periodic Catmull-Rom keeps velocity continuous through left touchdown.
    value = (u % 1) * len(values)
    i = math.floor(value)
    t = value - i
    a, b, c, d = (values[(i + delta) % len(values)] for delta in (-1, 0, 1, 2))
    return .5 * (2*b + (-a+c)*t + (2*a-5*b+4*c-d)*t*t + (-a+3*b-3*c+d)*t*t*t)


def skin(scene, source, data):
    id = data['id']
    def binary(tag, dtype):
        return np.fromfile(source / (id + '-' + tag + '.bin'), dtype=dtype)
    points = binary('positions', '<f4').reshape(-1, 3)
    indices = binary('indices', '<i4')
    mesh = bpy.data.meshes.new(id)
    mesh.vertices.add(len(points))
    mesh.vertices.foreach_set('co', points.ravel())
    mesh.loops.add(len(indices))
    mesh.loops.foreach_set('vertex_index', indices)
    mesh.polygons.add(len(indices) // 3)
    mesh.polygons.foreach_set('loop_start', np.arange(0, len(indices), 3, dtype=np.int32))
    mesh.update()
    surface = bpy.data.objects.new(id, mesh)
    scene.collection.objects.link(surface)

    arm = bpy.data.objects.new(id + ' gait rig', bpy.data.armatures.new(id))
    scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    bones = []
    display_length = max(.001, np.ptp(points[:, 0]) * .009)
    for node in data['bones']:
        b = arm.data.edit_bones.new(node['name'])
        b.head = Vector(node['pivot'])
        # Preserve a common anatomical basis independent of FBX bone roll.
        b.tail = b.head + Vector((0, display_length, 0))
        bones.append(b)
    for i, node in enumerate(data['bones']):
        if node['parent'] >= 0:
            bones[i].parent = bones[node['parent']]
    bpy.ops.object.mode_set(mode='OBJECT')
    groups = [surface.vertex_groups.new(name=n['name']) for n in data['bones']]
    counts = binary('counts', 'B')
    links = binary('links', '<u2').reshape(-1, 2)
    cursor = 0
    for index, count in enumerate(counts):
        stop = cursor + int(count)
        for joint, weight in links[cursor:stop]:
            groups[joint].add([index], int(weight) / 65535, 'ADD')
        cursor = stop
    modifier = surface.modifiers.new('Museum weights', 'ARMATURE')
    modifier.object = arm
    return surface, arm


def angles(data, phase):
    id, anatomy = data['id'], data['anatomy']
    yaw, pitch, neck, counter, arm, elbow, tail, tip, lag = STYLE[id]
    sweep = lambda t: periodic(SWEEP, t)
    load = lambda t: periodic(LOAD, t)
    lateral = lambda t: periodic(LATERAL, t)
    out = [
        (pitch * load(phase), yaw * lateral(phase), -yaw * .39 * sweep(phase)),
        (neck * load(phase - lag * .33), -yaw * .62 * lateral(phase - .012), yaw * .21 * sweep(phase)),
        (counter * load(phase - lag * .48), -yaw * .35 * lateral(phase - .045), yaw * .15 * sweep(phase - .018)),
    ]
    for side, group in enumerate((anatomy['left'], anatomy['right'])):
        u = phase + .5 * side - lag
        sign = -1 if side else 1
        if id == 'phorusrhacos':
            # Folded wings rotate about the line of flight as the breast loads.
            out.append((arm * .35 * sweep(u), 0, sign * arm * (.6 * load(u) + .4 * lateral(u))))
        else:
            out.append((arm * sweep(u), sign * arm * .13 * lateral(u), sign * arm * .14 * load(u)))
        if len(group) == 2:
            out.append((-elbow * sweep(u - lag * .65), 0, sign * elbow * .12 * load(u - .04)))
    for j, _ in enumerate(anatomy['tail']):
        u = phase - lag * (.7 + .75*j)
        strength = tail if j == 0 else tip / (1 + .30 * (j - 1))
        if id == 'allosaurus-pandras':
            strength = tail + j * tip * .53
        out.append((-pitch * (.46 if not j else .22) * load(u), -strength * lateral(u), 0))
    return out


def bake(data, source):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    surface, arm = skin(scene, source, data)
    controls = [arm.pose.bones.get(n) if n else None for n in data['controls']]
    for name, bone in zip(data['controls'], controls):
        if name and not bone:
            raise ValueError('No Blender bone ' + name)
    arm.animation_data_create()
    arm.animation_data.action = bpy.data.actions.new(data['id'] + ' walking body')
    animated = []
    for control in controls:
        family = [control] if control else []
        if control and control.name.startswith('IdleClaw'):
            family = [b for b in arm.pose.bones if b.name.startswith(control.name[:10])]
        animated.append(family)
    # Eight authored poses per cycle plus periodic handles on both sides.
    for k in range(-2, 11):
        t = k / 8
        for family, (pitch, yaw, roll) in zip(animated, angles(data, t)):
            for bone in family:
                bone.rotation_mode = 'YZX'
                bone.rotation_euler = tuple(map(math.radians, (roll, -pitch, yaw)))
                bone.keyframe_insert('rotation_euler', frame=k * PERIOD // 8, group=bone.name)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    frames = []
    min_xyz = np.full(3, np.inf)
    max_xyz = -min_xyz
    for sample in range(SAMPLES):
        value = PERIOD * sample / SAMPLES
        scene.frame_set(int(value), subframe=value % 1)
        frame = []
        for bone in controls:
            roll, pitch, yaw = bone.rotation_euler if bone else (0, 0, 0)
            frame.extend(round(math.degrees(x), 3) for x in (-pitch, yaw, roll))
        evaluated = surface.evaluated_get(depsgraph)
        vertices = np.empty(len(surface.data.vertices) * 3, dtype=np.float32)
        evaluated.data.vertices.foreach_get('co', vertices)
        vertices = vertices.reshape(-1, 3)
        if not np.isfinite(vertices).all():
            raise ValueError('Nonfinite posed mesh in ' + data['id'])
        min_xyz = np.minimum(min_xyz, vertices.min(0))
        max_xyz = np.maximum(max_xyz, vertices.max(0))
        frames.append(frame)
    if np.any(max_xyz <= min_xyz):
        raise ValueError('Collapsed gait geometry')
    print(data['id'], len(arm.data.bones), 'bones,', len(surface.data.vertices), 'deformed vertices x', SAMPLES)
    return frames


source = Path(sys.argv[sys.argv.index('--') + 1])
out = ['// Blender rotations in degrees [pitch, yaw, roll], sampled over one closed stride.',
       '// Rebuild with tools/ground-motion/bake-biped-body.py.', 'export const bipedActions = {']
for id in STYLE:
    frames = bake(json.loads((source / (id + '.json')).read_text()), source)
    out.append('  ' + json.dumps(id) + ': [')
    out.extend('    ' + json.dumps(frame, separators=(',', ':')) + ',' for frame in frames)
    out.append('  ],')
out.extend(['};', ''])
(Path(__file__).resolve().parents[2] / 'museum/ground-motion/BipedActions.js').write_text('\n'.join(out))
