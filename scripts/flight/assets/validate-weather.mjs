import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const path='src/flight-experience/assets/weather/',manifest=JSON.parse(readFileSync(path+'manifest.json','utf8')),png=readFileSync(path+'cloud-density.png')
assert.equal(createHash('sha256').update(png).digest('hex'),manifest.sha256)
assert.equal(manifest.license,'AGPL-3.0-only');assert.equal(manifest.colorSpace,'linear data / NoColorSpace')
assert.deepEqual(manifest.size,[512,512]);assert.ok(manifest.gpuBytesIncludingMipmaps<2*1024*1024);assert.ok(png.length<512*1024)
console.log(`Weather density verified: ${png.length} compressed bytes, ${manifest.gpuBytesIncludingMipmaps} texture bytes including mipmaps.`)
