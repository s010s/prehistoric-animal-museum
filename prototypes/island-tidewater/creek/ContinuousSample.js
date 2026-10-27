// Museum-authored metre-scale coastal catchment. Modern landform/forest
// analogies inform this design; these coordinates are not a surveyed site.
// One field drives water, physical bed, habitats, authoring and inspection.
export const SAMPLE = {
  id: 'west-fissure-to-sea-v1', center: [-1024, -160], size: 1024, res: 512,
  sourceCenter: [-660, -480], sea: -.7,
  channelControls:[
    {id:'source-apron-block',kind:'rock',position:[-658,-485],radius:1.25,scour:[-656,-481,2.2,3.1,.42]},
    {id:'fallen-channel-stem',kind:'wood',a:[-704,-274],b:[-693,-282],radius:.42,scour:[-701,-267,2.8,5.8,.62]},
  ],
  // x, z, mean water, half width, thalweg depth. Non-periodic forced pools.
  sections: [
    [-642,-504,55.20,.20,.07],[-642,-500,55.00,.24,.08],
    [-645,-496,54.75,.30,.10],[-649,-491,53.40,.45,.12],
    [-654,-486,52.55,.85,.25],[-656,-482,52.50,2.65,.95],
    [-665,-472,52.35,1.10,.28],[-686,-448,50.80,1.25,.38],
    [-714,-405,46.80,1.70,.56],[-719,-348,39.90,1.35,.42],
    [-698,-282,31.70,2.30,.78],[-730,-220,24.10,1.80,.40],
    [-751,-160,18.20,2.70,.76],[-730,-100,13.60,2.10,.42],
    [-744,-33,8.80,3.30,.68],[-777,20,4.70,3.70,.85],
    [-799,75,1.40,4.80,1.00],[-831,108,.30,6.00,1.25],
    [-858,123,-.45,9.00,1.50],[-900,130,-.70,13.00,1.85],
    [-962,146,-.70,18.00,2.90],[-1110,170,-.70,25.00,6.00],
    [-1240,180,-.70,38.00,10.00],
  ],
};
export const smooth = (a,b,v) => {const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
const mix=(a,b,t)=>a+(b-a)*t, f=n=>Number(n).toFixed(7);
const cat=(a,b,c,d,t)=>b+.5*t*(c-a+t*(2*a-5*b+4*c-d+t*(3*(b-c)+d-a)));

export function createContinuousSample() {
  const controls=SAMPLE.sections, points=[],bins=new Map(),cell=32;
  let travel=0,length=0;
  for(let i=0;i<controls.length-1;i++){
    const a=controls[Math.max(0,i-1)],b=controls[i],c=controls[i+1],d=controls[Math.min(i+2,controls.length-1)];
    const steps=Math.ceil(Math.hypot(c[0]-b[0],c[1]-b[1]));
    for(let j=0;j<steps;j++){
      const t=j/steps,level=mix(b[2],c[2],t),width=mix(b[3],c[3],smooth(0,1,t)),depth=mix(b[4],c[4],smooth(0,1,t));
      const p={x:i<7?mix(b[0],c[0],t):cat(a[0],b[0],c[0],d[0],t),z:i<7?mix(b[1],c[1],t):cat(a[1],b[1],c[1],d[1],t),level,width:i<7?mix(b[3],c[3],t):width,depth};
      if(points.length){const q=points.at(-1),ds=Math.hypot(p.x-q.x,p.z-q.z),grade=Math.max(0,(q.level-level)/Math.max(ds,.001));length+=ds;travel+=ds/Math.max(.14,Math.min(.85,.18+grade*3));}
      p.distance=length;p.travel=travel;points.push(p);
    }
  }
  const last=controls.at(-1),end={x:last[0],z:last[1],level:last[2],width:last[3],depth:last[4]};
  length+=Math.hypot(end.x-points.at(-1).x,end.z-points.at(-1).z);points.push({...end,distance:length,travel:travel+1/.18});
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],pad=120;
    for(let j=Math.floor((Math.min(a.z,b.z)-pad)/cell);j<=Math.floor((Math.max(a.z,b.z)+pad)/cell);j++)for(let k=Math.floor((Math.min(a.x,b.x)-pad)/cell);k<=Math.floor((Math.max(a.x,b.x)+pad)/cell);k++){
      const key=k+','+j;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(i);
    }
  }
  const nearest=(x,z)=>{
    const ids=bins.get(Math.floor(x/cell)+','+Math.floor(z/cell));if(!ids)return null;
    let best=null,bestD=Infinity;
    for(const i of ids){const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,L2=dx*dx+dz*dz,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/L2)),qx=a.x+dx*t,qz=a.z+dz*t,dist=Math.hypot(x-qx,z-qz);if(dist>=bestD)continue;bestD=dist;const inv=1/Math.sqrt(L2);
      best={x:qx,z:qz,level:mix(a.level,b.level,t),width:mix(a.width,b.width,t),depth:mix(a.depth,b.depth,t),distance:mix(a.distance,b.distance,t),travel:mix(a.travel,b.travel,t),dist,across:((x-qx)*dz-(z-qz)*dx)*inv,dir:[dx*inv,dz*inv],grade:Math.max(0,(a.level-b.level)*inv)};
    }return best;
  };
  // Exact sub-metre spring support; its first 56m is monotone in Z. The
  // same linear coefficients are emitted below, avoiding an undersampled
  // two-metre atlas for the twenty-centimetre emerging ribbon.
  const fineControls=controls.slice(0,8),fineAt=(x,z)=>{
    if(z<fineControls[0][1]||z>fineControls.at(-1)[1])return null;
    for(let i=1;i<fineControls.length;i++)if(z<=fineControls[i][1]){
      const a=fineControls[i-1],b=fineControls[i],t=(z-a[1])/(b[1]-a[1]),cx=mix(a[0],b[0],t),w=mix(a[3],b[3],t);
      if(Math.abs(x-cx)>w+6)return null;
      const norm=Math.hypot(b[0]-a[0],b[1]-a[1]),speed=Math.min(.85,.18+Math.max(0,(a[2]-b[2])/norm)*3);
      // Preserve the precise wet ribbon; feather its dry-bank support into
      // the coarse field. A hard support edge here became a serrated cliff
      // when the quarter-metre terrain sampled two different water levels.
      const edge=Math.abs(x-cx)-w;
      return [mix(a[2],b[2],t),edge,(b[0]-a[0])/norm*speed,(b[1]-a[1])/norm*speed,1-smooth(2,6,edge)];
    }return null;
  };
  const bytes=new Float32Array(SAMPLE.res*SAMPLE.res*4),origin=[SAMPLE.center[0]-512,SAMPLE.center[1]-512];
  for(let j=0;j<SAMPLE.res;j++)for(let i=0;i<SAMPLE.res;i++){
    const x=origin[0]+(i+.5)*2,z=origin[1]+(j+.5)*2,r=nearest(x,z),k=(j*SAMPLE.res+i)*4;
    if(!r){bytes.set([SAMPLE.sea,10000,0,0],k);continue;}
    const speed=Math.min(.85,.18+r.grade*3);bytes.set([r.level,r.dist-r.width,r.dir[0]*speed,r.dir[1]*speed],k);
  }
  const sample=(x,z,out=[0,0,0,0])=>{
    const fine=fineAt(x,z);if(fine&&fine[4]===1&&z<=-456){for(let c=0;c<4;c++)out[c]=fine[c];return out;}
    const fx=(x-origin[0])/2-.5,fz=(z-origin[1])/2-.5;if(fx<0||fz<0||fx>=511||fz>=511){out[0]=SAMPLE.sea;out[1]=10000;out[2]=out[3]=0;return out;}
    const i=Math.floor(fx),j=Math.floor(fz),u=fx-i,v=fz-j,k=(j*512+i)*4;
    for(let c=0;c<4;c++)out[c]=mix(mix(bytes[k+c],bytes[k+4+c],u),mix(bytes[k+2048+c],bytes[k+2052+c],u),v);if(fine){const w=fine[4]*(1-smooth(-456,-448,z));for(let c=0;c<4;c++)out[c]=mix(out[c],fine[c],w);}return out;
  };
  const weight=(x,z)=>{const r=nearest(x,z);if(!r)return 0;return (1-smooth(r.width+38,r.width+108,r.dist))*(1-smooth(480,504,Math.max(Math.abs(x+1024),Math.abs(z+160))));};
  const sculpt=(x,z,old)=>{
    const r=nearest(x,z);if(!r)return old;const w=weight(x,z);if(w<=0)return old;
    const water=sample(x,z),lateral=Math.max(0,r.dist-r.width),asym=r.across<0?1.0:.67;
    const channel=Math.max(0,1-(1+water[1]/Math.max(.2,r.width))**2),thalweg=water[0]-r.depth*(.22+.78*channel);
    const bank=water[0]+.10+Math.min(11,lateral*(.29+asym*.12));
    let target=mix(thalweg,bank,smooth(-.25,.75,water[1]));
    for(const control of SAMPLE.channelControls){const [cx,cz,rx,rz,depth]=control.scour;const shape=Math.exp(-(((x-cx)/rx)**2+((z-cz)/rz)**2));target-=depth*shape*(1-smooth(-.2,1.0,water[1]));}
    if(r.level<=SAMPLE.sea+.01){
      // A submerged channel opens into the existing shelf; no raised berm.
      target=Math.min(old,water[0]-r.depth*Math.max(.12,1-(r.dist/Math.max(1,r.width*1.6))**2));
    }
    // Broad irregular bedrock shoulders; centimetre grit stays in the
    // filtered material, never in incompatible physical sampling grids.
    const shoulder=(Math.sin(x*.043+z*.017)+Math.sin(z*.029-x*.011))*.32;
    target+=shoulder*smooth(2,9,lateral);
    const sourceBack=1-smooth(-510,-504,z);
    if(Math.abs(x+642)<12&&z>-525&&z< -504)target=Math.max(target,55.4+sourceBack*3.6);
    return mix(old,target,w);
  };
  const fineWGSL=fineControls.slice(1).map((b,i)=>{
    const a=fineControls[i],n=Math.hypot(b[0]-a[0],b[1]-a[1]),s=Math.min(.85,.18+Math.max(0,(a[2]-b[2])/n)*3);
    return `if(p.y<=${f(b[1])}){let t=(p.y-(${f(a[1])}))/${f(b[1]-a[1])};let r=mix(vec3f(${f(a[0])},${f(a[2])},${f(a[3])}),vec3f(${f(b[0])},${f(b[2])},${f(b[3])}),t);let edge=abs(p.x-r.x)-r.z;let w=(1.0-smoothstep(2.0,6.0,edge))*(1.0-smoothstep(-456.0,-448.0,p.y));return mix(fallback,vec4f(r.y,edge,${f((b[0]-a[0])/n*s)},${f((b[1]-a[1])/n*s)}),w);}`;
  }).join('\n');
  const wgsl=`
fn museumSampleField(p:vec2f)->vec4f{
 if(p.x<=-1536.0||p.x>=-512.0||p.y<=-672.0||p.y>=352.0){return vec4f(-.7,10000.0,0.0,0.0);}
 var fallback=vec4f(-.7,10000.0,0.0,0.0);
 let uv=(p-vec2f(-1536.0,-672.0))*.5-.5;
 if(all(uv>=vec2f(0.0))&&all(uv<vec2f(511.0))){let q=vec2i(floor(uv))+vec2i(1024,512);let t=fract(uv);fallback=mix(mix(textureLoad(creekFieldTex,q,0),textureLoad(creekFieldTex,q+vec2i(1,0),0),t.x),mix(textureLoad(creekFieldTex,q+vec2i(0,1),0),textureLoad(creekFieldTex,q+vec2i(1,1),0),t.x),t.y);}
 if(p.y>=-504.0&&p.y<=-448.0){${fineWGSL}}
 return fallback;
}
fn museumSampleOutcrop(p:vec2f)->f32{return (1.0-smoothstep(6.0,12.0,length((p-vec2f(-642.0,-501.0))*vec2f(1.0,.7))));}
fn museumSampleWet(P:vec3f)->f32{if(distance(P.xz,vec2f(-649.0,-490.0))>30.0){return 0.0;}let f=museumSampleField(P.xz);return (1.0-smoothstep(.05,1.1,f.y))*(1.0-smoothstep(.06,.75,P.y-f.x));}
fn museumSampleWhitewater(P:vec3f,slope:f32)->vec2f{
 if(distance(P.xz,vec2f(-651.0,-488.0))>15.0){return vec2f(0.0);}let wet=museumSampleWet(P);
 let lip=exp(-pow((P.z+488.0)/1.5,2.0)-pow((P.x+652.0)/1.1,2.0));
 let impact=exp(-pow((P.z+484.8)/.80,2.0)-pow((P.x+655.0)/.75,2.0));
 return vec2f(wet*smoothstep(.10,.65,slope)*lip*.18,wet*impact*.018);
}
`;
  const flowAt=(x,z)=>{const r=nearest(x,z);if(!r)return [0,0,0,1];return [r.across,r.travel,1,r.depth];};
  return {...SAMPLE,points,length,bytes,sample,nearest,weight,sculpt,wgsl,flowAt,enabled:true};
}
export const sampleDisabledWGSL=`
fn museumSampleField(p:vec2f)->vec4f{return vec4f(-.7,10000.0,0.0,0.0);}
fn museumSampleOutcrop(p:vec2f)->f32{return 0.0;}
fn museumSampleWet(P:vec3f)->f32{return 0.0;}
fn museumSampleWhitewater(P:vec3f,slope:f32)->vec2f{return vec2f(0.0);}
`;
