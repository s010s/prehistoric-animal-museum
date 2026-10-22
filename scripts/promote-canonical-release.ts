import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { assertPreparedInventory, plannedCanonicalChanges, releaseEvidenceDirectory, sha256, typecheckPromotionOverlay, type PreparedCanonicalRelease } from './canonical-release-plan'

const manifestPath=resolve(releaseEvidenceDirectory,'prepared-release.json')
const manifestBytes=await readFile(manifestPath),plan=JSON.parse(manifestBytes.toString()) as PreparedCanonicalRelease
await assertPreparedInventory(plan)
const changes=await plannedCanonicalChanges(plan)
typecheckPromotionOverlay(changes)
if(!process.argv.includes('--apply')){
  console.log(`Dry-run passed for ${changes.size} deterministic source changes. No source file modified. Explicit approval for ${sha256(manifestBytes)} is still required.`)
}else{
  const index=process.argv.indexOf('--approval'),path=process.argv[index+1]
  if(index<0||!path)throw new Error('An explicit owner approval record is required; the pending template is not approval.')
  const approval=JSON.parse(await readFile(path,'utf8')) as {decision?:unknown;preparedManifestSha256?:unknown;approvedBy?:unknown;approvedOn?:unknown;approvedDomains?:unknown}
  if(approval.decision!=='approved'||approval.preparedManifestSha256!==sha256(manifestBytes)||typeof approval.approvedBy!=='string'||!approval.approvedBy.trim()||
      typeof approval.approvedOn!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(approval.approvedOn)||!Array.isArray(approval.approvedDomains)||!plan.requiredApprovalDomains.every(d=>(approval.approvedDomains as unknown[]).includes(d)))throw new Error('Approval must cover every required domain and this exact prepared manifest.')
  const backup=resolve(releaseEvidenceDirectory,`promotion-backup-${Date.now()}`)
  const generated=['src/content/credits.generated.ts','THIRD_PARTY_NOTICES.md']
  const originals=new Map<string,Buffer>()
  for(const file of new Set([...changes.keys(),...generated])){const bytes=await readFile(file);originals.set(file,bytes);await mkdir(dirname(resolve(backup,file)),{recursive:true});await copyFile(file,resolve(backup,file))}
  const directoryBackups=['dist','public/social'].map(directory=>({directory,existed:existsSync(directory),path:resolve(backup,directory)}))
  for(const record of directoryBackups)if(record.existed)await cp(record.directory,record.path,{recursive:true})
  const env={...process.env,MUSEUM_RELEASE_CANDIDATE:'0'}
  try{
    for(const [file,text] of changes)await writeFile(file,text)
    for(const script of ['scripts/generate-credits.ts','scripts/generate-seo-social-cards.ts','scripts/validate-content.ts'])execFileSync('node',['--import','tsx',script],{stdio:'inherit',env})
    execFileSync('npm',['run','typecheck'],{stdio:'inherit',env})
    execFileSync('npm',['run','build'],{stdio:'inherit',env})
    await writeFile(resolve(releaseEvidenceDirectory,'promotion-result.json'),JSON.stringify({completedAt:new Date().toISOString(),preparedManifestSha256:sha256(manifestBytes),approvalRecordSha256:sha256(await readFile(path)),approvedBy:approval.approvedBy,approvedOn:approval.approvedOn,sourceChangesApplied:[...changes.keys()],productionBuildPassed:true,externalPublicationPerformed:false,backup},null,2)+'\n')
    console.log('Local canonical promotion completed. No push, deployment or external publication was performed.')
  }catch(error){
    for(const [file,bytes] of originals)await writeFile(file,bytes)
    for(const record of directoryBackups){
      await rm(record.directory,{recursive:true,force:true})
      if(record.existed)await cp(record.path,record.directory,{recursive:true})
    }
    throw new Error(`Promotion restored all changed/generated sources and the exact prior dist/social trees (including prior absence); retained backup ${backup}.`,{cause:error})
  }
}
