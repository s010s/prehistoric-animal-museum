// End-to-end verification of the actual optimizer on disposable model trees.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import sharp from 'sharp'
import { validateBytes } from 'gltf-validator'

const repositoryRoot = resolve(import.meta.dirname, '..')
const scratch = await mkdtemp(join(tmpdir(), 'museum-optimizer-verification-'))
await mkdir(join(scratch, 'scripts'))
await symlink(join(repositoryRoot, 'node_modules'), join(scratch, 'node_modules'))
await writeFile(join(scratch, 'package.json'), '{"type":"module"}')
for (const name of ['optimize-runtime-models.mjs', 'resample-cubic-rotation-tracks.mjs']) {
  await copyFile(join(repositoryRoot, 'scripts', name), join(scratch, 'scripts', name))
}
const animals = join(scratch, 'src/content/animals')
const modelPath = join(animals, 'fixture/model/model.glb')
await mkdir(join(animals, 'fixture/model'), { recursive: true })
await mkdir(join(animals, 'missing'), { recursive: true })
const document = new Document()
const buffer = document.createBuffer()
const positions = new Float32Array(9000)
const uvs = new Float32Array(6000)
for (let i = 0; i < 3000; i += 3) {
  positions.set([0, 0, 0, 1, 0, 0, 0, 1, 0], i * 3)
  uvs.set([0, 0, 1, 0, 0, 1], i * 2)
}
const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: '#237f4f80' } }).png().toBuffer()
const texture = document.createTexture().setImage(png).setMimeType('image/png')
const material = document.createMaterial().setBaseColorTexture(texture)
const primitive = document.createPrimitive().setMaterial(material)
  .setIndices(document.createAccessor().setType('SCALAR').setArray(Uint16Array.from({ length: 3000 }, (_, i) => i)).setBuffer(buffer))
  .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
  .setAttribute('TEXCOORD_0', document.createAccessor().setType('VEC2').setArray(uvs).setBuffer(buffer))
const node = document.createNode().setMesh(document.createMesh().addPrimitive(primitive))
document.createScene().addChild(node)
const sampler = document.createAnimationSampler().setInterpolation('CUBICSPLINE')
  .setInput(document.createAccessor().setType('SCALAR').setArray(new Float32Array([0, 1])).setBuffer(buffer))
  .setOutput(document.createAccessor().setType('VEC4').setArray(new Float32Array([
    0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0.70710678, 0.70710678, 0, 0, 0, 0,
  ])).setBuffer(buffer))
document.createAnimation().addSampler(sampler).addChannel(document.createAnimationChannel()
  .setTargetNode(node).setTargetPath('rotation').setSampler(sampler))
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
await io.write(modelPath, document)
const before = await readFile(modelPath)
function run() {
  return execFileSync(process.execPath, [join(scratch, 'scripts/optimize-runtime-models.mjs')], { encoding: 'utf8', stdio: 'pipe' })
}
const output = run()
const after = await readFile(modelPath)
assert(after.length < before.length, 'Expected a smaller optimized model')
const optimized = await io.read(modelPath)
assert(optimized.getRoot().listExtensionsUsed().some(e => e.extensionName === 'EXT_meshopt_compression'))
assert.equal(optimized.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION').getCount(), 3000)
assert.equal(optimized.getRoot().listAnimations()[0].listSamplers()[0].getInterpolation(), 'LINEAR')
assert.equal(optimized.getRoot().listAnimations()[0].listSamplers()[0].getInput().getCount(), 25)
const nextTexture = optimized.getRoot().listTextures()[0]
assert.equal(nextTexture.getMimeType(), 'image/webp')
assert.deepEqual(await sharp(nextTexture.getImage()).ensureAlpha().raw().toBuffer(), await sharp(png).ensureAlpha().raw().toBuffer())
const validation = await validateBytes(new Uint8Array(after))
assert.equal(validation.issues.numErrors, 0, JSON.stringify(validation.issues))
assert.match(run(), /already optimized/)
assert.deepEqual(await readFile(modelPath), after, 'Already optimized input changed')
// A tiny empty scene costs more to compress: retain the source exactly.
const tinyPath = join(animals, 'tiny/model/model.glb')
await mkdir(join(animals, 'tiny/model'), { recursive: true })
const tiny = new Document()
tiny.createScene().addChild(tiny.createNode())
await io.write(tinyPath, tiny)
const tinyBefore = await readFile(tinyPath)
assert.match(run(), /kept original/)
assert.deepEqual(await readFile(tinyPath), tinyBefore)
// Invalid glTF must fail validation before replacing the source.
const rejectedPath = join(animals, 'rejected/model/model.glb')
await mkdir(join(animals, 'rejected/model'), { recursive: true })
const rejected = new Document()
rejected.createScene()
await io.write(rejectedPath, rejected)
const rejectedBefore = await readFile(rejectedPath)
assert.throws(run, /Model validation failed/)
assert.deepEqual(await readFile(rejectedPath), rejectedBefore)
await (await import('node:fs/promises')).rm(join(animals, 'rejected'), { recursive: true })
// Corrupt input must fail without replacing any source bytes.
const invalidPath = join(animals, 'invalid/model/model.glb')
await mkdir(join(animals, 'invalid/model'), { recursive: true })
const invalid = Buffer.from('invalid model')
await writeFile(invalidPath, invalid)
assert.throws(run)
assert.deepEqual(await readFile(invalidPath), invalid)
const heroPath = join(scratch, 'hero.png')
await sharp(join(repositoryRoot, 'assets/readme/hero.svg')).png().toFile(heroPath)
assert((await sharp(heroPath).metadata()).width > 0)
const report = { result: 'PASS', beforeBytes: before.length, afterBytes: after.length,
  checks: ['PNG lossless WebP pixels', 'meshopt roundtrip', 'geometry count', 'cubic rotation resampling', 'glTF validation', 'optimized skip', 'missing model skip', 'larger output retained', 'invalid glTF rejected before replacement', 'invalid input retained', 'SVG rendering'], output }
await writeFile(join(scratch, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ...report, artifacts: scratch }, null, 2))
