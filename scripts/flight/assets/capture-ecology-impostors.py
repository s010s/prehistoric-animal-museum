"""Capture exact baked LOD0 albedo silhouettes, never lighting, for R5 ecology."""
import bpy, pathlib, sys, json, math
from mathutils import Vector
root=pathlib.Path(sys.argv[sys.argv.index('--')+1]);out=root/'src/flight-experience/assets/ecology-r5'
bpy.ops.wm.open_mainfile(filepath=str(root/'.flight-evidence/r5/assets/lookdev-r4-baked.blend'))
for mat in bpy.data.materials:
 if not mat.use_nodes:continue
 nodes=mat.node_tree.nodes;p=nodes.get('Principled BSDF');output=next((n for n in nodes if n.type=='OUTPUT_MATERIAL'),None)
 if not p or not output:continue
 emission=nodes.new('ShaderNodeEmission')
 if p.inputs['Base Color'].is_linked:mat.node_tree.links.new(p.inputs['Base Color'].links[0].from_socket,emission.inputs['Color'])
 else:emission.inputs['Color'].default_value=p.inputs['Base Color'].default_value
 mat.node_tree.links.new(emission.outputs[0],output.inputs['Surface'])
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=8;scene.cycles.use_denoising=False;scene.render.resolution_x=512;scene.render.resolution_y=512;scene.render.resolution_percentage=100;scene.render.film_transparent=True
scene.view_settings.view_transform='Standard';scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
camdata=bpy.data.cameras.new('same-source canopy');cam=bpy.data.objects.new('same-source canopy',camdata);scene.collection.objects.link(cam);scene.camera=cam;camdata.type='ORTHO'
meshes=[o for o in scene.objects if o.type=='MESH'];manifest=json.loads((out/'manifest.json').read_text())
for asset in manifest['assets']:
 if asset['kind']!='plant':continue
 ob=bpy.data.objects[asset['id']+'-lod0']
 for other in meshes:other.hide_render=other!=ob
 center=Vector((0,0,asset['physicalHeight']/2));camdata.ortho_scale=max(asset['physicalHeight'],asset['footprint']['radius']*2)*1.15
 for index,az,el in [(0,0,0),(1,math.pi/2,0),(4,0,math.pi/2)]:
  offset=Vector((math.cos(az)*math.cos(el),math.sin(az)*math.cos(el),math.sin(el)))*50;cam.location=center+offset;cam.rotation_euler=(-offset).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(out/f'{asset["id"]}-{index}.png');bpy.ops.render.render(write_still=True)
 asset['impostor']={'source':'exact baked LOD0 albedo emission, transparent 512px, front/side/top','views':[0,1,4],'physicalSize':camdata.ortho_scale}
manifest['scope']='multilayer flight ecology; material terrain trials remain isolated';manifest['reviewStatus']='integrated-preview';manifest['limitations']=['Family 1 crown density revised for renewed visual review.']
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
