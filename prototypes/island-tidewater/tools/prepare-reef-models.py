"""From Blender's background CLI, pass -- followed by the pinned Vault checkout."""
import hashlib
import json
import math
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import bmesh
import bpy


def digest(data):
    return hashlib.sha256(data).hexdigest()


def prepare_model(source, destination, kind, scratch):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 1
    bpy.ops.import_scene.gltf(filepath=str(source))
    original, = [obj for obj in scene.objects if obj.type == 'MESH']
    for material in original.data.materials:
        tree = material.node_tree
        shader = next(n for n in tree.nodes if n.type == 'BSDF_PRINCIPLED')
        pigment = shader.inputs['Base Color'].links[0].from_socket
        emission = tree.nodes.new('ShaderNodeEmission')
        tree.links.new(pigment, emission.inputs['Color'])
        output = next(n for n in tree.nodes if n.type == 'OUTPUT_MATERIAL')
        tree.links.new(emission.outputs[0], output.inputs['Surface'])

    model = original.copy()
    model.data = original.data.copy()
    scene.collection.objects.link(model)
    bpy.ops.object.select_all(action='DESELECT')
    model.select_set(True)
    bpy.context.view_layer.objects.active = model

    # The source atlases split coincident vertices. Decimating these seams
    # as boundaries opens triangular holes in the real shell or coral wall.
    for uv in list(model.data.uv_layers):
        model.data.uv_layers.remove(uv)
    mesh = bmesh.new()
    mesh.from_mesh(model.data)
    bmesh.ops.remove_doubles(mesh, verts=list(mesh.verts), dist=.000005)
    mesh.to_mesh(model.data)
    mesh.free()
    model.data.update()
    modifier = model.modifiers.new('Colony silhouette', 'DECIMATE')
    modifier.ratio = .32 if kind in {'favosites', 'halysites', 'pirania', 'acrocyathus', 'thecosmilia'} else .20
    modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)

    model.data.uv_layers.new(name='Reef UV')
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(69), island_margin=.008)
    bpy.ops.object.mode_set(mode='OBJECT')
    for face in model.data.polygons:
        face.material_index = 0
        face.use_smooth = True
    model.data.materials.clear()
    material = bpy.data.materials.new('Reef mineral and shell pigments')
    material.use_nodes = True
    model.data.materials.append(material)
    tree = material.node_tree
    image = bpy.data.images.new('Reef colour', width=512, height=512, alpha=False)
    tex = tree.nodes.new('ShaderNodeTexImage')
    tex.image = image
    tree.nodes.active = tex

    # Bake original pigment separately from the island's sunlight. Both
    # source maps of Siphocypraea are sampled on their respective surfaces.
    original.select_set(True)
    bake = scene.render.bake
    bake.use_selected_to_active = True
    bake.cage_extrusion = .015
    bake.max_ray_distance = .044
    bake.margin = 8
    bpy.ops.object.bake(type='EMIT')
    shader = next(n for n in tree.nodes if n.type == 'BSDF_PRINCIPLED')
    tree.links.new(tex.outputs['Color'], shader.inputs['Base Color'])
    shader.inputs['Roughness'].default_value = .88
    image.filepath_raw = str(scratch / (kind+'.png'))
    image.file_format = 'PNG'
    image.save()
    image.pack()
    bpy.ops.object.select_all(action='DESELECT')
    model.select_set(True)
    model.name = kind
    bpy.context.view_layer.objects.active = model
    bpy.ops.export_scene.gltf(filepath=str(destination), use_selection=True, export_format='GLB',
                              export_image_format='JPEG', export_jpeg_quality=90, export_animations=False)
    data = destination.read_bytes()
    gltf = json.loads(data[20:20 + int.from_bytes(data[12:16], 'little')])
    triangles = sum(gltf['accessors'][p['indices']]['count']//3
                    for mesh in gltf['meshes'] for p in mesh['primitives'])
    return dict(bytes=len(data), sha256=digest(data), triangles=triangles)


if __name__ == '__main__':
    source_root = Path(sys.argv[sys.argv.index('--')+1])
    creek = Path(__file__).resolve().parents[1] / 'creek'
    lock_path = creek / 'vault-reef.lock.json'
    lock = json.loads(lock_path.read_text())
    with TemporaryDirectory() as temporary:
        for item in lock['assets']:
            source = source_root / item['sourcePath']
            if digest(source.read_bytes()) != item['sourceSha256']:
                raise ValueError('Source differs from pinned model '+item['id'])
            target = Path(temporary) / (item['id']+'.glb')
            item.update(prepare_model(source, target, item['id'], Path(temporary)))
            (creek / item['path']).write_bytes(target.read_bytes())
    lock_path.write_text(json.dumps(lock, indent=2)+'\n')
