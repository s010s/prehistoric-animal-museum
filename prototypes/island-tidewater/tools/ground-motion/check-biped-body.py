"""Check continuous rendered-skin trajectories in the pelvis frame.

Inputs come from export-biped-blender.mjs and capture-poses.mjs --sequence.
Run with Blender's bundled Python (NumPy). Positions include the source morphs,
the actual summed skin matrices and the grounded feet.
"""
import json
import sys
from pathlib import Path

import numpy as np


def sample_near(points, at, count):
    distance = np.sum((points - at)**2, axis=1)
    return np.argpartition(distance, count)[:count]


def verify(bind, directory, id):
    data = json.loads((bind / (id + '.json')).read_text())
    bones, anatomy = data['bones'], data['anatomy']
    ids = {node['name']: i for i, node in enumerate(bones)}

    def frame(tag):
        return np.fromfile(directory / (id + '-' + tag + '.bin'), '<f4').reshape(-1, 3)

    reference = frame('Source')
    # Select a stable patch above the hip, away from the knees, instead of
    # counting root translation as hand, skull or tail movement.
    name = next((name for name in ['Museum hind left hip', 'L_Upper', 'Bone.018.L', 'Femur.L_054',
                'UpperLeg.L_060', '骨骼.014', 'lThigh_056_63_81'] if name in ids), None)
    if not name:
        raise ValueError('Missing hip for ' + id)
    hip = np.array(bones[ids[name]]['pivot'])
    baseline = np.fromfile(bind / (id + '-positions.bin'), '<f4').reshape(-1, 3)
    # Capture normalizes the floor height; the authoring file retains model Y.
    hip += np.median(reference - baseline, axis=0)
    length = np.ptp(reference[:, 0])
    pelvis = sample_near(reference, hip + [0, 0, length*.045], 640)
    home = reference[pelvis].mean(0)
    counts = np.fromfile(bind / (id + '-counts.bin'), 'B')
    links = np.fromfile(bind / (id + '-links.bin'), '<u2').reshape(-1, 2)
    vertices = np.repeat(np.arange(len(reference)), counts)
    groups = {}
    for group, owner in [('head', anatomy['head']), ('left hand', anatomy['left'][-1]),
                         ('right hand', anatomy['right'][-1]), ('tail', anatomy['tail'][-1])]:
        children = {owner}
        if owner.startswith('IdleClaw'):
            children.update(n['name'] for n in bones if n['name'].startswith(owner[:10]))
        for i in range(len(bones)):
            node = bones[i]
            while node['parent'] >= 0:
                node = bones[node['parent']]
                if node['name'] in children:
                    children.add(bones[i]['name'])
                    break
        take = np.isin(links[:, 0], [ids[n] for n in children])
        weights = np.bincount(vertices[take], weights=links[take, 1], minlength=len(reference))
        # Folded phorusrhacos wings deliberately share most of the skin
        # with the ribcage. Follow their strongest weighted patch.
        candidates = np.flatnonzero(weights > max(65535 * .10, weights.max() * .55))
        if len(candidates) < 3:
            raise ValueError('Missing weighted ' + id + ' ' + group)
        # Distal vertices make an angular swing visible even when the joint
        # pivot is fixed. Follow the same actual vertices in every frame.
        pivot = np.array(bones[ids[owner]]['pivot']) + np.median(reference - baseline, axis=0)
        distance = np.sum((reference[candidates] - pivot)**2, axis=1)
        groups[group] = candidates[distance >= np.quantile(distance, .75)][::3]
    tracks = {name: [] for name in groups}
    for tick in range(75, 217, 3):
        points = frame('Step ' + str(tick).zfill(3))
        if not np.isfinite(points).all():
            raise ValueError('Nonfinite motion in ' + id)
        center = points[pelvis].mean(0)
        u, _, vt = np.linalg.svd((points[pelvis]-center).T @ (reference[pelvis]-home))
        rotation = u @ np.diag([1, 1, np.linalg.det(u@vt)]) @ vt
        for label, members in groups.items():
            tracks[label].append((points[members].mean(0)-center) @ rotation)
    print(id, end='')
    for label, values in tracks.items():
        travel = np.linalg.norm(np.ptp(values, axis=0))/length
        if not .00025 < travel < .30:
            raise ValueError(f'{id} {label} travel {travel:.5f} of body length')
        print(f'  {label} {travel*100:.2f}%', end='')
    print()


if __name__ == '__main__':
    bind, directory, *requested = sys.argv[1:]
    samples = Path(directory)
    for id in requested or sorted(p.stem for p in samples.glob('*.json')):
        verify(Path(bind), samples, id)
