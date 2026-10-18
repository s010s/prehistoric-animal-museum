// One authoritative inland-water registry: the original fine creek, headwater
// fissures, main river, two lakes, tributary and connected tidal wetland.
import {createHeadwater} from './HeadwaterDesign.js';
import {createTributarySource} from './TributarySource.js';
import {Texture} from '../vendor/tidewater/src/engine/gpu/Texture.js';
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const num=n=>Number(n).toFixed(7);
export function installIslandWater(field,world,headwater){
 const head=field.headwater=createHeadwater(world.source);
 const east=field.tributarySource=createTributarySource(world);
 // The export enabled the wide main-river extent in one row at Z=-3280.
 // Reconstruct its 40m confluence on the existing half-metre atlas before
 // CPU queries, terrain materials, grass and GPU water share these values.
 // Heights remain the original water profile; the locked source is untouched.
 headwater=new Float32Array(headwater);
 const joinZ=field.riverLayout.riverStart,joinA=joinZ-20,joinB=joinZ+20,sourceZ=world.source.center[1]-128;
 const rowAt=z=>{const f=(z-sourceZ)*2-.5,j=Math.floor(f);return [j,f-j];};
 const [ja,ta]=rowAt(joinA),[jb,tb]=rowAt(joinB),oldSource=headwater.slice();let repairedSourceTexels=0;
 for(let j=0;j<512;j++){
  const z=sourceZ+(j+.5)*.5;if(z<=joinA||z>=joinB)continue;
  const t=smooth(joinA,joinB,z);
  for(let i=0;i<512;i++){
   const k=(j*512+i)*4;
   for(const c of [1,2,3]){
    const a=oldSource[(ja*512+i)*4+c]*(1-ta)+oldSource[((ja+1)*512+i)*4+c]*ta;
    const b=oldSource[(jb*512+i)*4+c]*(1-tb)+oldSource[((jb+1)*512+i)*4+c]*tb;
    headwater[k+c]=a*(1-t)+b*t;
   }repairedSourceTexels++;
  }
 }
 field.sourceExtentRepair={from:joinA,to:joinB,texels:repairedSourceTexels,waterLevelsUnchanged:true};
 const n=field.g.waterRes,W=1536,H=n+2,packed=new Float32Array(W*H*4),sg=world.source;
 for(let j=0;j<n;j++)packed.set(field.data.subarray(j*n*4,(j+1)*n*4),j*W*4);
 for(let j=0;j<512;j++)packed.set(headwater.subarray(j*512*4,(j+1)*512*4),(j*W+n)*4);
 packed.set(field.riverProfile,W*n*4);
 const start=field.riverProfile.length/4,trip=world.tributary.flat();packed.set(trip,(W*n+start)*4);
 const old=field.texture;field.texture=new Texture({label:'Museum inland-water atlas',width:W,height:H,format:'rgba32float',data:packed,usage:['sample','copyDst']});field.module.bindings.creekFieldTex.texture=field.texture;old.destroy();
 const l=field.riverLayout,T=world.tributary,M=world.marsh;
 const fineCode=field.module.code.split('fn creekRiverRow')[0];
 const sample=`fn islandWaterBilinear(p:vec2f,c:vec2f,size:f32,res:f32,offset:vec2i)->vec4f{
 let f=(p-c+size*.5)/size*res-.5;if(any(f<vec2f(0.0))||any(f>=vec2f(res-1.0))){return vec4f(0.0,10000.0,0.0,0.0);}
 let q=vec2i(floor(f))+offset;let t=fract(f);return mix(mix(textureLoad(creekFieldTex,q,0),textureLoad(creekFieldTex,q+vec2i(1,0),0),t.x),mix(textureLoad(creekFieldTex,q+vec2i(0,1),0),textureLoad(creekFieldTex,q+vec2i(1,1),0),t.x),t.y);
}
fn creekRiverRow(i:i32)->vec4f{return textureLoad(creekFieldTex,vec2i(i%${W},${n}+i/${W}),0);}
fn creekRiverAt(z:f32)->vec4f{let f=(z-(${num(l.riverStart)}))/${num(l.riverStep)};if(f<0.0||f>=${num(l.riverCount-1)}){return vec4f(0.0,-90.0,-10000.0,0.0);}let i=i32(floor(f));return mix(creekRiverRow(i),creekRiverRow(i+1),fract(f));}
fn islandTributary(z:f32)->vec4f{if(z>=1088.0&&z<=1536.0){return museumEastTributary(z);}let f=(z-(${num(T[0][3])}))/8.0;if(f<0.0||f>=${num(T.length-1)}){return vec4f(0.0,-90.0,-10000.0,0.0);}let i=i32(floor(f))+${start};return mix(creekRiverRow(i),creekRiverRow(i+1),fract(f));}
fn creekFieldAt(p:vec2f)->vec4f{
 if(max(abs(p.x),abs(p.y))<255.49){return creekFineFieldAt(p);}
 if(max(abs(p.x-${num(sg.center[0])}),abs(p.y-${num(sg.center[1])}))<127.49){return museumSourceField(p,islandWaterBilinear(p,vec2f(${sg.center.map(num).join(',')}),256.0,512.0,vec2i(1024,0)));}
 let r=creekRiverAt(p.y);let flow=normalize(vec2f(r.w,1.0))*.38;
 var best=vec4f(r.y,select(10000.0,abs(p.x-r.x)-r.z,r.z>0.0),flow);
 ${world.lakes.map(b=>`let e_${b.id}=(length((p-vec2f(${b.center.map(num).join(',')}))/vec2f(${num(b.rx)},${num(b.rz)}))-1.06)*${num(Math.min(b.rx,b.rz))};if(e_${b.id}<best.y){best=vec4f(${num(b.level)},e_${b.id},.025,.008);}`).join('\n')}
 let t=islandTributary(p.y);let te=abs(p.x-t.x)-t.z;if(t.z>0.0&&te<best.y){best=vec4f(t.y,te,.035,.3);}
 let me=(length((p-vec2f(${num(M.x)},${num(M.z)}))/vec2f(${num(M.rx)},${num(M.rz)}))-1.04)*${num(Math.min(M.rx,M.rz))};
 if(me<best.y){best=vec4f(2.4-3.1*smoothstep(6850.0,7850.0,p.y),me,.025,.07);}
 return best;
}
fn museumWaterOwner(p:vec2f)->f32{
 if(max(abs(p.x),abs(p.y))<255.49){return 0.0;}
 if(max(abs(p.x-${num(sg.center[0])}),abs(p.y-${num(sg.center[1])}))<127.49){return 3.0;}
 ${world.lakes.map(b=>`if(length((p-vec2f(${b.center.map(num).join(',')}))/vec2f(${num(b.rx)},${num(b.rz)}))<1.06){return 2.0;}`).join('\n')}
 if(length((p-vec2f(${num(M.x)},${num(M.z)}))/vec2f(${num(M.rx)},${num(M.rz)}))<1.04){return 4.0;}
 let t=islandTributary(p.y);if(t.z>0.0&&abs(p.x-t.x)<t.z+1.0){return select(5.0,6.0,museumEastSourceInside(p));}return 1.0;
}
fn museumEstuaryOwns(p:vec2f)->bool{return creekContains(p)&&creekMeanAt(p)>frame.seaLevel+.5;}
// Light transport crosses the tidal reach continuously. Mesh ownership is a
// rasterisation choice, not a physical boundary in the underwater medium.
fn museumInlandLightWeight(p:vec2f)->f32{let f=creekFieldAt(p);return smoothstep(0.0,1.5,f.x-frame.seaLevel)*(1.0-smoothstep(0.0,8.0,f.y));}
fn museumEstuaryBlend(p:vec2f)->f32{let f=creekFieldAt(p);return smoothstep(0.0,.2,f.x-frame.seaLevel)*(1.0-smoothstep(1.0,3.0,f.x-frame.seaLevel))*(1.0-smoothstep(-1.0,0.0,f.y));}
`;
 field.module.code=(fineCode+head.wgsl+east.wgsl+sample).replace('return creekFieldAt(p).y<0.05;','return creekFieldAt(p).y<0.05&&creekMeanAt(p)>frame.seaLevel+.5;');
 field.height=(x,z)=>{const f=field.sample(x,z);return f[1]<.05&&f[0]>-.2?f[0]:-90;};
 const fineSample=field._fineSample,raw=(bytes,res,x,z,c,size,out)=>{const fx=(x-c[0]+size/2)/size*res-.5,fz=(z-c[1]+size/2)/size*res-.5;if(fx<0||fz<0||fx>=res-1||fz>=res-1){out[0]=0;out[1]=10000;out[2]=out[3]=0;return out;}const ix=Math.floor(fx),iz=Math.floor(fz),u=fx-ix,v=fz-iz,k=(iz*res+ix)*4;for(let q=0;q<4;q++)out[q]=(bytes[k+q]*(1-u)+bytes[k+4+q]*u)*(1-v)+(bytes[k+res*4+q]*(1-u)+bytes[k+(res+1)*4+q]*u)*v;return out;};
 field.sample=(x,z,out=[0,0,0,0])=>{
  if(Math.max(Math.abs(x),Math.abs(z))<255.49)return fineSample(x,z,out);
  if(Math.max(Math.abs(x-sg.center[0]),Math.abs(z-sg.center[1]))<127.49)return head.sample(x,z,raw(headwater,512,x,z,sg.center,256,out));
  const r=field.riverAt(z);out[0]=r?.level??-90;out[1]=r?Math.abs(x-r.x)-r.width:10000;const norm=Math.hypot(r?.slope??0,1);out[2]=(r?.slope??0)/norm*.38;out[3]=1/norm*.38;
  for(const b of world.lakes){const e=(Math.hypot((x-b.center[0])/b.rx,(z-b.center[1])/b.rz)-1.06)*Math.min(b.rx,b.rz);if(e<out[1]){out[0]=b.level;out[1]=e;out[2]=.025;out[3]=.008;}}
  const f=(z-T[0][3])/8;if(f>=0&&f<T.length-1){const i=Math.floor(f),u=f-i,profile=east.at(z),t=profile?[profile.x,profile.level,profile.width,z]:T[i].map((v,q)=>v*(1-u)+T[i+1][q]*u),e=Math.abs(x-t[0])-t[2];if(e<out[1]){out[0]=t[1];out[1]=e;out[2]=.035;out[3]=.3;}}
  const e=(Math.hypot((x-M.x)/M.rx,(z-M.z)/M.rz)-1.04)*Math.min(M.rx,M.rz);if(e<out[1]){out[0]=2.4-3.1*smooth(6850,7850,z);out[1]=e;out[2]=.025;out[3]=.07;}return out;
 };
 field.island=world;field.northRuns=world.source.runs;field.sourceWater=headwater;field.sourceCenter=sg.center;
}
