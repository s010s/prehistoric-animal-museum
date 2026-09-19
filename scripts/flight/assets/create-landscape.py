"""Blender 5.2 sample authoring. Fresh factory scene; never opens or changes user files.
blender -b --factory-startup --python scripts/flight/assets/create-landscape.py -- ROOT
"""
import bpy, math, random, sys, pathlib, json, hashlib
from mathutils import Vector
root=pathlib.Path(sys.argv[sys.argv.index('--')+1]); out=root/'src/flight-experience/assets/landscape'; out.mkdir(parents=True,exist_ok=True)
evidence=root/'.flight-evidence/r3/assets'; evidence.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
random.seed(193706)
def material(name,color,rough):
 m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*color,1); p.inputs['Roughness'].default_value=rough
 return m
bark=material('bark',(.16,.105,.062),.92); leaf=material('foliage',(.12,.22,.09),.88); stone=material('weathered sediment',(.32,.30,.25),.92)
def mesh(name,verts,faces,mat):
 me=bpy.data.meshes.new(name); me.from_pydata(verts,[],faces); me.update(); ob=bpy.data.objects.new(name,me); bpy.context.collection.objects.link(ob); ob.data.materials.append(mat); return ob
def branch(a,b,r1,r2):
 direction=Vector(b)-Vector(a); verts=[]; faces=[]; q=direction.to_track_quat('Z','Y')
 for c,r in [(a,r1),(b,r2)]:
  for j in range(8): verts.append(Vector(c)+q@Vector((r*math.cos(j*math.tau/8),r*math.sin(j*math.tau/8),0)))
 for j in range(8): faces.append((j,(j+1)%8,(j+1)%8+8,j+8))
 faces.extend([tuple(range(7,-1,-1)),tuple(range(8,16))]); return mesh('branch',verts,faces,bark)
def foliage(center,radius,rng):
 # Open clusters of individual opaque leaf blades: real gaps, no alpha screen coverage.
 verts=[]; faces=[]
 for i in range(95):
  a=rng.random()*math.tau; rr=radius*math.sqrt(rng.random()); z=(rng.random()-.5)*radius*.65
  c=Vector(center)+Vector((math.cos(a)*rr,math.sin(a)*rr,z)); length=radius*(.24+.16*rng.random()); w=length*.43
  axis=Vector((math.cos(a),math.sin(a),.18)); side=Vector((-math.sin(a),math.cos(a),0)); base=len(verts)
  verts.extend([c-axis*length,c+side*w+Vector((0,0,.05)),c+axis*length,c-side*w]); faces.extend([(base,base+1,base+2),(base,base+2,base+3)])
 return mesh('leaf cluster',verts,faces,leaf)
def tree(family,variant):
 rng=random.Random(100+family*8+variant); h=11+family*2+variant*.8; obs=[branch((0,0,0),(.2,-.1,h),.38,.05)]
 for j in range(13):
  z=h*(.28+j*.043); a=j*2.399+variant*.4; reach=(h-z)*(.53 if family==0 else .72)*(1+rng.random()*.18)
  end=(math.cos(a)*reach,math.sin(a)*reach,z+1.05); obs.append(branch((.1,0,z),end,.12,.024))
  tip=(end[0]*1.17,end[1]*1.17,end[2]+.35); obs.append(branch(end,tip,.045,.012)); obs.append(foliage(tip,1.12 if family==0 else 1.43,rng))
 obs.append(foliage((.2,0,h),.9,rng)); return obs
def rock(index,cliff=False):
 rng=random.Random(300+index); verts=[]; faces=[]; rings=11 if cliff else 8; n=22 if cliff else 18
 for k in range(rings):
  z=k/(rings-1); radius=(.7+.22*math.sin(z*4.2)+.08*math.sin(k*4))*(1-.22*z)
  for j in range(n):
   a=j*math.tau/n; f=radius*(.9+rng.random()*.16); verts.append((math.cos(a)*f*(8 if cliff else 2.4),math.sin(a)*f*(2.5 if cliff else 1.8),z*(9 if cliff else 3.2)))
 for k in range(rings-1):
  for j in range(n): faces.append((k*n+j,k*n+(j+1)%n,(k+1)*n+(j+1)%n,(k+1)*n+j))
 faces.extend([tuple(range(n-1,-1,-1)),tuple((rings-1)*n+j for j in range(n))]); return [mesh('layered rock',verts,faces,stone)]
records=[]
for i in range(8):
 name=f'tree-{i//2}-{i%2}' if i<4 else f'rock-{i-4}' if i<7 else 'cliff-0'; obs=tree(i//2,i%2) if i<4 else rock(i, i==7)
 bpy.ops.object.select_all(action='DESELECT')
 for ob in obs: ob.select_set(True)
 bpy.context.view_layer.objects.active=obs[0]; bpy.ops.object.join(); source=bpy.context.object; source.name=name+'-lod0'
 # Actual UV unwrap shared by every derived LOD.
 bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.uv.smart_project(angle_limit=1.15,island_margin=.02); bpy.ops.object.mode_set(mode='OBJECT')
 # Protect complete leaf blades: generic edge-collapse was erasing far canopy coverage.
 if i<4:
  group=source.vertex_groups.new(name='branches-only')
  branch_indices=set(v for p in source.data.polygons if p.material_index==0 for v in p.vertices)
  group.add(list(branch_indices),1.0,'REPLACE')
 bpy.context.view_layer.update(); bounds=[list(source.matrix_world@Vector(c)) for c in source.bound_box]; lo=[min(p[j] for p in bounds) for j in range(3)]; hi=[max(p[j] for p in bounds) for j in range(3)]
 lods=[]
 for level,ratio in enumerate([1,.48,.18]):
  ob=source if level==0 else source.copy()
  if level: ob.data=source.data.copy(); bpy.context.collection.objects.link(ob); ob.name=name+f'-lod{level}'; bpy.context.view_layer.objects.active=ob; mod=ob.modifiers.new('same-source simplification','DECIMATE'); mod.ratio=ratio; mod.vertex_group='branches-only' if i<4 else ''; mod.vertex_group_factor=1.0; bpy.ops.object.modifier_apply(modifier=mod.name)
  ob.data.calc_loop_triangles(); lods.append({'name':ob.name,'triangles':len(ob.data.loop_triangles)})
 records.append({'id':name,'kind':'plant' if i<4 else 'rock','physicalHeight':hi[2]-lo[2],'crownRadius':max(hi[0]-lo[0],hi[1]-lo[1])/2,'groundAnchor':[0,0,0],'footprint':{'radius':max(math.hypot(p[0],p[1]) for p in bounds),'height':hi[2]},'sourceBoundsBlender':[lo,hi],'lods':lods})
# Scene source is private. GLB asset is a candidate only, imported solely by flight code.
bpy.ops.wm.save_as_mainfile(filepath=str(evidence/'landscape-samples.blend'))
bpy.ops.export_scene.gltf(filepath=str(out/'landscape-samples.glb'),export_format='GLB',export_yup=True,export_apply=True)
p=out/'landscape-samples.glb'
manifest={'version':1,'reviewStatus':'needs_review','approval':None,'author':'Project original procedural sample authored with Blender','license':'CC-BY-NC-SA-4.0','recipe':'scripts/flight/assets/create-landscape.py','blender':bpy.app.version_string,'units':'metres','axis':'glTF Y-up; Blender Z-up','sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size,'assets':records,'limitations':['Material constants with UVs; PBR texture baking and multi-angle impostor approval remain pending.','No automatic asset approval.']}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
