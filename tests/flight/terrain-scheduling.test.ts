import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {Texture,TextureLoader} from 'three'
import {TerrainStream} from '../../src/flight-experience/terrain-stream'
import {generateTerrain,type TerrainJob} from '../../src/flight-experience/terrain-protocol'
import {FrameWorkBudget} from '../../src/flight-experience/frame-work-budget'
class WorkerStub{
 static instances:WorkerStub[]=[];onmessage:((e:{data:unknown})=>void)|null=null;onerror:(()=>void)|null=null;jobs:TerrainJob[]=[]
 constructor(){WorkerStub.instances.push(this)}postMessage(j:TerrainJob){this.jobs.push(j)}terminate(){}
 finish(){const j=this.jobs.shift();if(j)this.onmessage?.({data:generateTerrain(j)})}
}
beforeEach(()=>{WorkerStub.instances=[];vi.stubGlobal('Worker',WorkerStub);vi.spyOn(TextureLoader.prototype,'loadAsync').mockResolvedValue(new Texture())})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})
// Scheduling contracts use virtual preparation time; real CPU cost is measured separately.
const budget=new FrameWorkBudget(()=>0);let frame=0
function step(stream:TerrainStream,dt=1/60){WorkerStub.instances.forEach(w=>w.finish());budget.begin(++frame);stream.update(dt,true,budget)}
function coverage(stream:TerrainStream){for(let i=0;i<400&&!stream.ready;i++)step(stream);expect(stream.ready).toBe(true)}
function bounded(stream:TerrainStream){
 const diagnostics=stream.diagnostics();expect(diagnostics.activeMorphArea).toBeLessThanOrEqual(2*128*128)
 expect(diagnostics.independentPatches).toBeLessThanOrEqual(80)
 expect(diagnostics.renderPatches).toBeLessThanOrEqual(diagnostics.resident+80)
 expect(diagnostics.readyBytes).toBeLessThanOrEqual(8*1024*1024)
}
describe('R4 independent patch tasks, fixed epochs and shared work budget',()=>{
 it('rejects a late patch packet after static-view preparation removed its base tile',()=>{
  const stream=new TerrainStream(()=>{},()=>{});stream.plan(745.23,-1032.93,-.09,540);coverage(stream)
  const worker=WorkerStub.instances[0]!
  for(let i=0;i<30&&!worker.jobs.some(job=>job.patchIndex!==undefined);i++)step(stream,0)
  const job=worker.jobs.find(job=>job.patchIndex!==undefined)!
  expect(job).toBeDefined()
  const tile=[...stream.resident.values()].find(tile=>tile.result.chunk.x===job.chunk.x&&tile.result.chunk.z===job.chunk.z)!
  tile.morph=0;tile.vertexBlend?.fill(0);stream.prepareStaticView()
  const rejected=stream.metrics.rejected;step(stream,0)
  expect(stream.metrics.rejected).toBeGreaterThan(rejected)
  expect([...stream.resident.values()].every(tile=>tile.result.patchIndex===undefined)).toBe(true)
  for(let i=0;i<100&&!stream.ready;i++)step(stream,0)
  expect(stream.ready).toBe(true);stream.dispose()
 },30_000)

 it('rebuilds cached coarse near coverage for an explicit static camera jump without advancing time',()=>{
  const stream=new TerrainStream(()=>{},()=>{});stream.plan(0,0,0,240);coverage(stream)
  // This was distant basic coverage in the first view and is cached atLOD3.
  const ridge=[...stream.resident.values()].find(tile=>tile.result.chunk.x===2&&tile.result.chunk.z===-3)!
  expect(ridge.result.lod).toBe(3)
  stream.plan(1257.23,-1032.93,-.09,540)
  const oldCoarse=[...stream.resident.values()].filter(tile=>tile.result.lod===3).length
  expect(stream.prepareStaticView()).toBeGreaterThan(0);expect(stream.ready).toBe(false)
  for(let i=0;i<400&&!stream.ready;i++)step(stream,0)
  expect(stream.ready).toBe(true)
  const rebuilt=[...stream.resident.values()].find(tile=>tile.result.chunk.x===2&&tile.result.chunk.z===-3)!
  expect(rebuilt.result.lod).toBe(2);expect(rebuilt.morph).toBe(1);expect(rebuilt.mesh.geometry.getAttribute('terrainBlend').getX(0)).toBe(1)
  expect(oldCoarse).toBeGreaterThan(4);expect(stream.metrics.morphUploadBytes).toBe(0)
  expect(stream.prepareStaticView()).toBe(0);stream.dispose()
 },30_000)

 it('makes the four nearest ridge tiles usable before a paused first view is ready',()=>{
  const stream=new TerrainStream(()=>{},()=>{});stream.plan(745.23,-1032.93,-.09,540)
  let accounted=false
  for(let i=0;i<400&&!stream.ready;i++){
   step(stream,0)
   if(stream.metrics.installBytes>0){expect(budget.metrics.bytes).toBeGreaterThan(0);accounted=true}
  }
  expect(stream.ready).toBe(true);expect(accounted).toBe(true)
  const nearest=[...stream.resident.values()].sort((a,b)=>Math.hypot((a.result.chunk.x+.5)*512-745.23,(a.result.chunk.z+.5)*512+1032.93)-Math.hypot((b.result.chunk.x+.5)*512-745.23,(b.result.chunk.z+.5)*512+1032.93)).slice(0,4)
  for(const tile of nearest){expect(tile.result.lod).toBe(2);expect(tile.morph).toBe(1);expect(tile.mesh.geometry.getAttribute('terrainBlend').getX(0)).toBe(1)}
  expect(stream.metrics.morphUploadBytes).toBe(0);bounded(stream);stream.dispose()
 },30_000)

 it('keeps actual rendered shared edges closed at the ridge anchor during patch installation',()=>{
  const stream=new TerrainStream(()=>{},()=>{});stream.plan(745.23,-1032.93,-.09,540);coverage(stream)
  const check=()=>{
   const edges=new Map<string,number[]>(),attributes=new Map<string,number[]>()
   let attributeError=0
   stream.forEachRenderable(mesh=>{
    const g=mesh.geometry,p=g.getAttribute('position'),b=g.getAttribute('terrainBlend'),c=g.getAttribute('coarseHeight'),index=g.index!
    const end=Math.min(index.count,g.drawRange.start+g.drawRange.count)
    const normal=g.getAttribute('normal'),startNormal=g.getAttribute('startNormal'),color=g.getAttribute('color'),startColor=g.getAttribute('startColor')
    const attributeValue=(vertex:number)=>[0,1,2].flatMap(component=>{
     const blend=b.getX(vertex),i=vertex*3+component
     return [startNormal.array[i]!+(normal.array[i]!-startNormal.array[i]!)*blend,startColor.array[i]!+(color.array[i]!-startColor.array[i]!)*blend]
    })
    for(let n=g.drawRange.start;n<end;n+=3)for(let e=0;e<3;e++){
     const a=index.getX(n+e),v=index.getX(n+(e+1)%3),ax=p.getX(a)+mesh.position.x,az=p.getZ(a)+mesh.position.z,vx=p.getX(v)+mesh.position.x,vz=p.getZ(v)+mesh.position.z
     if(!(ax===vx&&ax%128===0||az===vz&&az%128===0))continue
     for(const vertex of [a,v]){
      const key=`${p.getX(vertex)+mesh.position.x},${p.getZ(vertex)+mesh.position.z}`,values=attributeValue(vertex),prior=attributes.get(key)
      if(prior)for(let component=0;component<6;component++)attributeError=Math.max(attributeError,Math.abs(prior[component]!-values[component]!))
      else attributes.set(key,values)
     }
     const ah=c.getX(a)+(p.getY(a)-c.getX(a))*b.getX(a),vh=c.getX(v)+(p.getY(v)-c.getX(v))*b.getX(v)
     const reversed=ax>vx||ax===vx&&az>vz,key=reversed?`${vx},${vz}:${ax},${az}`:`${ax},${az}:${vx},${vz}`
     const values=edges.get(key)??[];values.push(reversed?vh:ah,reversed?ah:vh);edges.set(key,values)
    }
   })
   expect(attributeError,'shared rendered normal/color').toBeLessThan(.001)
   // Keep every edge and every checkpoint; aggregate numerical bounds instead
   // of constructing tens of thousands of Chai assertions on successful edges.
   let openEdge:string|null=null,duplicateEdge:string|null=null,maxHeightError=0,heightErrorEdge=''
   for(const [key,values] of edges){
    const [a,b]=key.split(':').map(point=>point.split(',').map(Number)),mx=(a![0]!+b![0]!)/2,mz=(a![1]!+b![1]!)/2
    if(mx>512&&mx<1024&&mz> -1536&&mz< -1024&&values.length!==4)openEdge??=key
    if(values.length>4)duplicateEdge??=key
    if(values.length===4){const error=Math.max(Math.abs(values[0]!-values[2]!),Math.abs(values[1]!-values[3]!));if(!Number.isFinite(error)||error>maxHeightError){maxHeightError=error;heightErrorEdge=key}}
   }
   expect(openEdge,'open rendered edge').toBeNull()
   expect(duplicateEdge,'duplicate rendered edge').toBeNull()
   expect(maxHeightError,`shared rendered heights ${heightErrorEdge}`).toBeLessThan(.001)
  }
  check();for(let i=0;i<500;i++){step(stream);if(i%20===0)check()}check();stream.dispose()
 },30_000)

 it('changes at most two independently bounded patches and keeps basic coverage ready',()=>{
  const stream=new TerrainStream(()=>{},()=>{});stream.plan(1600,-700,0,400);coverage(stream)
  let found=false
  for(let i=0;i<500;i++){step(stream);bounded(stream);if(stream.diagnostics().independentPatches>0){found=true;break}}
  expect(found).toBe(true);expect(stream.ready).toBe(true)
  for(const tile of stream.resident.values())for(const patch of tile.patches.values()){
   const box=patch.mesh.geometry.boundingBox!;expect(box.max.x-box.min.x).toBe(128);expect(box.max.z-box.min.z).toBe(128)
   expect(patch.mesh.frustumCulled).toBe(true);expect(patch.mesh.geometry.groups).toHaveLength(0)
  }
  let draws=0;stream.forEachRenderable(()=>draws++);expect(draws).toBe(stream.diagnostics().renderPatches)
  stream.dispose()
 },30_000)
 it('retains continuity through a turn, two origins and quality change during unfinished patch work',()=>{
  const stream=new TerrainStream(()=>{},()=>{});stream.plan(1600,-700,0,400);coverage(stream)
  for(let i=0;i<160;i++)step(stream)
  const x=1704,z=-650,before=stream.displayedHeight(x,z)
  stream.relocate({x:2048,z:-2048});stream.relocate({x:4096,z:-4096})
  expect(stream.displayedHeight(x,z)).toBe(before)
  stream.forEachRenderable(mesh=>expect(Number.isFinite(mesh.position.x+mesh.position.z)).toBe(true))
  stream.plan(2600,-700,Math.PI,400)
  for(let i=0;i<250;i++){step(stream);bounded(stream)}
  stream.radius=6;stream.plan(2600,-700,0,400);coverage(stream)
  for(let i=0;i<100;i++){step(stream);bounded(stream)}
  stream.radius=4;stream.plan(1600,-700,Math.PI,400);coverage(stream)
  expect(stream.resident.size).toBe(81);bounded(stream);stream.dispose()
 },30_000)
 it('captures one immutable display epoch without reading later 10m to30m morph state',()=>{
  const stream=new TerrainStream(()=>{},()=>{});stream.plan(100,-100,0,200);coverage(stream)
  for(const tile of stream.resident.values()){
   for(let i=0;i<tile.result.positions.length/3;i++)tile.result.positions[i*3+1]=30
   tile.result.coarseHeights.fill(10);tile.vertexBlend?.fill(0);tile.morph=0
  }
  const rect={minX:0,minZ:-128,maxX:128,maxZ:0},snapshot=stream.captureDisplayedSurface(rect),key=snapshot.contentKey(rect)
  expect(snapshot.sampleHeight(21,-71)).toBeCloseTo(10,5)
  for(let i=0;i<60;i++){budget.begin(++frame);stream.update(1/60,true,budget)}
  expect(snapshot.sampleHeight(21,-71)).toBeCloseTo(10,5)
  expect(stream.displayedHeight(21,-71)).toBeCloseTo(30,5)
  expect(snapshot.contentKey(rect)).toBe(key)
  expect(stream.captureDisplayedSurface(rect).contentKey(rect)).not.toBe(key)
  snapshot.release();stream.dispose()
 },30_000)
 it('freezes paused surfaces and accepts late worker data without installing or advancing',()=>{
  const stream=new TerrainStream(()=>{},()=>{});stream.plan(800,-900,0,250);stream.update(0,true)
  WorkerStub.instances[0]!.finish();const state=stream.diagnostics()
  for(let i=0;i<50;i++)stream.update(1/60,false)
  expect(stream.diagnostics()).toEqual(state)
  coverage(stream)
  const time=stream.metrics.generated
  for(let i=0;i<120;i++)step(stream,0)
  expect(stream.metrics.generated).toBeGreaterThan(time)
  expect(stream.metrics.morphUploadBytes).toBe(0)
  stream.dispose()
 },30_000)
 it('accounts scheduled morph attribute uploads even when the preparation budget is exhausted',()=>{
  const stream=new TerrainStream(()=>{},()=>{});stream.plan(100,-100,0,200);coverage(stream)
  const tile=[...stream.resident.values()][0]!
  tile.morph=0;tile.vertexBlend?.fill(0)
  const bytes=tile.mesh.geometry.getAttribute('terrainBlend').array.byteLength
  budget.begin(++frame,0);stream.update(1/60,true,budget)
  expect(tile.morph).toBeGreaterThan(0)
  expect(stream.metrics.morphUploadBytes).toBe(bytes)
  expect(budget.metrics.bytes).toBeGreaterThanOrEqual(bytes)
  stream.dispose()
 },30_000)
 it('slices the bounded25-tile fallback and accounts shared terrain work without pretending a hard deadline',()=>{
  const stream=new TerrainStream(()=>{},()=>{});WorkerStub.instances[0]!.onerror?.();WorkerStub.instances[1]!.onerror?.()
  stream.plan(1400,-1400,0,400)
  let measured=false
  for(let i=0;i<600&&!stream.ready;i++){budget.begin(++frame);stream.update(1/60,true,budget);if(budget.metrics['terrain.fallbackStep']!==undefined)measured=true}
  expect(stream.ready).toBe(true);expect(stream.resident.size).toBe(25);expect(stream.metrics.fallbackGenerated).toBe(25)
  expect(stream.metrics.peakFallbackGenerationMs).toBeGreaterThan(0);expect(measured).toBe(true)
  stream.dispose()
 },30_000)
})
