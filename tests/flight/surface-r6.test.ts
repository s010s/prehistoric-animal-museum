import {describe,it,expect} from 'vitest'
import {ShaderMaterial} from 'three'
import {createWorldSampler,WORLD} from '../../src/flight-experience/world'
import {generateTerrain} from '../../src/flight-experience/terrain-protocol'
import {sampleDisplayedHeight} from '../../src/flight-experience/displayed-surface'
import {farSurfaceHeight} from '../../src/flight-experience/far-surface'
import {oceanCoverage} from '../../src/flight-experience/hydrology/ocean-coverage'
import {visibleWaterHeight,waterVertex,WATER_GRID_STEP} from '../../src/flight-experience/hydrology/water-surface'
import {RiverScene} from '../../src/flight-experience/hydrology/river-scene'
import {FlightAnimationController} from '../../src/flight-experience/flight-animation'

describe('unified finite river and surface contract',()=>{
 for(const seed of [193706,193707,193708])it(`keeps ${seed} river excavation bounded and generated mouth triangles oriented`,()=>{
  const w=createWorldSampler({...WORLD,seed});let prior=Infinity,maxCut=0
  for(let s=20;s<w.river.length;s+=5){const p=w.river.station(s),t=w.terrainAt(p.x,p.z);expect(p.waterLevel).toBeLessThanOrEqual(prior+1e-8);prior=p.waterLevel;maxCut=Math.max(maxCut,t.naturalHeight-t.height);expect(t.height).toBeLessThan(p.waterLevel)}
  // The wider inland reach reserves 24m above water, instead of cutting a
  // 5.5m-high coastal contour that left an unresolvable sliver beside the sea.
  expect(maxCut).toBeLessThan(28)
  const p=w.river.station(w.river.length-100),r=generateTerrain({type:'generate',sessionId:1,requestId:1,world:w.config,chunk:{x:Math.floor(p.x/512),z:Math.floor(p.z/512)},lod:0,configHash:'terrain-v3',errorSampling:false}),edges=new Map<string,number>()
  for(let i=0;i<r.indices.length;i+=3){const a=r.indices[i]!*3,b=r.indices[i+1]!*3,c=r.indices[i+2]!*3,cross=(r.positions[b+2]!-r.positions[a+2]!)*(r.positions[c]!-r.positions[a]!)-(r.positions[b]!-r.positions[a]!)*(r.positions[c+2]!-r.positions[a+2]!);expect(cross).toBeGreaterThan(0)
   for(const [u,v] of [[a,b],[b,c],[c,a]]){const A=`${r.positions[u!]},${r.positions[u!+2]}`,B=`${r.positions[v!]},${r.positions[v!+2]}`,key=[A,B].sort().join('|');edges.set(key,(edges.get(key)??0)+1)}
  }
  expect([...edges.values()].every(n=>n<=2)).toBe(true)
  for(const [key,count] of edges)if(count===1){const [a,b]=key.split('|').map(p=>p.split(',').map(Number));expect(a![0]===b![0]&&(a![0]===0||a![0]===512)||a![1]===b![1]&&(a![1]===0||a![1]===512)).toBe(true)}
 })
 it('joins every near LOD to the far triangle along complete tile perimeters',()=>{
  const w=createWorldSampler(),chunk={x:0,z:-1}
  for(const lod of [0,1,2,3] as const){const r=generateTerrain({type:'generate',sessionId:1,requestId:1,world:WORLD,chunk,lod,configHash:'terrain-v3',errorSampling:false}),surface={result:r,morph:1,startNormals:r.normals,startColors:r.colors}
   for(let d=0;d<=512;d+=1.7)for(const [x,z] of [[0,d],[512,d],[d,0],[d,512]])expect(sampleDisplayedHeight(surface,x!,z!)).toBeCloseTo(farSurfaceHeight(w,x!,z!-512),4)
  }
 })
 it('publishes one opaque water replacement only after preparation, and safely cancels pending work',async()=>{
  const w=createWorldSampler(),events:boolean[]=[],river=new RiverScene(w,()=>new ShaderMaterial(),r=>events.push(r),()=>{})
  expect(river.root.children).toHaveLength(0);expect(events).toHaveLength(0)
  while(river.busy)await new Promise(r=>setTimeout(r,1))
  expect(river.error).toBeNull();expect(events).toEqual([true]);expect(river.root.children).toHaveLength(1)
  river.dispose();expect(events).toEqual([true,false])
  const cancelled=new RiverScene(w,()=>{throw new Error('must not allocate')},()=>{},()=>{});cancelled.dispose();await new Promise(r=>setTimeout(r,5));expect(cancelled.root.children).toHaveLength(0)
 })
 it('cuts ocean ownership geometrically, with no overlapping mouth triangles',()=>{
  const w=createWorldSampler(),hole=w.river.bounds,g=oceanCoverage({x:0,z:0},{x:0,z:0},hole),a=g.getAttribute('position');let area=0
  for(let i=0;i<a.count;i+=3){const x=(a.getX(i)+a.getX(i+1)+a.getX(i+2))/3,z=(a.getZ(i)+a.getZ(i+1)+a.getZ(i+2))/3
   expect(x>hole.minX&&x<hole.maxX&&z>hole.minZ&&z<hole.maxZ).toBe(false)
   area+=((a.getZ(i+1)-a.getZ(i))*(a.getX(i+2)-a.getX(i))-(a.getX(i+1)-a.getX(i))*(a.getZ(i+2)-a.getZ(i)))/2
  }
  expect(area).toBeCloseTo(10000**2-(hole.maxX-hole.minX)*(hole.maxZ-hole.minZ),4);g.dispose()
 })
 it('queries the same water triangles rather than an unrelated analytic water level',()=>{
  const w=createWorldSampler()
  for(let s=100;s<w.river.length;s+=67){const p=w.river.station(s),step=WATER_GRID_STEP,x=Math.floor(p.x/step)*step,z=Math.floor(p.z/step)*step
   for(const [u,v] of [[.1,.2],[.7,.8],[.5,.5]]){const a=waterVertex(w,x,z).height,b=waterVertex(w,x+step,z).height,c=waterVertex(w,x,z+step).height,d=waterVertex(w,x+step,z+step).height,expected=u!+v!<=1?a*(1-u!-v!)+b*u!+c*v!:b*(1-v!)+c*(1-u!)+d*(u!+v!-1)
    expect(visibleWaterHeight(w,x+u!*step,z+v!*step)).toBeCloseTo(expected,8)
   }
  }
 })
 it('drives continuous powered flight from lift intent, freezes, and releases with hysteresis',()=>{
  const a=new FlightAnimationController()
  for(let i=0;i<600;i++){a.update(1/60,1,0);if(i>15)expect(a.poweredWeight).toBeCloseTo(1)}
  expect(a.state).toBe('PoweredFlap');a.update(10,0,0,false);expect(a.poweredWeight).toBe(1)
  for(let i=0;i<30;i++)a.update(1/60,0,0);expect(a.state).toBe('PoweredFlap')
  for(let i=0;i<90;i++)a.update(1/60,0,0);expect(a.poweredWeight).toBe(0)
  a.update(.25,0,3);expect(a.poweredWeight).toBe(1)
 })
})
