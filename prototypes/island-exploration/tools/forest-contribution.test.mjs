// Failure cases and isolated scope are recorded in phase2/forest-contribution.md
// before implementation. This does not simulate GPU alpha/depth or milliseconds.
import assert from 'node:assert/strict';
import * as T from 'three';
import {readFile,writeFile} from 'node:fs/promises';
const result={schema:'forest-contribution-isolated-v1',checks:[],gpuExecuted:false};
const check=(name,fn)=>{fn();result.checks.push(name);};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
try{
 const {projectForestPolygon,createForestContributionAudit}=await import('../forest-impostor.js');
 const viewport=[0,0,100,100],quad=[[-.5,-.5,0,1,2],[.5,-.5,0,1,2],[.5,.5,0,1,2],[-.5,.5,0,1,2]];
 check('known quad pixel area and width',()=>{const p=projectForestPolygon(quad,viewport);close(p.areaPx2,2500);close(p.diameterPx,50);close(p.minDepth,2);});
 check('viewport uses real target pixels',()=>{const p=projectForestPolygon(quad,[40,60,512,256]);close(p.areaPx2,32768);close(p.diameterPx,256);});
 check('scissor bounds actual raster region',()=>{const p=projectForestPolygon(quad,viewport,[25,25,25,50]);close(p.areaPx2,1250);});
 check('behind camera rejected without explosive divide',()=>assert.equal(projectForestPolygon(quad.map(p=>[p[0],p[1],p[2],-1,p[4]]),viewport),null));
 check('near crossing clipped before divide',()=>{const p=projectForestPolygon([[-.5,-.5,-2,1,.05],[.5,-.5,0,1,2],[.5,.5,0,1,2],[-.5,.5,-2,1,.05]],viewport);assert.ok(p.areaPx2>0&&p.areaPx2<2500);assert.ok(p.minDepth>.05);});
 check('screen clipping limits giant quad area',()=>{const p=projectForestPolygon(quad.map(p=>[p[0]*10,p[1]*10,p[2],p[3],p[4]]),viewport);close(p.areaPx2,10000);});
 check('finite and zero viewport guards',()=>{assert.equal(projectForestPolygon(quad.map(p=>[NaN,...p.slice(1)]),viewport),null);assert.equal(projectForestPolygon(quad,[0,0,0,100]),null);});
 const audit=createForestContributionAudit(),viewer={value:new T.Vector3()},range={value:8500},fraction={value:1};
 const mesh=new T.InstancedMesh(new T.PlaneGeometry(1.4,1.4),new T.MeshBasicMaterial(),3),records=[{id:10,species:0},{id:20,species:0},{id:30,species:0}];
 for(let i=0;i<3;i++)mesh.setMatrixAt(i,new T.Matrix4().compose(new T.Vector3(i*15,0,-(i===2?400:50+i*100)),new T.Quaternion(),new T.Vector3(20,30,20)));mesh.updateMatrixWorld();
 mesh.geometry.setAttribute('nearSeed',new T.InstancedBufferAttribute(new Float32Array([.1,.2,.3]),1));
 let oldCalls=0;mesh.onBeforeRender=()=>oldCalls++;
 audit.observe(mesh,{records,templates:[{height:30,width:18}],viewerPosition:viewer,forestRange:range,nearFraction:fraction});
 const camera=new T.PerspectiveCamera(60,1,.1,10000);camera.updateMatrixWorld();
 const target={width:512,height:512,texture:{uuid:'mirror'},scissor:new T.Vector4(0,0,256,512),scissorTest:true};let currentTarget=null;
 const renderer={getRenderTarget:()=>currentTarget,getCurrentViewport:v=>v.set(0,0,currentTarget?512:1000,currentTarget?512:1000),getDrawingBufferSize:v=>v.set(1000,1000),getScissorTest:()=>false};
 check('disabled audit avoids renderer and preserves callback',()=>{mesh.onBeforeRender({},null,camera);assert.equal(oldCalls,1);assert.equal(audit.active,false);});
 check('invalid audit options rejected',()=>assert.throws(()=>audit.begin({sampleStride:NaN})));
 audit.begin({sampleStride:1,maxSamples:20,maxRecords:20});mesh.onBeforeRender(renderer,null,camera);
 currentTarget=target;fraction.value=0;const mirror=camera.clone();mirror.projectionMatrix.elements[8]=.2;mirror.updateMatrixWorld();mesh.onBeforeRender(renderer,null,mirror);const data=audit.end();
 check('actual projection viewport and target captured',()=>{assert.equal(data.passes.length,2);const p=data.passes.find(p=>p.target.width===512);assert.deepEqual(p.viewport,[0,0,512,512]);assert.equal(p.projection[8],.2);assert.deepEqual(p.scissor,[0,0,256,512]);});
 check('main far discard differs from reflection live nearFraction',()=>{assert.equal(data.passes[0].hiddenNearSamples,1);assert.equal(data.passes[1].hiddenNearSamples,0);});
 check('root 280m ownership and nominal fetch counts retained',()=>{const rows=data.passes.flatMap(p=>p.records);assert.ok(rows.some(p=>p.id===20&&p.atlasFrames===4&&p.maxAtlasFetchesPerPixel===8));assert.ok(rows.some(p=>p.id===30&&p.atlasFrames===1&&p.maxAtlasFetchesPerPixel===2));});
 check('paired records share identity and actual crop measurements',()=>{assert.ok(data.pairs.some(p=>p.id===20));assert.equal(data.pairs[0].passes.length,2);});
 check('report is detached and end disables collection',()=>{const old=JSON.stringify(data);fraction.value=1;mesh.onBeforeRender(renderer,null,camera);assert.equal(JSON.stringify(data),old);assert.equal(audit.active,false);});
 audit.begin({sampleStride:1,maxSamples:1,maxRecords:1});mesh.onBeforeRender(renderer,null,camera);const bounded=audit.end().passes[0];
 check('bounded explicit samples and no cap extrapolation',()=>{assert.equal(bounded.sampledInstances,1);assert.equal(bounded.sampleLimitReached,true);assert.equal(bounded.estimatedVisibleSubmittedInstances,null);assert.ok(bounded.records.length<=1);});
 const source=await readFile(new URL('../forest-impostor.js',import.meta.url),'utf8'),props=await readFile(new URL('../props.js',import.meta.url),'utf8');
 check('shader280 unchanged and no added render target/pass',()=>{assert.match(source,/if\(rootDistance>280\.\)/);assert.doesNotMatch(source,/new T\.WebGLRenderTarget|renderer\.render\(/);});
 check('caster qualification and installation named separately',()=>{assert.match(props,/nearColourEligible/);assert.match(props,/casterCPUEligible/);assert.match(props,/casterInstalled/);assert.doesNotMatch(props,/nearSelected:/);});
 result.passed=true;
}catch(error){result.passed=false;result.error=String(error);process.exitCode=1;}
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
