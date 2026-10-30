import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import type { CanonicalComparisonMetadata, CanonicalIdleContactSamples, CanonicalMotionFootprint } from '../src/scale-encounter/canonical-extension'
import type { LoadedAnimalDefinition } from './content-data'

const fingerprint = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex')
const readJson = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T
interface AdditionTrack {
  readonly animalId: string
  readonly locale: string
  readonly phase: string
  readonly file: string
  readonly script: string
  readonly sha256: string
  readonly durationMs: number
  readonly startSample: number
  readonly endSample: number
  readonly continuousMasterSha256: string
  readonly continuousMasterScriptSha256: string
  readonly sampleRateHz: number
  readonly speaker: string
  readonly language: string
  readonly humanReviewStatus: string
}
interface NarrationOwnerRecord {
  readonly decision: string
  readonly trackCount: number
  readonly tracks: readonly Pick<AdditionTrack, 'animalId' | 'locale' | 'phase' | 'sha256' | 'script' | 'durationMs'>[]
}

export async function validateReleaseCandidate(bindingsOnly = false): Promise<void> {
  if (process.env.MUSEUM_RELEASE_CANDIDATE !== '1') throw new Error('Explicit local candidate flag required.')
  const { releaseCandidateAnimalIds, releaseCandidateComparisonIds } = await import('../src/content/release-candidate')
  const { mainCollection } = await import('../src/content/collections/main')
  const evidence = resolve('.handoff/expansion-12/release-fix/integration')
  await mkdir(evidence, { recursive: true })
  if (Number(mainCollection.animalIds.length) !== 36 || new Set(mainCollection.animalIds).size !== 36) {
    throw new Error('Local candidate must select36unique canonical gallery IDs.')
  }
  const metadata = await readJson<Record<string, CanonicalComparisonMetadata>>('src/scale-encounter/canonical-comparison-metadata.json')
  const contacts = await readJson<Record<string, CanonicalIdleContactSamples>>('src/scale-encounter/canonical-idle-contacts.json')
  const footprints = await readJson<Record<string, CanonicalMotionFootprint>>('src/scale-encounter/canonical-motion-footprints.json')
  const narration = await readJson<{tracks: AdditionTrack[]}>('src/scale-encounter/audio/additions-manifest.json')
  const owner = await readJson<NarrationOwnerRecord>('.handoff/expansion-12/release-readiness/narration-owner-confirmation.json')
  if (owner.decision !== 'approved' || owner.trackCount !== 72 || narration.tracks.length !== 48) {
    throw new Error('Missing actual narration batch decision or exact48comparison tracks.')
  }
  const expectedIds = [...releaseCandidateComparisonIds].sort()
  if (JSON.stringify(Object.keys(metadata).sort()) !== JSON.stringify(expectedIds)) throw new Error('Expected8comparison definitions.')
  const audioRows = []
  for (const id of releaseCandidateComparisonIds) {
    const modelPath = `src/content/animals/${id}/model/model.glb`
    if (await fingerprint(modelPath) !== metadata[id].modelSha256) throw new Error(`Calibration model hash mismatch: ${id}`)
    if (!Number.isFinite(metadata[id].meters) || metadata[id].meters <= 0) throw new Error(`Invalid size: ${id}`)
    if (metadata[id].habitat === 'land') {
      const entry = contacts[id], footprint = footprints[id]
      if (!entry || entry.modelSha256 !== metadata[id].modelSha256 || entry.clip !== 'Idle' || entry.duration !== 8 ||
          entry.sampleRate !== 24 || entry.frames.length !== 193 || entry.meters !== metadata[id].meters ||
          !footprint || footprint.modelSha256 !== entry.modelSha256 || footprint.clip !== 'Idle' || footprint.sampleCount !== 193) {
        throw new Error(`Incomplete hash-bound8second Idle contacts/footprint: ${id}`)
      }
    }
    for (const locale of ['zh-CN', 'en']) {
      const rows = narration.tracks.filter((t: {animalId: string; locale: string}) => t.animalId === id && t.locale === locale)
      if (rows.length !== 3) throw new Error(`Missing three continuous phases: ${id}/${locale}`)
      let end = 0
      const scripts = []
      for (const phase of ['intro', 'transition', 'arrival']) {
        const track = rows.find((t: {phase: string}) => t.phase === phase)
        const approval = owner.tracks.find((t: {animalId: string; locale: string; phase: string}) => t.animalId === `expansion-${id}` && t.locale === locale && t.phase === phase)
        if (!track || !approval || approval.sha256 !== track.sha256 || approval.script !== track.script ||
            track.startSample !== end || !Number.isInteger(track.endSample) || track.endSample <= end ||
            track.continuousMasterSha256 !== rows[0].continuousMasterSha256 || track.sampleRateHz !== 48000 ||
            track.speaker !== 'Serena' || track.language !== (locale === 'zh-CN' ? 'Chinese' : 'English') || track.humanReviewStatus !== 'approved') {
          throw new Error(`Continuous phase/owner/locale mismatch: ${id}/${locale}/${phase}`)
        }
        const path = `src/scale-encounter/audio/${track.file}`
        if (await fingerprint(path) !== track.sha256) throw new Error(`Narration hash mismatch: ${path}`)
        const durationMs = Math.round(Number(execFileSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',path], {encoding:'utf8'}).trim()) * 1000)
        if (durationMs !== track.durationMs || durationMs !== approval.durationMs) throw new Error(`Measured narration duration mismatch: ${path}`)
        end = track.endSample; scripts.push(track.script)
        audioRows.push({id,locale,phase,path,sha256:track.sha256,durationMs})
      }
      const scriptSha = createHash('sha256').update(scripts.join('\n')).digest('hex')
      if (!rows.every((t: {continuousMasterScriptSha256: string}) => t.continuousMasterScriptSha256 === scriptSha)) {
        throw new Error(`Continuous master script mismatch: ${id}/${locale}`)
      }
    }
  }
  const missingSmall = ['tullimonstrum','hallucigenia','ammonite','opabinia'].filter(id => metadata[id])
  if (missingSmall.length) throw new Error('Small gallery exhibits must not gain comparison definitions.')
  await writeFile(resolve(evidence,'canonical-extension-bindings.json'), JSON.stringify({checkedAt:new Date().toISOString(),galleryCount:36,comparisonCount:32,newComparisonCount:8,newAudioCount:48,landContactCount:5,allPassed:true,audioRows,productionApprovalGranted:false},null,2)+'\n')
  if (!bindingsOnly) {
    const { loadAnimalDefinitions } = await import('./content-data')
    const { validateContent } = await import('./content-validation')
    const originals = await loadAnimalDefinitions(mainCollection.animalIds)
    if (originals.length !== 36 || !releaseCandidateAnimalIds.every(id => originals.some(p => p.definition.id === id && p.definition.status === 'draft'))) {
      throw new Error('Expected24published plus12unapproved canonical drafts.')
    }
    // Exercise the full asset/rights/bilingual quality gate in memory. The
    // source status stays draft; this projection grants no owner approval.
    const qualityProjection = originals.map(p => ({...p,definition:{...p.definition,status:'published'}})) as LoadedAnimalDefinition[]
    const issues = await validateContent(qualityProjection)
    await writeFile(resolve(evidence,'candidate-content-quality.json'),JSON.stringify({checkedAt:new Date().toISOString(),sourceStatuses:originals.map(p=>({id:p.definition.id,status:p.definition.status})),qualityProjectionOnly:true,ownerApprovalGranted:false,issues},null,2)+'\n')
    const errors = issues.filter(i => i.severity === 'error')
    if (errors.length) throw new Error(`Candidate content quality failed:\n${errors.map(e=>`${e.animalId}:${e.code}:${e.message}`).join('\n')}`)
  }
  console.log(`Canonical local candidate bindings passed:36gallery,32comparison,48new phase MP3,5Idle contact sets${bindingsOnly ? '' : '; full publication-quality asset checks passed without granting approval'}.`)
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.env.MUSEUM_RELEASE_CANDIDATE='1'
  await validateReleaseCandidate(process.argv.includes('--bindings-only'))
}
