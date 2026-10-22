import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fingerprintFiles, plannedCanonicalChanges, releaseEvidenceDirectory, releaseInputPaths, sha256, typecheckPromotionOverlay, walkFiles, type PreparedCanonicalRelease } from './canonical-release-plan'

process.env.MUSEUM_RELEASE_CANDIDATE='1'
const { mainCollection }=await import('../src/content/collections/main')
const { releaseCandidateAnimalIds }=await import('../src/content/release-candidate')
const { loadAnimalDefinitions }=await import('./content-data')
const packages=await loadAnimalDefinitions(mainCollection.animalIds)
if(packages.length!==36 || releaseCandidateAnimalIds.some(id=>packages.find(p=>p.definition.id===id)?.definition.status!=='draft'))throw new Error('Prepare expects24published and12actual canonical drafts.')
if(!existsSync('dist-release-candidate/.vite/manifest.json'))throw new Error('Build the actual local release candidate first.')
let plan:PreparedCanonicalRelease={schemaVersion:1,preparedAt:new Date().toISOString(),galleryIds:mainCollection.animalIds,comparisonCount:32,
  newAnimalIds:releaseCandidateAnimalIds,names:packages.map(p=>({id:p.definition.id,habitat:p.definition.habitat,zhCN:p.definition.content['zh-CN']!.name,en:p.definition.content.en!.name})),
  inputs:await fingerprintFiles(await releaseInputPaths()),artifacts:await fingerprintFiles(await walkFiles('dist-release-candidate')),
  requiredApprovalDomains:['science','visuals','motion','responsive','rights','production'],productionOwnerApproved:false}
await mkdir(releaseEvidenceDirectory,{recursive:true})
const path=resolve(releaseEvidenceDirectory,'prepared-release.json')
const previousBytes=existsSync(path) ? await readFile(path,'utf8') : undefined
const previous=previousBytes ? JSON.parse(previousBytes) as PreparedCanonicalRelease : undefined
const sameSnapshot=previous !== undefined && JSON.stringify({...previous,preparedAt:''})===JSON.stringify({...plan,preparedAt:''})
if(sameSnapshot && previous)plan=previous
const changes=await plannedCanonicalChanges(plan)
typecheckPromotionOverlay(changes)
const output=sameSnapshot && previousBytes ? previousBytes : JSON.stringify(plan,null,2)+'\n'
const manifestSha=sha256(output)
if(!sameSnapshot){
  if(previousBytes){
    const archive=resolve(releaseEvidenceDirectory,'prepared-history',sha256(previousBytes))
    await mkdir(archive,{recursive:true})
    await writeFile(resolve(archive,'prepared-release.json'),previousBytes)
    const oldChanges=resolve(releaseEvidenceDirectory,'prepared-promotion-changes.json')
    if(existsSync(oldChanges))await writeFile(resolve(archive,'prepared-promotion-changes.json'),await readFile(oldChanges))
  }
  await writeFile(path,output)
  await writeFile(resolve(releaseEvidenceDirectory,'prepared-promotion-changes.json'),JSON.stringify({preparedManifestSha256:manifestSha,changes:[...changes].map(([path,text])=>({path,preparedText:text,sha256:sha256(text)})),typecheckOverlayPassed:true,sourceFilesModified:false,ownerApprovalRequired:true},null,2)+'\n')
}
const template=JSON.stringify({decision:'pending',preparedManifestSha256:manifestSha,approvedBy:null,approvedOn:null,approvedDomains:plan.requiredApprovalDomains,narration:'Already confirmed separately by the owner for the exact72-track batch; this template grants no approval.'},null,2)+'\n'
const templatePath=resolve(releaseEvidenceDirectory,`owner-approval-template-${manifestSha}.json`)
if(!existsSync(templatePath))await writeFile(templatePath,template)
const stableTemplate=resolve(releaseEvidenceDirectory,'owner-approval-template.json')
if(!existsSync(stableTemplate))await writeFile(stableTemplate,template)
console.log(`${sameSnapshot ? 'Reused identical prepared snapshot' : 'Prepared deterministic local promotion'}, overlay typecheck passed; source draft statuses unchanged. Manifest SHA256 ${manifestSha}; pending approval template ${templatePath}`)
