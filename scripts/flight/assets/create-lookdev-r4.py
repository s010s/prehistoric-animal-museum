"""R4 finite, unapproved lookdev samples. No production/scatter replacement.
Blender -b --factory-startup --python scripts/flight/assets/create-lookdev-r4.py -- ROOT
"""
import bpy, bmesh, math, random, pathlib, sys, json, os
from mathutils import Vector
root=pathlib.Path(sys.argv[sys.argv.index('--')+1]); evidence=root/os.environ.get('MUSEUM_ASSET_EVIDENCE','.flight-evidence/r4/assets'); evidence.mkdir(parents=True,exist_ok=True); out=pathlib.Path(os.environ.get('MUSEUM_LOOKDEV_OUTPUT',str(root/'src/flight-experience/assets/lookdev-r4')));out.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def organic_material(name,colors,wood=False):
 m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF');coord=n.new('ShaderNodeTexCoord');noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=18 if wood else 8;noise.inputs['Detail'].default_value=4
 l.new(coord.outputs['Object'],noise.inputs['Vector']);ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(*colors[0],1);ramp.color_ramp.elements[1].color=(*colors[1],1);l.new(noise.outputs['Fac'],ramp.inputs[0]);l.new(ramp.outputs[0],p.inputs['Base Color'])
 rough=n.new('ShaderNodeMapRange');rough.inputs['To Min'].default_value=.62 if wood else .45;rough.inputs['To Max'].default_value=.94 if wood else .83;l.new(noise.outputs['Fac'],rough.inputs[0]);l.new(rough.outputs[0],p.inputs['Roughness'])
 bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.4 if wood else .18;bump.inputs['Distance'].default_value=.035 if wood else .008;l.new(noise.outputs['Fac'],bump.inputs['Height']);l.new(bump.outputs[0],p.inputs['Normal'])
 return m
bark=organic_material('sculpted bark',((.055,.033,.018),(.24,.145,.07)),True);leaf=organic_material('leaf variation',((.045,.105,.03),(.21,.36,.10)))
stone=bpy.data.materials.new('CC0 rock_01 geological surface');stone.use_nodes=True;n=stone.node_tree.nodes;l=stone.node_tree.links;p=n.get('Principled BSDF');coord=n.new('ShaderNodeTexCoord');mapping=n.new('ShaderNodeVectorMath');mapping.operation='SCALE';mapping.inputs[3].default_value=.45;l.new(coord.outputs['Object'],mapping.inputs[0])
for channel in ['albedo','normal','arm']:
 tex=n.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(root/f'src/flight-experience/assets/lookdev-materials/rock_01-{channel}.webp'));tex.image.colorspace_settings.name='sRGB' if channel=='albedo' else 'Non-Color';tex.projection='BOX';tex.projection_blend=.22;l.new(mapping.outputs[0],tex.inputs['Vector'])
 if channel=='albedo':l.new(tex.outputs['Color'],p.inputs['Base Color'])
 elif channel=='arm':sep=n.new('ShaderNodeSeparateColor');l.new(tex.outputs[0],sep.inputs[0]);l.new(sep.outputs[1],p.inputs['Roughness'])
 else: bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.3;bump.inputs['Distance'].default_value=.025;l.new(tex.outputs[0],bump.inputs['Height']);l.new(bump.outputs[0],p.inputs['Normal'])
def mesh(name,vertices,faces,mat):
 data=bpy.data.meshes.new(name);data.from_pydata(vertices,[],faces);data.update();obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj);data.materials.append(mat);return obj
def branch(a,b,r0,r1,rng):
 a=Vector(a);b=Vector(b);direction=b-a;q=direction.to_track_quat('Z','Y');v=[];f=[];segments=5;sides=9
 for k in range(segments+1):
  t=k/segments;c=a+direction*t+q@Vector((math.sin(t*math.pi)*r0*.9,0,0));r=r0+(r1-r0)*t
  for j in range(sides):
   angle=j*math.tau/sides;v.append(c+q@Vector((math.cos(angle)*r*(1+.10*math.sin(j*3)),math.sin(angle)*r,0)))
 for k in range(segments):
  for j in range(sides):f.append((k*sides+j,k*sides+(j+1)%sides,(k+1)*sides+(j+1)%sides,(k+1)*sides+j))
 f.extend([tuple(range(sides-1,-1,-1)),tuple(segments*sides+j for j in range(sides))]);return mesh('branch',v,f,bark)
def spray(center,size,rng,count=18,normal=None,blade_scale=1):
 # Small lanceolate blades, not large triangular cards. A two-row midrib gives
 # eight curved facets per leaf; leaf size and cluster envelope are independent.
 v=[];f=[];center=Vector(center)
 for i in range(count*3):
  az=rng.random()*math.tau;rr=size*.72*math.sqrt(rng.random());c=center+Vector((math.cos(az)*rr,math.sin(az)*rr,(rng.random()-.42)*size*1.15))
  direction=Vector((math.cos(az),math.sin(az),rng.uniform(-.75,.85))).normalized();side=direction.cross(Vector((.2,.1,1))).normalized();up=side.cross(direction).normalized()
  length=size*rng.uniform(.14,.23)*blade_scale;width=length*rng.uniform(.35,.52);idx=len(v)
  v.append(c-direction*length)
  for t in (.32,.7):
   rib=c+direction*((t*2-1)*length)+up*(math.sin(t*math.pi)*length*.16)
   half=width*math.sin(t*math.pi);v.extend([rib-side*half-up*half*.24,rib,rib+side*half-up*half*.24])
  v.append(c+direction*length-up*length*.12)
  f.extend([(idx,idx+1,idx+2),(idx,idx+2,idx+3),
            (idx+1,idx+4,idx+2),(idx+2,idx+4,idx+5),(idx+2,idx+5,idx+3),(idx+3,idx+5,idx+6),
            (idx+4,idx+7,idx+5),(idx+5,idx+7,idx+6)])
 ob=mesh('curved small leaves with raised midribs',v,f,leaf)
 for polygon in ob.data.polygons:polygon.use_smooth=True
 return ob
def tree(family,variant):
 rng=random.Random(900+family*30+variant);height=12+family*2+variant*.6;obs=[]
 trunk=(rng.uniform(-.5,.5),rng.uniform(-.3,.3),height*.65);obs.append(branch((0,0,-.25),trunk,.43,.14,rng))
 for j in range(5):
  a=j*math.tau/5+.2;obs.append(branch((0,0,.65),(math.cos(a)*1.1,math.sin(a)*1.1,-.22),.2,.025,rng))
 if family==0:
  for j in range(3):
   angle=j*2.1+.4;tip=(math.cos(angle)*2.0,math.sin(angle)*2.0,height-.5+rng.random());obs.append(branch((trunk[0]*.5,0,height*.38),tip,.23,.045,rng))
   for k in range(5):
    t=.28+k*.14;base=Vector((trunk[0]*.5,0,height*.38)).lerp(Vector(tip),t);a=angle+k*2.4;end=base+Vector((math.cos(a)*(2.4-t),math.sin(a)*(2.4-t),.5));obs.append(branch(base,end,.09,.018,rng));obs.append(spray(end,1.25+rng.random()*.35,rng,23))
   obs.append(spray(tip,1.2,rng,23))
 else:
  obs.append(branch(trunk,(.1,.1,height),.14,.018,rng))
  for j in range(18):
   t=j/18;z=height*(.22+t*.65);angle=j*2.4+rng.random()*.3;reach=(1-t)*3.5+.3;end=Vector((math.cos(angle)*reach,math.sin(angle)*reach,z+.5));obs.append(branch((0,0,z),end,.12*(1-t)+.025,.014,rng))
   for k in range(3):
    tip=end+Vector((math.cos(angle+k*.7)*.45,math.sin(angle+k*.7)*.45,.25));obs.append(spray(tip,max(.85,1.5-t*.5),rng,25,blade_scale=1.9))
   obs.append(spray(end*.62+Vector((0,0,z*.38)),max(.8,1.25-t*.3),rng,20,blade_scale=1.8))
  obs.append(spray((.1,.1,height),.85,rng,22,blade_scale=1.8))
 return obs
def understory(index):
 rng=random.Random(1700+index);obs=[]
 for j in range(7 if index==0 else 5):
  a=j*2.4;reach=1.2 if index==0 else .8;tip=Vector((math.cos(a)*reach,math.sin(a)*reach,1.1+index*.6));obs.append(branch((0,0,0),tip,.035,.01,rng))
  for k in range(4):
   c=tip*(.3+k*.22);obs.append(spray(c,.43 if index==0 else .6,rng,8))
 return obs
def block(center,scale,rng):
 # Convex fracture fragments from irregular radial samples. Broad oblique hull
 # planes are real surfaces; no rectangular extrusion/brick bevel template.
 sx,sy,sz=scale;v=[]
 phase=rng.random()*math.tau;lean=rng.uniform(-.32,.32)
 for ring,(height,radius) in enumerate([(0,.74),(.31,1),(.73,.9),(1,.46)]):
  for j in range(7):
   angle=j*math.tau/7+phase+ring*.13;irregular=rng.uniform(.76,1.13)
   v.append((center[0]+math.cos(angle)*sx*.5*radius*irregular+lean*height*sz,
             center[1]+math.sin(angle)*sy*.5*radius*irregular+height*sz*.13,
             center[2]+height*sz+rng.uniform(-.09,.09)*sz))
 data=bpy.data.meshes.new('oblique fracture hull');bm=bmesh.new()
 for co in v:bm.verts.new(co)
 bm.verts.ensure_lookup_table();result=bmesh.ops.convex_hull(bm,input=list(bm.verts),use_existing_faces=False)
 interior=[g for g in result.get('geom_interior',[]) if isinstance(g,bmesh.types.BMVert)]
 if interior:bmesh.ops.delete(bm,geom=interior,context='VERTS')
 bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(data);bm.free();data.update()
 ob=bpy.data.objects.new('oblique natural fracture fragment',data);bpy.context.collection.objects.link(ob);data.materials.append(stone)
 return ob

def cliff_mass(rng):
 # One continuous irregular outcrop. Front follows tilted bedding and two
 # oblique fracture seams; rear/sides close the volume. No row/column blocks.
 columns=13;rows=7;v=[];faces=[]
 for row in range(rows):
  t=row/(rows-1)
  for column in range(columns):
   u=column/(columns-1);x=(u-.5)*23.5+.5*math.sin(column*1.8+row*.65)
   crest=10.4+2.8*math.sin(u*math.pi)+1.3*math.sin(u*math.pi*5+.7)+.55*math.sin(column*2.7)
   z=-.3+t*crest+(.28*math.sin(column*1.2+row*2.1) if row not in (0,rows-1) else 0)
   bedding=(z+.24*x)/3.8;ledge=.62*math.floor(bedding)+.35*math.sin(x*.5)
   seam1=max(0,1-abs(x-(-5+z*.34))/1.1)*1.8
   seam2=max(0,1-abs(x-(5-z*.2))/.85)*1.4
   y=-2.2+.17*z+ledge+seam1+seam2+.28*math.sin(x*.83+row*1.9)
   v.append((x,y,z))
 front_count=len(v)
 for x,y,z in v[:]:v.append((x,6.5+.1*z,z))
 for row in range(rows-1):
  for column in range(columns-1):
   a=row*columns+column;b=a+1;c=a+columns;d=c+1
   # Deliberately varied fractured planes, tied to the continuous surface.
   if (row+column)%3==0:faces.extend([(a,c,b),(b,c,d)])
   else:faces.extend([(a,c,d),(a,d,b)])
   faces.append((a+front_count,b+front_count,d+front_count,c+front_count))
 for column in range(columns-1):
  a=column;b=a+1;faces.append((a,b,b+front_count,a+front_count))
  a=(rows-1)*columns+column;b=a+1;faces.append((a,a+front_count,b+front_count,b))
 for row in range(rows-1):
  a=row*columns;b=a+columns;faces.append((a,a+front_count,b+front_count,b))
  a=row*columns+columns-1;b=a+columns;faces.append((a,b,b+front_count,a+front_count))
 # All loop faces above follow the interior orientation. Reverse consistently,
 # then verify the actual closed mesh has positive signed volume before baking.
 ob=mesh('continuous tilted bedding and oblique fault outcrop',v,[tuple(reversed(face)) for face in faces],stone)
 bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
 if bm.calc_volume(signed=True)<=0:bmesh.ops.reverse_faces(bm,faces=list(bm.faces))
 assert bm.calc_volume(signed=True)>0,'Outcrop winding must face outwards'
 bm.to_mesh(ob.data);bm.free();ob.data.update()
 return ob

def geology(index):
 rng=random.Random(2500+index);obs=[]
 if index<2:
  # One dominant broken mass, one shoulder fragment and irregular talus; scales
  # interlock and overlap instead of forming an equally sized box arrangement.
  obs.append(block((-.4,.25,-.2),(4.4,3.3,3.4),rng))
  obs.append(block((1.65,-.4,-.25),(2.8,2.2,2.15),rng))
  for j in range(6):
   a=rng.random()*math.tau;r=rng.uniform(1.4,2.5);obs.append(block((math.cos(a)*r,math.sin(a)*r*.7,-.18),(rng.uniform(.3,1.2),rng.uniform(.3,1),rng.uniform(.3,.85)),rng))
 else:
  obs.append(cliff_mass(rng))
  for center,scale in [((-8,-1.8,-.4),(7,5,6.5)),((6,-.2,-.5),(7,5.5,8.1)),((1.6,-2.5,-.4),(5.1,3.8,3.9))]:obs.append(block(center,scale,rng))
  for j in range(15):
   obs.append(block((rng.uniform(-11.5,11.5),rng.uniform(-5.8,-3.1),-.25),(rng.uniform(.35,2.1),rng.uniform(.4,1.7),rng.uniform(.25,1.5)),rng))
 return obs
records=[]
for index in range(9):
 asset=f'tree-{index//2}-{index%2}' if index<4 else f'understory-{index-4}' if index<6 else f'rock-group-{index-6}' if index<8 else 'cliff-group-0';obs=tree(index//2,index%2) if index<4 else understory(index-4) if index<6 else geology(index-6)
 bpy.ops.object.select_all(action='DESELECT')
 for ob in obs:ob.select_set(True)
 bpy.context.view_layer.objects.active=obs[0];bpy.ops.object.join();low=bpy.context.object;low.name=asset+'-lod0';low.data.validate(clean_customdata=True);low.data.update()
 bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=1.15,island_margin=.018);bpy.ops.object.mode_set(mode='OBJECT')
 if index in (2,3):
  # Dense crowns cannot give thousands of tiny islands 1.8% atlas margins.
  # Reuse eight leaf-shaped atlas regions; preserve the curved blade/midrib UVs.
  uv=low.data.uv_layers.active.data;adj={};leaf_polygons=[];bark_adj={};bark_polygons=[]
  for poly in low.data.polygons:
   if low.data.materials[poly.material_index].name.startswith('leaf variation'):
    leaf_polygons.append(poly)
    for a in poly.vertices:
     adj.setdefault(a,set()).update(poly.vertices)
   else:
    bark_polygons.append(poly)
    for a in poly.vertices:bark_adj.setdefault(a,set()).update(poly.vertices)
  bark_rank={}
  for first in bark_adj:
   if first in bark_rank:continue
   stack=[first];seen=set()
   while stack:
    v=stack.pop()
    if v in seen:continue
    seen.add(v);stack.extend(bark_adj[v]-seen)
   assert len(seen)==54,'Expected six nine-sided bark rings'
   for rank,vi in enumerate(sorted(seen)):bark_rank[vi]=rank
  for poly in bark_polygons:
   sides=[bark_rank[vi]%9 for vi in poly.vertices];seam=max(sides)-min(sides)>4
   for li in poly.loop_indices:
    rank=bark_rank[low.data.loops[li].vertex_index];j=rank%9
    if seam and j==0:j=9
    uv[li].uv=(.012+.366*j/9,.012+.976*(rank//9)/5)
  mapped={};component=0
  for first in adj:
   if first in mapped:continue
   stack=[first];seen=set()
   while stack:
    v=stack.pop()
    if v in seen:continue
    seen.add(v);stack.extend(adj[v]-seen)
   assert len(seen)==8,'Expected an intact curved blade'
   shape=[(0,.5),(.32,0),(.32,.5),(.32,1),(.7,0),(.7,.5),(.7,1),(1,.5)]
   tile=component%8;ox=.42+(tile%4)*.14;oy=(tile//4)*.5
   for vi,xy in zip(sorted(seen),shape):mapped[vi]=(ox+.008+xy[0]*.124,oy+.014+xy[1]*.472)
   component+=1
  for poly in leaf_polygons:
   for li in poly.loop_indices:uv[li].uv=mapped[low.data.loops[li].vertex_index]
 high=low.copy();high.data=low.data.copy();bpy.context.collection.objects.link(high);high.name=asset+'-high';bpy.context.view_layer.objects.active=high
 subdiv=high.modifiers.new('independent surface subdivision','SUBSURF');subdiv.subdivision_type='SIMPLE';subdiv.levels=2;bpy.ops.object.modifier_apply(modifier=subdiv.name)
 tex=bpy.data.textures.new(asset+' relief',type='CLOUDS');tex.noise_scale=.11 if index<6 else .29;tex.noise_depth=2;displace=high.modifiers.new('actual high surface relief','DISPLACE');displace.texture=tex;displace.strength=.008 if index<6 else .095;displace.mid_level=.5;bpy.ops.object.modifier_apply(modifier=displace.name)
 high.data.calc_loop_triangles();bounds=[list(low.matrix_world@Vector(c)) for c in low.bound_box];lo=[min(p[j] for p in bounds) for j in range(3)];hi=[max(p[j] for p in bounds) for j in range(3)];low.data.calc_loop_triangles()
 records.append({'id':asset,'kind':'plant' if index<4 else 'understory' if index<6 else 'rock','physicalHeight':hi[2]-lo[2],'groundAnchor':[0,lo[2],0],'boundsBlender':[lo,hi],'footprint':{'radius':max(math.hypot(v[0],v[1]) for v in bounds),'height':hi[2]},'highTriangles':len(high.data.loop_triangles),'lowTriangles':len(low.data.loop_triangles),'sourceDetails':'hierarchical branching, dense multiorientation small curved leaves with raised midribs, and root flare' if index<4 else 'clustered lower vegetation silhouette' if index<6 else 'continuous irregular outcrop with tilted bedding, oblique fault seams, convex fracture fragments and graded talus'})
bpy.ops.wm.save_as_mainfile(filepath=str(evidence/'lookdev-r4-source.blend'))
manifest={'version':1,'reviewStatus':'needs_review','approval':None,'scope':'finite browser lookdev only; not scattered into world','units':'metres','axis':'glTF Y-up, Blender Z-up','blender':bpy.app.version_string,'geometryLicense':'CC-BY-NC-SA-4.0 project original','rockMaterialSource':'Poly Haven rock_01 CC0; see ../lookdev-materials/manifest.json','recipe':'scripts/flight/assets/create-lookdev-r4.py + bake-lookdev-r4.py','assets':records}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
