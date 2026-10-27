import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import * as T from 'three'
const leaf=await import('../leaf-transmission.js').catch(()=>null)
test('module and bounded view-space angular relationships',()=>{
 assert.ok(leaf,'preimplementation missing module');const n=[0,0,1],v=[0,0,1],back=[0,0,-1];
 assert.equal(leaf.leafAngularWeight(n,v,v),0);assert.equal(leaf.leafAngularWeight(n,back,v),1);
 assert.equal(leaf.leafAngularWeight([0,0,-1],back,v),1);
 for(let i=0;i<200;i++){const a=[Math.sin(i),Math.cos(i),Math.sin(i*.3)];const w=leaf.leafAngularWeight(a,back,v);assert.ok(Number.isFinite(w)&&w>=0&&w<=1)}
 assert.equal(leaf.leafAngularWeight([NaN,0,0],back,v),0);
})
test('disabled, shadow/terrain zero and cloud scalar are linear',()=>{
 assert.ok(leaf);const input={normal:[0,0,1],light:[0,0,-1],view:[0,0,1],colour:[3,2,1],albedo:[.2,.7,.3],strength:.14,enabled:true,gate:1};
 const clear=leaf.leafTransmissionDelta(input);assert.ok(clear.every(x=>x>0));
 assert.deepEqual(leaf.leafTransmissionDelta({...input,enabled:false}),[0,0,0]);assert.deepEqual(leaf.leafTransmissionDelta({...input,gate:0}),[0,0,0]);
 const cloud=leaf.leafTransmissionDelta({...input,gate:.55});cloud.forEach((x,i)=>assert.ok(Math.abs(x/clear[i]-.55)<1e-12));
 leaf.leafTransmissionDelta({...input,strength:20}).forEach((x,i)=>assert.ok(x<=input.colour[i]*input.albedo[i]*.2/Math.PI+1e-12));
})
test('real r185 directional chunk retains other loops and shadow count',()=>{
 assert.ok(leaf);const src=T.ShaderChunk.lights_fragment_begin,patched=leaf.patchSolarLighting(src),start=src.indexOf('#if ( NUM_DIR_LIGHTS'),end=src.indexOf('#if ( NUM_RECT_AREA_LIGHTS');
 assert.equal(patched.slice(0,start),src.slice(0,start));assert.ok(patched.endsWith(src.slice(end)));
 assert.equal((patched.match(/getShadow\(/g)||[]).length,(src.match(/getShadow\(/g)||[]).length);
 assert.equal((patched.match(/directLight.color\*=sunVisibility/g)||[]).length,1);
 assert.ok(patched.indexOf('directLight.color*=sunVisibility')>patched.indexOf('getDirectionalLightInfo'));
 assert.ok(patched.includes('BRDF_Lambert(material.diffuseContribution)'));
 assert.throws(()=>leaf.patchSolarLighting('unknown shape'));
 assert.doesNotMatch(leaf.leafTransmissionGLSL,/texture|emissive|getShadow|worldSun|pow\(/);
})
test('explicit near leaf marker and shared switch survive material cloning',()=>{
 assert.ok(leaf);const m=new T.MeshStandardMaterial({alphaTest:.36}),map=m.map;leaf.markTreeLeafMaterial(m,'needle');
 assert.equal(m.userData.treeLeafKind,'needle');assert.equal(leaf.leafUniformsFor(m).leafTransmissionStrength.value,.06);
 const cloned=m.clone();assert.equal(cloned.userData.treeLeafKind,'needle');leaf.markTreeLeafMaterial(cloned,cloned.userData.treeLeafKind);assert.equal(cloned.defines.ISLAND_LEAF_TRANSMISSION,1);assert.equal(m.map,map);assert.equal(m.alphaTest,.36);
 const fan=new T.MeshStandardMaterial();leaf.markTreeLeafMaterial(fan,'fan');assert.equal(leaf.leafUniformsFor(fan).leafTransmissionStrength.value,.14);
 assert.equal(leaf.leafUniformsFor(new T.MeshStandardMaterial()).leafTransmissionStrength,undefined);
 assert.throws(()=>leaf.markTreeLeafMaterial(new T.MeshBasicMaterial(),'fan'));assert.throws(()=>leaf.markTreeLeafMaterial(m,'grass'));
 leaf.setLeafTransmission(false);assert.equal(leaf.leafUniformsFor(m).leafTransmissionEnabled.value,0);leaf.setLeafTransmission(true);
})
test('assembled atmosphere computes sun once before lighting, without a late double gate',async()=>{
 assert.ok(leaf);const {makeAtmosphere}=await import('../atmosphere.js');const m=new T.MeshStandardMaterial({alphaTest:.36});leaf.markTreeLeafMaterial(m,'fan');const mesh=new T.Mesh(new T.PlaneGeometry(),m);makeAtmosphere({}).apply(mesh);
 const s={uniforms:{},vertexShader:T.ShaderLib.standard.vertexShader,fragmentShader:T.ShaderLib.standard.fragmentShader};m.onBeforeCompile(s);
 assert.equal((s.fragmentShader.match(/float sunVisibility=worldSun\(airWorld\)/g)||[]).length,1);
 assert.ok(s.fragmentShader.indexOf('float sunVisibility=')<s.fragmentShader.indexOf('vec3 geometryPosition'));
 assert.doesNotMatch(s.fragmentShader,/reflectedLight\.direct(?:Diffuse|Specular)\*=sunVisibility/);
 assert.equal(s.uniforms.leafTransmissionEnabled,leaf.leafTransmission.enabled);
 const props=await fs.readFile(new URL('../props.js',import.meta.url),'utf8');assert.match(props,/markTreeLeafMaterial\(part.material,species===2\?'fan':'needle'\)/);
})
