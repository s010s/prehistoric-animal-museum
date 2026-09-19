import { describe,expect,it } from 'vitest'
import { createExperienceGpuTimer } from '../../src/viewer/experience-gpu-timer'
function mock(supported=true){
  let created=0,deleted=0,begun=0,ended=0,lost=false,disjoint=false,available=false,foreign=false
  const gl={CURRENT_QUERY:1,QUERY_RESULT_AVAILABLE:2,QUERY_RESULT:3,
    getExtension:()=>supported?{TIME_ELAPSED_EXT:4,GPU_DISJOINT_EXT:5}:null,
    isContextLost:()=>lost,getParameter:()=>disjoint,getQuery:()=>foreign?{}:null,
    createQuery:()=>({id:++created}),deleteQuery:()=>{deleted++},beginQuery:()=>{begun++},endQuery:()=>{ended++},
    getQueryParameter:(_q:unknown,key:number)=>key===2?available:12_500_000,
  } as unknown as WebGL2RenderingContext
  return {gl,counts:()=>({created,deleted,begun,ended}),set:(state:{lost?:boolean;disjoint?:boolean;available?:boolean;foreign?:boolean})=>{
    lost=state.lost??lost;disjoint=state.disjoint??disjoint;available=state.available??available;foreign=state.foreign??foreign
  }}
}
describe('bounded external experience GPU timer',()=>{
  it('samples once per 30 frames, never blocks, and converts completed nanoseconds to milliseconds',()=>{
    const m=mock(),timer=createExperienceGpuTimer(m.gl)
    for(let i=0;i<60;i++){timer.begin();timer.end();expect(timer.poll()).toBeNull()}
    expect(m.counts().created).toBe(2)
    m.set({available:true});expect(timer.poll()).toBe(12.5);expect(timer.poll()).toBe(12.5);expect(timer.poll()).toBeNull()
    expect(m.counts().deleted).toBe(2);timer.dispose()
  })
  it('bounds pending queries, drops disjoint samples, and cleans up idempotently',()=>{
    const m=mock(),timer=createExperienceGpuTimer(m.gl)
    for(let i=0;i<300;i++){timer.begin();timer.end()}
    expect(m.counts().created).toBe(2)
    m.set({disjoint:true,available:true});expect(timer.poll()).toBeNull();expect(m.counts().deleted).toBe(2)
    m.set({disjoint:false});expect(timer.begin()).toBe(true);timer.dispose();timer.dispose()
    expect(m.counts()).toEqual({created:3,deleted:3,begun:3,ended:3});expect(timer.begin()).toBe(false)
  })
  it('abandons an active query on context loss without ending a lost-context query',()=>{
    const m=mock(),timer=createExperienceGpuTimer(m.gl);timer.begin();m.set({lost:true});timer.end()
    expect(m.counts()).toEqual({created:1,deleted:1,begun:1,ended:0});expect(timer.poll()).toBeNull();timer.dispose()
  })
  it('does nothing when unavailable or another profiler owns the timer',()=>{
    const unsupported=mock(false),timer=createExperienceGpuTimer(unsupported.gl)
    expect(timer.supported).toBe(false);expect(timer.begin()).toBe(false);timer.end();expect(timer.poll()).toBeNull();timer.dispose()
    expect(unsupported.counts().created).toBe(0)
    const m=mock();m.set({foreign:true});expect(createExperienceGpuTimer(m.gl).begin()).toBe(false);expect(m.counts().created).toBe(0)
  })
})
