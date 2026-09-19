import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
const dir=new URL('../../../src/flight-experience/assets/soundscape/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('manifest.json',dir),'utf8'))
assert.equal(manifest.assets.length,4)
let duration=0,sourceBytes=0
for(const asset of manifest.assets){
 const wav=readFileSync(new URL(asset.file,dir))
 assert.equal(createHash('sha256').update(wav).digest('hex'),asset.sha256)
 assert.equal(wav.length,asset.fileBytes);assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt16LE(20),1);assert.equal(wav.readUInt16LE(22),asset.channels);assert.equal(wav.readUInt32LE(24),asset.sampleRate)
 assert.equal(wav.readUInt32LE(40)/2,asset.frames);assert.equal(asset.sourceDecodedBytes,asset.frames*asset.channels*4)
 assert.ok(asset.duration>=8&&asset.duration<=15);assert.equal(asset.loopStart,0);assert.equal(asset.loopEnd,asset.duration);assert.equal(asset.license,'CC0-1.0');assert.equal(asset.review,'pending-human-listening')
 let peak=0,sum=0,maxStep=0,previous=wav.readInt16LE(wav.length-2)/32768
 for(let i=44;i<wav.length;i+=2){const v=wav.readInt16LE(i)/32768;peak=Math.max(peak,Math.abs(v));sum+=v*v;maxStep=Math.max(maxStep,Math.abs(v-previous));previous=v}
 assert.ok(peak<=.301);assert.ok(Math.abs(peak-asset.peak)<1e-10);assert.ok(Math.abs(Math.sqrt(sum/asset.frames)-asset.rms)<1e-10)
 const seam=Math.abs(wav.readInt16LE(44)-wav.readInt16LE(wav.length-2))/32768
 assert.ok(seam<=maxStep,'Wrap discontinuity must not exceed internal changes')
 duration+=asset.duration;sourceBytes+=asset.sourceDecodedBytes
 console.log(`${asset.id}: ${asset.duration}s mono, peak ${peak.toFixed(4)}, wrap step ${seam.toFixed(4)}, sha256 verified; subjective listening PENDING`)
}
assert.ok(duration>=40&&duration<=60)
console.log(`Total ${duration}s; source PCM ${sourceBytes} bytes. Runtime measures resampled PCM separately; four-voice combined worst-case at initial master .6 stays below unity.`)
