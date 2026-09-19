"""Selected high-to-low bake for finite R4 samples; no inherited world replacement."""
import bpy, pathlib, sys, json, hashlib, os
root=pathlib.Path(sys.argv[sys.argv.index('--')+1]);out=pathlib.Path(os.environ.get('MUSEUM_LOOKDEV_OUTPUT',str(root/'src/flight-experience/assets/lookdev-r4')));evidence=root/os.environ.get('MUSEUM_ASSET_EVIDENCE','.flight-evidence/r4/assets');tex=evidence/'textures';tex.mkdir(exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(evidence/'lookdev-r4-source.blend'));scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=12;scene.render.bake.margin=12;scene.render.bake.use_selected_to_active=True;scene.render.bake.cage_extrusion=.18;scene.render.bake.max_ray_distance=.35
manifest=json.loads((out/'manifest.json').read_text());all_meshes=[o for o in scene.objects if o.type=='MESH'];exported=[]
for asset in manifest['assets']:
 scene.render.bake.cage_extrusion=.04 if asset['kind'] in ['plant','understory'] else .18;scene.render.bake.max_ray_distance=.08 if asset['kind'] in ['plant','understory'] else .35
 name=asset['id'];low=bpy.data.objects[name+'-lod0'];high=bpy.data.objects[name+'-high'];bpy.ops.object.select_all(action='DESELECT')
 for ob in all_meshes:ob.hide_render=ob not in [low,high]
 low.select_set(True);high.select_set(True);bpy.context.view_layer.objects.active=low
 for slot in low.material_slots:slot.material=slot.material.copy()
 images={};size=1024
 for kind,bake_type in [('baseColor','DIFFUSE'),('normal','NORMAL'),('roughness','ROUGHNESS'),('AO','AO')]:
  image=bpy.data.images.new(name+'-'+kind,size,size,alpha=True);image.colorspace_settings.name='sRGB' if kind=='baseColor' else 'Non-Color'
  for material in low.data.materials:
   node=material.node_tree.nodes.new('ShaderNodeTexImage');node.image=image;material.node_tree.nodes.active=node
  # Colour/roughness are the same procedural material on both sources. Thin leaf
  # backfaces can miss a selected-to-active ray and bake black. Evaluate material
  # channels on the low surface; retain actual high-surface rays for tangent normals.
  ray_bake=bake_type=='NORMAL';scene.render.bake.use_selected_to_active=ray_bake
  high.select_set(ray_bake);high.hide_render=not ray_bake
  if bake_type=='DIFFUSE':bpy.ops.object.bake(type=bake_type,pass_filter={'COLOR'})
  else:bpy.ops.object.bake(type=bake_type)
  image.filepath_raw=str(tex/f'{name}-{kind}.png');image.file_format='PNG';image.save();images[kind]=image
 ao=list(images['AO'].pixels[:]);rough=images['roughness'].pixels[:];orm=bpy.data.images.new(name+'-ORM',size,size,alpha=False);orm.colorspace_settings.name='Non-Color'
 for i in range(0,len(ao),4):ao[i+1]=rough[i];ao[i+2]=0;ao[i+3]=1
 orm.pixels[:]=ao;orm.filepath_raw=str(tex/f'{name}-ORM.png');orm.file_format='PNG';orm.save()
 material=bpy.data.materials.new(name+' high-to-low PBR');material.use_nodes=True;n=material.node_tree.nodes;l=material.node_tree.links;p=n.get('Principled BSDF')
 for kind,image in [('baseColor',images['baseColor']),('normal',images['normal']),('ORM',orm)]:
  node=n.new('ShaderNodeTexImage');node.image=image
  if kind=='baseColor':l.new(node.outputs[0],p.inputs['Base Color'])
  elif kind=='normal':normal=n.new('ShaderNodeNormalMap');l.new(node.outputs[0],normal.inputs[1]);l.new(normal.outputs[0],p.inputs['Normal'])
  else:
   sep=n.new('ShaderNodeSeparateColor');l.new(node.outputs[0],sep.inputs[0]);l.new(sep.outputs[1],p.inputs['Roughness']);l.new(sep.outputs[2],p.inputs['Metallic'])
   group=bpy.data.node_groups.get('glTF Material Output')
   if not group:group=bpy.data.node_groups.new('glTF Material Output','ShaderNodeTree');group.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
   groupnode=n.new('ShaderNodeGroup');groupnode.node_tree=group;l.new(sep.outputs[0],groupnode.inputs['Occlusion'])
 low.data.materials.clear();low.data.materials.append(material)
 for poly in low.data.polygons:poly.material_index=0
 asset['lods']=[]
 for level,ratio in enumerate([1,.45,.15]):
  ob=low
  if level:
   ob=low.copy();ob.data=low.data.copy();bpy.context.collection.objects.link(ob);ob.name=name+f'-lod{level}';bpy.context.view_layer.objects.active=ob;mod=ob.modifiers.new('same-source retained-UV LOD','DECIMATE');mod.ratio=ratio;bpy.ops.object.modifier_apply(modifier=mod.name);ob.data.validate(clean_customdata=True)
  ob.hide_render=False;ob.data.calc_loop_triangles();exported.append(ob);asset['lods'].append({'name':ob.name,'triangles':len(ob.data.loop_triangles)})
 asset['textures']={'sourceResolution':1024,'normalSource':'subdivided/displaced high surface plus material relief; selected-to-active rays','roughnessSource':'same source spatial shader / CC0 ARM evaluated on low surface to avoid leaf ray misses','maps':['baseColor','normal','ORM']}
bpy.ops.wm.save_as_mainfile(filepath=str(evidence/'lookdev-r4-baked.blend'));bpy.ops.object.select_all(action='DESELECT')
for ob in exported:ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(out/('ecology-r5.glb' if out.name=='ecology-r5' else 'lookdev-r4.glb')),export_format='GLB',use_selection=True,export_yup=True,export_apply=True)
p=out/('ecology-r5.glb' if out.name=='ecology-r5' else 'lookdev-r4.glb');manifest['sha256']=hashlib.sha256(p.read_bytes()).hexdigest();manifest['bytes']=p.stat().st_size;manifest['limitations']=['Finite browser lookdev only; silhouette, projected coverage, realism and device budget await human review.','Mesh LOD2 is a review comparator; no new impostor/scatter rollout before finite-scene approval.'];(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
