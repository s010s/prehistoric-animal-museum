"""Verify deformation and phase on two oppositely turning runtime captures.

First run capture-poses.mjs DIR --anatomy --sequence tyrannosaurus-rex
twice, adding --reverse-turn to one run. Pass both directories to this script
using Python with NumPy. The route/terrain and world-space toe pad checks are
also exercised by ground-contact-contract.mjs --full-route tyrannosaurus-rex.
"""
import argparse
import json
from collections import defaultdict
from pathlib import Path

import numpy as np

ID = 'tyrannosaurus-rex'


def align_to_sacrum(points, rest):
    a, b = points.mean(0), rest.mean(0)
    u, _, v = np.linalg.svd((points-a).T @ (rest-b))
    rotation = u @ np.diag([1, 1, np.linalg.det(u@v)]) @ v
    return rotation, b-a@rotation


def included_angle(a, b):
    return np.degrees(np.arccos(np.clip(a@b / (np.linalg.norm(a)*np.linalg.norm(b)), -1, 1)))


def section(rest, sign, x, z):
    candidates = (abs(rest[:, 2]-z) < .026) & (abs(rest[:, 0]-x) < .13) & (rest[:, 1]*sign > .18)
    return candidates & (rest[:, 1]*sign >= np.quantile(rest[candidates, 1]*sign, .4))


def outside_skin(rest, triangles):
    # Duplicate vertices on the UV/open-component seams must coincide after
    # posing as well. These pairs are chosen on the visible reference mesh.
    pairs, groups = [], defaultdict(list)
    for i in np.flatnonzero((abs(rest[:, 0]-.09) < .23) & (rest[:, 2] > .44) & (rest[:, 2] < .74)):
        groups[tuple(np.round(rest[i], 5))].append(i)
    for group in groups.values():
        pairs.extend((group[0], other) for other in group[1:])
    assert len(pairs) > 55, 'Hip seam selection no longer represents the reference skin'
    edges = np.unique(
        np.sort(np.vstack([triangles[:, :2], triangles[:, 1:], triangles[:, [0, 2]]]), axis=1), axis=0)
    centers = rest[edges].mean(1)
    length = np.linalg.norm(rest[edges[:, 0]]-rest[edges[:, 1]], axis=1)
    choose = ((abs(centers[:, 0]-.09) < .20) & (centers[:, 2] > .44) & (centers[:, 2] < .74)
              & (abs(centers[:, 1]) > .19) & (length > .009))
    return np.array(pairs), edges[choose], length[choose]


def verify(folder):
    manifest = json.loads((folder/f'{ID}.json').read_text())

    def coords(name):
        return np.fromfile(folder/f'{ID}-{name}.bin', '<f4').reshape(-1, 3).astype(float)
    rest, scale = coords('Source'), manifest['scale']
    triangles = np.fromfile(folder/f'{ID}-topology.bin', '<u4').reshape(-1, 3)
    dorsal = (abs(rest[:, 0]+.035) < .195) & (rest[:, 2] > .825) & (rest[:, 2] < 1.055)
    seam, edges, lengths = outside_skin(rest, triangles)
    markers = [[section(rest, sign, x, z) for x, z in [(.16, .70), (.15, .60), (.13, .50)]]
               for sign in [1, -1]]
    distal = [((rest[:, 2] < .39) & (rest[:, 1]*sign > .035)) for sign in [1, -1]]
    frame_rows = [f for f in manifest['frames'] if f['name'].startswith('Step ')]
    assert len(frame_rows) >= 150
    tracks = [[], []]
    gap, stretch, compression, separation = 0, 1, 1, np.inf
    max_bone_error = 0
    reference_lengths = [None, None]
    for frame in frame_rows:
        tick = int(frame['name'][5:])
        p = coords(frame['name'])
        rotation, shift = align_to_sacrum(p[dorsal], rest[dorsal])
        points = p@rotation+shift
        gap = max(gap, np.linalg.norm(points[seam[:, 0]]-points[seam[:, 1]], axis=1).max()*scale)
        strain = np.linalg.norm(points[edges[:, 0]]-points[edges[:, 1]], axis=1)/lengths
        low, high = np.quantile(strain, [.01, .99])
        stretch, compression = max(stretch, high), min(compression, low)
        separation = min(separation, (points[distal[0], 1].min()-points[distal[1], 1].max())*scale)
        for i, side in enumerate(['left', 'right']):
            joints = np.array([frame['joints'][f'Museum hind {side} {j}']
                              for j in ['hip', 'knee', 'ankle', 'toes']])
            h, k, a, t = joints@rotation+shift
            bone_lengths = np.linalg.norm(np.diff(joints, axis=0), axis=1)
            if reference_lengths[i] is None:
                reference_lengths[i] = bone_lengths
            max_bone_error = max(max_bone_error, np.max(abs(bone_lengths-reference_lengths[i]))*scale)
            upper, middle, end = [points[m].mean(0) for m in markers[i]]
            def angle(d): return np.degrees(np.arctan2(d[0], -d[2]))
            foot = frame['contacts'][i]
            u = (frame['phase']-i*.5) % 1
            tracks[i].append([tick, u, foot['planted'], foot['swing'], angle(k-h), angle(end-upper),
                              upper[0]*scale, middle[0]*scale, (k[0]-h[0])*scale,
                              included_angle(h-k, a-k), angle(t-a), included_angle(k-a, t-a)])
    # Engineering limits on this 12 m exhibit, tested against its broken
    # preceding rig. They are not proposed extinct-animal measurements.
    assert gap < .002 and max_bone_error < .0001, f'Open hip seam or changing bone length: {gap}, {max_bone_error}'
    assert compression > .60 and stretch < 1.85, f'Folding or stretched thigh triangles: {compression}, {stretch}'
    assert separation > .02, f'Opposite shanks cross the same lane: {separation}'
    summaries = []
    for rows in map(np.array, tracks):
        steady = rows[(rows[:, 0] >= 75) & (rows[:, 0] <= 216)]
        moving = rows[(rows[:, 0] >= 60) & (rows[:, 0] <= 324)]
        thigh, skin = steady[:, 4], steady[:, 5]
        flex, extend = thigh.max(), thigh.min()
        correlation = np.corrcoef(thigh, skin)[0, 1]
        travels = np.ptp(steady[:, 6:8], axis=0)
        assert flex > 16 and extend < 3 and np.ptp(thigh) > 23, 'Femur fails to protract and retract'
        assert correlation > .90 and .70 < np.ptp(skin)/np.ptp(thigh) < 1.22, 'Skin lags or slips up the femur'
        assert travels[0] > .24 and travels[1] > .38 and travels[
            1] > travels[0], f'Stationary upper thigh: {travels}'
        stance = moving[moving[:, 2] == 1]
        early, late = stance[(stance[:, 1] > .33) & (stance[:, 1] < .47)], stance[stance[:, 1] > .86]
        assert np.median(early[:, 4]) - np.median(late[:, 4]) > 12, 'Bearing femur failed to retract'
        airborne = moving[moving[:, 2] == 0]
        folded = airborne[(airborne[:, 3] > .30) & (airborne[:, 3] < .65)]
        approach = airborne[airborne[:, 3] > .78]
        assert np.median(approach[:, 9]) - np.median(folded[:, 9]
                                                     ) > 10, 'True knee fails to unfold before landing'
        assert np.ptp(steady[:, 10]) > 18 and np.ptp(steady[:, 11]) > 8, 'Hock/metatarsus locked to the toes'
        turn = rows[(rows[:, 0] >= 218) & (rows[:, 0] <= 318)]
        assert np.ptp(turn[:, 4]) > 17 and np.ptp(turn[:, 6]) > .11 and np.all(
            rows[-3:, 2]), 'Turn or stop lost limb performance'
        assert np.max(abs(np.diff(rows[:, 4]))) < 23, 'Hip snaps at launch, turn or stop'
        summaries.append(dict(femur_deg=[round(extend, 2), round(flex, 2)], skin_arc_deg=round(np.ptp(skin), 2),
                              thigh_excursion_m=np.round(travels, 3).tolist(), skin_correlation=round(correlation, 3),
                              knee_deg=np.round([steady[:, 9].min(), steady[:, 9].max()], 2).tolist()))
    heading = max(frame_rows, key=lambda f: abs(f['heading']))['heading']
    print(json.dumps(dict(heading_deg=round(np.degrees(heading), 2), sides=summaries, hip_seam_m=round(gap, 6),
                          edge_1st_and_99th=np.round([compression, stretch], 3).tolist(), shank_clearance_m=round(separation, 3))))
    return heading


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('captures', nargs=2, type=Path)
    headings = [verify(folder) for folder in parser.parse_args().captures]
    assert min(headings) < -.3 and max(headings) > .3, 'Need both turn directions'
