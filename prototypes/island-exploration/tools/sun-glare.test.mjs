// Failure cases established before implementation:
// behind/horizon/underwater/invalid sun leaks; perspective aspect or UV flips;
// camera matrices mutate; time rewind/cut restores stale history; paused zero-dt
// changes history; disabled work submits; render throws and leaks target/autoClear;
// self-sampling ping-pong, extra depth renders/readbacks, cloud raymarch, duplicate
// tonemapping, final shapes evaluated with zero visibility, resource leaks.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import * as T from 'three';

const evidence={schema:'sun-glare-isolated-v1',createdAt:new Date().toISOString(),checks:[],gpuExecuted:false};
const check=(name,fn)=>{fn();evidence.checks.push(name);};
try {
 const {makeSunGlare,projectSunGlare,visibilityBlend,sunGlareGLSL,SUN_GLARE_TAPS}=await import('../sun-glare.js');
 const camera=new T.PerspectiveCamera(62,2,.5,45000);camera.position.set(0,5,0);camera.lookAt(0,6,-1);camera.updateMatrixWorld();
 const sun=new T.Vector3(0,1,-1).normalize(),waterHeight=0;
 check('center UV and stable projection',()=>{const matrix=camera.projectionMatrix.clone();const p=projectSunGlare(camera,sun,waterHeight);assert.equal(p.eligible,true);assert.ok(Math.abs(p.sunUv.x-.5)<1e-12&&Math.abs(p.sunUv.y-.5)<1e-12);assert.ok(camera.projectionMatrix.equals(matrix));assert.ok(p.discUv.x>0&&Math.abs(p.discUv.y/p.discUv.x-2)<1e-10);});
 check('behind/horizon/underwater/invalid gates',()=>{for(const [s,w] of [[sun.clone().negate(),0],[new T.Vector3(0,0,-1),0],[sun,6],[new T.Vector3(),0],[new T.Vector3(NaN,1,0),0]])assert.equal(projectSunGlare(camera,s,w).eligible,false);});
 check('UV origin matches WebGL depth',()=>{const s=new T.Vector3(0,1.2,-1).normalize();assert.ok(projectSunGlare(camera,s,0).sunUv.y>.5);});
 check('bounded exponential integration',()=>{assert.equal(visibilityBlend(0),0);assert.equal(visibilityBlend(-1),0);assert.equal(visibilityBlend(Infinity),0);assert.ok(visibilityBlend(.016)>0&&visibilityBlend(.016)<1);assert.equal(visibilityBlend(2),visibilityBlend(.1));});
 const texture=new T.DataTexture(new Uint8Array([255,255,255,255]),1,1);texture.needsUpdate=true;
 const sky={cloudPanorama:{value:texture},cloudPrevious:{value:texture},cloudPanoramaReady:{value:1},cloudBlend:{value:1},cloudPublishedOrigin:{value:new T.Vector3()},cloudPreviousOrigin:{value:new T.Vector3()},cloudPublishedPhase:{value:new T.Vector2()},cloudPreviousPhase:{value:new T.Vector2()},cloudPhase:{value:new T.Vector2()}};
 const glare=makeSunGlare(sky),initialTexture=glare.uniforms.glareVisibilityTex.value;
 const state={target:{name:'original'},autoClear:false,draws:[],throwRender:false};
 const renderer={getRenderTarget:()=>state.target,setRenderTarget:t=>state.target=t,get autoClear(){return state.autoClear;},set autoClear(v){state.autoClear=v;},render(scene){const material=scene.children[0].material;assert.notEqual(material.uniforms.glarePrevious.value,state.target.texture);state.draws.push({target:state.target,previous:material.uniforms.glarePrevious.value,shader:material.fragmentShader});if(state.throwRender)throw Error('synthetic render failure');}};
 const original=state.target,args={depth:texture,camera,sun,time:1,waterHeight};
 check('zero initial output and bounded two targets',()=>{assert.equal(glare.uniforms.glareActive.value,0);assert.deepEqual(Array.from(initialTexture.image.data),[0,0,0,0]);assert.equal(glare.resources().length,2);for(const [,r]of glare.resources()){assert.equal(r.width,1);assert.equal(r.height,1);assert.equal(r.texture.type,T.HalfFloatType);assert.equal(r.depthBuffer,false);}assert.equal(glare.status().estimatedTargetBytes,16);assert.equal(glare.status().taps,24);assert.equal(SUN_GLARE_TAPS,24);});
 check('one visibility draw preserves renderer state',()=>{glare.update(renderer,args);assert.equal(state.draws.length,1);assert.equal(state.target,original);assert.equal(state.autoClear,false);assert.equal(glare.uniforms.glareActive.value,1);});
 check('ping-pong without self-sampling',()=>{glare.update(renderer,{...args,time:1.016});assert.equal(state.draws.length,2);assert.notEqual(state.draws[0].target,state.draws[1].target);assert.equal(state.draws[1].previous,state.draws[0].target.texture);});
 check('zero dt skips work',()=>{const n=state.draws.length;glare.update(renderer,{...args,time:1.016});assert.equal(state.draws.length,n);});
 check('ineligible clears immediately and skips draw',()=>{const n=state.draws.length;glare.update(renderer,{...args,time:1.032,waterHeight:6});assert.equal(state.draws.length,n);assert.equal(glare.uniforms.glareActive.value,0);assert.equal(glare.uniforms.glareVisibilityTex.value,initialTexture);});
 check('eligible restart reads zero history',()=>{glare.update(renderer,{...args,time:1.048});assert.equal(state.draws.at(-1).previous,initialTexture);});
 check('camera cut instant zero then fresh restart',()=>{const n=state.draws.length;camera.position.x+=20;camera.updateMatrixWorld();glare.update(renderer,{...args,time:1.064});assert.equal(state.draws.length,n);assert.equal(glare.uniforms.glareActive.value,0);assert.equal(glare.status().historyReset,'camera-cut');glare.update(renderer,{...args,time:1.08});assert.equal(state.draws.at(-1).previous,initialTexture);});
 check('rewind instant zero and restart',()=>{const n=state.draws.length;glare.update(renderer,{...args,time:.2});assert.equal(state.draws.length,n);assert.equal(glare.uniforms.glareActive.value,0);assert.equal(glare.status().historyReset,'time-reset');glare.update(renderer,{...args,time:.216});assert.equal(state.draws.at(-1).previous,initialTexture);});
 check('toggle skips and starts from zero',()=>{const n=state.draws.length;glare.setEnabled(false);glare.update(renderer,{...args,time:.232});assert.equal(state.draws.length,n);glare.setEnabled(true);glare.update(renderer,{...args,time:.248});assert.equal(state.draws.at(-1).previous,initialTexture);});
 check('throw restores renderer and zero output',()=>{state.throwRender=true;assert.throws(()=>glare.update(renderer,{...args,time:.264}),/synthetic/);assert.equal(state.target,original);assert.equal(state.autoClear,false);assert.equal(glare.uniforms.glareActive.value,0);state.throwRender=false;});
 check('visibility shader source contract',()=>{const shader=state.draws[0].shader;assert.match(shader,/i\s*<\s*24/);assert.match(shader,/texture2D\(glareDepth/);assert.match(shader,/cloudPublishedPhase-cloudPhase/);assert.match(shader,/cloudPreviousPhase-cloudPhase/);assert.match(shader,/smoothstep\(\.004,\.04/);assert.doesNotMatch(shader,/traceCloud|cloudField|sampler3D|tonemapping|colorspace/);assert.match(shader,/exp\(/);});
 check('linear additive display branch has no own tone mapping',()=>{assert.match(sunGlareGLSL,/vec3 sunGlareLight\(vec2 uv\)/);assert.match(sunGlareGLSL,/if\(glareActive<\.5\)return vec3\(0\.\)/);assert.match(sunGlareGLSL,/if\(visibility<=0\.\)return vec3\(0\.\)/);assert.doesNotMatch(sunGlareGLSL,/tonemapping|colorspace|sceneDepth|glareDepth/);});
 check('dispose is complete and idempotent',()=>{let disposed=0;for(const [,r]of glare.resources())r.addEventListener('dispose',()=>disposed++);initialTexture.addEventListener('dispose',()=>disposed++);glare.dispose();glare.dispose();assert.equal(disposed,3);assert.equal(glare.status().disposed,true);assert.equal(glare.uniforms.glareActive.value,0);});
 evidence.passed=true;
}catch(error){evidence.passed=false;evidence.error=String(error);process.exitCode=1;}
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
