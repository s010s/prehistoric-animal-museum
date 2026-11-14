// Rendering and placement share these measured-in-metres footprints. Map
// points use the export's source coordinates; the physical water registry
// already uses island coordinates. A colour influence never sets water level.
import {ISLAND_PLAN} from '../island/plan.js';
import {createShoreLandforms} from './ShoreLandforms.js';

const scalar=n=>{if(!Number.isFinite(n))throw Error('Invalid landform coordinate');return Number.isInteger(n)?n.toFixed(1):String(n);};
const vec=v=>'vec2f('+v.map(scalar).join(',')+')';

function footprint(name,center,axes,ramp=null){
 if(center.length!==2||axes.length!==2||!axes.every(x=>x>0&&Number.isFinite(x))||!center.every(Number.isFinite)||(ramp&&(!(ramp[1]>ramp[0])||!ramp.every(Number.isFinite))))throw Error('Invalid footprint '+name);
 const weight=(x,z)=>{
  const dx=(x-center[0])/axes[0],dz=(z-center[1])/axes[1];
  if(!ramp)return Math.exp(-(dx*dx+dz*dz));
  const t=Math.max(0,Math.min(1,(Math.hypot(dx,dz)-ramp[0])/(ramp[1]-ramp[0])));return 1-t*t*(3-2*t);
 };
 const expr=ramp?'1.0-smoothstep('+ramp.map(scalar).join(',')+',length(q))':'exp(-dot(q,q))';
 return {center,axes,ramp,weight,wgsl:'fn '+name+'(p:vec2f)->f32{let q=(p-'+vec(center)+')/'+vec(axes)+';return '+expr+';}'};
}

export function createClimateFields(world,plan=ISLAND_PLAN){
 const source=world.sourceOrigin,regions=new Map(plan.regions.map(r=>[r.id,r]));
 const islandCenter=id=>{
  const point=regions.get(id)?.point;if(!point)throw Error('Missing island region '+id);
  return point.map((v,k)=>v-source[k]);
 };
 const upland=islandCenter('dry-upland'),northern=islandCenter('highland'),marsh=world.marsh;
 const wetland=footprint('museumWetlandSoil',[marsh.x,marsh.z],[marsh.rx,marsh.rz],[.78,1.26]);
 const dry=footprint('museumDryGrassTone',upland,[1400,1700]);
 const heath=footprint('museumCoolGrassTone',northern,[2300,2100]);
 const snow=footprint('museumSnowShelter',northern,[2100,2000]);
 // Understory density extends southwest of the residual-snow footprint.
 const sparse=footprint('museumHighlandSparse',[northern[0]-200,northern[1]+30],[2700,2400],[.5,1.2]);
 return {wetland,dry,heath,snow,sparse,wgsl:[wetland,dry,heath,snow].map(f=>f.wgsl).join('\n')};
}

export function createIslandLandforms(data,climate){
 return {...createShoreLandforms(data),climate};
}
