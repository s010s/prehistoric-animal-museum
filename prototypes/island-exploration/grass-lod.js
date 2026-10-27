import * as T from 'three';
export const grassGeometryLodEnabled={value:false};
export const grassViewportHeight={value:720};
export const grassLodConfig=Object.freeze({trianglesPerClump:[60,24,4],pixelBoundaries:[.9,.35],bladeIdentity:'original k%3 order',groundHandover:'same meadowPigment and existing world-distance endpoint',width:'projected 0.04 m blade envelope; at most 3x coverage compensation'});
export function makeGrassLods(source){
 const near=source.clone(),positions=source.getAttribute('position'),middle=[],far=[];
 for(let k=0;k<12;k++)for(let j=0;j<4;j++)for(let side=0;side<2;side++){
  const i=k*8+j*2+side,t=j/3;
  for(const [out,a,b,f]of [[middle,j===1?0:j,j===1?2:j,j===1?.5:0],[far,0,3,t]]){
   for(let c=0;c<3;c++)out.push(positions.getComponent(k*8+a*2+side,c)*(1-f)+positions.getComponent(k*8+b*2+side,c)*f);
  }
 }
 near.setAttribute('bladeMiddle',new T.Float32BufferAttribute(middle,3));near.setAttribute('bladeFar',new T.Float32BufferAttribute(far,3));
 const indexFor=level=>{const indices=[];for(let k=0;k<12;k++){
  if(level===1&&k%3===2||level===2&&k%3!==0)continue;
  const base=k*8;if(level===2)indices.push(base,base+6,base+1);
  else indices.push(base,base+4,base+1,base+1,base+4,base+5,base+4,base+6,base+5);
 }return indices;};
 const mid=near.clone(),distant=near.clone();mid.setIndex(indexFor(1));distant.setIndex(indexFor(2));
 return [near,mid,distant];
}
export function patchGrassGeometryLod(shader){
 Object.assign(shader.uniforms,{grassGeometryLodEnabled,grassViewportHeight});
 shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
 uniform bool grassGeometryLodEnabled;uniform float grassViewportHeight;attribute vec3 bladeMiddle,bladeFar;
 `);
 const entry='if(grassBladeStabilityEnabled){vec2 tierWidth=';
 shader.vertexShader=shader.vertexShader.replace(entry,`if(grassGeometryLodEnabled){
 float scale=max(length((modelMatrix*instanceMatrix)[0].xyz),length((modelMatrix*instanceMatrix)[2].xyz));
 float depth=max(.3,-(viewMatrix*vec4(root,1.)).z);
 float pixels=.04*scale*projectionMatrix[1][1]*grassViewportHeight*.5/depth;
 float f2=smoothstep(.9,1.6,pixels),f1=smoothstep(.35,.7,pixels);
 float own=bladeLod.x>1.5?f2:bladeLod.x>.5?f1:1.;
 vec3 shape=mix(bladeMiddle,position,f2);shape=mix(bladeFar,shape,f1);
 float finalFade=1.-smoothstep(grassFade.x,grassFade.y,bladeDistance);
 float compensate=min(3.,3./(1.+f1+f2));
 transformed=shape+bladeSide*(compensate*own*finalFade-1.);
 transformed.y*=own;grassTierVisibility=own*finalFade;
 }else ${entry}`);
 // Distance fading occurs once, through geometry; A2C retains physical coverage.
 shader.fragmentShader=shader.fragmentShader.replace('varying float grassTierVisibility;','uniform bool grassGeometryLodEnabled;varying float grassTierVisibility;')
 .replace('diffuseColor.a*=grassBladeOpacityFactor(densityFade);','diffuseColor.a*=grassGeometryLodEnabled?1.:grassBladeOpacityFactor(densityFade);').replace('if(grassBladeStabilityEnabled&&grassTierVisibility','if((grassBladeStabilityEnabled||grassGeometryLodEnabled)&&grassTierVisibility');
}
export function createGrassLodInstaller({renderer,getFine,parts,install,hide}){
 let packet=null,lastKey='',lastPosition=new T.Vector3(Infinity,Infinity,Infinity),counts=[0,0,0],updates=0,lastCpuMs=0;
 const lists=parts.map(()=>({length:0,matrices:null,colors:null,order:null}));
 function update(camera,force=false){
  if(!packet||!grassGeometryLodEnabled.value)return;
  camera.updateMatrixWorld();const height=renderer.domElement.height,factor=camera.projectionMatrix.elements[5]*height*.5,key=[height,camera.fov,getFine()].join(':');grassViewportHeight.value=height;
  if(!force&&lastKey===key&&camera.position.distanceToSquared(lastPosition)<.04&&camera.quaternion.angleTo(lastQuaternion)<.003)return;
  const started=performance.now(),view=camera.matrixWorldInverse.elements;counts=[0,0,0];
  const orders=lists.map(list=>list.order),a=packet.matrices;
  for(let row=0;row<packet.length;row++){const i=packet.order?.[row]??row,j=i*16,scale=Math.max(Math.hypot(a[j],a[j+1],a[j+2]),Math.hypot(a[j+8],a[j+9],a[j+10]));
   const depth=Math.max(.3,-(view[2]*a[j+12]+view[6]*a[j+13]+view[10]*a[j+14]+view[14])),pixels=.04*scale*factor/depth,level=pixels>.9?0:pixels>.35?1:2;orders[level][counts[level]++]=i;
  }
  hide();for(let level=0;level<3;level++){const list=lists[level];list.length=counts[level];install(parts[level],list);}
  lastKey=key;lastPosition.copy(camera.position);lastQuaternion.copy(camera.quaternion);updates++;lastCpuMs=performance.now()-started;
 }
 const lastQuaternion=new T.Quaternion();
 return {accept(value,camera){packet=value;for(const list of lists){list.matrices=value.matrices;list.colors=value.colors;if(!list.order||list.order.length<value.count)list.order=new Uint32Array(value.count);}lastKey='';if(grassGeometryLodEnabled.value)update(camera,true);else{hide();install(null,packet);}},update,
  setEnabled(value,camera){grassGeometryLodEnabled.value=Boolean(value);if(value)update(camera,true);else if(packet){hide();install(null,packet);}},
  status:()=>({enabled:grassGeometryLodEnabled.value,...grassLodConfig,installed:packet?.length??0,instances:grassGeometryLodEnabled.value?[...counts]:[packet?.length??0,0,0],geometryIndices:parts.map(p=>p.geometry.index.count),triangles:grassGeometryLodEnabled.value?counts.reduce((n,count,i)=>n+count*parts[i].geometry.index.count/3,0):(packet?.length??0)*60,fullTriangles:(packet?.length??0)*60,updates,lastCpuMs,classification:'view-depth, instance scale, projection and physical viewport; updates at 0.2 m / 0.003 rad; no density removal'})};
}
