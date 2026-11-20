"""Bake the island's flight tracks against the visible Idle poses in Blender.

Run Blender --background --factory-startup --python-exit-code 1 --python
prototypes/island-tidewater/tools/author-island-flight.py
"""

import gzip
import json
import math
import struct
from pathlib import Path

from mathutils import Matrix, Quaternion, Vector


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'museum/assets'


def source_pose(species):
    data = gzip.decompress((ASSETS / f'island/{species}.glb.gz').read_bytes())
    json_size = struct.unpack_from('<I', data, 12)[0]
    model = json.loads(data[20:20 + json_size])
    nodes = model['nodes']
    rest = [
        dict(
            translation=node.get('translation', [0, 0, 0]),
            rotation=node.get('rotation', [0, 0, 0, 1]),
            scale=node.get('scale', [1, 1, 1]),
        )
        for node in nodes
    ]
    idle = next(clip for clip in model['animations'] if clip['name'] == 'Idle')
    for channel in idle['channels']:
        target = channel['target']
        sampler = idle['samplers'][channel['sampler']]
        accessor = model['accessors'][sampler['output']]
        view = model['bufferViews'][accessor['bufferView']]
        offset = 28 + json_size + view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        path = target['path']
        code, divisor = {5126: ('f', 1), 5122: ('h', 32767), 5120: ('b', 127)}[accessor['componentType']]
        width = 4 if path == 'rotation' else 3
        values = struct.unpack_from(f'<{width}{code}', data, offset)
        rest[target['node']][path] = [max(-1, value / divisor) for value in values] if accessor.get('normalized') else values
    poses = {}
    parents = {child: i for i, node in enumerate(nodes) for child in node.get('children', [])}
    worlds = {}

    def world(i):
        if i not in worlds:
            transform = rest[i]
            x, y, z, w = transform['rotation']
            local = Matrix.LocRotScale(
                Vector(transform['translation']), Quaternion((w, x, y, z)),
                Vector(transform['scale']),
            )
            worlds[i] = world(parents[i]) @ local if i in parents else local
        return worlds[i]

    for i, node in enumerate(nodes):
        x, y, z, w = rest[i]['rotation']
        parent = world(parents[i]) if i in parents else Matrix.Identity(4)
        poses[node['name']] = (
            Quaternion((w, x, y, z)).normalized(), parent.to_3x3().inverted()
        )
    return poses


def smooth(value):
    value = min(1, max(0, value))
    return value * value * (3 - 2 * value)


def flight_window(t, beats, start, end):
    """Blend a complete beat sequence into and out of the extended wing pose."""
    u = (t - start) / (end - start)
    power = smooth(u * beats * 1.55) * smooth((1 - u) * beats * 1.45)
    return math.tau * (u * beats), power


def stroke(phase):
    # The faster extension passes through the middle of the power stroke.
    return math.sin(phase) - .18 * math.sin(phase * 2 + .3)


def wing_pose(pose, joints, sections, phase, power):
    for side, chain in zip((1, -1), joints):
        for joint, spec in zip(chain, sections):
            neutral, amplitude, sweep, washout, lag = spec
            a = phase - lag
            curve = stroke(a)
            pose[joint] = (
                side * (neutral + amplitude * power * curve),
                side * sweep * power * math.cos(a - .2),
                washout * power * math.sin(a + .75),
            )


def paired(prefix, labels, pattern):
    return [[pattern.format(prefix=prefix, side=side, joint=joint) for joint in labels]
            for side in 'LR']


def anurognathus(t):
    phase = math.tau * t
    pose = {}
    joints = paired('Wing', ['Shoulder', 'Elbow', 'Wrist', 'Tip'], '{prefix}{joint}_{side}')
    wing_pose(pose, joints, [
        (-15, 27, 3.0, 1.6, 0), (2, 4.6, 3.2, 2.1, .33),
        (1.5, 6.6, 2.1, 2.7, .63), (1, 4.5, 1.2, 1.8, .93),
    ], phase, 1)
    pose['Body'] = (0, 0, 1.6 * math.sin(phase - .42))
    pose['Head'] = (0, 1.8 * math.sin(phase + .4), -1.9 * math.sin(phase - .2))
    for side in 'LR':
        pose[f'Foot_{side}'] = (0, 0, 2.1 + 1.6 * math.sin(phase - .58))
    recovery = .5 + .5 * math.cos(phase - .35)
    return pose, [.25 + .11 * (1 - recovery), .06 + .25 * recovery, .94]


def sordes(t):
    phase, power = flight_window(t, 2, .04, .55)
    pose = {}
    wing_pose(pose, [
        ['Bone.007_15', 'Bone.008_14', 'Bone.009_13', 'Bone.010_12'],
        ['Bone.011_19', 'Bone.012_18', 'Bone.013_17', 'Bone.014_16'],
    ], [
        (4, 23, 3.7, 1.0, 0), (-2, 4.5, 2.1, 2.0, .38),
        (1.5, 6.2, 2.2, 2.4, .74), (1, 5, 1.9, 1.7, 1.05),
    ], phase, power)
    drift = math.sin(t * math.tau)
    pose['Bone_20'] = (1.6 * drift, 0, 2.3 * power * stroke(phase - .32))
    pose['Bone.002_4'] = (0, 2.5 * drift, 2.7 * power * stroke(phase - .63))
    pose['Bone.003_3'] = (0, 3.5 * math.sin(t * math.tau - .55), 3.6 * power * stroke(phase - .9))
    # The .002/.003 chain is the tail. Animate the opposing neck chain too,
    # letting the head look across the glide path independently of the wings.
    pose['Bone.004_2'] = (0, 2.7 * drift, -.9 * power * stroke(phase - .37))
    pose['Bone.005_1'] = (0, 3.8 * math.sin(t * math.tau - .22), -1.3 * drift)
    return pose, None


def archaeopteryx(t):
    phase, power = flight_window(t, 2, .015, .79)
    pose = {}
    joints = paired('', ['Shoulder', 'Arm', 'ForeArm', 'Wrist'], '{side}_{joint}')
    wing_pose(pose, joints, [
        (-32, 27, 3.6, 1.8, 0), (-6, 3.2, 3.0, 1.8, .32),
        (-1, 6.8, 3.4, 2.4, .64), (2.2, 7.5, 4.1, 4.1, .92),
    ], phase, power)
    # Open the swept resting elbow and hold the remiges spread through recovery.
    for side, label in zip((1, -1), 'LR'):
        # The exhibition shoulders hold one outer wing lower throughout.
        # Trim both around the flight axis and retain the individual strokes.
        roll, sweep, pitch = pose[f'{label}_Shoulder']
        pose[f'{label}_Shoulder'] = (roll - 5.05, sweep, pitch)
        roll, sweep, pitch = pose[f'{label}_Arm']
        pose[f'{label}_Arm'] = (roll, sweep - side * 12, pitch)
        roll, sweep, pitch = pose[f'{label}_ForeArm']
        pose[f'{label}_ForeArm'] = (roll, sweep - side * 7, pitch)
        # The standing source puts the right ankle farther forward. Relax
        # each knee independently so both feet follow the abdomen in flight.
        leg_angle = 39 if label == 'L' else 46
        pose[f'{label}_leg'] = (0, side * 2.3, leg_angle + 2.2 * power * stroke(phase - .65))
        pose[f'{label}_knee'] = (0, 0, 7 if label == 'L' else 27)
        pose[f'{label}_heel'] = (0, 0, 17)
        pose[f'{label}_foot'] = (0, 0, -13)
    pose['Hip'] = (0, 0, 18 + 2.0 * power * stroke(phase - .45))
    pose['Neck_01'] = (0, 0, -8 - 1.9 * power * stroke(phase - .44))
    gaze = math.sin(t * math.tau)
    pose['Neck_02'] = (0, 2.7 * gaze, -.75 * power * stroke(phase - .5))
    pose['Head_01'] = (0, 3.3 * math.sin(t * math.tau - .26), -1.0 * gaze)
    pose['Tail_01'] = (0, 1.2 * math.sin(t * math.tau), -13 + 2.0 * power * stroke(phase - .72))
    pose['Tail_06'] = (0, 0, -4 + 2.1 * power * stroke(phase - 1))
    return pose, None


def quetzalcoatlus(t):
    phase, power = flight_window(t, 2, .016, .50)
    pose = {}
    wing_pose(pose, [
        ['Bone.001_L_03', 'Bone.001_L.001_04', 'Bone.001_L.002_05',
         'Bone.001_L.003_06', 'Bone.001_L.004_07', 'Bone.001_L.005_08'],
        ['Bone.001_R_09', 'Bone.001_R.001_010', 'Bone.001_R.002_011',
         'Bone.001_R.003_012', 'Bone.001_R.004_013', 'Bone.001_R.005_014'],
    ], [
        (-7, 20, 1.3, 1.3, 0), (-4, 3.3, 1.8, 1.5, .34),
        (-4, 3.6, 2.5, 2.5, .58), (7, 4.0, 2.0, 2.6, .83),
        (4.5, 4.8, 1.1, 1.7, 1.01), (2, 3.4, .7, 1.2, 1.25),
    ], phase, power)
    stance = power * stroke(phase - .20)
    breath = math.sin(t * math.tau)
    pose['Bone_01'] = (1.4 * breath, 0, 18 + 1.8 * stance)
    pose['Bone.002_015'] = (0, 0, 17 + 1.6 * stance)
    pose['Bone.003_016'] = (0, 2.1 * breath, 7 + 1.2 * stance)
    pose['Bone.004_017'] = (0, 2.9 * math.sin(t * math.tau - .28), 5)
    pose['Bone.005_018'] = (0, 0, -5)
    # The source held the mandible wide open. It pivots from the same hinge
    # as the skull; preserve the upper outline and settle the lower beak.
    pose['Bone.006_019'] = (0, 0, -35.5 + .55 * breath - 1.2 * stance)
    pose['Bone.007_00'] = (0, 0, -24 - 1.2 * stance)
    for leg, ankle in [('Bone_L.001_021', 'Bone_L.003_023'),
                       ('Bone_R.001_026', 'Bone_R.003_028')]:
        pose[leg] = (0, 0, 13 + 1.1 * stance)
        pose[ankle] = (0, 0, 9 + .7 * math.sin(t * math.tau - .55))
    return pose, None


def meganeura(t):
    phase = math.tau * t
    beat = math.sin(8 * phase + .20 * math.sin(phase))
    envelope = .94 + .095 * math.sin(phase - .55)
    return {'Animal': (1.8 * math.sin(phase), .7 * math.sin(phase - .4), 2 * math.cos(phase))}, [
        .69 * envelope * max(0, beat),
        .36 + .75 * envelope * max(0, -beat),
    ]


def rhamphorhynchus(t):
    phase, power = flight_window(t, 3, .015, .66)
    beat = power * stroke(phase)
    glide = .04 + .022 * math.sin(t * math.tau)
    return {'Animal': (1.25 * math.sin(t * math.tau), 0, 2.3 * power * stroke(phase - .49))}, [
        glide + 1.00 * max(0, beat), 1.02 * max(0, -beat),
    ]


def tupandactylus(t):
    phase, power = flight_window(t, 2, .02, .53)
    beat = power * stroke(phase)
    return {'Animal': (.95 * math.sin(t * math.tau), 0, 1.7 * power * stroke(phase - .49))}, [
        .96 - .04 * power,
        .038 + .02 * math.sin(t * math.tau) + 1.00 * max(0, beat),
        .94 * max(0, -beat),
    ]


FLIGHTS = {
    'anurognathus': (.59, 36, anurognathus),
    'sordes': (3.85, 84, sordes),
    'archaeopteryx': (1.58, 64, archaeopteryx),
    'quetzalcoatlus': (6.40, 126, quetzalcoatlus),
    'meganeura': (.93, 144, meganeura),
    'rhamphorhynchus': (4.48, 108, rhamphorhynchus),
    'tupandactylus': (5.20, 108, tupandactylus),
}


def local_rotation(rest, parent_inverse, axes, values):
    for direction, angle in zip(axes, values):
        axis = (parent_inverse @ direction).normalized()
        rest = Quaternion(axis, math.radians(angle)) @ rest
    return rest.normalized()


def bake(species, definition, metadata):
    duration, samples, flight = definition
    basis = source_pose(species)
    fx, fz = metadata['forward']
    axes = [Vector((fx, 0, fz)), Vector((0, 1, 0)), Vector((fz, 0, -fx))]
    rotations = {}
    previous = {}
    morph = []
    for frame in range(samples + 1):
        pose, weights = flight((frame % samples) / samples)
        for name, values in pose.items():
            rest, parent = basis[name]
            q = local_rotation(rest, parent, axes, values)
            if name in previous and previous[name].dot(q) < 0:
                q.negate()
            previous[name] = q
            rotations.setdefault(name, []).extend(round(value, 6) for value in (q.x, q.y, q.z, q.w))
        if weights is not None:
            morph.extend(round(weight, 6) for weight in weights)
    for name, values in rotations.items():
        if all(value == values[i % 4] for i, value in enumerate(values)):
            rotations[name] = values[:4]
    return dict(seconds=duration, samples=samples, rotations=rotations, morph=morph)


def write():
    museum = json.loads((ROOT / 'museum/island-museum-models.lock.json').read_text())['animals']
    output = ROOT / 'museum/flight-motion'
    output.mkdir(exist_ok=True)
    for species, definition in FLIGHTS.items():
        clip = bake(species, definition, museum[species])
        track = json.dumps(clip, separators=(',', ':'), allow_nan=False)
        (output / f'{species}.js').write_text('export default ' + track + ';\n')


if __name__ == '__main__':
    write()
