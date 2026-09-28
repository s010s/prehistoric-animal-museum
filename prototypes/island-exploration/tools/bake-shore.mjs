import {writeFileSync} from 'node:fs';
import {terrainHeight} from '../field.js';
const size=768,N=385,data=new Float32Array(N*N);
for(let j=0;j<N;j++)for(let i=0;i<N;i++)data[j*N+i]=terrainHeight(9160-size/2+i*size/(N-1),2330-size/2+j*size/(N-1));
writeFileSync(new URL('../public/assets/coast-height.bin',import.meta.url),Buffer.from(data.buffer));console.log(JSON.stringify({size:N,bytes:data.byteLength,min:Math.min(...data.subarray(0,1000))}));
