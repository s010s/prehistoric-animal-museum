"""Rebind the island derivative of Marcel Schanz's Tyrant King in Blender.

blender -b -t 2 --python-exit-code 1 --python author.py -- input.glb output.glb
An optional third path saves the editable hindlimbs, jaw action and weighted surface.
Transfer the Blender weights and inverse binds into the original GLB streams so
the two material meshes, UV splits, textures, triangle order and Idle survive.
"""
import json
import struct
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

# Quadrate/articular contact in the reference skin, posterior and below the orbit.
# Native model axes are lateral, vertical, anterior.
JAW_SOCKET = Vector((0, .88, 1.15))
PATROL_CLOSURE = 24.4

# Side-view landmarks on this mesh in native units: forward, lateral, height.
# The old display rig put its leg pivot midway down the visible thigh belly.
LANDMARKS = ((.069, .171, .875), (.157, .202, .487), (-.083, .213, .224),
             (-.048, .227, .064), (.14, .237, .03))
JOINTS = ('hip', 'knee', 'ankle', 'toes')
TO_BLENDER = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1),))
TO_NATIVE = TO_BLENDER.inverted()


def smooth(lo, hi, x):
    t = np.clip((x - lo) / (hi - lo), 0, 1)
    return t*t*(3 - 2*t)


def rewrite(source, output, blend=None):
    data = source.read_bytes()
    js_end = 20 + struct.unpack_from('<I', data, 12)[0]
    gltf = json.loads(data[20:js_end])
    binary = bytearray(data[js_end+8:])
    nodes = gltf['nodes']
    root = next(i for i, n in enumerate(nodes) if n['name'] == 'root')
    primitive = gltf['meshes'][0]['primitives'][0]
    skin = gltf['skins'][0]
    old_nodes = list(skin['joints'])
    names = [nodes[i]['name'] for i in old_nodes]

    def array(index):
        acc = gltf['accessors'][index]
        view = gltf['bufferViews'][acc['bufferView']]
        dim = {'VEC3': 3, 'VEC4': 4, 'MAT4': 16, 'SCALAR': 1}[acc['type']]
        dtype = np.dtype({5121: 'u1', 5122: '<i2', 5123: '<u2', 5125: '<u4', 5126: '<f4'}[acc['componentType']])
        return np.ndarray((acc['count'], dim), dtype=dtype, buffer=binary,
                          offset=view.get('byteOffset', 0) + acc.get('byteOffset', 0),
                          strides=(view.get('byteStride', dim*dtype.itemsize), dtype.itemsize))

    def native_matrix(i):
        node = nodes[i]
        t = Vector(node.get('translation', (0, 0, 0)))
        x, y, z, w = node.get('rotation', (0, 0, 0, 1))
        return Matrix.LocRotScale(t, Quaternion((w, x, y, z)), Vector(node.get('scale', (1, 1, 1))))

    bpy.ops.wm.read_factory_settings(use_empty=True)
    root_world = native_matrix(root)
    # The island's two skinned meshes use different decoding transforms.
    # Bind the body in its actual model coordinates, before its animated pose.
    inverse_accessor = skin['inverseBindMatrices']
    base = root_world @ Matrix(array(inverse_accessor)[old_nodes.index(root)].reshape(4, 4).T)
    to_skin = np.array(TO_BLENDER @ base)
    coords = array(primitive['attributes']['POSITION']).copy()
    points = (coords @ to_skin[:3, :3].T + to_skin[:3, 3]).astype(np.float32)
    triangles = array(primitive['indices']).flatten().astype(np.int32)
    count = len(points)
    mesh = bpy.data.meshes.new('Tyrant King body')
    mesh.vertices.add(count)
    mesh.vertices.foreach_set('co', points.ravel())
    mesh.loops.add(len(triangles))
    mesh.loops.foreach_set('vertex_index', triangles)
    mesh.polygons.add(len(triangles)//3)
    mesh.polygons.foreach_set('loop_start', np.arange(0, len(triangles), 3, dtype=np.int32))
    mesh.update()
    surface = bpy.data.objects.new(mesh.name, mesh)
    bpy.context.scene.collection.objects.link(surface)
    arm = bpy.data.objects.new('Tyrant King hindlimbs', bpy.data.armatures.new('Pelvis and hindlimbs'))
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    pelvis = arm.data.edit_bones.new('root')
    pelvis.head = TO_BLENDER @ root_world.translation
    pelvis.tail = pelvis.head + Vector((0, 0, .12))
    if blend:
        skull = arm.data.edit_bones.new('head')
        skull.head, skull.tail = (0, -.86, 1.0), (0, -1.50, .92)
        skull.parent = pelvis
        mandible = arm.data.edit_bones.new('jaw')
        mandible.head, mandible.tail = TO_BLENDER @ JAW_SOCKET, (0, -1.435, .70)
        mandible.parent = skull
    chains = []
    for side, sign in [('left', -1), ('right', 1)]:
        landmarks = [Vector((l*sign, -f, z)) for f, l, z in LANDMARKS]
        parent = pelvis
        chain = []
        for joint, head, tail in zip(JOINTS, landmarks, landmarks[1:]):
            name = 'Museum hind ' + side + ' ' + joint
            bone = arm.data.edit_bones.new(name)
            bone.head, bone.tail = head, tail
            bone.parent = parent
            bone.use_connect = parent != pelvis
            chain.append(name)
            parent = bone
        chains.append(chain)
    bpy.ops.object.mode_set(mode='OBJECT')
    groups = [surface.vertex_groups.new(name=n) for n in names + sum(chains, [])]
    modifier = surface.modifiers.new('Hindlimbs', 'ARMATURE')
    modifier.object = arm

    joints = array(primitive['attributes']['JOINTS_0'])
    weights = array(primitive['attributes']['WEIGHTS_0'])
    old = np.zeros((count, len(old_nodes)))
    np.add.at(old, (np.arange(count)[:, None], joints), weights)
    old /= old.sum(1)[:, None]
    lateral, forward, height = points[:, 0], -points[:, 1], points[:, 2]
    side = np.abs(lateral)
    # Wrap the outer muscle in the lateral flank across both sides of the UV
    # seam. The sacrum, tail root, inner belly and medial acetabulum stay firm.
    center = np.interp(height, [.46, .66, .88, .99], [.155, .132, .079, .065])
    width = np.interp(height, [.46, .66, .88, .99], [.174, .203, .178, .14])
    longitudinal = (1 - smooth(.69, 1.48, np.abs(forward-center)/width))
    shell = smooth(.061, .192, side)
    cap = 1 - smooth(.794, .986, height)
    regional = longitudinal * shell * cap
    old_leg = old[:, names.index('leg_left')] + old[:, names.index('leg_right')]
    # Below the seam the leg is a distinct surface. Spatial paint alone would
    # leak onto the belly or leave isolated claws and UV islands behind.
    leg = old_leg + (1 - old_leg) * regional
    palette = np.zeros((count, len(groups)))
    palette[:, :len(names)] = old * (1 - leg[:, None])
    palette[:, names.index('root')] += (1-leg)*old_leg
    for old_name in ('leg_left', 'leg_right'):
        palette[:, names.index(old_name)] = 0
    # Load crosses the front of the knee and folds behind it. At the ankle the
    # tendon passes across the joint. The digit tips keep the toe frame.
    knee = 1 - smooth(.442, .532, height)
    ankle = 1 - smooth(.191, .258, height)
    # Oblique MTP fold allows all three digits to share their bearing pad.
    mtp = np.clip(.067 + .32*(forward+.048), .042, .104)
    toes = 1 - smooth(mtp-.026, mtp+.027, height)
    parts = np.column_stack([1-knee, knee*(1-ankle), knee*ankle*(1-toes), knee*ankle*toes])
    for i, lane in enumerate((lateral < 0, lateral >= 0)):
        start = len(names)+4*i
        palette[:, start:start+4] = parts * (leg * lane)[:, None]
    if np.max(np.abs(palette.sum(1) - 1)) > 1e-6:
        raise ValueError('Invalid hindlimb partition')
    rows = np.argsort(-palette, axis=1, kind='stable')[:, :4]
    values = np.take_along_axis(palette, rows, axis=1)
    if np.min(values.sum(1)) < .995:
        raise ValueError('Body weights spill past the original four GPU slots')
    values /= values.sum(1)[:, None]
    # The Blender vertex groups are the source of the exported skin weights.
    for i, (indices, amounts) in enumerate(zip(rows, values)):
        for index, amount in zip(indices, amounts):
            if amount > 1e-8:
                groups[index].add([i], float(amount), 'REPLACE')
    for vertex in mesh.vertices:
        i = vertex.index
        joints[i], weights[i] = 0, 0
        for j, influence in enumerate(vertex.groups):
            joints[i, j], weights[i, j] = influence.group, influence.weight

    # The original display hinge is located in the neck. Move its bind axis
    # before narrowing the gape so the posterior teeth do not enter the palate.
    jaw = old_nodes[names.index('jaw')]
    head = old_nodes[names.index('head')]
    ancestors = {child: i for i, node in enumerate(nodes) for child in node.get('children', [])}

    def world_matrix(i):
        local = native_matrix(i)
        return world_matrix(ancestors[i]) @ local if i in ancestors else local

    source_jaw = world_matrix(jaw)
    nodes[jaw]['translation'] = list(world_matrix(head).inverted() @ JAW_SOCKET)
    socket = world_matrix(jaw)
    for source_skin in gltf['skins']:
        if jaw in source_skin['joints']:
            matrix = array(source_skin['inverseBindMatrices'])[source_skin['joints'].index(jaw)]
            matrix[:] = np.asarray(socket.inverted() @ source_jaw @ Matrix(matrix.reshape(4, 4).T)).T.ravel()

    idle = next(a for a in gltf['animations'] if a['name'] == 'Idle')
    channel = next(c for c in idle['channels'] if c['target'] == {'node': jaw, 'path': 'rotation'})
    key_acc = idle['samplers'][channel['sampler']]['output']
    assert gltf['accessors'][key_acc]['componentType'] == 5122 and gltf['accessors'][key_acc]['normalized']
    keys = array(key_acc)
    angles = np.degrees(2 * np.arctan2(keys[:, 0].astype(float), keys[:, 3]))
    # Retain the timing of the museum glance, with a brief, slight opening
    # at its peak. Both patrol and idle return to the same seated bite.
    opening = 1.8 * smooth(2.55, 3.8, angles - angles[0])
    half = np.radians(angles[0] - PATROL_CLOSURE + opening) / 2
    keys[:, 0], keys[:, 3] = np.rint(32767*np.sin(half)), np.rint(32767*np.cos(half))
    nodes[jaw]['rotation'] = [float(np.sin(half[0])), 0, 0, float(np.cos(half[0]))]
    if blend:
        # Keep the same socket and bite in the editable Blender review scene.
        controller = arm.pose.bones['jaw']
        axis = controller.bone.matrix_local.to_quaternion().inverted() @ Vector((1, 0, 0))
        times = array(idle['samplers'][channel['sampler']]['input']).ravel()
        for time, delta in zip(times, opening):
            controller.rotation_quaternion = Quaternion(axis, np.radians(delta - PATROL_CLOSURE))
            controller.keyframe_insert('rotation_quaternion', frame=float(time)*24, group='jaw')
        arm.animation_data.action.name = 'Tyrant King quiet observation'
        bpy.context.scene.frame_set(0)
    bind = list(array(inverse_accessor).copy())
    for chain in chains:
        parent = root
        parent_world = root_world
        for name in chain:
            bone = arm.data.bones[name]
            world = TO_NATIVE @ bone.matrix_local
            offset = parent_world.inverted() @ world
            q = offset.to_quaternion()
            index = len(nodes)
            nodes[parent].setdefault('children', []).append(index)
            nodes.append(dict(name=name, translation=list(offset.translation),
                              rotation=[q.x, q.y, q.z, q.w]))
            skin['joints'].append(index)
            bind.append(np.asarray(world.inverted() @ base).T.flatten())
            parent, parent_world = index, world
    # Append this body's new bind array. The eye skin uses its own source rows.
    segment = np.asarray(bind, dtype='<f4').tobytes()
    old_view = gltf['accessors'][inverse_accessor]
    gltf['bufferViews'].append(dict(buffer=0, byteOffset=len(binary), byteLength=len(segment)))
    old_view.update(bufferView=len(gltf['bufferViews'])-1, byteOffset=0, count=len(bind))
    binary = bytes(binary) + segment
    gltf['buffers'][0]['byteLength'] = len(binary)
    meta = json.dumps(gltf, separators=(',', ':'), ensure_ascii=False).encode()
    meta += b' '*(-len(meta) % 4)
    length = 28+len(meta)+len(binary)
    output.write_bytes(struct.pack('<4sIIII', b'glTF', 2, length, len(meta), 0x4e4f534a)+meta
                       + struct.pack('<II', len(binary), 0x004e4942)+binary)
    if blend:
        bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    print(
        f'{count} weighted vertices / {len(groups)} groups / {sum(np.any(palette[:, len(names):] > .01, axis=1))} hindlimb vertices')


rewrite(*(Path(p) for p in sys.argv[sys.argv.index('--')+1:]))
