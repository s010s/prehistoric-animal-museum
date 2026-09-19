// Same-source distant companion. No authoring session or original asset is mutated.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { simplify } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
const source='src/content/animals/pteranodon/model/model.glb'
const output='src/flight-experience/assets/companions/pteranodon-far.glb'
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
await Promise.all([MeshoptDecoder.ready,MeshoptEncoder.ready,MeshoptSimplifier.ready])
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder})
const sourceBytes=await fs.readFile(source), doc=await io.read(source), root=doc.getRoot()
const animationDigest=(animationRoot=root)=>hash(Buffer.concat(animationRoot.listAnimations().flatMap(a=>a.listSamplers().flatMap(s=>[Buffer.from(s.getInput().getArray().buffer),Buffer.from(s.getOutput().getArray().buffer)]))))
const animationHash=animationDigest(), bones=root.listSkins().flatMap(s=>s.listJoints().map(j=>j.getName()))
await doc.transform(simplify({simplifier:MeshoptSimplifier,ratio:.30,error:.003,lockBorder:true}))
if(animationHash!==animationDigest())throw new Error('Original animation changed')
// Borrow the source material at runtime; do not duplicate its four texture images.
for(const texture of root.listTextures())texture.dispose()
const primitives=root.listMeshes().flatMap(m=>m.listPrimitives())
const triangles=primitives.reduce((sum,p)=>sum+p.getIndices().getCount()/3,0)
if(triangles>8500)throw new Error(`Far mesh budget exceeded: ${triangles}`)
await fs.mkdir('src/flight-experience/assets/companions',{recursive:true})
await io.write(output,doc)
const derived=await io.read(output)
if(animationHash!==animationDigest(derived.getRoot()))throw new Error('Export changed original animation samples')
if(JSON.stringify(bones)!==JSON.stringify(derived.getRoot().listSkins().flatMap(s=>s.listJoints().map(j=>j.getName()))))throw new Error('Bone names changed')
if(hash(await fs.readFile(source))!==hash(sourceBytes))throw new Error('Source modified')
const bytes=await fs.readFile(output)
const manifest={version:1,reviewStatus:'needs_review',approval:null,source,sourceSha256:hash(sourceBytes),author:'Chistodrako._. / Oscar López Riviello',sourceUrl:'https://sketchfab.com/3d-models/pteranodon-animated-7d7683df41d1405283f160e81a5dff1b',license:'CC-BY-4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',output,sha256:hash(bytes),bytes:bytes.length,recipe:'scripts/flight/assets/prepare-companion.mjs',modifications:'Meshopt index/vertex simplification (ratio 0.30, error 0.003, locked borders). Surviving vertex bone indices/weights retained. All original Idle samplers, skin joints, inverse binds, node transforms and scale retained. Textures omitted: borrow source material at runtime. No PoweredFlap or authored animation.',triangles,primitives:primitives.length,joints:bones.length,animationHash,animation:'Idle',duration:10.666666984558105,sourceUnitsSampledBounds:{min:[-.528202029,-.286211741,-.267591785],max:[.515380412,.398308744,.191115568]},safetyPaddingSourceUnits:.05,visualReview:'pending headed browser entire original cycle; simplification is for distant companions only'}
await fs.writeFile('src/flight-experience/assets/companions/manifest.json',JSON.stringify(manifest,null,2)+'\n')
console.log(JSON.stringify(manifest,null,2))
