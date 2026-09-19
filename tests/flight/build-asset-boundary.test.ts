import {afterEach,expect,it} from 'vitest'
import {mkdtemp,mkdir,readFile,writeFile,rm,copyFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {findFlightAssetBoundaryFindings} from '../../scripts/flight/build-asset-boundary.mjs'
const temporary:string[]=[]
afterEach(async()=>{await Promise.all(temporary.splice(0).map(root=>rm(root,{recursive:true,force:true})))})
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'flight-boundary-'));temporary.push(root);await mkdir(join(root,'assets'))
 const sources=['src/flight-experience/assets/ecology-r5/ecology-r5.glb','src/flight-experience/assets/companions/pteranodon-far.glb',...['wind','surf','rain','river'].map(id=>`src/flight-experience/assets/soundscape/${id}.wav`)]
 const files:string[]=[],manifest:Record<string,{file:string;src:string}>={}
 for(const [i,src] of sources.entries()){
  const file=`assets/candidate-${i}.${src.endsWith('.wav')?'wav':'glb'}`
  await copyFile(src,join(root,file));files.push(join(root,file));manifest[src]={file,src}
 }
 return {root,files,manifest}
}
it('admits exactly the enabled manifest sources with matching asset bytes',async()=>{
 const {root,files,manifest}=await fixture()
 await expect(findFlightAssetBoundaryFindings(root,true,files,manifest)).resolves.toEqual([])
})
it('rejects a missing companion source, altered sound, and an extra sound layer',async()=>{
 const {root,files,manifest}=await fixture(),companion='src/flight-experience/assets/companions/pteranodon-far.glb'
 const missing={...manifest};delete missing[companion]
 expect(await findFlightAssetBoundaryFindings(root,true,files,missing)).toContain(`Flight source gate mismatch: ${companion}, entries=0`)
 const sound=files[2]!,bytes=await readFile(sound);bytes[100]=bytes[100]!^1;await writeFile(sound,bytes)
 expect(await findFlightAssetBoundaryFindings(root,true,files,manifest)).toContain('Flight emitted asset checksum differs: src/flight-experience/assets/soundscape/wind.wav')
 const extra=join(root,'assets/extra.wav');await writeFile(extra,'unexpected')
 expect(await findFlightAssetBoundaryFindings(root,true,[...files,extra],manifest)).toContain('Expected exactly 4 Flight WAV assets; found 5')
})
it('rejects disabled candidate bytes even after renaming and removing their manifest source',async()=>{
 const {root,files}=await fixture()
 await expect(findFlightAssetBoundaryFindings(root,false,[],{})).resolves.toEqual([])
 const findings=await findFlightAssetBoundaryFindings(root,false,[files[1]!],{})
 expect(findings).toContain('Flight candidate binary escaped its gate: assets/candidate-1.glb')
})
