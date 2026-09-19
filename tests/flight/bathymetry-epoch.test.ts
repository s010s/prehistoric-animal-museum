import { describe,expect,it } from 'vitest'
import { BathymetryField,coverageWeight,decodeHeight,DEPTH_SIZE,type SurfaceSnapshot,type BathymetryOptions } from '../../src/flight-experience/environment/bathymetry'
function capture(height:number,epoch:number,contentKey?:SurfaceSnapshot['contentKey']):SurfaceSnapshot{return{worldKey:'test-seed-1',epoch,topologyLayoutId:'patch-v4',worldOrigin:{x:8192,z:-8192},...(contentKey?{contentKey}:{}),sampleHeight:()=>height,release(){}}}
function complete(field:BathymetryField,options:BathymetryOptions={},x=0,z=0){const before=field.revision;for(let i=0;i<100&&field.revision===before;i++)field.update(x,z,()=>-80,Infinity,options)}
describe('R4-02 pinned display epochs and world-space handoff',()=>{
  it('does not assemble 10m and 30m surface states into the same published epoch',()=>{
    const field=new BathymetryField();let height=10,epoch=1,captures=0
    const options=()=>({surfaceRevision:epoch,captureSurface:()=>{captures++;return capture(height,epoch)}})
    for(let i=0;i<16;i++)field.update(0,0,()=>height,Infinity,options())
    height=30;epoch=2;complete(field,options())
    expect(captures).toBe(1);expect(field.publication?.epoch).toBe(1)
    for(let i=0;i<DEPTH_SIZE*DEPTH_SIZE;i++)expect(decodeHeight(field.data[i*4]!,field.data[i*4+1]!)).toBeCloseTo(10,1)
    complete(field,{...options(),presentationSeconds:1})
    expect(field.publication?.epoch).toBe(2)
    for(let i=0;i<DEPTH_SIZE*DEPTH_SIZE;i++)expect(decodeHeight(field.data[i*4]!,field.data[i*4+1]!)).toBeCloseTo(30,1)
  })
  it('prepares while paused but neither publishes nor advances visible blend',()=>{
    const field=new BathymetryField();complete(field,{captureSurface:()=>capture(10,1),surfaceRevision:1})
    const paused={captureSurface:()=>capture(30,2),surfaceRevision:2,allowPublish:false,presentationSeconds:5}
    for(let i=0;i<50;i++)field.update(0,0,()=>0,Infinity,paused)
    expect(field.prepared).toBe(true);expect(field.busy).toBe(false);expect(field.revision).toBe(1)
    expect(decodeHeight(field.data[0]!,field.data[1]!)).toBeCloseTo(10,1)
    field.update(0,0,()=>0,Infinity,{...paused,allowPublish:true})
    expect(field.revision).toBe(2);expect(field.blend).toBe(0)
    field.update(0,0,()=>0,Infinity,{...paused,presentationSeconds:50});expect(field.blend).toBe(0)
  })
  it('retains old and new origins separately across 128/256/512m moves and bounds guard slopes',()=>{
    const field=new BathymetryField();complete(field,{captureSurface:()=>capture(10,1),surfaceRevision:1})
    const oldX=field.startX;complete(field,{captureSurface:()=>capture(10,1),surfaceRevision:1,presentationSeconds:1},512)
    expect(field.previousX).toBe(oldX);expect(field.startX-oldX).toBe(512)
    const worldX=200;expect((worldX-field.previousX)/8-(worldX-field.startX)/8).toBe(64)
    const rect={minX:0,minZ:0,maxX:1032,maxZ:1032}
    expect(coverageWeight(0,500,rect)).toBe(0);expect(coverageWeight(64,500,rect)).toBe(1)
    for(let x=0;x<64;x+=.1)expect(Math.abs(coverageWeight(x+.1,500,rect)-coverageWeight(x,500,rect))).toBeLessThan(.003)
  })
  it('recomputes only dirty 128m pages and never rebuilds unchanged offshore data',()=>{
    const field=new BathymetryField();let calls=0
    const make=(epoch:number)=>{const s=capture(epoch,epoch,r=>r.minX===-512&&r.minZ===-512?`dirty-${epoch}`:'stable');return{...s,sampleHeight:()=>{calls++;return epoch}}}
    complete(field,{surfaceRevision:1,captureSurface:()=>make(1)});calls=0
    complete(field,{surfaceRevision:2,captureSurface:()=>make(2),presentationSeconds:1})
    expect(calls).toBe(256);expect(field.publication?.dirtyRects).toHaveLength(1)
    for(let i=0;i<100;i++)field.update(0,0,()=>{throw Error('must not poll')},Infinity,{surfaceRevision:2,presentationSeconds:2})
    expect(calls).toBe(256)
  })
  it('releases a pinned epoch once on cancellation and never restarts after disposal',()=>{
    const field=new BathymetryField();let releases=0,captures=0
    const options={captureSurface:()=>{captures++;return{...capture(10,1),release(){releases++}}}}
    field.update(0,0,()=>0,Infinity,options);expect(field.busy).toBe(true)
    field.dispose();field.dispose();expect(releases).toBe(1)
    expect(field.update(0,0,()=>0,Infinity,options)).toBe(0);expect(captures).toBe(1)
  })

})
