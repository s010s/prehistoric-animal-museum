/** Deterministic original procedural candidates; no recordings or third-party audio. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const dir=new URL('../../../src/flight-experience/assets/soundscape/',import.meta.url)
mkdirSync(dir,{recursive:true})
const sampleRate=24000,seconds=12,n=sampleRate*seconds,assets=[]
for(const [index,id] of ['wind','surf','rain','river'].entries()){
 let seed=193706+index*12345,low=0,slow=0
 const samples=new Float64Array(n),noise=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2147483648-1}
 // Warm the filters before the retained loop. A wrap crossfade removes filter/random discontinuities.
 for(let i=-sampleRate;i<n;i++){
  const white=noise();low+=.025*(white-low);slow+=.002*(white-slow)
  const t=(i+n)/sampleRate, swell=.6+.4*Math.sin(2*Math.PI*t/6)**2
  const v=id==='wind'?low*.9+slow*1.2:id==='surf'?(low*.9+white*.08)*swell:id==='rain'?white*.11+low*.2:(white*.07+low*.5)*(.8+.2*Math.sin(2*Math.PI*t/3)**2)
  if(i>=0)samples[i]=v
 }
 const fade=2400
 for(let i=0;i<fade;i++){const w=.5-.5*Math.cos(Math.PI*i/(fade-1));samples[n-fade+i]=samples[n-fade+i]*(1-w)+samples[i]*w}
 // Remove the overlapped prefix so endpoint and starting sample are contiguous.
 const pcm=samples.slice(fade),frames=pcm.length,wav=Buffer.alloc(44+frames*2)
 wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(sampleRate,24);wav.writeUInt32LE(sampleRate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(frames*2,40)
 let rawPeak=0
 for(const value of pcm)rawPeak=Math.max(rawPeak,Math.abs(value))
 const scale=Math.min(1,.28/rawPeak)
 let max=0,sum=0
 for(let i=0;i<frames;i++){const value=Math.round(pcm[i]*scale*32767);wav.writeInt16LE(value,44+i*2);max=Math.max(max,Math.abs(value/32768));sum+=(value/32768)**2}
 writeFileSync(new URL(`${id}.wav`,dir),wav)
 assets.push({id,file:`${id}.wav`,author:'Original procedural synthesis generated for Leon做了个 using Codex',source:'scripts/flight/assets/generate-soundscape.mjs; no external recording',license:'CC0-1.0',changes:'Seeded filtered noise, slow envelopes, 100 ms wrap crossfade; PCM16 mono',channels:1,sampleRate,frames,duration:frames/sampleRate,fileBytes:wav.length,sourceDecodedBytes:frames*4,loopStart:0,loopEnd:frames/sampleRate,sha256:createHash('sha256').update(wav).digest('hex'),peak:max,rms:Math.sqrt(sum/frames),review:'pending-human-listening',representation:'synthetic artistic candidate, not field recording or prehistoric reconstruction'})
}
writeFileSync(new URL('manifest.json',dir),JSON.stringify({schema:'flight-soundscape-v1',status:'unreviewed-candidates',assets},null,2)+'\n')
