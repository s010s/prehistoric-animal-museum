"""Clean/export sample topology and render unlit same-source multi-view impostors.
Run after create-landscape.py, with the same ROOT argument. Uses a private new .blend.
"""
import bpy, pathlib, sys, json, hashlib, math, shutil
from mathutils import Vector
root=pathlib.Path(sys.argv[sys.argv.index('--')+1]); out=root/'src/flight-experience/assets/landscape'; evidence=root/'.flight-evidence/r3/assets'
bpy.ops.wm.open_mainfile(filepath=str(evidence/'landscape-samples.blend'))
for ob in bpy.context.scene.objects:
 if ob.type=='MESH':
  ob.data.validate(verbose=True,clean_customdata=True); ob.data.update()
  for p in ob.data.polygons: p.use_smooth=False
bpy.ops.export_scene.gltf(filepath=str(out/'landscape-samples.glb'),export_format='GLB',export_yup=True,export_apply=True)
p=out/'landscape-samples.glb'; mf=json.loads((out/'manifest.json').read_text()); mf['sha256']=hashlib.sha256(p.read_bytes()).hexdigest(); mf['bytes']=p.stat().st_size
# Albedo snapshots use emission; no sun/ambient shadows are baked into base colour.
for mat in bpy.data.materials:
 if not mat.use_nodes: continue
 nodes=mat.node_tree.nodes; color=mat.diffuse_color; nodes.clear(); output=nodes.new('ShaderNodeOutputMaterial'); emission=nodes.new('ShaderNodeEmission'); emission.inputs['Color'].default_value=color; mat.node_tree.links.new(emission.outputs[0],output.inputs['Surface'])
scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=4; scene.cycles.use_denoising=False; scene.render.resolution_x=256; scene.render.resolution_y=256; scene.render.resolution_percentage=100; scene.render.film_transparent=True
scene.view_settings.view_transform='Standard'; scene.render.image_settings.file_format='PNG'; scene.render.image_settings.color_mode='RGBA'
camdata=bpy.data.cameras.new('impostor camera'); cam=bpy.data.objects.new('impostor camera',camdata); scene.collection.objects.link(cam); scene.camera=cam; camdata.type='ORTHO'
meshes=[o for o in scene.objects if o.type=='MESH']; captures=evidence/'impostors'; captures.mkdir(exist_ok=True)
for asset in mf['assets']:
 ob=bpy.data.objects[asset['id']+'-lod0'];
 for other in meshes: other.hide_render=other!=ob
 center=Vector((0,0,asset['physicalHeight']/2)); camdata.ortho_scale=max(asset['physicalHeight'],asset['crownRadius']*2)*1.15
 views=[]
 for index,(az,el) in enumerate([(0,0),(math.pi/2,0),(math.pi,0),(math.pi*1.5,0),(0,math.pi/2)]):
  offset=Vector((math.cos(az)*math.cos(el),math.sin(az)*math.cos(el),math.sin(el)))*40; cam.location=center+offset; cam.rotation_euler=(-offset).to_track_quat('-Z','Y').to_euler(); scene.render.filepath=str(captures/f'{asset["id"]}-{index}.png'); bpy.ops.render.render(write_still=True); views.append({'azimuth':az,'elevation':el,'file':f'{asset["id"]}-{index}.png'})
 if asset['kind']=='plant':
  for view in (0,1,4): shutil.copy(captures/f'{asset["id"]}-{view}.png',out/f'{asset["id"]}-{view}.png')
 asset['impostor']={'source':'same LOD0 geometry, unlit albedo, transparent background','resolution':256,'views':views,'runtime':'plant LOD2 uses front, side and top alpha-tested planes; 6 triangles, same physical size'}
mf['limitations']=['PBR texture baking remains pending; runtime uses UV-unwrapped material constants.','Multi-angle unlit impostors are local review sources; runtime uses same-source mesh LOD2.','No automatic asset approval.']; (out/'manifest.json').write_text(json.dumps(mf,indent=2)+'\n')
