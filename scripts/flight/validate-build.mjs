import {findFlightAssetBoundaryFindings} from './build-asset-boundary.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
const root = process.argv[2] ?? 'dist'
const enabled = process.argv.includes('--enabled')
const manifest = JSON.parse(await fs.readFile(path.join(root, '.vite/manifest.json'), 'utf8'))
const flight = Object.keys(manifest).filter(key => key.includes('flight-experience'))
if (enabled !== (flight.length > 0)) throw new Error(`Flight build boundary mismatch: enabled=${enabled}, modules=${flight.length}`)
const files = []
async function walk(dir) { for (const entry of await fs.readdir(dir, {withFileTypes:true})) { const p=path.join(dir,entry.name); if(entry.isDirectory()) await walk(p); else files.push(p) } }
await walk(root)
const assetFindings=await findFlightAssetBoundaryFindings(root,enabled,files,manifest)
if(assetFindings.length)throw new Error(assetFindings.join('\n'))
const workers = files.filter(p => /terrain.worker-.*\.js$/.test(p))
if (enabled !== (workers.length === 1)) throw new Error(`Unexpected terrain workers: ${workers.length}`)
for (const file of files.filter(p => /\.(js|json|html|css|md)$/.test(p))) {
  const content = await fs.readFile(file,'utf8')
  if (/\.flight-evidence|prehistoric-flight-handoff|P0-01｜|\.handoff\/flight-plan/.test(content)) throw new Error(`Private flight material in ${file}`)
}
if (enabled && !files.some(p => p.endsWith('FLIGHT_ASSET_PROVENANCE.md'))) throw new Error('Flight attribution missing')
console.log(`Flight ${enabled ? 'candidate' : 'disabled'} boundary verified: ${flight.length} module entries, ${workers.length} workers. No private handoff/evidence.`)
