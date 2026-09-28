import {writeFileSync} from 'node:fs';
import {terrainHeight} from '../field.js';
const N=385,data=new Float32Array(N*N*2),cells=[[9160,2330,768],[-3200,3600,1536]];
for(let k=0;k<2;k++){const[x,z,size]=cells[k];for(let j=0;j<N;j++)for(let i=0;i<N;i++)data[j*N*2+k*N+i]=terrainHeight(x-size/2+i*size/(N-1),z-size/2+j*size/(N-1));}
writeFileSync(new URL('../public/assets/coast-height-r9.bin',import.meta.url),Buffer.from(data.buffer));console.log(JSON.stringify({width:N*2,height:N,bytes:data.byteLength,cells}));
