import {writeFileSync} from 'node:fs';
// Periodic weather FBM adapted from Tidewater SkyProClouds.js (MIT, DRG Software Solutions LLC).
// Keep the independent mass/detail distribution separate from the 3D cloud shape.
const size=1024,data=new Uint8Array(size*size),mix=(a,b,t)=>a+(b-a)*t,clamp=x=>Math.max(0,Math.min(1,x));
function hash(x,y,z){let a=(Math.imul(x,1664525)+1013904223)>>>0,b=(Math.imul(y,1664525)+1013904223)>>>0,c=(Math.imul(z,1664525)+1013904223)>>>0;a=(a+Math.imul(b,c))>>>0;b=(b+Math.imul(c,a))>>>0;c=(c+Math.imul(a,b))>>>0;a^=a>>>16;b^=b>>>16;c^=c>>>16;a=(a+Math.imul(b,c))>>>0;return (a>>>24)&15;}
function noise(x,y,z,period){const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),fx=x-ix,fy=y-iy,fz=z-iz,fade=t=>t*t*t*(t*(t*6-15)+10),wrap=n=>((n%period)+period)%period;
 const g=(a,b,c)=>{const h=hash(wrap(ix+a),wrap(iy+b),wrap(iz+c)),dx=fx-a,dy=fy-b,dz=fz-c,u=h<8?dx:dy,v=h<4?dy:h===12||h===14?dx:dz;return (h&1?-u:u)+(h&2?-v:v)};
 return mix(mix(mix(g(0,0,0),g(1,0,0),fade(fx)),mix(g(0,1,0),g(1,1,0),fade(fx)),fade(fy)),mix(mix(g(0,0,1),g(1,0,1),fade(fx)),mix(g(0,1,1),g(1,1,1),fade(fx)),fade(fy)),fade(fz));}
function fbm(x,y,f,n,seed){let w=.5,sum=0,total=0;for(let i=0;i<n;i++){sum+=noise(x*f,y*f,(seed*13.37+.5)*f,f)*w;total+=w;w*=.5;f*=2;}return sum/total*.5+.5;}
for(let y=0;y<size;y++)for(let x=0;x<size;x++){const u=x/size,v=y/size,mass=clamp((fbm(u,v,4,5,0)-.5)*1.32+.5),detail=(fbm(u,v,6,6,1)*2-1)*.13;data[y*size+x]=Math.round(clamp(mass+detail+.26-.5)*255);}
writeFileSync(new URL('../public/assets/cloud-weather.bin',import.meta.url),data);
const sorted=data.slice().sort();console.log(JSON.stringify({size,mean:data.reduce((s,x)=>s+x,0)/data.length/255,p10:sorted[Math.floor(data.length*.1)]/255,p50:sorted[Math.floor(data.length*.5)]/255,p90:sorted[Math.floor(data.length*.9)]/255}));
