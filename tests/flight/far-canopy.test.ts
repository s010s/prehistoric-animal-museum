import { describe,expect,it,vi } from 'vitest'
import { Group,PlaneGeometry,MeshStandardMaterial,PerspectiveCamera,InstancedMesh,Matrix4 } from 'three'
import { FarCanopyLayer } from '../../src/flight-experience/props/far-canopy-layer'
import { FrameWorkBudget } from '../../src/flight-experience/frame-work-budget'
import { VISIBILITY_PROFILES } from '../../src/flight-experience/visibility-profile'
import { createWorldSampler,type Address,type Prop } from '../../src/flight-experience/world'
function fixture(source={scatter:(a:Address):Prop[]=>[{id:`${a.x}:${a.z}`,x:a.x*512+250,z:a.z*512+250,y:10,scale:4,yaw:0,kind:'plant',priority:.1}]}){
  const parent=new Group(),geometry=new PlaneGeometry(8,12),material=new MeshStandardMaterial(),near=new Set<string>()
  const templates=['tree-0-0','tree-0-1','tree-1-0','tree-1-1'].map(asset=>({asset,parts:[{geometry,material}]}))
  const layer=new FarCanopyLayer(parent,source,{templates:()=>templates,hasRepresentation:id=>near.has(id),surface:()=>10})
  const camera=new PerspectiveCamera(70,1.7,.5,6500);camera.position.set(0,180,500);camera.lookAt(0,100,-1000);camera.updateMatrixWorld()
  return{parent,geometry,material,near,layer,camera}
}
describe('bounded same-source distant canopy',()=>{
  it('uses separate detail/visible/cache ranges and covers the planned fog endpoint',()=>{
    for(const p of Object.values(VISIBILITY_PROFILES)){expect(p.canopyVisible).toBeGreaterThan(p.fogEnd);expect(p.canopyCache).toBeGreaterThan(p.canopyVisible);expect(p.terrainVisible).toBeGreaterThan(p.canopyVisible)}
  })
  it('keeps cache, candidates and submissions finite during extended travel',()=>{
    const f=fixture(createWorldSampler())
    for(let frame=0;frame<280;frame++){if(frame%35===0)f.camera.position.x+=900;f.layer.update(f.camera,{x:0,z:0},'balanced')}
    expect(f.layer.metrics.tiles).toBeLessThanOrEqual(441);expect(f.layer.metrics.candidates).toBeLessThanOrEqual(49152)
    expect(f.layer.metrics.submitted).toBeLessThanOrEqual(16384);expect(f.layer.metrics.drawCalls).toBeLessThanOrEqual(12)
    f.layer.dispose();expect(f.parent.children).toHaveLength(0)
  })
  it('suppresses near-owned IDs and does not destroy shared source assets',()=>{
    const f=fixture(),disposeGeometry=vi.spyOn(f.geometry,'dispose'),disposeMaterial=vi.spyOn(f.material,'dispose')
    for(let i=0;i<150;i++)f.layer.update(f.camera,{x:0,z:0},'low')
    expect(f.layer.metrics.submitted).toBeGreaterThan(0)
    const old=f.layer.metrics.live
    for(let x=-8;x<8;x++)for(let z=-8;z<8;z++)f.near.add(`${x}:${z}`)
    f.layer.update(f.camera,{x:0,z:0},'low',{canStart:()=>false,measure:(_label,fn)=>fn()})
    expect(f.layer.metrics.live).toBeLessThan(old)
    f.layer.dispose();expect(disposeGeometry).not.toHaveBeenCalled();expect(disposeMaterial).not.toHaveBeenCalled()
    f.geometry.dispose();f.material.dispose()
  })
  it('retains the current representation during denied work and rebases existing matrices without a rebuild',()=>{
    const f=fixture();for(let i=0;i<100;i++)f.layer.update(f.camera,{x:0,z:0},'low')
    const mesh=f.layer.root.children.find(m=>m instanceof InstancedMesh&&m.count>0) as InstancedMesh
    const matrix=new Matrix4();mesh.getMatrixAt(0,matrix);const before=matrix.elements[12]
    const submitted=f.layer.metrics.submitted;f.camera.position.x-=8192
    f.layer.update(f.camera,{x:8192,z:0},'low',{canStart:()=>false,measure:(_label,fn)=>fn()})
    mesh.getMatrixAt(0,matrix);expect(matrix.elements[12]+mesh.position.x+f.layer.root.position.x+8192).toBeCloseTo(before,6)
    expect(f.layer.metrics.submitted).toBe(submitted);f.layer.dispose()
  })
  it('does not rebuild settled stationary canopy and restores released near ownership',()=>{
    const f=fixture();for(let i=0;i<400;i++)f.layer.update(f.camera,{x:0,z:0},'low')
    const count=f.layer.metrics.compactionFrames,live=f.layer.metrics.live
    for(let i=0;i<30;i++)f.layer.update(f.camera,{x:0,z:0},'low')
    expect(f.layer.metrics.compactionFrames).toBe(count)
    for(let x=-8;x<8;x++)for(let z=-8;z<8;z++)f.near.add(`${x}:${z}`)
    f.layer.update(f.camera,{x:0,z:0},'low');expect(f.layer.metrics.live).toBeLessThan(live)
    f.near.clear();for(let i=0;i<30;i++)f.layer.update(f.camera,{x:0,z:0},'low')
    expect(f.layer.metrics.live).toBe(live);f.layer.dispose()
  })
  it('splits pool allocation and uploads under the shared byte/object budget',()=>{
    const f=fixture();let ticks=0;const budget=new FrameWorkBudget(()=>ticks+=.001)
    for(let frame=0;frame<120;frame++){
      budget.begin(frame,2);f.layer.update(f.camera,{x:0,z:0},'balanced',budget)
      expect(budget.metrics.bytes??0).toBeLessThanOrEqual(512*1024)
      expect(budget.metrics.objects??0).toBeLessThanOrEqual(64)
    }
    expect(f.layer.metrics.ready).toBe(true);expect(f.layer.metrics.submitted).toBeGreaterThan(0);f.layer.dispose()
  })

})
