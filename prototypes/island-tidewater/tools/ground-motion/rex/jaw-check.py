"""Check the actual opposing teeth and soft tissues in native runtime captures.

Run under Blender after capture-poses.mjs DIR --sequence --anatomy tyrannosaurus-rex.
The optional --measure flag reports the prior appearance without applying the
new aperture limits. Supply two directories to check both turn directions.
"""
import argparse
import gzip
import json
import struct
import sys
from pathlib import Path

import numpy as np
from mathutils.bvhtree import BVHTree


ID = 'tyrannosaurus-rex'
ASSET = Path(__file__).resolve().parents[3]/'museum'/'assets'/'island'/f'{ID}.glb.gz'


def bind_landmarks(asset):
    raw = gzip.decompress(asset.read_bytes())
    end = 20 + struct.unpack_from('<I', raw, 12)[0]
    document = json.loads(raw[20:end])
    payload = memoryview(raw)[end+8:]

    def array(index):
        acc = document['accessors'][index]
        view = document['bufferViews'][acc['bufferView']]
        dtype = np.dtype({5121: 'u1', 5123: '<u2', 5125: '<u4', 5126: '<f4'}[acc['componentType']])
        n = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[acc['type']]
        return np.ndarray((acc['count'], n), dtype=dtype, buffer=payload,
                          offset=view.get('byteOffset', 0) + acc.get('byteOffset', 0),
                          strides=(view.get('byteStride', n*dtype.itemsize), dtype.itemsize))

    primitive = document['meshes'][0]['primitives'][0]
    attributes = primitive['attributes']
    skin = document['skins'][0]
    names = [document['nodes'][i]['name'] for i in skin['joints']]
    root = names.index('root')
    matrix = array(skin['inverseBindMatrices'])[root].reshape(4, 4).T
    raw_positions = array(attributes['POSITION'])
    points = raw_positions @ matrix[:3, :3].T + matrix[:3, 3]
    points += np.array(document['nodes'][skin['joints'][root]]['translation'])
    # Use the original modeling pose, even when the island's neutral bite is
    # changed. The same tooth islands and the same 74 lip vertices are tracked.
    forward, height = points[:, 2], points[:, 1]
    weight = (array(attributes['WEIGHTS_0']) * (array(attributes['JOINTS_0']) == names.index('jaw'))).sum(1)
    triangles = array(primitive['indices']).reshape(-1, 3)
    parent = list(range(len(points)))

    def root_of(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for a, b, c in triangles:
        parent[root_of(a)] = root_of(b)
        parent[root_of(b)] = root_of(c)
    labels = np.array([root_of(i) for i in range(len(points))])
    parts, sizes = np.unique(labels, return_counts=True)
    body = parts[np.argmax(sizes)]
    upper, lower = [], []
    for part in parts:
        section = labels == part
        if np.sum(section) < 5 or forward[section].min() < 1.25 or height[section].max() > .945:
            continue
        if weight[section].min() > .98:
            lower.append(part)
        if weight[section].max() < .02:
            upper.append(part)
    tongue, = parts[(sizes == 725)]
    lining, = parts[(sizes == 549)]
    fraction = weight[triangles]
    triangle_part = labels[triangles[:, 0]]
    oral = np.isin(triangle_part, [body, lining]) & (forward[triangles].min(1) > 1.20)
    surfaces = [np.isin(triangle_part, upper), np.isin(triangle_part, lower),
                oral & (fraction.max(1) < .14), oral & (fraction.min(1) > .86), triangle_part == tongue]
    compact = []
    for surface in surfaces:
        index, local = np.unique(triangles[surface], return_inverse=True)
        compact.append((index, local.reshape(-1, 3).tolist()))
    front_lip = (labels == body) & (weight > .98) & (forward > 1.405) & (height > .687)
    if (len(upper), len(lower), front_lip.sum()) != (40, 36, 74):
        raise ValueError('The dental landmarks no longer match this mesh')
    return compact, front_lip


def check(directory, compact, lip, measure_only):
    manifest = json.loads((directory/f'{ID}.json').read_text())
    gaps, collisions = [], []
    for frame in manifest['frames']:
        tag = frame['name']
        if not tag.startswith('Step '):
            continue
        tick = int(tag[5:])
        points = np.fromfile(directory/f'{ID}-{tag}.bin', '<f4').reshape(-1, 3)
        up, low, palate, dentary, tongue = [
            BVHTree.FromPolygons(points[index].tolist(), faces, all_triangles=True)
            for index, faces in compact]
        collisions.append([len(a.overlap(b)) for a, b in
                           [(low, up), (low, palate), (up, dentary), (tongue, palate)]])
        distances = [palate.find_nearest(p)[3]*manifest['scale'] for p in points[:len(lip)][lip].tolist()]
        gaps.append([tick, *np.percentile(distances, [5, 50])])
    gaps = np.array(gaps)
    cruise = gaps[(gaps[:, 0] >= 75) & (gaps[:, 0] <= 318), 2]
    resting = gaps[gaps[:, 0] >= 360, 2]
    overlaps = np.max(collisions, axis=0)
    print(directory, 'dental and tongue intersections', overlaps.tolist(),
          'cruise lip-to-maxilla median m', np.round([cruise.min(), cruise.max()], 4).tolist(),
          'observation median m', np.round([resting.min(), resting.max()], 4).tolist())
    if not measure_only:
        assert len(gaps) > 145 and not np.any(overlaps), 'Opposing teeth, tongue, or muzzle intersect'
        assert .02 < cruise.min() and cruise.max() < .090, 'Sustained open or collapsed patrol bite'
        assert .012 < resting.max()-cruise.min() < .075, 'Observation jaw excursion outside the quiet range'


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('captures', nargs='+', type=Path)
parser.add_argument('--measure', action='store_true')
options = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
parts, landmarks = bind_landmarks(ASSET)
for directory in options.captures:
    check(directory, parts, landmarks, options.measure)
