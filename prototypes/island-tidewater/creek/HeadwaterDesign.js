// Museum-authored rock-fissure spring. One longitudinal profile drives water,
// the physical apron and the native renderer; no second decorative water plane.
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const shape=[[-1.5,0,1.32,.27],[-.8,-.03,1.30,.30],[0,-.08,.94,.36],[.65,-.13,.81,.42],[1.1,-.20,.68,.46],[1.65,-.26,.16,.58],[2.3,-.32,-.04,.72],[3.2,-.52,-.19,1.18],[4.3,-.79,-.34,1.45],[5.9,-1.05,-.53,.44],[6.5,-1.06,-.58,.43]];
export function createHeadwater(source){
 const o=source.runs[0][0],points=shape.map(([z,x,y,w])=>({x:o.x+x,z:o.z+z,level:o.level+y,width:w,depth:.09,speed:z<2.5?.8:.3}));
 const at=z=>{if(z<points[0].z||z>points.at(-1).z)return null;let i=1;while(points[i].z<z)i++;const a=points[i-1],b=points[i],t=(z-a.z)/(b.z-a.z);return {x:a.x+(b.x-a.x)*t,level:a.level+(b.level-a.level)*t,width:a.width+(b.width-a.width)*t,slope:(b.level-a.level)/(b.z-a.z),travel:(a._travel??0)+((b._travel??0)-(a._travel??0))*t};};
 const sample=(x,z,out)=>{const r=at(z);if(!r)return out;const edge=Math.abs(x-r.x)-r.width;if(edge>2.5||edge>out[1]+.5)return out;const blend=1-smooth(o.z+5.3,o.z+6.5,z);out[0]=out[0]*(1-blend)+r.level*blend;out[1]=out[1]*(1-blend)+Math.min(out[1],edge)*blend;out[2]=out[2]*(1-blend)-.09*blend;out[3]=out[3]*(1-blend)+(z<o.z+2.5?.8:.3)*blend;return out;};
 const sculpt=(x,z,h)=>{const r=at(z);if(!r)return h;const edge=Math.abs(x-r.x)-r.width;const w=(1-smooth(.04,1.1,edge))*(1-smooth(o.z+5.3,o.z+6.5,z));if(w<=0)return h;
  const bed=r.level-.08;return h*(1-w)+bed*w;};
 const f=n=>Number(n).toFixed(7),wgsl=`
fn museumSourceProfile(z:f32)->vec4f{
 ${points.slice(1).map((b,i)=>{const a=points[i];return `if(z<=${f(b.z)}){let t=clamp((z-(${f(a.z)}))/${f(b.z-a.z)},0.0,1.0);return mix(vec4f(${f(a.x)},${f(a.level)},${f(a.width)},0.0),vec4f(${f(b.x)},${f(b.level)},${f(b.width)},0.0),t);}`;}).join('\n')}
 return vec4f(0.0);
}
fn museumSourceField(p:vec2f,old:vec4f)->vec4f{
 if(p.y<${f(points[0].z)}||p.y>${f(points.at(-1).z)}||abs(p.x-${f(o.x)})>5.0){return old;}
 let r=museumSourceProfile(p.y);let edge=abs(p.x-r.x)-r.z;if(edge>2.5||edge>old.y+.5){return old;}
 let w=1.0-smoothstep(${f(o.z+5.3)},${f(o.z+6.5)},p.y);return vec4f(mix(old.x,r.y,w),mix(old.y,min(old.y,edge),w),mix(old.zw,vec2f(-.09,select(.3,.8,p.y<${f(o.z+2.5)})),w));
}
fn museumSpringOutcrop(p:vec2f)->f32{
 let north=length((p-vec2f(${f(o.x)},${f(o.z-1.8)}))/vec2f(6.6,5.6));
 return max(museumSampleOutcrop(p),max(museumTributaryOutcrop(p),1.0-smoothstep(.82,1.16,north)));
}
fn museumSourceWet(P:vec3f)->f32{
 let east=max(museumTributaryWet(P),museumSampleWet(P));
 let d=P.xz-vec2f(${f(o.x)},${f(o.z)});if(abs(d.x)>7.0||d.y< -3.0||d.y>10.0){return east;}
 let f=creekFieldAt(P.xz);return max(east,(1.0-smoothstep(.1,1.6,f.y))*(1.0-smoothstep(.05,1.5,P.y-f.x)));
}
fn museumSpringWhitewater(P:vec3f,slope:f32)->vec2f{
 let east=max(museumTributaryWhitewater(P,slope),museumSampleWhitewater(P,slope));
 let dz=P.z-${f(o.z)};if(abs(P.x-${f(o.x)})>7.0||dz< -1.5||dz>10.0){return east;}
 let wet=museumSourceWet(P);
 let rapid=wet*smoothstep(.22,.7,slope)*.36;
 let landing=wet*.055*exp(-pow((dz-2.9)/1.35,2.0));
 return max(east,vec2f(rapid,landing));
}
`;
 // Remove the legacy sub-metre sine pebbles from physical height samples.
 // They were sampled on incompatible .5/4/16m lattices and became metre-wide
 // cavity-AO bands. Retain the original channel/bed profile; filtered gravel
 // relief lives in the material. The correction is one continuous world field.
 const oldRuns=source.runs.map(run=>run.filter((_,i)=>i%4===0).concat([run.at(-1)]));
 const removeLegacyGrain=(x,z,h)=>{
  if(z< -3402||z> -3248||Math.abs(x-source.center[0])>65)return h;
  let edge=Infinity;
  for(const run of oldRuns)for(let i=1;i<run.length;i++){
   const a=run[i-1],b=run[i],dx=b.x-a.x,dz=b.z-a.z,L2=dx*dx+dz*dz;
   const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/Math.max(.00001,L2)));
   edge=Math.min(edge,Math.hypot(x-a.x-dx*t,z-a.z-dz*t)-(a.width+(b.width-a.width)*t));
  }
  const zone=smooth(-3402,-3393,z)*(1-smooth(-3270,-3248,z))*(1-smooth(7,24,edge));
  const ox=x-2000,oz=z-650;
  return h-zone*(.035*Math.sin(ox*2.31+oz*1.71)+.023*Math.sin(ox*4.13-oz*2.3));
 };
 return {origin:o,points,at,sample,sculpt,wgsl,removeLegacyGrain,revision:'rock-fissure-profile-v2'};
}
