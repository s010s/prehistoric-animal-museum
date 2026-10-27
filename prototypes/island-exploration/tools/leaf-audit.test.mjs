import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import * as T from 'three'
const audit=await import('../leaf-audit.js').catch(()=>null),leaf=await import('../leaf-transmission.js').catch(()=>null)
function setup(){
 const scene=new T.Scene(),group=new T.Group(),camera=new T.PerspectiveCamera(60,16/9,.1,5000),sun=new T.DirectionalLight();camera.position.set(2,40,3);sun.position.set(1,2,1);scene.add(sun);scene.add(sun.target);
 for(const kind of ['needle','fan']){const m=new T.MeshStandardMaterial({alphaTest:.28});leaf.markTreeLeafMaterial(m,kind);m.map=new T.DataTexture(new Uint8Array([40,130,50,255]),1,1);group.add(new T.InstancedMesh(new T.PlaneGeometry(),m,1))}scene.add(group);
 const target={width:1280,height:720,texture:{type:T.HalfFloatType}},renderTimes=[];let lost=false;
 const renderer={getDrawingBufferSize:v=>v.set(1280,720),getContext:()=>({isContextLost:()=>lost}),readRenderTargetPixels:(rt,x,y,w,h,data)=>{for(let i=0;i<data.length;i+=4){data[i]=data[i+1]=data[i+2]=T.DataUtils.toHalfFloat(.25+(leaf.leafTransmission.enabled.value?.01:0));data[i+3]=T.DataUtils.toHalfFloat(1)}}};
 return{renderer,scene,camera,sun,props:{group},water:{resources:()=>[['linearComposite',target]]},renderAt:t=>renderTimes.push(t),setPose:({position,target})=>{camera.position.fromArray(position);camera.lookAt(new T.Vector3().fromArray(target))},time:17,renderTimes,setLost:()=>lost=true};
}
test('opaque UV tissue selection and bounded HDR half-float decode',()=>{
 assert.ok(audit);const uv=audit.selectOpaqueLeafUV(new Uint8Array([100,30,10,255,40,120,50,255,0,255,0,0]),3,1);assert.ok(uv[0]>.33&&uv[0]<.67);
 assert.throws(()=>audit.selectOpaqueLeafUV(new Uint8Array(4),1,1));const p=new Uint16Array(16);for(let i=0;i<16;i++)p[i]=T.DataUtils.toHalfFloat(i%4===3?1:.25);
 const stats=audit.summarizeHDRPatch(p);assert.equal(stats.finite,true);assert.deepEqual(stats.meanRGB,[.25,.25,.25]);assert.equal(stats.nonzeroPixels,4);
 p[0]=0x7c00;assert.equal(audit.summarizeHDRPatch(p).finite,false);
})
test('explicit audit is bounded, fixed time, no new RT, restores scene and switch',async()=>{
 assert.ok(audit&&leaf);const o=setup(),before=o.scene.children.length,pos=o.camera.position.clone();leaf.setLeafTransmission(false);
 const result=await audit.runLeafAudit(o);assert.equal(result.cases.length,20);assert.equal(o.renderTimes.length,20);assert.ok(o.renderTimes.every(t=>t===17));assert.equal(result.synthetic,true);assert.equal(result.readbackBytes,20*16*16*4*2);assert.equal(result.restored,true);assert.equal(o.scene.children.length,before);assert.ok(o.camera.position.equals(pos));assert.equal(leaf.leafTransmission.enabled.value,0);
})
test('callback failure, cancel, context loss, pixel/deadline guard restore without later GL',async()=>{
 assert.ok(audit&&leaf);const failing=setup(),before=failing.scene.children.length;await assert.rejects(audit.runLeafAudit({...failing,onCase:()=>{throw Error('capture failed')}}),/capture failed/);assert.equal(failing.scene.children.length,before);
 const cancel=setup(),controller=new AbortController(),newPosition=[200,90,300];await assert.rejects(audit.runLeafAudit({...cancel,signal:controller.signal,onCase:()=>{controller.abort();cancel.setPose({position:newPosition,target:[201,90,301]});cancel.camera.fov=65}}),/abort|cancel/i);assert.equal(cancel.renderTimes.length,1);assert.deepEqual(cancel.camera.position.toArray(),newPosition);assert.equal(cancel.camera.fov,65);
 const lost=setup();await assert.rejects(audit.runLeafAudit({...lost,onCase:()=>lost.setLost()}),/context/i);assert.equal(lost.renderTimes.length,1);
 const invalid=setup();invalid.renderer.getDrawingBufferSize=v=>v.set(1920,1080);await assert.rejects(audit.runLeafAudit(invalid),/pixel/i);assert.equal(invalid.renderTimes.length,0);
 await assert.rejects(audit.runLeafAudit({...setup(),deadlineMs:0}),/deadline/i);
})
test('fixture uses actual callbacks/instancing and existing target with no RAF/new render target',async()=>{
 assert.ok(audit);const src=await fs.readFile(new URL('../leaf-audit.js',import.meta.url),'utf8');assert.match(src,/new T.InstancedMesh/);assert.match(src,/onBeforeCompile/);assert.match(src,/linearComposite/);assert.doesNotMatch(src,/requestAnimationFrame|new T.WebGLRenderTarget|new T.DataTexture|emissive/);
})
