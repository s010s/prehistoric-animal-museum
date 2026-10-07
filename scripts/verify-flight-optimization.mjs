// Exercise both flight asset scripts on copies of the shipped GLBs.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { validateBytes } from 'gltf-validator'
const root = resolve(import.meta.dirname, '..')
const scratch = await mkdtemp(join(tmpdir(), 'museum-flight-optimizer-verification-'))
await symlink(join(root, 'node_modules'), join(scratch, 'node_modules'))
await writeFile(join(scratch, 'package.json'), '{"type":"module"}')
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
function topology(document) {
  const nodes = document.getRoot().listNodes()
  return nodes.map(node => ({ name: node.getName(), children: node.listChildren().map(n => n.getName()).sort(),
    triangles: node.getMesh()?.listPrimitives().reduce((sum, p) => sum + (p.getIndices() ?? p.getAttribute('POSITION')).getCount() / 3, 0) ?? 0 })).sort((a, b) => a.name.localeCompare(b.name))
}
const reports = []
for (const [folder, file, script, evidence] of [
  ['landscape', 'landscape-samples.glb', 'optimize-landscape.mjs', 'r3'],
  ['lookdev-r4', 'lookdev-r4.glb', 'optimize-lookdev-r4.mjs', 'r4'],
]) {
  const asset = `src/flight-experience/assets/${folder}`
  await mkdir(join(scratch, asset), { recursive: true })
  await mkdir(join(scratch, `.flight-evidence/${evidence}/assets`), { recursive: true })
  await mkdir(join(scratch, 'scripts/flight/assets'), { recursive: true })
  for (const name of [file, 'manifest.json']) await copyFile(join(root, asset, name), join(scratch, asset, name))
  await copyFile(join(root, 'scripts/flight/assets', script), join(scratch, 'scripts/flight/assets', script))
  const path = join(scratch, asset, file)
  const before = await io.read(path)
  execFileSync(process.execPath, [join(scratch, 'scripts/flight/assets', script)], { cwd: scratch, stdio: 'pipe', env: { ...process.env, MUSEUM_LOOKDEV_OUTPUT: asset, MUSEUM_ASSET_EVIDENCE: `.flight-evidence/${evidence}/assets` } })
  const after = await io.read(path)
  assert.deepEqual(topology(after), topology(before), `${folder}: scene hierarchy/geometry changed`)
  assert(after.getRoot().listExtensionsUsed().some(e => e.extensionName === 'EXT_meshopt_compression'))
  const validation = await validateBytes(new Uint8Array(await readFile(path)))
  assert.equal(validation.issues.numErrors, 0, JSON.stringify(validation.issues))
  const manifest = JSON.parse(await readFile(join(scratch, asset, 'manifest.json'), 'utf8'))
  const bytes = await readFile(path)
  assert.equal(manifest.bytes, bytes.length)
  assert.equal(manifest.sha256, createHash('sha256').update(bytes).digest('hex'))
  reports.push({ folder, result: 'PASS', nodes: topology(after).length, bytes: manifest.bytes })
}
await writeFile(join(scratch, 'report.json'), JSON.stringify(reports, null, 2))
console.log(JSON.stringify({ reports, artifacts: scratch }, null, 2))
