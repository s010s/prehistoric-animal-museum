// Full museum geography, exported from our authored world. Upstream Tidewater
// supplies rendering contracts, never the island layout. Run once, offline.
import {createServer} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {museumReliefPlugin,loadMuseumSampler,reliefRevision} from './museum-relief.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const previous=path.resolve(process.argv[2]??path.join(root,'../../../island-perceptual-budget'));
const out=path.join(root,'creek/assets');await mkdir(out,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex'),outputs=[];
const save=async(name,data)=>{const b=Buffer.isBuffer(data)?data:Buffer.from(data.buffer??JSON.stringify(data));await writeFile(path.join(out,name),b);outputs.push({path:'assets/'+name,bytes:b.length,sha256:hash(b)});};
const server=await createServer({configFile:false,plugins:[museumReliefPlugin()],root:previous,cacheDir:path.join(root,'.cache/island-export'),optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,hmr:false,watch:null},appType:'custom'});
try{
 const F=await loadMuseumSampler(server),H=await server.ssrLoadModule('/prototypes/island-exploration/habitat.js'),S=await server.ssrLoadModule('/prototypes/island-exploration/spring.js');
 const sourceOrigin=[-2000,-650],seaLevel=-.7,size=32768,res=2048,maskRes=1024;
 const source=(x,z)=>[x+sourceOrigin[0],z+sourceOrigin[1]];
 const grids=[{id:'island',center:[0,0],size,res},{id:'north',center:[2048,-6144],size:8192,res:2048},{id:'east',center:[8192,4096],size:8192,res:2048},{id:'source',center:[S.springOrigin.x-sourceOrigin[0],S.springOrigin.z-sourceOrigin[1]],size:256,res:512}];
 for(const g of grids){const heights=new Float32Array(g.res*g.res);g.texel=g.size/g.res;g.min=Infinity;g.max=-Infinity;
  for(let j=0;j<g.res;j++){const z=g.center[1]-g.size/2+(j+.5)*g.texel+sourceOrigin[1];for(let i=0;i<g.res;i++){const x=g.center[0]-g.size/2+(i+.5)*g.texel+sourceOrigin[0],h=F.terrainHeight(x,z);if(!Number.isFinite(h))throw Error('Nonfinite island');heights[j*g.res+i]=h;g.min=Math.min(g.min,h);g.max=Math.max(g.max,h);}if(j%256===0)console.log(g.id+' heights '+j+'/'+g.res);}
  g.file='island-'+g.id+'-heights.bin';await save(g.file,heights);
 }
 const masks=new Uint8Array(maskRes*maskRes*4);
 for(let j=0;j<maskRes;j++){for(let i=0;i<maskRes;i++){const [x,z]=source(-size/2+(i+.5)*size/maskRes,-size/2+(j+.5)*size/maskRes),k=(j*maskRes+i)*4,h=F.terrainHeight(x,z);if(h<seaLevel-.4)continue;const water=F.waterLevelAt(x,z),ny=F.slopeAt(x,z),wood=F.woodland(x,z),trail=H.trailWeight(x,z),b=F.biomeAt(x,z);masks[k]=Math.round(trail*255);masks[k+1]=Math.round(F.smooth(.70,.94,ny)*F.smooth(.18,1.2,h-water)*(1-trail)*(.38+.46*(1-wood))*(1-b.heath*.68)*255);masks[k+2]=Math.round((1-F.smooth(.35,.83,ny))*255);masks[k+3]=Math.round(wood*255);}if(j%256===0)console.log('island habitat '+j+'/'+maskRes);}
 await save('island-habitat.bin',masks);
 const trees=[];
 for(let z=-9000;z<10800;z+=24)for(let x=-6500;x<13000;x+=24){
  if(Math.max(Math.abs(x),Math.abs(z))<1860)continue;
  const jx=x+(F.hash(x+11,z+7)-.5)*19,jz=z+(F.hash(x+79,z+31)-.5)*19,[sx,sz]=source(jx,jz),wood=F.woodland(sx,sz),b=F.biomeAt(sx,sz);
  if(F.hash(x+197,z-31)>wood*.92||H.trailWeight(sx,sz)>.03||F.terrainHeight(sx,sz)<F.waterLevelAt(sx,sz)+1.5)continue;
  trees.push({x:jx,z:jz,s:.82+F.hash(x+7,z+333)*.78,sy:.87+F.hash(x+45,z+61)*.34,yaw:F.hash(x,z+57)*Math.PI*2,seed:F.hash(x+9,z+17),heath:b.heath,grass:b.grass,marsh:b.marsh});
 }
 const waterRuns=S.springRuns.map(run=>run.map(p=>({...p,x:p.x-sourceOrigin[0],z:p.z-sourceOrigin[1]})));
 const sourceWater=new Float32Array(512*512*4),sg=grids[3];
 for(let j=0;j<512;j++)for(let i=0;i<512;i++){const [x,z]=source(sg.center[0]-128+(i+.5)*.5,sg.center[1]-128+(j+.5)*.5),s=S.springAt(x,z),k=(j*512+i)*4;let level=F.riverLevel(z),edge=z>=-3930?Math.abs(x-F.riverX(z))-F.halfWidth(z)-25:10000,vx=0,vz=.38;
  if(s&&!s.forest&&s.edge<edge){level=s.level;edge=s.edge;const near=S.springRuns.flatMap(run=>run).filter(p=>!p.forest).reduce((a,b)=>Math.hypot(a.x-x,a.z-z)<Math.hypot(b.x-x,b.z-z)?a:b);vx=0;vz=near.speed??.3;}
  sourceWater.set([level,edge,vx,vz],k);
 }
 await save('island-source-water.bin',sourceWater);
 const tributary=[];for(let z=-300;z<=5700;z+=8)tributary.push([F.tributaryX(z)-sourceOrigin[0],F.tributaryLevel(z),F.tributaryWidth(z)+8,z-sourceOrigin[1]]);
 const old=JSON.parse(await readFile(path.join(out,'watershed-layout.json'),'utf8'));
 const lakes=[{id:'lake',name:'山间长湖',center:[F.lake.x-sourceOrigin[0],F.lake.z-sourceOrigin[1]],level:F.lake.level,rx:F.lake.rx,rz:F.lake.rz},{id:'tarn',name:'高地冰斗湖',center:[F.tarn.x-sourceOrigin[0],F.tarn.z-sourceOrigin[1]],level:F.tarn.level,rx:F.tarn.rx,rz:F.tarn.rz}];
 const marsh={...F.wetland,x:F.wetland.x-sourceOrigin[0],z:F.wetland.z-sourceOrigin[1]};
 const landmarks=Object.entries(F.LANDMARKS??F.landmarks??{}).map(([id,s])=>({id,...s}));
 const layout={schema:'museum-whole-island-v1',sourceOrigin,size,res,texel:size/res,origin:-size/2,maskRes,seaLevel,grids,trees,lakes,marsh,tributary,source:{...sg,waterSize:256,waterRes:512,runs:waterRuns.slice(0,3)},coasts:old.coasts,relief:reliefRevision,landmarks,notes:'One connected museum-authored island. Global16m + regional4m arrays + original1m core +0.5m headwater; same CPU/GPU surfaces.'};
 await save('island-layout.json',Buffer.from(JSON.stringify(layout)));
 await writeFile(path.join(root,'creek/island.lock.json'),JSON.stringify({schema:layout.schema,sourceOrigin,reliefAdapterSha256:hash(await readFile(new URL('./museum-relief.mjs',import.meta.url))),sources:JSON.parse(await readFile(path.join(root,'creek/geography.lock.json'),'utf8')).sources,outputs,trees:trees.length,grids:grids.map(({id,size,res,texel,min,max})=>({id,size,res,texel,min,max}))},null,2)+'\n');
 console.log(JSON.stringify({complete:true,trees:trees.length,outputs}));
}finally{await server.close();}
