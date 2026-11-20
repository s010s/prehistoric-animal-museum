"""Bake the Pachycephalosaurus weight-bearing pose in Blender.

  blender -b --factory-startup --python-exit-code 1 \
    --python tools/ground-motion/bake-stride-base.py
"""

from bisect import bisect_right
import gzip
import json
import math
from pathlib import Path
import struct

import bpy
from mathutils import Matrix, Quaternion, Vector


MUSEUM = Path(__file__).resolve().parents[2] / 'museum'
SPECIES = 'pachycephalosaurus'
SOURCE = MUSEUM / 'assets' / 'island' / f'{SPECIES}.glb.gz'
# Both feet are loaded in this phase of Idle. The trunk and tail are already
# near the sagittal plane. Preserve the visible neck pitch and knee geometry.
SOURCE_TIME = 60 / 24
UP = Vector((0, 1, 0))


def read_glb():
    binary = gzip.decompress(SOURCE.read_bytes())
    length, = struct.unpack_from('<I', binary, 12)
    data = json.loads(binary[20:20 + length])

    def accessor(index):
        info = data['accessors'][index]
        view = data['bufferViews'][info['bufferView']]
        offset = 28 + length + view.get('byteOffset', 0) + info.get('byteOffset', 0)
        width = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[info['type']]
        code = {5126: 'f', 5122: 'h', 5120: 'b'}[info['componentType']]
        record = struct.Struct(f'<{width}{code}')
        stride = view.get('byteStride', record.size)
        values = [record.unpack_from(binary, offset + i * stride) for i in range(info['count'])]
        if info.get('normalized'):
            maximum = {'h': 32767, 'b': 127}[code]
            return [tuple(max(-1, v / maximum) for v in row) for row in values]
        return values

    return data, accessor


def gltf_quaternion(xyzw):
    x, y, z, w = xyzw
    return Quaternion((w, x, y, z)).normalized()


def sample(clip, channel, accessor):
    sampler = clip['samplers'][channel['sampler']]
    times = [row[0] for row in accessor(sampler['input'])]
    values = accessor(sampler['output'])
    width = len(values) // len(times)
    keys = [tuple(v for row in values[i:i + width] for v in row) for i in range(0, len(values), width)]
    previous = max(0, bisect_right(times, SOURCE_TIME) - 1)
    next_key = min(previous + 1, len(times) - 1)
    if sampler.get('interpolation') == 'STEP' or next_key == previous or SOURCE_TIME <= times[0]:
        return keys[previous]
    u = (SOURCE_TIME - times[previous]) / (times[next_key] - times[previous])
    a, b = map(Vector, (keys[previous], keys[next_key]))
    if channel['target']['path'] == 'rotation' and a.dot(b) < 0:
        b.negate()
    return tuple(a.lerp(b, u))


def create_pose(nodes, authored):
    # The empties preserve the normalized GLB's hierarchy and Y-up basis.
    # Blender evaluates the parent frames used to center the neck and tail.
    controls = []
    for i, node in enumerate(nodes):
        obj = bpy.data.objects.new(node['name'], None)
        bpy.context.scene.collection.objects.link(obj)
        paths = authored.get(i, {})
        obj.location = paths.get('translation', node.get('translation', (0, 0, 0)))
        obj.rotation_mode = 'QUATERNION'
        obj.rotation_quaternion = gltf_quaternion(paths.get('rotation', node.get('rotation', (0, 0, 0, 1))))
        obj.scale = paths.get('scale', node.get('scale', (1, 1, 1)))
        controls.append(obj)
    for i, node in enumerate(nodes):
        for child in node.get('children', []):
            controls[child].parent = controls[i]
    bpy.context.view_layer.update()
    return controls


def center_heading(control, tip, forward):
    direction = tip.matrix_world.translation - control.matrix_world.translation
    target_heading = 0 if forward > 0 else math.pi
    change = math.remainder(target_heading - math.atan2(direction.x, direction.z), math.tau)
    parent_axis = control.parent.matrix_world.to_3x3().inverted() @ UP
    control.rotation_quaternion = Quaternion(parent_axis.normalized(), change) @ control.rotation_quaternion
    bpy.context.view_layer.update()


def bake():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    model, accessor = read_glb()
    nodes = model['nodes']
    named = {node['name']: i for i, node in enumerate(nodes)}
    idle = next(clip for clip in model['animations'] if clip['name'] == 'Idle')
    authored = {}
    for channel in idle['channels']:
        target = channel['target']
        authored.setdefault(target['node'], {})[target['path']] = sample(idle, channel, accessor)

    controls = create_pose(nodes, authored)
    properties = {'translation': 'location', 'rotation': 'rotation_quaternion', 'scale': 'scale'}
    tail = ['SpineTail_048', *(f'Tail{n}_{48 + n:03d}' for n in range(1, 10)), 'Tail9_end_099']
    for root, tip, sign in [('Head_09', 'TopJaw_end_085', 1),
                            *((start, end, -1) for start, end in zip(tail, tail[1:]))]:
        index = named[root]
        center_heading(controls[index], controls[named[tip]], sign)
        authored.setdefault(index, {})['rotation'] = None
    bpy.context.scene.frame_start = bpy.context.scene.frame_end = 0
    for index, paths in authored.items():
        for path in paths:
            controls[index].keyframe_insert(data_path=properties[path], frame=0)
    bpy.context.scene.frame_set(0)

    channels = []
    for index, paths in sorted(authored.items()):
        obj = controls[index]
        for path in paths:
            values = getattr(obj, properties[path])
            if path == 'rotation':
                values = (values.x, values.y, values.z, values.w)
            channels.append((nodes[index]['name'], path, [round(v, 8) for v in values]))
    morphs = [(nodes[channel['target']['node']]['name'], sample(idle, channel, accessor))
              for channel in idle.get('extras', {}).get('islandMorph', {}).get('channels', [])]
    return channels, morphs


if __name__ == '__main__':
    channels, morphs = bake()
    lines = ['// Generated in Blender by tools/ground-motion/bake-stride-base.py.',
             'export const pachycephalosaurusStrideBase = {', '  channels: [']
    lines.extend(f'    {json.dumps(channel)},' for channel in channels)
    lines.extend(('  ],', '  morphs: ['))
    lines.extend(f'    {json.dumps(channel)},' for channel in morphs)
    lines.extend(('  ],', '};', ''))
    path = MUSEUM / 'PachycephalosaurusStrideBase.js'
    path.write_text('\n'.join(lines))
    print(f'Baked {len(channels)} local transforms and {len(morphs)} morph channels to {path}')
