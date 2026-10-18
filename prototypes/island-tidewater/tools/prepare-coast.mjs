// Museum-owned western coast, in the same translated coordinates as the creek.
import {createServer} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {museumReliefPlugin,loadMuseumSampler,reliefRevision} from './museum-relief.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const previous=path.resolve(process.argv[2]??path.join(root,'../../../island-perceptual-budget'));
const out=path.join(root,'creek/assets');await mkdir(out,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
const server=await createServer({configFile:false,plugins:[museumReliefPlugin()],root:previous,cacheDir:path.join(root,'.cache/coast-export'),optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,hmr:false,watch:null},appType:'custom'});
try{
 const F=await loadMuseumSampler(server);
 const H=await server.ssrLoadModule('/prototypes/island-exploration/habitat.js');
 const R=await server.ssrLoadModule('/prototypes/island-exploration/sample-region.js');
 const origin=[-2000,-650],size=4096,res=1024,maskRes=512,seaLevel=-.7;
 const heights=new Float32Array(res*res);let min=Infinity,max=-Infinity;
 for(let j=0;j<res;j++){const z=origin[1]-size/2+(j+.5)*size/res;for(let i=0;i<res;i++){const h=F.terrainHeight(origin[0]-size/2+(i+.5)*size/res,z);if(!Number.isFinite(h))throw Error('Nonfinite coast');heights[j*res+i]=h;min=Math.min(min,h);max=Math.max(max,h);}if(j%128===0)console.log(`Own coast height ${j}/${res}`);}
 const masks=new Uint8Array(maskRes*maskRes*4);
 for(let j=0;j<maskRes;j++)for(let i=0;i<maskRes;i++){const x=origin[0]-size/2+(i+.5)*size/maskRes,z=origin[1]-size/2+(j+.5)*size/maskRes,h=F.terrainHeight(x,z),ny=F.slopeAt(x,z),wood=F.woodland(x,z),trail=H.trailWeight(x,z),water=F.waterLevelAt(x,z),k=(j*maskRes+i)*4;masks[k]=Math.round(trail*255);masks[k+1]=Math.round(F.smooth(.72,.94,ny)*F.smooth(.22,1.3,h-water)*(1-trail)*(.28+.48*(1-wood))*255);masks[k+2]=Math.round((1-F.smooth(.38,.83,ny))*255);masks[k+3]=Math.round(wood*255);}
 const trees=[];for(let z=-1900;z<1900;z+=14)for(let x=-1900;x<1900;x+=14){if(Math.max(Math.abs(x),Math.abs(z))<480)continue;const sx=x+origin[0]+(F.hash(x+11,z+7)-.5)*10,sz=z+origin[1]+(F.hash(x+79,z+31)-.5)*10,wood=F.woodland(sx,sz);if(F.hash(x+197,z-31)>wood*.8||H.trailWeight(sx,sz)>.03||R.regionOpening(sx,sz,4)||F.terrainHeight(sx,sz)<F.waterLevelAt(sx,sz)+2)continue;trees.push({x:sx-origin[0],z:sz-origin[1],s:.82+F.hash(x+7,z+333)*.72,sy:.87+F.hash(x+45,z+61)*.3,yaw:F.hash(x,z+57)*Math.PI*2,seed:F.hash(x+9,z+17)});}
 const shores=[];for(let z=-1150;z<450;z+=12){let a=-3900,previousH=F.terrainHeight(a,z);for(let x=a+12;x<-2550;x+=12){const h=F.terrainHeight(x,z);if(previousH<seaLevel&&h>=seaLevel){let lo=x-12,hi=x;for(let i=0;i<18;i++){const m=(lo+hi)/2;if(F.terrainHeight(m,z)<seaLevel)lo=m;else hi=m;}const edge=(lo+hi)/2,inland=F.terrainHeight(edge+18,z),deep=F.terrainHeight(edge-35,z);shores.push({x:edge-origin[0],z:z-origin[1],source:[edge,z],inland,deep,score:Math.max(0,inland-seaLevel)*.12+Math.abs(z+650)/750});break;}previousH=h;}}
 shores.sort((a,b)=>a.score-b.score);if(!shores.length)throw Error('No verified original coast');
 const coast=shores[0],layout={schema:'museum-own-coast-v1',sourceOrigin:origin,relief:reliefRevision,size,res,texel:size/res,origin:-size/2,maskRes,seaLevel,minHeight:min,maxHeight:max,coast,trees,coreBlend:[448,496],notes:'Museum coast with protected original waterline and revised upland relief; shared 1m creek core.'};
 const outputs=[];for(const [name,b]of [['coast-heights.bin',Buffer.from(heights.buffer)],['coast-masks.bin',Buffer.from(masks.buffer)],['coast-layout.json',Buffer.from(JSON.stringify(layout))]]){await writeFile(path.join(out,name),b);outputs.push({path:'assets/'+name,bytes:b.length,sha256:hash(b)});}
 const sources=JSON.parse(await readFile(path.join(root,'creek/geography.lock.json'),'utf8')).sources;
 await writeFile(path.join(root,'creek/coast.lock.json'),JSON.stringify({schema:'museum-coast-export-v1',sourceOrigin:origin,relief:reliefRevision,reliefAdapterSha256:hash(await readFile(new URL('./museum-relief.mjs',import.meta.url))),sources,outputs,coast,outerTexelMetres:4,coreTexelMetres:1,outerSize:4096,trees:trees.length},null,2)+'\n');
 console.log(JSON.stringify({complete:true,coast,trees:trees.length,min,max,outputs}));
}finally{await server.close();}
