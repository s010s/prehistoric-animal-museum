import {SUN_DIRECTION} from '../lighting-config.js';
// Offline terrain horizons and ecology, no browser.
import {writeFileSync} from 'node:fs';
import {terrainHeight,SIZE,biomeAt,woodland,riverX,halfWidth,smooth} from '../field.js';
const N=1024,H=SIZE/2,step=SIZE/(N-1),height=new Float32Array(N*N),light=new Float32Array(N*N*4);
for(let z=0;z<N;z++)for(let x=0;x<N;x++)height[z*N+x]=terrainHeight(x*step-H,z*step-H);
function sample(x,z){const fx=(x+H)/step,fz=(z+H)/step;if(fx<0||fz<0||fx>N-1||fz>N-1)return -100;const ix=Math.min(N-2,Math.floor(fx)),iz=Math.min(N-2,Math.floor(fz)),u=fx-ix,v=fz-iz;return (height[iz*N+ix]*(1-u)+height[iz*N+ix+1]*u)*(1-v)+(height[(iz+1)*N+ix]*(1-u)+height[(iz+1)*N+ix+1]*u)*v;}
const [sunX,sunY,sunZ]=SUN_DIRECTION,len=Math.hypot(sunX,sunZ),dx=sunX/len,dz=sunZ/len,sy=sunY/len;
for(let z=0;z<N;z++)for(let x=0;x<N;x++){const wx=x*step-H,wz=z*step-H,y=height[z*N+x];let top=y-6,distance=0;
for(let d=step;d<3800;d*=1.13){const horizon=sample(wx+dx*d,wz+dz*d)-sy*d;if(horizon>top){top=horizon;distance=d;}}
let sum=0;for(let a=0;a<8;a++){const angle=a*Math.PI/4;let slope=0;for(const d of [20,40,80,140,240,400,680])slope=Math.max(slope,(sample(wx+Math.cos(angle)*d,wz+Math.sin(angle)*d)-y-1)/d);sum+=1/(1+slope*slope)}
light.set([y,top,distance,sum/8],(z*N+x)*4);}
writeFileSync(new URL('../public/assets/terrain-horizon.bin',import.meta.url),new Uint8Array(light.buffer));
const C=512,cover=new Uint8Array(C*C*4);
for(let z=0;z<C;z++)for(let x=0;x<C;x++){const wx=(x/(C-1)-.5)*SIZE,wz=(z/(C-1)-.5)*SIZE,b=biomeAt(wx,wz),bank=Math.abs(wx-riverX(wz))-halfWidth(wz);const gallery=smooth(-1700,-1500,wz)*(1-smooth(350,650,wz))*smooth(4,18,bank)*(1-smooth(100,160,bank));const forest=Math.max(woodland(wx,wz),gallery*.9);cover.set([forest,b.grass,b.heath,b.marsh].map(v=>Math.round(Math.max(0,Math.min(1,v))*255)),(z*C+x)*4);}
writeFileSync(new URL('../public/assets/terrain-cover.bin',import.meta.url),cover);console.log(JSON.stringify({size:N,bytes:light.byteLength,coverBytes:cover.length}));
