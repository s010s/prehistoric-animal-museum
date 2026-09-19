import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import path from 'node:path'

/** Source identities and bytes are both checked: hashed Vite filenames alone are not an asset contract. */
export async function findFlightAssetBoundaryFindings(root,enabled,files,manifest,sourceRoot=process.cwd()){
 const readJson=async source=>JSON.parse(await readFile(path.join(sourceRoot,source),'utf8'))
 const ecology=await readJson('src/flight-experience/assets/ecology-r5/manifest.json')
 const companion=await readJson('src/flight-experience/assets/companions/manifest.json')
 const sound=await readJson('src/flight-experience/assets/soundscape/manifest.json')
 const expected=[
  {source:'src/flight-experience/assets/ecology-r5/ecology-r5.glb',sha256:ecology.sha256},
  {source:companion.output,sha256:companion.sha256},
  ...sound.assets.map(asset=>({source:`src/flight-experience/assets/soundscape/${asset.file}`,sha256:asset.sha256})),
 ]
 const findings=[]
 if(sound.assets.length!==4||new Set(sound.assets.map(asset=>asset.id)).size!==4)findings.push('Flight sound manifest must contain exactly four distinct sound layers')
 const sourceEntries=Object.entries(manifest)
 const flightEntries=sourceEntries.filter(([key,entry])=>[key,entry.src??''].some(source=>source.includes('flight-experience')))
 if(enabled!==(flightEntries.length>0))findings.push(`Flight module gate mismatch: enabled=${enabled}, entries=${flightEntries.length}`)
 const waves=files.filter(file=>path.extname(file)==='.wav')
 if(waves.length!==(enabled?4:0))findings.push(`Expected exactly ${enabled?4:0} Flight WAV assets; found ${waves.length}`)
 for(const asset of expected){
  const matches=sourceEntries.filter(([key,entry])=>key===asset.source||entry.src===asset.source)
  if(matches.length!==(enabled?1:0)){findings.push(`Flight source gate mismatch: ${asset.source}, entries=${matches.length}`);continue}
  if(!enabled)continue
  const emitted=matches[0][1].file
  if(typeof emitted!=='string'||!files.includes(path.join(root,emitted))){findings.push(`Flight emitted asset missing: ${asset.source}`);continue}
  const hash=createHash('sha256').update(await readFile(path.join(root,emitted))).digest('hex')
  if(hash!==asset.sha256)findings.push(`Flight emitted asset checksum differs: ${asset.source}`)
 }
 // Also detect the optional binary copied outside the manifest, including renamed files.
 if(!enabled){
  const forbiddenHashes=new Set(expected.map(asset=>asset.sha256))
  for(const file of files.filter(file=>/\.(glb|wav)$/.test(file))){
   if(forbiddenHashes.has(createHash('sha256').update(await readFile(file)).digest('hex')))findings.push(`Flight candidate binary escaped its gate: ${path.relative(root,file)}`)
  }
 }
 return findings
}
