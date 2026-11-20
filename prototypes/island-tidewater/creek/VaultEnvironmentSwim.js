import {BufferAttribute} from '../vendor/tidewater/src/engine/index.js';
import {smooth} from '../vendor/tidewater/src/world/wildlife/Kit.js';
import {reviewedGeometry} from './VaultEnvironmentAssets.js';
import {REVIEWED_SWIM_BONES, REVIEWED_SWIM_RIGS} from './VaultReviewedSwimMotion.js';
import {reviewedGeometryLods} from './VaultGeometryLods.js';

export const REVIEWED_FISH=['falcatus','cheiracanthus'];

const masks={
 falcatus:{
  pectoral:{z:[.091,.143,.270,.320],x:[.060,.132],y:[-.039,-.089],tip:[.112,.197]},
  pelvic:{z:[-.166,-.126,-.055,-.018],x:[.030,.069],y:[-.035,-.081],tip:[.052,.079]},
  dorsal:{z:[-.102,-.077,.020,.072],y:[.045,.094],x:[.028,.014]},
  anal:{z:[-.252,-.237,-.209,-.178],y:[-.035,-.065],x:[.028,.009]},
 },
 cheiracanthus:{
  pectoral:{z:[.143,.179,.271,.340],x:[.035,.077],y:[-.052,-.126],tip:[-.109,-.151]},
  pelvic:{z:[-.056,-.025,.105,.143],x:[.008,.024],y:[-.093,-.169],tip:[-.147,-.231]},
  dorsal:{z:[-.153,-.123,.014,.061],y:[.078,.145],x:[.031,.013]},
  anal:{z:[-.248,-.231,-.120,-.085],y:[-.075,-.139],x:[.027,.009]},
 },
};

export function reviewedSwimGeometry(gltf,kind) {
 const shark=kind==='falcatus';
 const geometry=reviewedGeometry(gltf,shark?(x,y,z)=>[-z,y,x]:(x,y,z)=>[-x,y,-z]);
 const {position}=geometry.attributes, count=position.count, p=position.array;
 const data=new Float32Array(count*4), fins=new Float32Array(count*2);
 const axial=REVIEWED_SWIM_RIGS[kind].axial, masksForFish=masks[kind];
 const finVertices={pectoral:[0,0],pelvic:[0,0],dorsal:0,anal:0};
 const partNames=Object.keys(masksForFish);
 let tailVertices=0;
 for(let i=0;i<count;i++) {
  const j=i*3, k=i*4, x=p[j], y=p[j+1], z=p[j+2], side=x<0?0:1, ax=Math.abs(x);
  let lower=0;
  while(lower<axial.length-1&&z<axial[lower+1][2])lower++;
  const upper=Math.min(axial.length-1,lower+1);
  const t=lower===upper?0:smooth(axial[lower][2],axial[upper][2],z);
  data[k]=lower;data[k+1]=upper;data[k+2]=t;
  if(lower>=5)tailVertices++;
  let bestWeight=0;
  for(const part of partNames){
   const m=masksForFish[part], w=smooth(m.z[0],m.z[1],z)*(1-smooth(m.z[2],m.z[3],z))*smooth(m.x[0],m.x[1],ax)*smooth(m.y[0],m.y[1],y);
   if(w<=bestWeight)continue;
   bestWeight=w;
   data[k+3]=w;
   fins[i*2]=REVIEWED_SWIM_BONES[part]+(m.tip?2*side:0);
   fins[i*2+1]=m.tip?smooth(m.tip[0],m.tip[1],shark?ax:y):0;
  }
  if(bestWeight>0){
   const bone=fins[i*2];
   if(bone<REVIEWED_SWIM_BONES.pelvic)finVertices.pectoral[side]++;
   else if(bone<REVIEWED_SWIM_BONES.dorsal)finVertices.pelvic[side]++;
   else finVertices[bone===REVIEWED_SWIM_BONES.dorsal?'dorsal':'anal']++;
  }
 }
 geometry.setAttribute('aData',new BufferAttribute(data,4));
 geometry.setAttribute('aFishFin',new BufferAttribute(fins,2));
 geometry.vaultRigStats={kind,vertices:count,tailVertices,finVertices,bones:REVIEWED_SWIM_BONES.count,
  method:'weighted spine and caudal fan, paired ray joints, rigid median spines and exact previous skinning'};
 return geometry;
}

// At each transition the offline simplifier's model-space error budget is
// about half a projected pixel, and the full mesh retains all source triangles.
const levels=[
 {triangles:4600,error:.0045,pixels:112},
 {triangles:1050,error:.011,pixels:35},
];

export function prepareReviewedSwimIndices(gltf,kind,simplifier) {
 const source=reviewedSwimGeometry(gltf,kind);
 const {position,normal,uv,aData}=source.attributes;
 const metrics=new Float32Array(position.count*6), lock=new Uint8Array(position.count);
 for(let i=0;i<position.count;i++){
  const j=i*3,k=i*6,d=i*4,f=i*2, x=position.array[j],y=position.array[j+1],z=position.array[j+2];
  metrics[k]=normal.array[j];metrics[k+1]=normal.array[j+1];metrics[k+2]=normal.array[j+2];
  metrics[k+3]=uv.array[f];metrics[k+4]=uv.array[f+1];metrics[k+5]=aData.array[d+3];
  // Preserve diagnostic tips in their own zones, even at the lowest level.
  const ax=Math.abs(x);
  const tip=kind==='falcatus'
   ?z>.466&&y>.079||ax>.211||z<-.39&&y<-.088||z>-.13&&z<-.055&&ax>.076&&y<-.088
   :y>.217||y<-.233||z<-.493||z>.15&&y<-.147&&ax>.086||z<-.19&&y<-.19;
  if(tip||z<-.492)lock[i]=1;
 }
 return levels.map(level=>simplifier.simplifyWithAttributes(source.index.array,position.array,3,metrics,6,
  [.30,.30,.30,.10,.10,.19],lock,level.triangles*3,level.error,['ErrorAbsolute','Regularize'])[0]);
}

export function reviewedSwimKinds(gltf,kind,bytes) {
 // Every reduced vertex retains the original atlas coordinates and joint weights.
 const source=reviewedSwimGeometry(gltf,kind);
 const kinds=reviewedGeometryLods(source,bytes).map(geometry=>({geometry,shadow:false}));
 source.vaultRigStats.lods=kinds.map(({geometry})=>({triangles:geometry.index.count/3,vertices:geometry.attributes.position.count}));
 return kinds;
}

// ReefBatch's main and fade draws use the same compact, atlas-bearing geometry.
export function installReviewedSwimAttributes(batch) {
 for(const [name,size] of [['uv',2],['aFishFin',2]]){
  const packed=new Float32Array(batch.geometry.attributes.position.count*size);
  for(const [i,kind] of batch.kinds.entries())packed.set(kind.geometry.attributes[name].array,batch.baseVertex[i]*size);
  const attribute=new BufferAttribute(packed,size);
  batch.geometry.setAttribute(name,attribute);
  batch.fadeGeometry.setAttribute(name,attribute);
 }
}

export function addReviewedSwimInstance(batch,index,pixels,distance,range) {
 const lod=pixels>=levels[0].pixels?0:pixels>=levels[1].pixels?1:2;
 const threshold=levels[lod]?.pixels;
 if(distance>range*.85){
  batch.addFade(lod,index,Math.max(0,(range-distance)/(range*.15)),false);
 }else if(threshold&&pixels<threshold*1.18){
  const share=(pixels/threshold-1)/.18;
  batch.addFade(lod,index,share,false);
  batch.addFade(lod+1,index,share,true);
 }else batch.add(lod,index);
}

export function bindReviewedSwim(material,texture) {
 material.bindings.reviewedFishAtlas={texture};
 material.surface+=`
   s.albedo=textureSample(reviewedFishAtlas,smpAnisoRepeat,in.uv).rgb;
   s.metalness=0.0; s.roughness=0.69; s.specularIntensity=0.18;
 `;
}
