"""Bake source albedo, tangent normals and AO into 1k UV atlases; pack AO/roughness.
No directional sunshine baked into albedo. Source .blend remains private/unmodified.
"""
import bpy, pathlib, sys, json, hashlib
root=pathlib.Path(sys.argv[sys.argv.index('--')+1]); out=root/'src/flight-experience/assets/landscape'; evidence=root/'.flight-evidence/r3/assets'; tex=evidence/'textures'; tex.mkdir(exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(evidence/'landscape-samples.blend'))
scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=8; scene.render.bake.margin=8
mf=json.loads((out/'manifest.json').read_text()); names=[a['id'] for a in mf['assets']]
for ob in scene.objects:
 if ob.type=='MESH': ob.data.validate(clean_customdata=True); ob.data.update()
for name in names:
 source=bpy.data.objects[name+'-lod0']
 for other in scene.objects:
  if other.type=='MESH': other.hide_render=other!=source
 bpy.ops.object.select_all(action='DESELECT'); source.select_set(True); bpy.context.view_layer.objects.active=source
 # Per-asset materials allow one non-overlapping atlas shared across its derived LODs.
 for slot in source.material_slots: slot.material=slot.material.copy()
 images={}
 for kind in ['baseColor','normal','AO']:
  img=bpy.data.images.new(name+'-'+kind,1024,1024,alpha=True); img.colorspace_settings.name='sRGB' if kind=='baseColor' else 'Non-Color'
  for mat in source.data.materials:
   node=mat.node_tree.nodes.new('ShaderNodeTexImage'); node.image=img; mat.node_tree.nodes.active=node; node.select=True
  if kind=='baseColor': bpy.ops.object.bake(type='DIFFUSE',pass_filter={'COLOR'})
  else: bpy.ops.object.bake(type='NORMAL' if kind=='normal' else 'AO')
  img.filepath_raw=str(tex/(name+'-'+kind+'.png')); img.file_format='PNG'; img.save(); images[kind]=img
 # Pack ambient occlusion, constant authored roughness, and zero metallic in glTF convention.
 ao=list(images['AO'].pixels[:]); packed=bpy.data.images.new(name+'-ORM',1024,1024,alpha=False); packed.colorspace_settings.name='Non-Color'
 for i in range(0,len(ao),4): ao[i+1]=.9; ao[i+2]=0; ao[i+3]=1
 packed.pixels[:]=ao; packed.filepath_raw=str(tex/(name+'-ORM.png')); packed.file_format='PNG'; packed.save()
 mat=bpy.data.materials.new(name+' PBR atlas'); mat.use_nodes=True; nodes=mat.node_tree.nodes; links=mat.node_tree.links; principled=nodes.get('Principled BSDF'); principled.inputs['Roughness'].default_value=.9
 for key,img in [('baseColor',images['baseColor']),('normal',images['normal']),('ORM',packed)]:
  node=nodes.new('ShaderNodeTexImage'); node.image=img
  if key=='baseColor': links.new(node.outputs['Color'],principled.inputs['Base Color'])
  elif key=='normal': normal=nodes.new('ShaderNodeNormalMap'); links.new(node.outputs['Color'],normal.inputs['Color']); links.new(normal.outputs['Normal'],principled.inputs['Normal'])
  else:
   sep=nodes.new('ShaderNodeSeparateColor'); links.new(node.outputs['Color'],sep.inputs['Color']); links.new(sep.outputs['Green'],principled.inputs['Roughness']); links.new(sep.outputs['Blue'],principled.inputs['Metallic'])
   # glTF exporter recognises the Occlusion input of its documented output group.
   group=bpy.data.node_groups.get('glTF Material Output')
   if not group:
    group=bpy.data.node_groups.new('glTF Material Output','ShaderNodeTree'); group.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
   output=nodes.new('ShaderNodeGroup'); output.node_tree=group; links.new(sep.outputs['Red'],output.inputs['Occlusion'])
 for level in range(3):
  ob=bpy.data.objects[name+f'-lod{level}']; ob.data.materials.clear(); ob.data.materials.append(mat)
  for poly in ob.data.polygons: poly.material_index=0
  ob.data.calc_loop_triangles(); mf['assets'][names.index(name)]['lods'][level]['triangles']=len(ob.data.loop_triangles)
 mf['assets'][names.index(name)]['textures']={'resolution':1024,'maps':['baseColor','tangent normal','ORM'],'uncompressedBytes':1024*1024*4*3,'bakeSamples':8}
bpy.ops.wm.save_as_mainfile(filepath=str(evidence/'landscape-samples-baked.blend'))
bpy.ops.export_scene.gltf(filepath=str(out/'landscape-samples.glb'),export_format='GLB',export_yup=True,export_apply=True)
p=out/'landscape-samples.glb'; mf['sha256']=hashlib.sha256(p.read_bytes()).hexdigest(); mf['bytes']=p.stat().st_size; mf['limitations']=['Plant runtime LOD2 uses same-source unlit front/side/top cutouts with dynamic lighting, 6 triangles; full mesh LOD2 remains an authoring reference.','Baked low-poly tangent normals capture mesh shading, not an independent sculpted high-poly surface.','No automatic asset approval.']; (out/'manifest.json').write_text(json.dumps(mf,indent=2)+'\n')
