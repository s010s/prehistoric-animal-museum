/** Finite coastal feature shared by the integrated preview.
 * Local metre coordinates; outlet=(0,0), Y up. No implied palaeoecological claim.
 */
export interface RiverPoint { x:number;z:number }
export interface RiverStation extends RiverPoint { chainage:number;waterLevel:number;bedLevel:number;halfWidth:number;tangent:RiverPoint }
export interface RiverSection { waterLevel:number;bedLevel:number;depth:number;signedBankDistance:number;wetness:number }
export interface RiverFeatureGraph {
  readonly status:'candidate-needs-review'
  readonly seed:number
  readonly namespace:'static-hydrology-v1'
  readonly length:3000
  readonly bounds:{minX:number;minZ:number;maxX:number;maxZ:number}
  readonly nodes:readonly {id:string;chainage:number;waterLevel:number}[]
  readonly reaches:readonly {id:string;from:string;to:string;kind:'stream'|'pool'|'estuary'}[]
  station(chainage:number):RiverStation
  crossSection(chainage:number,lateralMetres:number):RiverSection
  query(x:number,z:number):(RiverSection&{chainage:number;lateralMetres:number})|null
}
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n))
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t
const random=(seed:number,index:number)=>{let h=Math.imul(seed^0x6b43a291,index+374761393);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296}
const stations=[0,800,1500,1800,2100,2600,3000] as const
const levels=[118,75,28,14,14,4,-.7] as const
const widths=[2.5,3.5,5,14,14,10,28] as const
function profile(values:readonly number[],s:number){if(s>=3000)return values[values.length-1]!;let i=0;while(i<stations.length-2&&s>stations[i+1]!)i++;return lerp(values[i]!,values[i+1]!,clamp((s-stations[i]!)/(stations[i+1]!-stations[i]!),0,1))}
export function createCoastalRiverCandidate(seed=193706):RiverFeatureGraph {
  const controls:RiverPoint[]=[{x:2450,z:1400},{x:2110,z:1140},{x:1750,z:1010},{x:1370,z:650},{x:930,z:690},{x:510,z:230},{x:0,z:0}]
  controls.slice(1,-1).forEach((p,i)=>{p.x+=(random(seed,i*2)-.5)*70;p.z+=(random(seed,i*2+1)-.5)*100})
  const points:RiverPoint[]=[]
  // Catmull-Rom is sampled into a bounded polyline; all queries use this same geometry.
  for(let n=0;n<=120;n++){
    const u=n/120*(controls.length-1),i=Math.min(controls.length-2,Math.floor(u)),t=u-i
    const p0=controls[Math.max(0,i-1)]!,p1=controls[i]!,p2=controls[i+1]!,p3=controls[Math.min(controls.length-1,i+2)]!
    const cat=(a:number,b:number,c:number,d:number)=>.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t)
    points.push({x:cat(p0.x,p1.x,p2.x,p3.x),z:cat(p0.z,p1.z,p2.z,p3.z)})
  }
  let rawLength=0;for(let i=1;i<points.length;i++)rawLength+=Math.hypot(points[i]!.x-points[i-1]!.x,points[i]!.z-points[i-1]!.z)
  const scale=3000/rawLength;points.forEach(p=>{p.x*=scale;p.z*=scale})
  const distance=[0];for(let i=1;i<points.length;i++)distance.push(distance[i-1]!+Math.hypot(points[i]!.x-points[i-1]!.x,points[i]!.z-points[i-1]!.z))
  const bounds={minX:Math.min(...points.map(p=>p.x))-160,minZ:Math.min(...points.map(p=>p.z))-160,maxX:Math.max(...points.map(p=>p.x))+160,maxZ:Math.max(...points.map(p=>p.z))+160}
  const bins=new Map<string,number[]>()
  for(let i=0;i<points.length-1;i++){
    const a=points[i]!,b=points[i+1]!
    for(let z=Math.floor((Math.min(a.z,b.z)-160)/256);z<=Math.floor((Math.max(a.z,b.z)+160)/256);z++)for(let x=Math.floor((Math.min(a.x,b.x)-160)/256);x<=Math.floor((Math.max(a.x,b.x)+160)/256);x++){
      const key=`${x},${z}`,list=bins.get(key)??[];list.push(i);bins.set(key,list)
    }
  }
  function station(chainage:number):RiverStation {
    const s=clamp(chainage,0,3000);let i=0;while(i<points.length-2&&s>distance[i+1]!)i++
    const a=points[i]!,b=points[i+1]!,segment=distance[i+1]!-distance[i]!,t=clamp((s-distance[i]!)/segment,0,1),waterLevel=profile(levels,s)
    return{x:lerp(a.x,b.x,t),z:lerp(a.z,b.z,t),chainage:s,waterLevel,bedLevel:waterLevel-lerp(.8,2.4,s/3000),halfWidth:profile(widths,s),tangent:{x:(b.x-a.x)/segment,z:(b.z-a.z)/segment}}
  }
  function crossSection(chainage:number,lateralMetres:number):RiverSection {
    const s=station(chainage),distance=Math.abs(lateralMetres),u=distance/s.halfWidth,centreDepth=s.waterLevel-s.bedLevel
    // The signed bank is exactly where bed meets water; the outer bank rises continuously.
    const bedLevel=u<=1?s.waterLevel-centreDepth*(1-u*u):s.waterLevel+(u-1)*2.2
    return{waterLevel:s.waterLevel,bedLevel,depth:Math.max(0,s.waterLevel-bedLevel),signedBankDistance:distance-s.halfWidth,wetness:1-clamp((distance-s.halfWidth)/8,0,1)}
  }
  return Object.freeze({status:'candidate-needs-review',seed,namespace:'static-hydrology-v1',length:3000,bounds,
    nodes:[{id:'source',chainage:0,waterLevel:118},{id:'pool-in',chainage:1800,waterLevel:14},{id:'pool-out',chainage:2100,waterLevel:14},{id:'sea-outlet',chainage:3000,waterLevel:-.7}],
    reaches:[{id:'headwater',from:'source',to:'pool-in',kind:'stream'},{id:'river-pool',from:'pool-in',to:'pool-out',kind:'pool'},{id:'tidal-mouth',from:'pool-out',to:'sea-outlet',kind:'estuary'}],
    station,crossSection,
    query(x:number,z:number){
      if(x<bounds.minX||x>bounds.maxX||z<bounds.minZ||z>bounds.maxZ)return null
      let best=Infinity,chainage=0,lateralMetres=0
      for(const i of bins.get(`${Math.floor(x/256)},${Math.floor(z/256)}`)??[]){
        const a=points[i]!,b=points[i+1]!,dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz),t=clamp(((x-a.x)*dx+(z-a.z)*dz)/(length*length),0,1)
        const px=x-lerp(a.x,b.x,t),pz=z-lerp(a.z,b.z,t),d=px*px+pz*pz
        if(d<best){best=d;chainage=distance[i]!+length*t;lateralMetres=(dx*pz-dz*px)/length}
      }
      const s=station(chainage)
      if(Math.sqrt(best)>s.halfWidth+120)return null
      return{...crossSection(chainage,lateralMetres),chainage,lateralMetres}
    },
  } as RiverFeatureGraph)
}
