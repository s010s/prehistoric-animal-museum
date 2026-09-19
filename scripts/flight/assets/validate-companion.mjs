import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
const hash=b=>createHash('sha256').update(b).digest('hex')
const manifest=JSON.parse(await fs.readFile('src/flight-experience/assets/companions/manifest.json','utf8'))
const sourceBytes=await fs.readFile(manifest.source),outputBytes=await fs.readFile(manifest.output)
assert.equal(hash(sourceBytes),manifest.sourceSha256);assert.equal(hash(outputBytes),manifest.sha256);assert.equal(outputBytes.length,manifest.bytes)
await MeshoptDecoder.ready
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder})
const source=(await io.read(manifest.source)).getRoot(),derived=(await io.read(manifest.output)).getRoot()
function animationDigest(root){return hash(Buffer.concat(root.listAnimations().flatMap(a=>a.listSamplers().flatMap(s=>[Buffer.from(s.getInput().getArray().buffer),Buffer.from(s.getOutput().getArray().buffer)]))))}
assert.equal(animationDigest(source),animationDigest(derived));assert.equal(animationDigest(derived),manifest.animationHash)
assert.deepEqual(derived.listAnimations().map(a=>a.getName()),['Idle'])
assert.deepEqual(source.listSkins().map(s=>s.listJoints().map(j=>j.getName())),derived.listSkins().map(s=>s.listJoints().map(j=>j.getName())))
assert.deepEqual(source.listSkins().map(s=>Array.from(s.getInverseBindMatrices().getArray())),derived.listSkins().map(s=>Array.from(s.getInverseBindMatrices().getArray())))
let triangles=0
for(const mesh of derived.listMeshes())for(const p of mesh.listPrimitives()){
 triangles+=p.getIndices().getCount()/3
 assert.ok(p.getAttribute('JOINTS_0'));assert.ok(p.getAttribute('WEIGHTS_0'))
 const joints=p.getAttribute('JOINTS_0'),weights=p.getAttribute('WEIGHTS_0')
 for(let i=0;i<joints.getCount();i++){const j=[],w=[];joints.getElement(i,j);weights.getElement(i,w);assert.ok(Math.abs(w.reduce((a,b)=>a+b,0)-1)<.001);j.forEach((joint,index)=>{if(w[index]>0)assert.ok(joint<manifest.joints)})}
}
assert.equal(triangles,manifest.triangles);assert.ok(13494+3*triangles<=40000);assert.ok(2*13494+6*triangles<=90000)
assert.equal(derived.listTextures().length,0);assert.equal(manifest.license,'CC-BY-4.0')
console.log(`Companion valid: original Idle samples and rig retained; ${triangles} triangles, ${manifest.bytes} bytes; borrowed source textures.`)
