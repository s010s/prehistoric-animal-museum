import { expect,it } from 'vitest'
import { FrameTrace,type FlightFrameTrace } from '../../src/flight-experience/frame-trace'
it('keeps ordered bounded frames and attaches delayed GPU results to the submitted frame',()=>{
 const trace=new FrameTrace(2);trace.start()
 const row=(frameId:number):FlightFrameTrace=>({frameId,time:0,phase:'flying',pauseReason:null,position:[0,0,0],quality:'low',deltaMs:16,cpu:{},budget:{},terrain:{},props:{},bathymetry:{},gpuMs:null})
 trace.append(row(10));trace.append(row(11));trace.gpu(10,3);expect(trace.export()[0]!.gpuMs).toBe(3)
 trace.append(row(12));trace.gpu(10,6);expect(trace.export().map(r=>r.frameId)).toEqual([11,12]);trace.stop();trace.append(row(13));expect(trace.size).toBe(2)
})
