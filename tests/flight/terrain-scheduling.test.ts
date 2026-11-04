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
const budget=new FrameWorkBudget(()=>0);let frame=0
function step(stream:TerrainStream,dt=1/60){WorkerStub.instances.forEach(w=>w.finish());budget.begin(++frame);stream.update(dt,true,budget)}
function coverage(stream:TerrainStream){for(let i=0;i<400&&!stream.ready;i++)step(stream);expect(stream.ready).toBe(true)}
describe('captured terrain surfaces',()=>{

 it('captures one immutable display epoch without reading later 10m to30m morph state',()=>{
  const stream=new TerrainStream(()=>{},()=>{});stream.plan(100,-100,0,200);coverage(stream)
  for(const tile of stream.resident.values()){
   for(let i=0;i<tile.result.positions.length/3;i++)tile.result.positions[i*3+1]=30
   tile.result.coarseHeights.fill(10);tile.vertexBlend?.fill(0);tile.morph=0
  }
  const rect={minX:0,minZ:-128,maxX:128,maxZ:0},snapshot=stream.captureDisplayedSurface(rect)
  expect(snapshot.sampleHeight(21,-71)).toBeCloseTo(10,5)
  for(let i=0;i<60;i++){budget.begin(++frame);stream.update(1/60,true,budget)}
  expect(snapshot.sampleHeight(21,-71)).toBeCloseTo(10,5)
  expect(stream.displayedHeight(21,-71)).toBeCloseTo(30,5)
  snapshot.release();stream.dispose()
 },30_000)
})
