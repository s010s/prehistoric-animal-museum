"""Same-source angle atlas for far canopy; source Blender file stays private."""
import bpy,pathlib,sys,json,math,os
from mathutils import Vector
root=pathlib.Path(sys.argv[sys.argv.index('--')+1]);out=root/('.flight-evidence/r6/tree-views'+os.environ.get('TREE_CAPTURE_SUFFIX',''));out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(root/'.flight-evidence/r5/assets/lookdev-r4-baked.blend'))
for m in bpy.data.materials:
 if not m.use_nodes:continue
 ns=m.node_tree.nodes;p=ns.get('Principled BSDF');o=next((n for n in ns if n.type=='OUTPUT_MATERIAL'),None)
 if not p or not o:continue
 e=ns.new('ShaderNodeEmission')
 if p.inputs['Base Color'].is_linked:m.node_tree.links.new(p.inputs['Base Color'].links[0].from_socket,e.inputs['Color'])
 else:e.inputs['Color'].default_value=p.inputs['Base Color'].default_value
 m.node_tree.links.new(e.outputs[0],o.inputs['Surface'])
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=4;s.cycles.use_denoising=False;s.render.resolution_x=256;s.render.resolution_y=256;s.render.resolution_percentage=100;s.render.film_transparent=True;s.view_settings.view_transform='Standard';s.render.image_settings.file_format='PNG';s.render.image_settings.color_mode='RGBA'
c=bpy.data.cameras.new('tree-angle-capture');cam=bpy.data.objects.new('tree-angle-capture',c);s.collection.objects.link(cam);s.camera=cam;c.type='ORTHO'
meshes=[o for o in s.objects if o.type=='MESH'];manifest=json.loads((root/'src/flight-experience/assets/ecology-r5/manifest.json').read_text())
for a in manifest['assets']:
 if a['kind']!='plant':continue
 lod=int(os.environ.get('TREE_CAPTURE_LOD','0'));ob=bpy.data.objects[a['id']+f'-lod{lod}']
 for other in meshes:other.hide_render=other!=ob
 center=Vector((0,0,a['physicalHeight']/2));c.ortho_scale=max(a['physicalHeight'],a['footprint']['radius']*2)*1.15
 for row,el in enumerate([-math.pi/4,0,math.pi/4]):
  for col in range(8):
   az=col*math.pi/4;offset=Vector((math.cos(az)*math.cos(el),math.sin(az)*math.cos(el),math.sin(el)))*50;cam.location=center+offset;cam.rotation_euler=(-offset).to_track_quat('-Z','Y').to_euler();s.render.filepath=str(out/f'{a["id"]}-{row}-{col}.png');bpy.ops.render.render(write_still=True)
