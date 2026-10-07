import * as T from 'three'
import {leafTransmission,setLeafTransmission} from './leaf-transmission.js'

// CPU-only selection from the existing leaf texture; no replacement texture is created.
export function selectOpaqueLeafUV(rgba,width,height){
 let best=-Infinity,index=-1;
 for(let i=0;i<width*height;i++){const k=i*4,r=rgba[k],g=rgba[k+1],b=rgba[k+2];if(rgba[k+3]<250||g<=r||g<=b)continue;const score=g-Math.max(r,b);if(score>best){best=score;index=i}}
 if(index<0)throw Error('No opaque green leaf tissue in source texture');
 return[(index%width+.5)/width,1-(Math.floor(index/width)+.5)/height];
}
function sourceUV(map){
 const image=map?.image;if(!image)throw Error('Actual near leaf texture unavailable');
 if(image.data){const uv=selectOpaqueLeafUV(image.data,image.width,image.height);if(!map.flipY)uv[1]=1-uv[1];return uv}
 const width=Math.min(512,image.width),height=Math.min(512,image.height),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('Leaf tissue CPU canvas unavailable');ctx.drawImage(image,0,0,width,height);
 const uv=selectOpaqueLeafUV(ctx.getImageData(0,0,width,height).data,width,height);if(!map.flipY)uv[1]=1-uv[1];return uv;
}
export function summarizeHDRPatch(pixels){
 const meanRGB=[0,0,0];let finite=true,nonzeroPixels=0;const count=pixels.length/4;
 for(let i=0;i<pixels.length;i+=4){let nonzero=false;for(let c=0;c<4;c++){const v=T.DataUtils.fromHalfFloat(pixels[i+c]);finite&&=Number.isFinite(v);if(c<3){meanRGB[c]+=v;nonzero||=v>0}}if(nonzero)nonzeroPixels++}
 return{meanRGB:meanRGB.map(v=>v/count),finite,nonzeroPixels,pixels:count,bytes:pixels.byteLength};
}
const luminance=rgb=>rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
function delta(on,off){return on.meanRGB.map((x,i)=>x-off.meanRGB[i])}
function relationshipChecks(cases){
 const checks=[];
 for(const kind of ['needle','fan']){
  const pair=name=>{const rows=cases.filter(c=>c.kind===kind&&c.condition===name);return delta(rows.find(c=>c.enabled).patch,rows.find(c=>!c.enabled).patch)};
  const clear=luminance(pair('clear-back')),blocked=luminance(pair('blocked-back')),front=luminance(pair('front')),scalar=luminance(pair('gate-.55')),zero=luminance(pair('gate-0'));
  // Half-float subtraction has a finite quantization floor. Also return raw deltas for review.
  const tolerance=.0015+Math.abs(clear)*.12;
  checks.push({kind,clearDelta:clear,blockedDelta:blocked,frontDelta:front,scalarDelta:scalar,zeroDelta:zero,scalarRatio:clear>0?scalar/clear:null,tolerance,
   pass:clear>.002&&Math.abs(blocked)<tolerance&&Math.abs(front)<tolerance&&Math.abs(zero)<tolerance&&Math.abs(scalar-.55*clear)<tolerance});
 }
 return checks;
}

// Explicit queued review job. The caller pauses normal frames until this promise settles.
// renderAt uses the existing pipeline and fixed time; this audit allocates no rendering targets.
export async function runLeafAudit({renderer,scene,camera,sun,props,water,renderAt,setPose,getState,time,deadlineMs=18000,onCase,signal,shouldContinue=()=>true,position}){
 const started=performance.now(),savedEnabled=leafTransmission.enabled.value,savedPosition=camera.position.clone(),savedQuaternion=camera.quaternion.clone(),savedFov=camera.fov;
 const savedTarget=savedPosition.clone().add(camera.getWorldDirection(new T.Vector3()).multiplyScalar(10));
 const resources=water.resources(),target=resources.find(([name])=>name==='linearComposite')?.[1],owned=[];let blocker=null,fixture=null,ownedPose=null;
 const cases=[],report={synthetic:true,kind:'actual-near-leaf/HDR-difference',time,cases,readbackBytes:0,restored:false,gateMeaning:'Review scalar multiplies real worldSun; it does not validate actual cloud texture sampling.',shadowExtent:[sun.shadow?.camera.left??null,sun.shadow?.camera.right??null]};
 function guard(){
  if(signal?.aborted||!shouldContinue())throw Error('Leaf audit aborted/cancelled');
  if(renderer.getContext().isContextLost())throw Error('Leaf audit context lost');
  if(performance.now()-started>=Math.min(20000,deadlineMs))throw Error('Leaf audit wall deadline exceeded');
  const size=renderer.getDrawingBufferSize(new T.Vector2());if(size.x>1280||size.y>720||size.x*size.y>921600)throw Error('Leaf audit pixel budget exceeded');
 }
 try{
  guard();if(!target||target.texture.type!==T.HalfFloatType)throw Error('Existing half-float linearComposite target required');
  if(target.width<16||target.height<16)throw Error('HDR patch target too small');
  const materials=new Map();props.group.traverse(o=>{if(!o.isInstancedMesh)return;for(const m of Array.isArray(o.material)?o.material:[o.material])if(m.userData.treeLeafKind&&m.defines?.ISLAND_LEAF_TRANSMISSION&&m.isMeshStandardMaterial)materials.set(m.userData.treeLeafKind,m)});
  if(!materials.has('needle')||!materials.has('fan'))throw Error('Actual near needle and fan materials required; prepare both species first');
  const p=position?new T.Vector3().fromArray(position):savedPosition.clone().add(new T.Vector3(0,40,0));
  const l=sun.getWorldPosition(new T.Vector3()).sub(sun.target.getWorldPosition(new T.Vector3())).normalize();if(l.lengthSq()<.9)throw Error('Invalid solar direction');
  const rotation=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,1),l);
  const blockerGeometry=new T.PlaneGeometry(6,6),blockerMaterial=new T.MeshBasicMaterial({side:T.DoubleSide});owned.push(blockerGeometry,blockerMaterial);
  blocker=new T.Mesh(blockerGeometry,blockerMaterial);blocker.position.copy(p).addScaledVector(l,2);blocker.quaternion.copy(rotation);blocker.castShadow=true;blocker.visible=false;scene.add(blocker);
  for(const [kind,source]of materials){
   guard();const material=source.clone(),gate={value:1},uv=sourceUV(source.map);owned.push(material);
   material.defines={...source.defines,ISLAND_LEAF_REVIEW_FIXTURE:1};
   // The source already owns atmosphere + near-tree callbacks. Do not apply atmosphere twice.
   material.onBeforeCompile=s=>{source.onBeforeCompile.call(source,s);s.uniforms.leafFixtureSunGate=gate};
   material.customProgramCacheKey=()=>`${source.customProgramCacheKey()}-leaf-audit`;
   const geometry=new T.PlaneGeometry(2,2);owned.push(geometry);geometry.setAttribute('color',new T.Float32BufferAttribute(new Float32Array(12).fill(1),3));const uvs=geometry.getAttribute('uv');for(let i=0;i<uvs.count;i++)uvs.setXY(i,...uv);uvs.needsUpdate=true;
   // The actual tree shader requires instanceMatrix, including its root/yaw/wind transforms.
   fixture=new T.InstancedMesh(geometry,material,1);owned.push(fixture);const matrix=new T.Matrix4().compose(p,rotation,new T.Vector3(1,1,1));fixture.setMatrixAt(0,matrix);fixture.setColorAt(0,new T.Color(1,1,1));fixture.receiveShadow=true;fixture.castShadow=false;fixture.frustumCulled=false;scene.add(fixture);
   for(const condition of [{id:'clear-back',side:-1,gate:1,blocked:false},{id:'blocked-back',side:-1,gate:1,blocked:true},{id:'front',side:1,gate:1,blocked:false},{id:'gate-.55',side:-1,gate:.55,blocked:false},{id:'gate-0',side:-1,gate:0,blocked:false}]){
    guard();gate.value=condition.gate;blocker.visible=condition.blocked;camera.fov=50;camera.updateProjectionMatrix();setPose({position:p.clone().addScaledVector(l,4*condition.side).toArray(),target:p.toArray()});
    ownedPose={position:camera.position.clone(),quaternion:camera.quaternion.clone(),fov:camera.fov};
    for(const enabled of [false,true]){
     guard();setLeafTransmission(enabled);await renderAt(time);guard();
     const currentTarget=water.resources().find(([name])=>name==='linearComposite')?.[1];if(currentTarget!==target||target.texture.type!==T.HalfFloatType)throw Error('HDR target changed during leaf audit');
     const pixels=new Uint16Array(16*16*4),x=Math.floor(target.width/2)-8,y=Math.floor(target.height/2)-8;
     guard();renderer.readRenderTargetPixels(target,x,y,16,16,pixels);guard();
     const patch=summarizeHDRPatch(pixels);if(!patch.finite||patch.nonzeroPixels===0)throw Error('Invalid/nonfinite/all-zero leaf HDR readback');
     const row={kind,condition:condition.id,enabled,gate:gate.value,opaqueUV:uv,patch,position:camera.position.toArray(),target:p.toArray(),time,state:getState?.()??null};cases.push(row);report.readbackBytes+=pixels.byteLength;
     if(onCase){await onCase(row);guard()}
    }
   }
   scene.remove(fixture);fixture=null;
  }
  report.checks=relationshipChecks(cases);report.resourcesUnchanged=resources.every(([name,resource])=>water.resources().some(([n,r])=>n===name&&r===resource));report.pass=report.checks.every(c=>c.pass)&&report.resourcesUnchanged;
  report.elapsedMs=performance.now()-started;guard();return report;
 }finally{
  if(fixture)scene.remove(fixture);if(blocker)scene.remove(blocker);for(const resource of owned)resource.dispose();
  leafTransmission.enabled.value=savedEnabled;
  // A cancelled async capture may return after the user has already navigated.
  // Release only the pose we still own, preserving any newer position/orientation/FOV.
  const ownsPose=ownedPose&&camera.position.distanceToSquared(ownedPose.position)<1e-12&&Math.abs(camera.quaternion.dot(ownedPose.quaternion))>1-1e-12&&camera.fov===ownedPose.fov;
  if(ownsPose){camera.fov=savedFov;camera.updateProjectionMatrix();setPose({position:savedPosition.toArray(),target:savedTarget.toArray()});camera.quaternion.copy(savedQuaternion);camera.updateMatrixWorld()}
  report.poseRestored=Boolean(ownsPose);report.newerPosePreserved=Boolean(ownedPose&&!ownsPose);report.restored=true;
 }
}
