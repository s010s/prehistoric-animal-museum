"""Run with Blender --background --factory-startup --python this-file.

Own geometry, metres, native Y-up export. Working .blend/audit stay private.
This is a weathered granite landform study, not a scanned geological specimen.
"""
import bpy, bmesh, json, math, hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT.parent.parent / 'docs/research/tidewater-migration/continuous-sample-2026-10-18/authoring'
PRIVATE.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
parts=[]

def slab(name, front, depth):
    n=len(front)
    # World native [x,y,z] to Blender [x,-z,y]. Back extrudes into the slope.
    native=front+[[x,y+.18,z-depth] for x,y,z in front]
    verts=[(x,-z,y) for x,y,z in native]
    faces=[tuple(range(n)),tuple(reversed(range(n,2*n)))]
    faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active=obj;obj.select_set(True)
    bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(mesh);bm.free()
    bevel=obj.modifiers.new('weathered joint edges','BEVEL');bevel.width=.075;bevel.segments=2
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    tri=obj.modifiers.new('deterministic triangles','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=tri.name)
    obj.select_set(False);parts.append(obj)

def boulder(name, center, scale, seed):
    from mathutils import noise, Vector
    # Rounded weathering over a jointed, irregular mass; no identical bevel rim.
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1)
    obj=bpy.context.object;obj.name=name
    for v in obj.data.vertices:
        native=Vector((v.co.x,v.co.z,-v.co.y))
        q=native*1.4+Vector((seed*.17,seed*.31,seed*.23))
        broad=noise.noise(q,noise_basis='PERLIN_ORIGINAL')
        medium=noise.noise(q*2.7+Vector((11,3,7)),noise_basis='PERLIN_ORIGINAL')
        factor=1+broad*.19+medium*.055
        x=native.x*scale[0]*factor
        y=native.y*scale[1]*factor
        z=native.z*scale[2]*factor
        # A single oblique joint on each mass, with weathered uneven edges.
        if x>scale[0]*.70: x=scale[0]*.70+(x-scale[0]*.70)*.28
        v.co=(x+center[0],-z-center[2],y+center[1])
    bm=bmesh.new();bm.from_mesh(obj.data);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(obj.data);bm.free()
    for face in obj.data.polygons: face.use_smooth=True
    obj.select_set(False);parts.append(obj)

boulder('rounded left bank mass',[-1.85,.32,-1.75],[2.05,1.35,2.25],14)
boulder('low right joint block',[1.25,-.05,-1.5],[1.28,1.05,2.0],21)
boulder('buried slope head',[-.30,.85,-3.65],[2.7,1.25,2.65],41)
boulder('apron left fragment',[-1.24,-.23,.85],[.85,.48,1.35],64)
boulder('apron right fragment',[1.14,-.32,.72],[.72,.45,1.24],87)

positions=[];normals=[];uv=[];indices=[];report=[]
for obj in parts:
    mesh=obj.data;mesh.calc_loop_triangles()
    bm=bmesh.new();bm.from_mesh(mesh)
    nonmanifold=sum(not e.is_manifold for e in bm.edges);bm.free()
    if nonmanifold: raise RuntimeError(f'{obj.name}: {nonmanifold} nonmanifold edges')
    lo=[min(v.co[i] for v in mesh.vertices) for i in range(3)]
    hi=[max(v.co[i] for v in mesh.vertices) for i in range(3)]
    report.append({'name':obj.name,'vertices':len(mesh.vertices),'triangles':len(mesh.loop_triangles),'nonmanifoldEdges':nonmanifold,'blenderBounds':[lo,hi]})
    for tri in mesh.loop_triangles:
        for vi in tri.vertices:
            v=mesh.vertices[vi].co;n=mesh.vertices[vi].normal
            p=[v.x,v.z,-v.y];normal=[n.x,n.z,-n.y]
            positions.extend(round(q,7) for q in p);normals.extend(round(q,7) for q in normal)
            uv.extend([round(p[0]/3.7,7),round((p[1]+p[2]*.25)/3.7,7)])
            indices.append(len(indices))
asset={'schema':'museum-authored-mesh-v1','name':'weathered fissure outcrop','units':'metres','up':'Y','origin':[ -642,55,-500 ],'position':positions,'normal':normals,'uv':uv,'index':indices}
out=ROOT/'creek/assets/sample-fissure.json';out.write_text(json.dumps(asset,separators=(',',':'))+'\n')
sha=hashlib.sha256(out.read_bytes()).hexdigest()
previous=json.loads((ROOT/'creek/sample.lock.json').read_text()) if (ROOT/'creek/sample.lock.json').exists() else {}
lock={'schema':'museum-sample-authoring-v1','blender':bpy.app.version_string,'method':'closed native-scale weathered joint boulders, irregular multi-scale surface, explicit triangles and checked vertex normals; no external scan','scientificStatus':'authored granite/weathered-joint analogy; visible gap is an outcrop recess, not the measured underground fracture aperture','assets':[{'path':'assets/sample-fissure.json','sha256':sha,'bytes':out.stat().st_size}],'objects':report,'triangles':len(indices)//3,'units':'metres','basis':'x,z,-y from Blender to native Y-up','copyright':'Museum-authored geometry; product AGPL-3.0'}
lock['assets'] += [a for a in previous.get('assets',[]) if a['path']!='assets/sample-fissure.json']
(ROOT/'creek/sample.lock.json').write_text(json.dumps(lock,indent=2)+'\n')
(PRIVATE/'fissure-mesh-audit.json').write_text(json.dumps(lock,indent=2)+'\n')
bpy.ops.wm.save_as_mainfile(filepath=str(PRIVATE/'sample-fissure.blend'))
print(json.dumps({'asset':str(out),'sha256':sha,'triangles':len(indices)//3,'objects':len(parts),'nonmanifoldEdges':sum(r['nonmanifoldEdges'] for r in report)}))
