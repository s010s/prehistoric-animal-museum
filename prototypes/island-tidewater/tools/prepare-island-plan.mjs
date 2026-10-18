// Read-only full-island cartography from the museum's existing authored world.
// Planning data only: it does not pretend all sectors are loaded in the 3D slice.
import {createServer} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {museumReliefPlugin,loadMuseumSampler,reliefRevision} from './museum-relief.mjs';
import {ISLAND_PLAN} from '../island/plan.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const previous=path.resolve(process.argv[2]??path.join(root,'../../../island-perceptual-budget'));
const out=path.join(root,'island/assets');await mkdir(out,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const server=await createServer({configFile:false,root:previous,plugins:[museumReliefPlugin()],cacheDir:path.join(root,'.cache/island-plan'),optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,hmr:false,watch:null},appType:'custom'});
try{
 const F=await loadMuseumSampler(server),res=512,[x0,z0,x1,z1]=ISLAND_PLAN.bounds;
 const heights=new Float32Array(res*res),water=new Float32Array(res*res),habitat=new Uint8Array(res*res*4);let land=0;
 for(let j=0;j<res;j++){for(let i=0;i<res;i++){
  const x=x0+(i+.5)*(x1-x0)/res,z=z0+(j+.5)*(z1-z0)/res,k=j*res+i;
  heights[k]=F.terrainHeight(x,z);water[k]=F.waterLevelAt(x,z);const e=F.biomeAt(x,z);
  habitat.set([e.marsh*255,e.grass*255,e.heath*255,F.woodland(x,z)*255].map(Math.round),k*4);if(heights[k]>F.SEA)land++;
  if(!Number.isFinite(heights[k])||!Number.isFinite(water[k]))throw Error('Invalid full island sample');
 }if(j%128===0)console.log('Island plan rows',j+'/'+res);}
 const rivers=[Array.from({length:105},(_,i)=>{const z=-3980+i*80;return [F.riverX(z),z];}),Array.from({length:70},(_,i)=>{const z=100+i*80;return [F.tributaryX(z),z];})];
 const meta={rivers,schema:'museum-island-cartography-v1',plan:ISLAND_PLAN.id,bounds:ISLAND_PLAN.bounds,res,texelMetres:(x1-x0)/res,seaLevel:F.SEA,landAreaKm2:land*((x1-x0)/res)**2/1e6,relief:reliefRevision,scope:'Cartography of existing source world; current 3D loaded bounds are separately marked.'};
 const outputs=[];for(const [name,bytes]of [['heights.bin',Buffer.from(heights.buffer)],['water.bin',Buffer.from(water.buffer)],['habitat.bin',Buffer.from(habitat.buffer)],['map.json',Buffer.from(JSON.stringify(meta))]]){await writeFile(path.join(out,name),bytes);outputs.push({path:'assets/'+name,bytes:bytes.length,sha256:sha(bytes)});}
 const sources=JSON.parse(await readFile(path.join(root,'creek/geography.lock.json'),'utf8')).sources;
 await writeFile(path.join(root,'island/export.lock.json'),JSON.stringify({schema:'museum-island-plan-export-v1',sources,adapterSha256:sha(await readFile(new URL('./museum-relief.mjs',import.meta.url))),outputs,meta},null,2)+'\n');console.log(JSON.stringify({complete:true,...meta}));
}finally{await server.close();}
