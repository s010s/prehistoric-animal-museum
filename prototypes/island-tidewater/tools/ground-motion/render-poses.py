"""Render native skin samples from capture-poses.mjs, two views per phase.

  blender -b --factory-startup -t 4 --python-exit-code 1 \
    --python tools/ground-motion/render-poses.py -- /tmp/gait-review [specimen ...]
"""

import json
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector


def mesh_at(scene, offset, transform, indices, points, material, name):
    mesh = bpy.data.meshes.new(name)
    mesh.vertices.add(len(points))
    mesh.vertices.foreach_set('co', np.ravel(points @ transform + offset).astype(np.float32))
    mesh.loops.add(len(indices))
    mesh.loops.foreach_set('vertex_index', indices)
    triangles = len(indices) // 3
    mesh.polygons.add(triangles)
    mesh.polygons.foreach_set('loop_start', np.arange(0, len(indices), 3, dtype=np.int32))
    mesh.polygons.foreach_set('use_smooth', np.ones(triangles, dtype=bool))
    mesh.update(calc_edges=True)
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    obj.data.materials.append(material)


def label_at(scene, offset, name, material):
    label = bpy.data.curves.new(name, 'FONT')
    label.body = name
    label.size = .06
    label.align_x = 'CENTER'
    obj = bpy.data.objects.new(name, label)
    scene.collection.objects.link(obj)
    obj.location = offset
    obj.data.materials.append(material)


def render(manifest_path):
    info = json.loads(manifest_path.read_text())
    id = info['id']
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.view_settings.view_transform = 'Standard'
    scene.world = bpy.data.worlds.new('Review')
    scene.world.color = (.035, .035, .035)
    shading = scene.display.shading
    shading.light = 'STUDIO'
    shading.color_type = 'MATERIAL'
    shading.show_cavity = True
    shading.cavity_type = 'BOTH'
    shading.show_shadows = False
    shading.show_specular_highlight = False
    shading.background_type = 'WORLD'
    clay = bpy.data.materials.new('Clay')
    clay.diffuse_color = (.79, .68, .56, 1)
    white = bpy.data.materials.new('Label')
    white.diffuse_color = (.89, .89, .89, 1)

    def read(name, dtype):
        return np.fromfile(manifest_path.with_name(f'{id}-{name}.bin'), dtype=dtype)

    indices = read('topology', '<i4')
    source = read('Source', '<f4').reshape((-1, 3))
    low, high = source.min(0), source.max(0)
    center = (low + high) * .5
    width = (high - low).max()
    frames = info['frames']
    columns = 4
    rows = (len(frames) + columns - 1) // columns
    for i, frame in enumerate(frames):
        name = frame['name']
        stance = ' '.join('o' if planted else '^' for planted in frame['planted'])
        points = (read(name, '<f4').reshape((-1, 3)) - center) / width
        column, row = i % columns, i // columns
        for side, direction in enumerate(((0, -1, .065), (-1, -.70, .35))):
            orientation = (-Vector(direction)).to_track_quat('-Z', 'Y').inverted()
            transform = np.array(orientation.to_matrix()).T
            offset = np.array([(column * 2 + side - 3.5) * 1.19, ((rows - 1) / 2 - row) * .88, 0])
            mesh_at(scene, offset, transform, indices, points, clay, name + str(side))
            label_at(scene, offset + (0, -.385, 0), f'{name}    {stance}', white)

    camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.location = (0, 0, 10)
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = columns * 2 * 1.19
    scene.render.resolution_x = columns * 2 * 245
    scene.render.resolution_y = rows * 180
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = str(manifest_path.with_suffix('.png'))
    bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    directory, *species = sys.argv[sys.argv.index('--') + 1:]
    root = Path(directory)
    for path in (root / f'{id}.json' for id in species) if species else sorted(root.glob('*.json')):
        render(path)
