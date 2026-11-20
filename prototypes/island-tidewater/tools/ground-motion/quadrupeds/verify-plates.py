"""Check that all 17 Stegosaurus plates meet the body in actual solved skin samples.

node tools/ground-motion/capture-poses.mjs /tmp/ground-review stegosaurus
blender -b --python-exit-code 1 --python tools/ground-motion/quadrupeds/verify-plates.py -- /tmp/ground-review
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from mathutils.bvhtree import BVHTree


def connected_surfaces(points, triangles):
    links = list(range(len(points)))

    def representative(i):
        while links[i] != i:
            links[i] = links[links[i]]
            i = links[i]
        return i

    def merge(a, b):
        links[representative(a)] = representative(b)

    seams = {}
    for i, p in enumerate(points):
        seam = tuple(np.rint(p * 10000).astype(int))
        if seam in seams:
            merge(i, seams[seam])
        else:
            seams[seam] = i
    for a, b, c in triangles:
        merge(a, b)
        merge(b, c)
    groups = defaultdict(list)
    for i in range(len(points)):
        groups[representative(i)].append(i)
    faces = defaultdict(list)
    for triangle in triangles:
        faces[representative(triangle[0])].append(triangle)
    result = []
    for root, vertices in groups.items():
        local = {v: i for i, v in enumerate(vertices)}
        result.append((vertices, [[local[v] for v in triangle] for triangle in faces[root]]))
    return sorted(result, key=lambda group: len(group[0]), reverse=True)


def main(root):
    def vertices(label):
        return np.fromfile(root / f'stegosaurus-{label}.bin', dtype='<f4').reshape(-1, 3)

    triangles = np.fromfile(root / 'stegosaurus-topology.bin', dtype='<i4').reshape(-1, 3)
    reference = vertices('Source')
    body, *parts = connected_surfaces(reference, triangles)
    plates = []
    for part in parts:
        # Plates have a thin transverse section. The other islands in this
        # sculpt are two eyes and the four outward-facing terminal spikes.
        length, breadth, height = np.ptp(reference[part[0]], axis=0)
        if breadth < height * .60 and breadth < length:
            plates.append(part)
    assert len(plates) == 17, f'Expected 17 plate shells, found {len(plates)}'
    frames = json.loads((root / 'stegosaurus.json').read_text())['frames']
    for frame in frames:
        points = vertices(frame['name'])

        def tree(part):
            indices, faces = part
            return BVHTree.FromPolygons(points[indices].tolist(), faces, all_triangles=True)

        trunk = tree(body)
        for i, plate in enumerate(plates):
            if not trunk.overlap(tree(plate)):
                raise ValueError(f"Plate {i+1} lost contact with the back at {frame['name']}")
    print(f'{len(plates)} plate roots intersected the body in all {len(frames)} native mesh samples.')


if __name__ == '__main__':
    main(Path(sys.argv[sys.argv.index('--') + 1]))
