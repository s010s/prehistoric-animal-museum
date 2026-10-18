// A slope-foot contact spring, authored from the actual east-valley section.
// The same profile defines its physical bed, wet extent and flowing surface.
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const lerp=(a,b,t)=>a+(b-a)*t;
export function createTributarySource(world){
 const old=world.tributary;
 const oldAt=z=>{const f=(z-old[0][3])/8,i=Math.max(0,Math.min(old.length-2,Math.floor(f))),t=Math.max(0,Math.min(1,f-i));return old[i].map((v,k)=>lerp(v,old[i+1][k],t));};
 const cx=oldAt(1088)[0],origin={x:cx,z:1088,level:85.33};
 const profile=[
  [1088,86.65,.48,.13],[1096,85.68,.82,.16],
  [1104,84.95,1.75,.22],[1112,84.62,4.4,.5],
  [1120,84.48,5,.65],[1136,84.41,6.5,.8],
  [1152,oldAt(1152)[1],8,1.0],
  ...[[1184,12],[1248,18],[1344,27],[1456,oldAt(1456)[2]],[1536,oldAt(1536)[2]]].map(([z,w])=>[z,oldAt(z)[1],w,1.9]),
 ];
 const points=profile.map(([z,level,width,depth])=>({x:oldAt(z)[0],z,level,width,depth,speed:z<1108?.8:.3}));
 // Monotone Hermite segments avoid angular banks and preserve a descending
 // water surface. A linear eight-metre width ramp was visibly polygonal.
 const keys=['x','level','width','depth','speed'],coeff=[];
 const slope=(i,k)=>{
  if(i===0)return (points[1][k]-points[0][k])/(points[1].z-points[0].z);
  if(i===points.length-1)return (points[i][k]-points[i-1][k])/(points[i].z-points[i-1].z);
  const a=(points[i][k]-points[i-1][k])/(points[i].z-points[i-1].z),b=(points[i+1][k]-points[i][k])/(points[i+1].z-points[i].z);
  return a*b>0?2*a*b/(a+b):0;
 };
 for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],L=b.z-a.z,c={};for(const k of keys){const u=slope(i-1,k)*L,v=slope(i,k)*L;c[k]=[a[k],u,3*(b[k]-a[k])-2*u-v,2*(a[k]-b[k])+u+v];}coeff.push(c);}
 const at=z=>{
  if(z<1088||z>1536)return null;
  let i=1;while(points[i].z<z)i++;const a=points[i-1],b=points[i],t=(z-a.z)/(b.z-a.z),r={z};
  for(const k of keys){const c=coeff[i-1][k];r[k]=c[0]+t*(c[1]+t*(c[2]+t*c[3]));}return r;
 };
 // Replace the entire buried70m cap, not merely union a narrow extra rill.
 const rows=[];for(let z=1088;z<old.at(-1)[3];z+=8){const r=at(z),v=oldAt(z);rows.push(r?[r.x,r.level,r.width,z]:[v[0],v[1],v[2],z]);}
 world.tributary=rows;
 const sculpt=(x,z,h)=>{
  if(z<1086||z>1536||Math.abs(x-cx)>110)return h;
  const r=at(Math.max(1088,z));if(!r)return h;
  const edge=Math.abs(x-r.x)-r.width;
  const abandonedWidth=oldAt(z)[2]-r.width;
  const end=1-smooth(1472,1536,z),start=smooth(1086,1088,z),bank=1-smooth(8,Math.max(23,abandonedWidth+14),edge);
  if(start*end*bank===0)return h;
  // A concave rill becomes a pool, then recovers the original valley. Raise
  // abandoned submerged banks as well, so no unrendered dry trench remains.
  const u=Math.min(1,Math.abs(x-r.x)/r.width),bed=r.level-r.depth+(r.depth+.13)*u*u;
  const lip=r.level+.13+Math.max(0,edge)*.07;
  const target=edge<0?bed:Math.max(h,lip);
  return lerp(h,target,start*end*bank);
 };
 const center=[oldAt(1120)[0],1120],n=x=>Number(x).toFixed(7);
 const expressions=coeff.map((c,i)=>{const expr=k=>`(${c[k].map(n).join(',')})`;const vec=j=>`vec3f(${['x','level','width'].map(k=>n(c[k][j])).join(',')})`;return `if(z<=${n(points[i+1].z)}){let t=clamp((z-${n(points[i].z)})/${n(points[i+1].z-points[i].z)},0.0,1.0);let v=${vec(0)}+t*(${vec(1)}+t*(${vec(2)}+t*${vec(3)}));return vec4f(v,0.0);}`;}).join('\n');
 const wgsl=`
fn museumEastTributary(z:f32)->vec4f{${expressions}return vec4f(0.0,-90.0,-10000.0,0.0);}

fn museumEastSourceInside(p:vec2f)->bool{return max(abs(p.x-${n(center[0])}),abs(p.y-${n(center[1])}))<124.0;}
fn museumTributaryOutcrop(p:vec2f)->f32{
 let q=(p-vec2f(${n(cx)},1086.2))/vec2f(6.6,5.6);return 1.0-smoothstep(.82,1.16,length(q));
}
fn museumTributaryWet(P:vec3f)->f32{
 if(P.z<1087.0||P.z>1160.0||abs(P.x-${n(cx)})>60.0){return 0.0;}
 let f=creekFieldAt(P.xz);return (1.0-smoothstep(.1,2.5,f.y))*(1.0-smoothstep(.08,1.0,P.y-f.x));
}
fn museumTributaryWhitewater(P:vec3f,slope:f32)->vec2f{
 let dz=P.z-1088.0;if(dz<0.0||dz>38.0||abs(P.x-${n(cx)})>12.0){return vec2f(0.0);}
 let wet=museumTributaryWet(P);
 let rapid=wet*smoothstep(.055,.16,slope)*.22*(1.0-smoothstep(14.0,28.0,dz));
 let landing=wet*.025*exp(-pow((dz-22.0)/5.0,2.0));
 return vec2f(rapid,landing);
}
`;
 return {origin,points,at,sculpt,center,wgsl,revision:'east-slope-foot-spring-v1'};
}
