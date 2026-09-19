import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import {AnimationClip,Quaternion,QuaternionKeyframeTrack,VectorKeyframeTrack,Vector3} from 'three'
const source='src/content/animals/pteranodon/model/model.glb',base='src/flight-experience/assets/pteranodon-glide.json'
const glide=AnimationClip.parse(JSON.parse(await fs.readFile(base,'utf8'))),duration=1.4,times=Array.from({length:49},(_,i)=>i*duration/48)
const tracks=glide.tracks.map(track=>{
 const rest=Array.from(track.createInterpolant().evaluate(0)),values=[]
 for(const time of times){
  const value=[...rest]
  if(track.ValueTypeName==='quaternion'&&/upperArm|foreArm/.test(track.name)){
   // The source rig already mirrors the right limb basis. Both local Z signs
   // must agree for both world-space wing tips to rise together.
   const phase=time/duration*Math.PI*2
   const angle=/upperArm/.test(track.name)?Math.sin(phase)*.48:Math.sin(phase-.35)*.22
   const q=new Quaternion().fromArray(value).multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),angle)).normalize();values.push(...q.toArray())
  }else values.push(...value)
 }
 const Track=track.ValueTypeName==='quaternion'?QuaternionKeyframeTrack:VectorKeyframeTrack
 return new Track(track.name,times,values)
})
const clip=AnimationClip.toJSON(new AnimationClip('PoweredFlap',duration,tracks));clip.uuid='f1937060-0002-4000-8000-000000000001'
const output='src/flight-experience/assets/pteranodon-powered-flap.json';await fs.writeFile(output,JSON.stringify(clip))
const sha=async p=>crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex')
await fs.writeFile('src/flight-experience/assets/powered-flap-manifest.json',JSON.stringify({reviewStatus:'needs_review',approval:null,source,sourceSha256:await sha(source),poseSource:base,poseSourceSha256:await sha(base),output,sha256:await sha(output),duration,recipe:'scripts/flight/derive-powered-flap.mjs',license:'CC-BY-4.0',modifications:'Authored continuous bilateral shoulder/forearm flex respecting mirrored source joint bases over source-derived glide pose; 1.4s loop, shoulder ±0.48rad and forearm ±0.22rad; fixed translations; original GLB unchanged. Requires human motion review.'},null,2)+'\n')
