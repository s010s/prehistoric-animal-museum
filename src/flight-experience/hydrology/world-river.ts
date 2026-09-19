import { createCoastalRiverCandidate, type RiverStation } from './coastal-river-candidate'
const smooth=(v:number)=>{const t=Math.max(0,Math.min(1,v));return t*t*(3-2*t)}
/** Finite lowland reach. Each control is solved on a low elevation contour, rather
 * than dragging an inland valley through the coastal ridge. Chainage is real metres. */
export function createWorldRiver(seed:number,outlet:{x:number;z:number},valleyAt:(z:number)=>number,baseHeight:(x:number,z:number)=>number) {
 const feature=createCoastalRiverCandidate(seed),points:RiverStation[]=[],bins=new Map<string,number[]>()
 let length=0
 for(let i=0;i<=300;i++){
  const t=i/300,z=outlet.z-2900+2900*t
  // A short level pool interrupts the falling profile without a reversed grade.
  const progress=t<.5?t/.5*.48:t<.6?.48:.48+(t-.6)/.4*.52
  const level=18*(1-smooth(progress))-.7
  const naturalTarget=level+24*(1-smooth((t-.94)/.06))
  let lo=valleyAt(z)-1100,hi=lo+16
  // Find the first rising crossing; a valley is not globally monotone in X.
  while(baseHeight(hi,z)<naturalTarget&&hi<valleyAt(z)+1200){lo=hi;hi+=16}
  for(let n=0;n<28;n++){const x=(lo+hi)/2;if(baseHeight(x,z)<naturalTarget)lo=x;else hi=x}
  const x=(lo+hi)/2,previous=points[i-1]
  if(previous)length+=Math.hypot(x-previous.x,z-previous.z)
  const pool=Math.sin(Math.PI*Math.max(0,Math.min(1,(t-.45)/.2)))**2
  const halfWidth=32+pool*10+smooth((t-.88)/.12)*16,depth=2.4+pool*.8+smooth((t-.9)/.1)*1.2
  points.push({x,z,chainage:length,waterLevel:level,bedLevel:level-depth,halfWidth,tangent:{x:0,z:1}})
 }
 for(let i=0;i<points.length;i++){
  const a=points[Math.max(0,i-1)]!,b=points[Math.min(300,i+1)]!,d=Math.hypot(b.x-a.x,b.z-a.z)
  points[i]!.tangent={x:(b.x-a.x)/d,z:(b.z-a.z)/d}
  if(i===300)continue
  const c=points[i]!,e=points[i+1]!
  for(let z=Math.floor((Math.min(c.z,e.z)-192)/128);z<=Math.floor((Math.max(c.z,e.z)+192)/128);z++)for(let x=Math.floor((Math.min(c.x,e.x)-192)/128);x<=Math.floor((Math.max(c.x,e.x)+192)/128);x++){const key=`${x},${z}`,list=bins.get(key)??[];list.push(i);bins.set(key,list)}
 }
 function station(s:number):RiverStation{
  s=Math.max(0,Math.min(length,s));let lo=0,hi=300
  while(hi-lo>1){const m=(lo+hi)>>1;if(points[m]!.chainage>s)hi=m;else lo=m}
  const a=points[lo]!,b=points[hi]!,t=(s-a.chainage)/(b.chainage-a.chainage),mix=(a:number,b:number)=>a+(b-a)*t
  const tx=mix(a.tangent.x,b.tangent.x),tz=mix(a.tangent.z,b.tangent.z),d=Math.hypot(tx,tz)
  return{x:mix(a.x,b.x),z:mix(a.z,b.z),chainage:s,waterLevel:mix(a.waterLevel,b.waterLevel),bedLevel:mix(a.bedLevel,b.bedLevel),halfWidth:mix(a.halfWidth,b.halfWidth),tangent:{x:tx/d,z:tz/d}}
 }
 function query(x:number,z:number){
  const candidates=bins.get(`${Math.floor(x/128)},${Math.floor(z/128)}`);if(!candidates)return null
  let best=Infinity,chainage=0,lateralMetres=0
  for(const i of candidates){const a=points[i]!,b=points[i+1]!,dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/l2)),px=x-a.x-dx*t,pz=z-a.z-dz*t,d=px*px+pz*pz;if(d<best){best=d;chainage=a.chainage+(b.chainage-a.chainage)*t;lateralMetres=(dx*pz-dz*px)/Math.sqrt(l2)}}
  const s=station(chainage),distance=Math.sqrt(best)
  if(distance>s.halfWidth+128)return null
  const u=distance/s.halfWidth,depth=s.waterLevel-s.bedLevel
  const bedLevel=u<=1?s.waterLevel-depth*(1-u*u):s.waterLevel+(distance-s.halfWidth)*.18
  return {chainage,lateralMetres,waterLevel:s.waterLevel,bedLevel,depth:Math.max(0,s.waterLevel-bedLevel),signedBankDistance:distance-s.halfWidth,wetness:1-smooth((distance-s.halfWidth)/8),flow:s.tangent,speed:.35+.65*(1-smooth((s.halfWidth-12)/7))}
 }
 const bounds={minX:Math.floor((Math.min(...points.map(p=>p.x))-192)/8)*8,minZ:Math.floor((points[0]!.z-192)/8)*8,maxX:Math.ceil((Math.max(...points.map(p=>p.x))+192)/8)*8,maxZ:Math.ceil((outlet.z+192)/8)*8}
 return {feature,outlet,station,query,bounds,length,points,
  height(x:number,z:number,base:number,q=query(x,z)){if(!q)return base;const blend=smooth(q.signedBankDistance/112),end=smooth(q.chainage/12);return base+(Math.min(base,q.bedLevel*(1-blend)+base*blend)-base)*end}
 }
}
