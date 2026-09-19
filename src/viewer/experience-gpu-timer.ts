/** Opt-in external-experience GPU evidence; never waits for the GPU or owns a render loop. */
interface TimerExtension { TIME_ELAPSED_EXT:number; GPU_DISJOINT_EXT:number }
export interface ExperienceGpuTimer {
  readonly supported:boolean
  /** Call once per frame, immediately before render. Returns true only if a query began. */
  begin(frameId?:number):boolean
  /** Call after render, including a render failure's finally block. */
  end():void
  /** Returns the oldest complete valid sample in milliseconds, otherwise null. */
  poll():number|null
  pollSample():{frameId:number;milliseconds:number}|null
  dispose():void
}
export function createExperienceGpuTimer(gl:WebGL2RenderingContext):ExperienceGpuTimer {
  const ext=gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension|null
  let frame=0,active:WebGLQuery|null=null,disposed=false
  const pending:WebGLQuery[]=[]
  const ids=new Map<WebGLQuery,number>()
  const drop=()=>{
    if(active){if(!gl.isContextLost())gl.endQuery(ext!.TIME_ELAPSED_EXT);gl.deleteQuery(active);active=null}
    for(const query of pending)gl.deleteQuery(query)
    pending.length=0;ids.clear()
  }
  function pollSample(){
    if(disposed||!ext)return null
    if(gl.isContextLost()||(gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean)){drop();return null}
    const query=pending[0];if(!query)return null
    if(!gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE))return null
    const nanoseconds=gl.getQueryParameter(query,gl.QUERY_RESULT) as number
    const frameId=ids.get(query)??0;ids.delete(query)
    pending.shift();gl.deleteQuery(query)
    return Number.isFinite(nanoseconds)&&nanoseconds>=0?{frameId,milliseconds:nanoseconds/1e6}:null
  }
  return {
    supported:ext!==null,
    begin(frameId=frame){
      if(disposed||!ext)return false
      if(gl.isContextLost()){drop();return false}
      if(gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean){drop();return false}
      // Backpressure counts the active query too; no more than two GPU resources.
      if(frame++%30!==0||active||pending.length>=2)return false
      // An outside profiler may own the context's elapsed-time query. Do not interrupt it.
      if(gl.getQuery(ext.TIME_ELAPSED_EXT,gl.CURRENT_QUERY))return false
      const query=gl.createQuery();if(!query)return false
      gl.beginQuery(ext.TIME_ELAPSED_EXT,query);active=query;ids.set(query,frameId);return true
    },
    end(){
      if(!active||!ext)return
      if(disposed||gl.isContextLost()){drop();return}
      gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push(active);active=null
    },
    poll(){return pollSample()?.milliseconds??null},
    pollSample,
    dispose(){if(disposed)return;disposed=true;drop()},
  }
}
