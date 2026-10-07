// Failure scenarios precede implementation: phase2/atlas-policy-preimplementation.md.
import assert from 'node:assert/strict';
import * as T from 'three';
import {readFile,writeFile} from 'node:fs/promises';
const result={schema:'forest-atlas-policy-isolated-v1',checks:[],gpuExecuted:false};
const check=(name,fn)=>{fn();result.checks.push(name);};
const close=(a,b,epsilon=1e-8)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
try{
 const {forestAtlasWeights,forestProjectedCrownPixels,forestFrameGradients,configureForestImpostor,forestAtlasBudgetEnabled}=await import('../forest-impostor.js');
 check('finite nonnegative weights preserve energy',()=>{for(const px of [0,1,24,24.001,30,47.99,48,100])for(const a of [0,.1,.49,.5,.51,.9,7.99])for(const e of [0,.49,.5,.99,1.1,1.99,2]){const frames=forestAtlasWeights(a,e,px);assert.ok(frames.every(f=>Number.isFinite(f.weight)&&f.weight>0&&f.column>=0&&f.column<8&&f.row>=0&&f.row<=2));close(frames.reduce((n,f)=>n+f.weight,0),1);}});
 check('large crowns preserve exact linear bilinear weights',()=>{const frames=forestAtlasWeights(3.2,.3,48);const expected=[.56,.14,.24,.06];frames.forEach((f,i)=>close(f.weight,expected[i]));});
 check('compact small crowns usually read one frame',()=>assert.equal(forestAtlasWeights(3.2,.3,2).length,1));
 check('angular boundary smoothly uses two or four frames',()=>{assert.equal(forestAtlasWeights(3.5,.3,2).length,2);assert.equal(forestAtlasWeights(3.5,.5,2).length,4);});
 const dense=frames=>{const d=Array(24).fill(0);for(const f of frames)d[f.row*8+f.column]+=f.weight;return d;};
 check('pixel thresholds continuous even at angular half cell',()=>{for(const px of [24,48])for(const a of [3.2,3.5,3.8]){const before=dense(forestAtlasWeights(a,.5,px-1e-6)),after=dense(forestAtlasWeights(a,.5,px+1e-6));before.forEach((v,i)=>close(v,after[i],1e-6));}});
 check('small-crown angular half-cell has no round pop',()=>{const before=dense(forestAtlasWeights(3.5-1e-7,.3,1)),after=dense(forestAtlasWeights(3.5+1e-7,.3,1));before.forEach((v,i)=>close(v,after[i],1e-4));});
 check('azimuth wrap continuous and final elevation deduplicated',()=>{assert.equal(forestAtlasWeights(7.9,2,48).length,2);assert.ok(forestAtlasWeights(7.9,2,48).some(f=>f.column===0));assert.equal(forestAtlasWeights(0,2,1).length,1);});
 const camera=new T.PerspectiveCamera(60,1,.3,45000);camera.updateMatrixWorld();const root=new T.Vector3(0,0,-300),scale=new T.Vector3(20,30,20),ratio=.6;
 const pixels=(width,cam=camera,physicalRatio=ratio)=>forestProjectedCrownPixels({root,scale,crownRatio:physicalRatio,camera:cam,viewportWidth:width,time:60});
 check('actual per-pass viewport controls physical crown pixels',()=>close(pixels(512)/pixels(1280),.4));
 check('cropped pass projection changes pixel contribution',()=>{const cropped=camera.clone();cropped.projectionMatrix.elements[0]*=2;close(pixels(512,cropped)/pixels(512),2);});
 check('species template ratio changes pixel width',()=>close(pixels(1280,camera,.9)/pixels(1280),1.5));
 check('near-crossing and behind-camera stay conservative',()=>{for(const z of [0,-.1,10])assert.equal(forestProjectedCrownPixels({root:new T.Vector3(0,0,z),scale,crownRatio:ratio,camera,viewportWidth:1280,time:60}),Infinity);});
 check('explicit ray-plane gradients match finite differences',()=>{const O=[.3,.7,-5],D=[.1,-.2,5],dx=[.01,.03,-.02],dy=[-.02,.01,.04];const g=forestFrameGradients(O,D,dx,dy,.4,.55);for(const [direction,expected]of [[dx,g.dx],[dy,g.dy]]){const other=forestFrameGradients(O,D.map((v,i)=>v+direction[i]*1e-6),dx,dy,.4,.55);other.uv.forEach((v,i)=>close((v-g.uv[i])/1e-6,expected[i],1e-6));}});
 const mesh={material:new T.MeshStandardMaterial(),onBeforeRender(){},userData:{}},atlas={cell:256,rows:12,normalMap:new T.Texture()},viewer={value:new T.Vector3()},range={value:8500},fraction={value:1};configureForestImpostor(mesh,atlas,viewer,range,fraction);
 const shader={uniforms:{},vertexShader:T.ShaderLib.standard.vertexShader,fragmentShader:T.ShaderLib.standard.fragmentShader};mesh.material.onBeforeCompile(shader);
 check('explicit A/B uniform and actual-pass pixel projection wired',()=>{assert.ok(forestAtlasBudgetEnabled);assert.equal(shader.uniforms.forestAtlasBudgetEnabled,forestAtlasBudgetEnabled);assert.match(shader.vertexShader,/forestViewportWidth/);assert.match(shader.vertexShader,/forestCameraNear/);assert.match(shader.vertexShader,/treeCrownRatios/);});
 check('same atlas weights select color and deferred normals',()=>{assert.match(shader.fragmentShader,/atlasBlend\(map,vMapUv\)/);assert.match(shader.fragmentShader,/atlasBlend\(treeNormals,vMapUv\)/);assert.ok(shader.fragmentShader.indexOf('if(deferredAtlasNormal)canopyNormal')>shader.fragmentShader.indexOf('transitionNoise<nearCoverage'));});
 check('derivatives prepared before alpha/LOD and texture reads use explicit gradients',()=>{assert.match(shader.fragmentShader,/textureGrad\(/);assert.ok(shader.fragmentShader.indexOf('prepareForestAtlas')<shader.fragmentShader.indexOf('vec4 canopy=atlasBlend'));});
 check('legacy280 and near geometry ownership retained',()=>{assert.match(shader.fragmentShader,/rootDistance>280\./);assert.match(shader.fragmentShader,/smoothstep\(80\.,112\.,rootDistance\)/);assert.match(shader.vertexShader,/rootDistance=length\(viewerPosition-root\)/);});
 const source=await readFile(new URL('../forest-impostor.js',import.meta.url),'utf8');
 check('no new render target/pass or CPU per-tree ordinary traversal',()=>{assert.doesNotMatch(source,/new T\.WebGLRenderTarget|renderer\.render\(/);assert.match(source,/if\(active\)capture/);});
 result.passed=true;
}catch(error){result.passed=false;result.error=String(error);process.exitCode=1;}
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
