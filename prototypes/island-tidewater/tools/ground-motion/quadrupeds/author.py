"""Bake a distance-sampled gait on each displayed museum mesh and its actual joints.

node tools/ground-motion/quadrupeds/export-skins.mjs /tmp/quad-skins
blender -b -t 2 --python-exit-code 1 --python tools/ground-motion/quadrupeds/author.py -- /tmp/quad-skins
Add --blend-dir /tmp/quad-actions to retain the editable skin, FK and solved leg keys.
"""
import argparse
import base64
import json
import math
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

DIRECTORY = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(DIRECTORY))
from profiles import PROFILES, RIGS

SAMPLES = 32
UP = Vector((0, 0, 1))
TAU = 2 * math.pi


def create_armature(data):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    armature = bpy.data.armatures.new(data['id'])
    obj = bpy.data.objects.new(data['id'], armature)
    scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    nodes = data['nodes']
    bone_names = []
    leg_children = {parent: child for chain in data['legs'] for parent, child in zip(chain, chain[1:])}
    by_name = {node['name']: node for node in nodes}
    for node in nodes:
        bone = armature.edit_bones.new(node['name'])
        bone_names.append(bone.name)
        p = Vector(node['p'])
        children = [nodes[i] for i in node['children']]
        if node['name'] in leg_children:
            children.insert(0, by_name[leg_children[node['name']]])
        end = next((Vector(child['p']) for child in children if (Vector(child['p']) - p).length > .0001), p + UP * .05)
        bone.head, bone.tail = p, end
    for i, node in enumerate(nodes):
        for child in node['children']:
            armature.edit_bones[bone_names[child]].parent = armature.edit_bones[bone_names[i]]
    bpy.ops.object.mode_set(mode='OBJECT')

    mesh = bpy.data.meshes.new('Displayed neutral mesh')
    mesh.from_pydata(data['vertices'], [], data['faces'])
    mesh.update()
    skin = bpy.data.objects.new('Museum skin', mesh)
    scene.collection.objects.link(skin)
    groups = {}
    for v, links in enumerate(data['weights']):
        for joint, weight in links:
            if joint not in groups:
                groups[joint] = skin.vertex_groups.new(name=bone_names[joint])
            groups[joint].add([v], weight, 'REPLACE')
    modifier = skin.modifiers.new('Museum bone weights', 'ARMATURE')
    modifier.object = obj
    skin.parent = obj
    scene.render.fps = 24
    scene.frame_start, scene.frame_end = 0, SAMPLES - 1
    return obj


def canonical_motion(pb, rotation_deg=(0, 0, 0), translation=(0, 0, 0), pivot=None):
    """Write a rest-relative movement in anatomically aligned model axes."""
    axes = pb.bone.matrix_local.to_quaternion()
    rotation = Euler(tuple(math.radians(n) for n in rotation_deg)).to_quaternion()
    delta = Vector(translation)
    if pivot is not None:
        offset = pb.bone.head_local - pivot
        delta += rotation @ offset - offset
    pb.rotation_mode = 'QUATERNION'
    pb.rotation_quaternion = axes.inverted() @ rotation @ axes
    pb.location = axes.inverted() @ delta


def keyed(pb, frame):
    pb.keyframe_insert(data_path='rotation_quaternion', frame=frame, group=pb.name)
    pb.keyframe_insert(data_path='location', frame=frame, group=pb.name)


def smooth(x):
    return x*x*(3-2*x)


def foot_path(t, stride, lift, fore):
    # Heel peels first, the limb folds during passing, then extends and eases
    # onto the next support. The planted section moves back at travel speed.
    duty = .745 if not fore else .705
    swing = 1 - duty
    if t >= swing:
        return stride * (duty*.5 - (t-swing)), 0, 0
    u = t/swing
    return (stride * (smooth(u) - swing*u - duty*.5),
            lift * math.sin(math.pi*u)**1.45,
            math.sin(TAU*u)*math.sin(math.pi*u))


def rotate_about(pb, old_direction, new_direction):
    if not old_direction.length_squared or not new_direction.length_squared:
        return
    rotation = old_direction.rotation_difference(new_direction)
    p = pb.matrix.translation
    pb.matrix = Matrix.Translation(p) @ rotation.to_matrix().to_4x4() @ Matrix.Translation(-p) @ pb.matrix


def solve_leg(obj, chain, target, pole, rocker, frame):
    upper, lower, foot = [obj.pose.bones[k] for k in chain]
    update = bpy.context.view_layer.update
    hip, knee, ankle = [bone.head.copy() for bone in (upper, lower, foot)]
    a, b = (knee-hip).length, (ankle-knee).length
    axis = (target-hip).normalized()
    distance = min(a+b-.001*(a+b), max(abs(a-b)+.001*(a+b), (target-hip).length))
    along = (a*a + distance*distance - b*b)/(2*distance)
    bend = (pole - axis*axis.dot(pole)).normalized()
    new_knee = axis*along + bend*math.sqrt(max(0, a*a-along*along))
    rotate_about(upper, knee-hip, new_knee)
    update()
    rotate_about(lower, foot.head-lower.head, hip+axis*distance-lower.head)
    update()
    angle = Quaternion(Vector((0,1,0)), rocker)
    foot.matrix = Matrix.LocRotScale(foot.head.copy(), angle @ foot.bone.matrix_local.to_quaternion(), Vector((1,1,1)))
    for bone in (upper, lower, foot):
        keyed(bone, frame)


def make_action(data):
    obj = create_armature(data)
    id = data['id']
    profile = PROFILES[id]
    spine, neck, tail, girdles = RIGS[id]
    legs = data['legs']
    girdles = [girdles[i] if girdles and girdles[i] else leg[0] for i,leg in enumerate(legs)]
    bones = obj.pose.bones
    triples = [[bones[name].bone.head_local.copy() for name in chain] for chain in legs]
    hips = [p[0] for p in triples]
    center = sum(hips, Vector()) / 4
    height = min((hip-knee).length + (knee-foot).length for hip,knee,foot in triples)
    sides = [1 if hip.y > (hips[i//2*2].y+hips[i//2*2+1].y)*.5 else -1 for i,hip in enumerate(hips)]
    neutral_poles = []
    for hip,knee,foot in triples:
        axis = (foot-hip).normalized()
        neutral_poles.append(((knee-hip) - axis*axis.dot(knee-hip)).normalized())
    root = data['rootName']
    axes = {root:'rt', **dict.fromkeys(spine+neck+tail,'r')}
    for i, name in enumerate(girdles):
        axes[name] = 't' if name == legs[i][0] else 'rt'
    # Key once before/after the seam so handles see a continuous cycle.
    for frame in range(-2, SAMPLES+3, 2):
        phase = frame/SAMPLES
        for leg in legs:
            for name in leg:
                bones[name].matrix_basis = Matrix.Identity(4)
        p = TAU * (phase-.12)
        # Weight is already crossing before liftoff; vertical loading follows
        # the contacts twice each cycle, the pelvis advances over support.
        wave = math.cos(p)
        change = math.sin(p)
        load = math.cos(2*p-.46)
        transfer = math.sin(2*p-.18)
        sway, heave, surge, roll, yaw = profile.load
        # Phase zero lifts the negative-lateral hind foot. Several imported
        # rigs name their positives L, so the runtime and this action both
        # infer left and right from the displayed hip positions.
        side = -1
        canonical_motion(bones[root], (side*wave*roll, load*.94, -side*change*yaw),
                         (height*surge*transfer, -side*height*sway*wave, -height*heave*load), center)
        for i, name in enumerate(spine):
            factor = (1.0 if len(spine)==1 else (i+1)/sum(range(1,len(spine)+1)))
            angle = TAU*(phase-.14-.035*i)
            canonical_motion(bones[name], (-side*roll*.53*math.cos(angle)*factor,
                -.8*math.cos(2*angle)*factor, side*profile.spine*math.sin(angle)*factor))
        for i, name in enumerate(neck):
            # A proximal recoil and distal counterrotation keep the muzzle
            # steadier than the shoulder while retaining a visible nod.
            factor = (1 if len(neck)==1 else (.62 if i==0 else .38/(len(neck)-1)))
            at = TAU*(phase-.13-profile.delay*i/max(1,len(neck)-1)*.36)
            canonical_motion(bones[name], (-side*roll*.44*math.cos(at)*factor,
                profile.head*math.cos(2*at-.74)*factor,
                -side*profile.spine*.57*math.sin(at)*factor))
        for i, name in enumerate(tail):
            u = i/max(1,len(tail)-1)
            at = TAU*(phase-.17-profile.delay*u)
            # The heavy tail inherits the pelvis and counterbalances in a
            # delayed arc along the joints, with modest vertical compliance.
            factor = (1.28-.56*u)/len(tail)
            canonical_motion(bones[name], (0, .24*profile.tail*math.cos(2*at)*factor,
                side*profile.tail*math.sin(at)*factor))
        targets=[]
        for i, (chain, socket, triple) in enumerate(zip(legs,girdles,triples)):
            fore = i < 2
            liftoff = (.25 if fore else 0) + (.50 if sides[i] > 0 else 0)
            t = (phase - liftoff) % 1
            lane = 0 if fore else 1
            travel, clearance, rock = foot_path(t, profile.stride * height, profile.lift[lane] * height, fore)
            foot_swing = .295 if fore else .255
            airborne = math.sin(math.pi*t/foot_swing) if t<foot_swing else 0
            support = math.sin(math.pi*(t-foot_swing)/(1-foot_swing)) if t>=foot_swing else 0
            amplitude = profile.socket[lane]
            canonical_motion(bones[socket], (0, 0, 0) if socket==chain[0] else
                (sides[i]*airborne*1.2, -2.2*math.cos(TAU*(t-.25)), 0),
                (amplitude*height*math.sin(TAU*(t-.105)), sides[i]*height*.010*airborne,
                 height*amplitude*(.45*airborne-.25*support)))
            target = triple[2] + Vector((travel, sides[i]*height*profile.splay*.15*airborne, clearance))
            pole = neutral_poles[i].copy()
            pole.y += sides[i]*profile.splay*(airborne-.25*support)
            # A forward knee and rearward elbow have room to fold clear of
            # the opposite leg. Respect splayed or reversed source anatomy.
            pole.x += (.12 if not fore else -.10) * airborne
            targets.append((target,pole,rock*.20))
        for name in axes:
            keyed(bones[name],frame)
        bpy.context.view_layer.update()
        for chain,(target,pole,rock) in zip(legs,targets):
            solve_leg(obj,chain,target,pole,rock,frame)
    action = obj.animation_data.action
    action.name = id + ' · weight transfer and walk'
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for curve in bag.fcurves:
                    for key in curve.keyframe_points:
                        key.handle_left_type = key.handle_right_type = 'AUTO_CLAMPED'
                    curve.update()
    return obj, axes, height


def packed(rows):
    shorts = []
    for row in rows:
        for value in row:
            if abs(value) > 1.0001:
                raise ValueError(f'Encoded action channel overflows: {value}')
            shorts.append(round(min(1, max(-1, value)) * 32767))
    return base64.b64encode(struct.pack(f'<{len(shorts)}h', *shorts)).decode()


def bake(data, blend_dir):
    obj, tracks, height = make_action(data)
    samples = {name: [] for name in tracks}
    poles = [[] for _ in data['legs']]
    hips = [obj.pose.bones[leg[0]].bone.head_local for leg in data['legs']]
    center = sum(hips, Vector()) / 4
    root = obj.pose.bones[data['rootName']]
    for frame in range(SAMPLES):
        bpy.context.scene.frame_set(frame)
        if frame in (0, SAMPLES // 2):
            # At hind-foot liftoff the pelvis is already moving over the
            # opposite planted side. Source L/R names are not consistent.
            shift = (root.matrix @ root.bone.matrix_local.inverted() @ center - center).y
            support = 1 if frame == 0 else -1
            assert support * shift > height * .01, data['id'] + ' failed lateral support transfer'
        if frame % (SAMPLES // 4) == SAMPLES // 8:
            beat = frame // (SAMPLES // 4)
            leg_pair = (2, 3) if beat % 2 == 0 else (0, 1)
            limb = (min if beat < 2 else max)(leg_pair, key=lambda i: hips[i].y)
            foot = obj.pose.bones[data['legs'][limb][2]]
            assert foot.head.z - foot.bone.head_local.z > height * .03, data['id'] + ' failed swing clearance'
        for name, flags in tracks.items():
            bone = obj.pose.bones[name]
            rest = bone.bone.matrix_local.to_quaternion()
            values = []
            if 'r' in flags:
                rotation = rest @ bone.rotation_quaternion @ rest.inverted()
                rotation.normalize()
                if rotation.w < 0:
                    rotation.negate()
                axis, angle = rotation.to_axis_angle()
                values.extend(axis * angle)
            if 't' in flags:
                values.extend((rest @ bone.location) / height)
            samples[name].append(values)
        for i, chain in enumerate(data['legs']):
            hip, knee, ankle = [obj.pose.bones[name].head for name in chain]
            axis = (ankle - hip).normalized()
            thigh = knee - hip
            poles[i].append((thigh - axis * axis.dot(thigh)).normalized())
    if blend_dir:
        blend_dir.mkdir(parents=True, exist_ok=True)
        bpy.context.scene.frame_set(0)
        bpy.ops.wm.save_as_mainfile(filepath=str(blend_dir / (data['id'] + '.blend')))
    return {
        'samples': SAMPLES,
        'height': round(height, 8),
        'tracks': [[name, flags, packed(samples[name])] for name, flags in tracks.items()],
        'poles': [packed(track) for track in poles],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('skins', type=Path)
    parser.add_argument('--blend-dir', type=Path)
    parser.add_argument('--output', type=Path, default=DIRECTORY.parents[2] / 'museum' / 'QuadrupedActions.js')
    options = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    source = [
        '// Generated from mesh-bound Blender armatures by tools/ground-motion/quadrupeds/author.py.',
        'export const quadrupedActions = {',
    ]
    for species in PROFILES:
        skin = json.loads((options.skins / (species + '.json')).read_text())
        action = bake(skin, options.blend_dir)
        encoded = json.dumps(action, ensure_ascii=False, separators=(',', ':'))
        source.append(f'  {species}: {encoded},')
        print('Baked ' + species, flush=True)
    options.output.write_text('\n'.join(source + ['};', '']))


if __name__ == '__main__':
    main()
