// Export the existing museum main river to its actual tidal outlet; not a new
// artificial cut through the ridge. Old creek/coast source assets stay intact.
import {createServer} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {museumReliefPlugin,loadMuseumSampler,reliefRevision} from './museum-relief.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const previous=path.resolve(process.argv[2]??path.join(root,'../../../island-perceptual-budget'));
const out=path.join(root,'creek/assets');await mkdir(out,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const server=await createServer({configFile:false,plugins:[museumReliefPlugin()],root:previous,cacheDir:path.join(root,'.cache/watershed-export'),optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,hmr:false,watch:null},appType:'custom'});
try{
 const F=await loadMuseumSampler(server),H=await server.ssrLoadModule('/prototypes/island-exploration/habitat.js');
 const origin=[-2000,-650],size=8192,res=2048,texel=4,maskRes=1024,seaLevel=-.7;
 const heights=new Float32Array(res*res);let min=Infinity,max=-Infinity;
 for(let j=0;j<res;j++){const z=origin[1]-size/2+(j+.5)*texel;for(let i=0;i<res;i++){const h=F.terrainHeight(origin[0]-size/2+(i+.5)*texel,z);if(!Number.isFinite(h))throw Error('Nonfinite watershed terrain');heights[j*res+i]=h;min=Math.min(min,h);max=Math.max(max,h);}if(j%256===0)console.log(`Watershed height ${j}/${res}`);}
 const masks=new Uint8Array(maskRes*maskRes*4);
 for(let j=0;j<maskRes;j++)for(let i=0;i<maskRes;i++){const x=origin[0]-size/2+(i+.5)*size/maskRes,z=origin[1]-size/2+(j+.5)*size/maskRes,k=(j*maskRes+i)*4,h=F.terrainHeight(x,z),water=F.waterLevelAt(x,z),wood=F.woodland(x,z),trail=H.trailWeight(x,z),ny=F.slopeAt(x,z);masks[k]=Math.round(trail*255);masks[k+1]=Math.round(F.smooth(.72,.94,ny)*F.smooth(.22,1.3,h-water)*(1-trail)*(.28+.48*(1-wood))*255);masks[k+2]=Math.round((1-F.smooth(.38,.83,ny))*255);masks[k+3]=Math.round(wood*255);}
 const riverStart=-3930-origin[1],riverStep=4,riverCount=Math.ceil((3400+3930)/riverStep)+1,profile=new Float32Array(riverCount*4);
 for(let i=0;i<riverCount;i++){const z=origin[1]+riverStart+i*riverStep,dx=(F.riverX(z+.5)-F.riverX(z-.5));profile.set([F.riverX(z)-origin[0],F.riverLevel(z),F.halfWidth(z)+25,dx],i*4);}
 const existing=JSON.parse(await readFile(path.join(out,'coast-layout.json'),'utf8')).coast;
 const shoreline=(sz,kind)=>{const candidates=[];let old=F.terrainHeight(-5400,sz);for(let x=-5388;x<-2200;x+=12){const h=F.terrainHeight(x,sz);if(old<seaLevel&&h>=seaLevel){let lo=x-12,hi=x;for(let n=0;n<18;n++){const c=(lo+hi)/2;if(F.terrainHeight(c,sz)<seaLevel)lo=c;else hi=c;}const edge=(lo+hi)/2,inland=F.terrainHeight(edge+18,sz);candidates.push({x:edge-origin[0],z:sz-origin[1],source:[edge,sz],inland,kind});}old=h;}if(!candidates.length)throw Error('No source coast at '+sz);return candidates[0];};
 const north=shoreline(-1700,'rocky-cove');
 const rz=2960,rx=F.riverX(rz),rw=F.halfWidth(rz)+25;let bank=null;
 for(let s=0;s<2;s++)for(let d=rw;d<rw+130;d+=2){const x=rx+(s?-1:1)*d,h=F.terrainHeight(x,rz);if(h>seaLevel+.65&&h<seaLevel+4){const score=Math.abs(h-1.1)+d*.008;if(!bank||score<bank.score)bank={x:x-origin[0],z:rz-origin[1],source:[x,rz],inland:h,kind:'tidal-estuary',score};}}
 if(!bank)throw Error('No dry source estuary bank');
 const coasts=[{...existing,id:'coast',name:'西岸贝壳滩',kind:'shell-beach',visit:[existing.x+15,existing.z],gaze:[existing.x-45,.4,existing.z+4]}, {...north,id:'rock-cove',name:'北岸岩湾',visit:[north.x+15,north.z],gaze:[north.x-50,1,north.z+20]}, {...bank,id:'estuary',name:'河海交汇',visit:[bank.x,bank.z],gaze:[rx-origin[0],.1,bank.z+95]}];
 const mouth={source:[F.riverX(2960),2960],local:[F.riverX(2960)-origin[0],2960-origin[1]],level:F.riverLevel(2960),ground:F.terrainHeight(F.riverX(2960),2960)};
 const layout={schema:'museum-main-watershed-v1',sourceOrigin:origin,size,res,texel,origin:-size/2,maskRes,seaLevel,minHeight:min,maxHeight:max,riverStart,riverStep,riverCount,riverProfileLayout:'x,level,halfWidth,dx/dz; source authored river; tide level meets native ocean',coasts,mouth,relief:reliefRevision,notes:'8km regional terrain retains 4m sampling and original 1m creek core; remaining island sectors still planned.'};
 const outputs=[];for(const [name,bytes]of [['watershed-heights.bin',Buffer.from(heights.buffer)],['watershed-masks.bin',Buffer.from(masks.buffer)],['river-profile.bin',Buffer.from(profile.buffer)],['watershed-layout.json',Buffer.from(JSON.stringify(layout))]]){await writeFile(path.join(out,name),bytes);outputs.push({path:'assets/'+name,bytes:bytes.length,sha256:sha(bytes)});}
 const sources=JSON.parse(await readFile(path.join(root,'creek/geography.lock.json'),'utf8')).sources;
 await writeFile(path.join(root,'creek/watershed.lock.json'),JSON.stringify({schema:'museum-main-watershed-export-v1',sources,sourceOrigin:origin,reliefAdapterSha256:sha(await readFile(new URL('./museum-relief.mjs',import.meta.url))),outputs,coasts,mouth},null,2)+'\n');
 console.log(JSON.stringify({complete:true,size,res,riverCount,mouth,coasts,outputs}));
}finally{await server.close();}
