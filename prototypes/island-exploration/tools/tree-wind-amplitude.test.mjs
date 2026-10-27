// Failure inventory and seams agreed before implementation: see
// docs/research/perceptual-budget/phase3/wind-amplitude-preimplementation.md.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const result={schema:'tree-wind-amplitude-isolated-v1',checks:[],gpuExecuted:false};
const check=(name,fn)=>{fn();result.checks.push(name);};
const root=[-1945.9559516191832,20.98102430078286,-512.9167288541794],height=12.505061919800937;
try{
 const {treeWindConfig,treeWindSlopeAt,bendTreePoint,treeWindFieldGLSL,treeWindGLSL}=await import('../tree-wind.js');
 check('immutable build config records fourfold shear with original flutter/frequency',()=>{assert.ok(Object.isFrozen(treeWindConfig));assert.equal(treeWindConfig.amplitudeMultiplier,4);assert.equal(treeWindConfig.flutterMultiplier,1);assert.equal(treeWindConfig.frequencyMultiplier,1);});
 check('actual tree root stays fixed and displacement is continuous',()=>{const bound=height*Math.hypot(.008*(.61+.32*1.37),.0028*.47);for(let i=0;i<1200;i++){const t=60+i*.01,p=[root[0],root[1]+height,root[2]],a=bendTreePoint(p,root,t),b=bendTreePoint(p,root,t+.01);assert.deepEqual(bendTreePoint(root,root,t),root);assert.ok(a.every(Number.isFinite));assert.ok(Math.hypot(...b.map((v,j)=>v-a[j]))<=bound*.01+1e-9);}});
 const length=Math.hypot(-.38,.58,.72),light=[-.38,.58,.72].map(v=>v/length),points=[];
 for(let i=0;i<=1200;i++){const delta=treeWindSlopeAt(root,60+i*.01).map(v=>v*height),along=delta.reduce((n,v,j)=>n+v*light[j],0);points.push(delta.map((v,j)=>v-along*light[j]));}
 let pair=0;for(const a of points)for(const b of points)pair=Math.max(pair,Math.hypot(...a.map((v,j)=>v-b[j])));
 result.actualTreeLightPlaneMaximumPairMeters=pair;result.actualTreeLightPlaneMaximumPairTexels=pair/(280/2048);
 check('worked actual-tree light-plane motion reaches 1.65666 shadow texels',()=>{assert.ok(Math.abs(pair-.22649694951650737)<1e-8);assert.ok(result.actualTreeLightPlaneMaximumPairTexels>1.65&&result.actualTreeLightPlaneMaximumPairTexels<1.67);});
 check('GLSL build constants and frequencies match the CPU field',()=>{assert.match(treeWindFieldGLSL,/gust\*0\.008/);assert.match(treeWindFieldGLSL,/\*0\.0028/);for(const frequency of ['treeTime*.61','treeTime*1.37','treeTime*.47'])assert.ok(treeWindFieldGLSL.includes(frequency));});
 check('leaf flutter remains unamplified',()=>{assert.match(treeWindGLSL,/vec3\(\.014,\.005,\.009\)\*flutter\*leaf/);assert.match(treeWindGLSL,/treeTime\*2\.7/);assert.match(treeWindGLSL,/treeTime\*1\.9/);});
 const props=await readFile(new URL('../props.js',import.meta.url),'utf8');
 check('status exposes the exact shared config and existing near guard',()=>{assert.match(props,/import \{treeWindGLSL,treeWindConfig\} from '\.\/tree-wind\.js'/);assert.match(props,/treeWind:\{\.\.\.treeWindConfig\}/);assert.match(props,/mesh\.boundingSphere\.radius\+=1/);});
 // Source-derived upper bounds: base height <=41, sibling factor <=1.10,
 // geometry height <=1.1 declared template height (ginkgo card upper envelope),
 // maximum lateral instance scale <=1.25, minimum template height >=15.
 result.conservativeNearDisplacementMeters=45.1*1.1*Math.hypot(.008*1.32,.0028)+45.1/15*1.25*Math.hypot(.014,.005,.009);
 check('largest generated tree plus unchanged flutter fits existing 1m guard',()=>{assert.ok(result.conservativeNearDisplacementMeters<.61);assert.ok(result.conservativeNearDisplacementMeters<1);});
 result.passed=true;
}catch(error){result.passed=false;result.error=String(error);process.exitCode=1;}
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
