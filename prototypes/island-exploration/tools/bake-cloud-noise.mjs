import {writeFileSync} from 'node:fs';
// Periodic gradient-noise volume; generated locally, no external imagery.
const size=64, data=new Uint8Array(size**3*4);
const fract=x=>x-Math.floor(x), hash=(x,y,z)=>fract(Math.sin(x*127.1+y*311.7+z*74.7)*43758.5453), mix=(a,b,t)=>a+(b-a)*t;
function noise(x,y,z,c){
 x*=c;y*=c;z*=c;const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),fx=fract(x),fy=fract(y),fz=fract(z),fade=t=>t*t*t*(t*(t*6-15)+10);
 const gradient=(a,b,d)=>{const gx=((ix+a)%c+c)%c,gy=((iy+b)%c+c)%c,gz=((iz+d)%c+c)%c,angle=hash(gx,gy,gz)*Math.PI*2,up=hash(gx+17,gy+31,gz+53)*2-1,side=Math.sqrt(1-up*up);return Math.cos(angle)*side*(fx-a)+up*(fy-b)+Math.sin(angle)*side*(fz-d);};
 const u=fade(fx),v=fade(fy),w=fade(fz);return .5+mix(mix(mix(gradient(0,0,0),gradient(1,0,0),u),mix(gradient(0,1,0),gradient(1,1,0),u),v),mix(mix(gradient(0,0,1),gradient(1,0,1),u),mix(gradient(0,1,1),gradient(1,1,1),u),v),w)*.9;
}
function billow(x,y,z,c){x*=c;y*=c;z*=c;const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),fx=fract(x),fy=fract(y),fz=fract(z);let d=3;for(let k=-1;k<=1;k++)for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){const a=(ix+i+c)%c,b=(iy+j+c)%c,e=(iz+k+c)%c;d=Math.min(d,(i+hash(a,b,e)-fx)**2+(j+hash(a+19,b+19,e+19)-fy)**2+(k+hash(a+41,b+41,e+41)-fz)**2)}return Math.max(0,1-Math.sqrt(d));}
for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){const a=(x+.5)/size,b=(y+.5)/size,c=(z+.5)/size,i=((z*size+y)*size+x)*4;data[i]=Math.round((noise(a,b,c,4)*.64+noise(a,b,c,8)*.26+noise(a,b,c,16)*.10)*255);data[i+1]=Math.round((billow(a,b,c,8)*.7+billow(a,b,c,16)*.3)*255);data[i+2]=Math.round(noise(a,b,c,16)*255);data[i+3]=255;}
writeFileSync(new URL('../public/assets/cloud-volume.bin',import.meta.url),data);console.log(`cloud volume ${size}³, ${data.length} bytes`);
