// Established failures before implementation: root displacement; yaw/species
// changes wind direction; scale changes displacement per world metre; near and
// proxy centers diverge; inverse atlas ray uses static center or misses shear;
// color/depth shaders differ; flutter erased; stale program key; new RT/pass.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import * as T from 'three';
const result={schema:'tree-wind-isolated-v1',checks:[],gpuExecuted:false};
const check=(name,fn)=>{fn();result.checks.push(name);};
const near=(a,b)=>assert.ok(a.every((v,i)=>Math.abs(v-b[i])<1e-9),JSON.stringify({a,b}));
try{
 const {treeWindSlopeAt,bendTreePoint,unbendTreeDirection,treeWindFieldGLSL,treeWindGLSL}=await import('../tree-wind.js');
 const {configureForestImpostor}=await import('../forest-impostor.js');
 const root=[-2051.53,28,-680];
 check('roots fixed through time',()=>{for(const time of [0,1,61,300])near(bendTreePoint(root,root,time),root);});
 check('world height rules independent of yaw/scale/species',()=>{for(const yaw of [0,.9,3.1])for(const scale of [.5,1,2.7])for(const species of [0,1,2,3]){const p=new T.Vector3(2/scale,18/scale,3/scale).multiplyScalar(scale).applyAxisAngle(new T.Vector3(0,1,0),yaw).add(new T.Vector3(...root));const moved=bendTreePoint(p.toArray(),root,61),slope=treeWindSlopeAt(root,61);near(moved.map((v,i)=>v-p.getComponent(i)),slope.map(v=>v*18));assert.ok(species>=0);}});
 check('arbitrary world direction inversion',()=>{const slope=treeWindSlopeAt(root,61);for(const direction of [[2,18,3],[-20,-7,11],[0,0,0]]){const bent=direction.map((v,i)=>v+slope[i]*direction[1]);near(unbendTreeDirection(bent,slope),direction);}});
 check('deformed center camera ray inverse is exact',()=>{const center=[root[0],root[1]+17,root[2]],C=bendTreePoint(center,root,61),eye=[root[0]+24,root[1]+50,root[2]-100],point=[root[0]+3,root[1]+20,root[2]+4],P=bendTreePoint(point,root,61),slope=treeWindSlopeAt(root,61);const O=unbendTreeDirection(eye.map((v,i)=>v-C[i]),slope),D=unbendTreeDirection(P.map((v,i)=>v-eye[i]),slope);near(O.map((v,i)=>v+D[i]),point.map((v,i)=>v-center[i]));});
 check('near local basis returns shared world offset',()=>{for(const yaw of [0,1.2,4]){const basis=new T.Matrix3().setFromMatrix4(new T.Matrix4().compose(new T.Vector3(),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),yaw),new T.Vector3(.8,1.4,1.2)));const local=new T.Vector3(2,14,3),world=local.clone().applyMatrix3(basis),desired=new T.Vector3(...treeWindSlopeAt(root,61)).multiplyScalar(world.y),offset=desired.clone().applyMatrix3(basis.clone().invert());near(offset.applyMatrix3(basis).toArray(),desired.toArray());}});
 const mesh={material:new T.MeshStandardMaterial()},atlas={cell:256,rows:12,normalMap:new T.Texture()},viewer={value:new T.Vector3()},range={value:8500},fraction={value:1};configureForestImpostor(mesh,atlas,viewer,range,fraction);
 const shader={uniforms:{},vertexShader:T.ShaderLib.standard.vertexShader,fragmentShader:T.ShaderLib.standard.fragmentShader};mesh.material.onBeforeCompile(shader);
 check('proxy vertex shares field and deform center',()=>{assert.ok(shader.vertexShader.includes(treeWindFieldGLSL));assert.match(shader.vertexShader,/impostorCenter=center\+treeSway\*\(center\.y-root\.y\)/);assert.match(shader.vertexShader,/airWorld\+=treeSway\*\(airWorld\.y-root\.y\)/);});
 check('atlas ray references deform center and inverse shear',()=>{assert.match(shader.fragmentShader,/O=cameraPosition-impostorCenter/);assert.match(shader.fragmentShader,/O-=treeSway\*O\.y;D-=treeSway\*D\.y/);assert.doesNotMatch(shader.fragmentShader,/O=cameraPosition-\(treeRoot/);});
 const props=await readFile(new URL('../props.js',import.meta.url),'utf8');
 check('color and depth use same basis-aware deformation',()=>{assert.equal((props.match(/treeWindOffset\(position,(?:root|treeRoot),leafMotion,mat3\(modelMatrix\*instanceMatrix\)\)/g)??[]).length,2);});
 check('flutter preserved and wind coordinate conversion explicit',()=>{assert.match(treeWindGLSL,/inverse\(worldBasis\)/);assert.match(treeWindGLSL,/flutter\*leaf\*smoothstep\(1\.,5\.,height\)/);});
 check('new proxy program revision and no GPU resource work',()=>{assert.match(mesh.material.customProgramCacheKey(),/r12/);assert.doesNotMatch(treeWindGLSL,/texture|sampler|RenderTarget/);});
 result.passed=true;
}catch(error){result.passed=false;result.error=String(error);process.exitCode=1;}
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
