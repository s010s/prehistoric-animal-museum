import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { PublicationAuthorizedNarrationPlan } from '../src/content/types'

const recordPath = 'src/content/narration-publication-authorization.json'
const sha256Pattern = /^[a-f0-9]{64}$/
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const safeAssetPath = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('src/') && value.endsWith('.mp3') &&
  !value.includes('\\') && value.split('/').every(part => part !== '' && part !== '.' && part !== '..')

export interface NarrationTrackIdentity {
  readonly animalId: string
  readonly locale: string
  readonly phase: string
  readonly sha256: string
}
interface AuthorizedTrack extends NarrationTrackIdentity {
  readonly assetPath: string
}
interface PublicationAuthorization {
  readonly tracks: readonly AuthorizedTrack[]
}

function isAuthorization(value: unknown): value is PublicationAuthorization {
  if (!record(value) || value.schemaVersion !== 1 || value.kind !== 'owner-publication-authorization' ||
      value.scope !== 'owner-publication-authorized' || value.action !== 'public-distribution' ||
      value.completeListening !== 'unverified' || typeof value.owner !== 'string' || !value.owner.trim() ||
      typeof value.recordedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.recordedOn) ||
      !Number.isFinite(Date.parse(`${value.recordedOn}T00:00:00Z`)) ||
      new Date(`${value.recordedOn}T00:00:00Z`).toISOString().slice(0, 10) !== value.recordedOn ||
      !Array.isArray(value.tracks) || value.tracks.length === 0) return false
  const identities = new Set<string>()
  const paths = new Set<string>()
  for (const track of value.tracks) {
    if (!record(track) || typeof track.animalId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(track.animalId) ||
        !['zh-CN', 'en'].includes(String(track.locale)) ||
        !['gallery', 'intro', 'transition', 'arrival'].includes(String(track.phase)) ||
        typeof track.sha256 !== 'string' || !sha256Pattern.test(track.sha256) || !safeAssetPath(track.assetPath)) return false
    const identity = `${track.animalId}/${String(track.locale)}/${String(track.phase)}`
    if (identities.has(identity) || paths.has(track.assetPath)) return false
    identities.add(identity)
    paths.add(track.assetPath)
  }
  return true
}

type PublicationAuthorizedReview = Pick<PublicationAuthorizedNarrationPlan, 'speaker' | 'language' | 'humanReviewStatus' | 'publicationAuthorization'>

function isPublicationAuthorizedReview(value: unknown): value is PublicationAuthorizedReview {
  if (!record(value) || !record(value.publicationAuthorization)) return false
  const authorization = value.publicationAuthorization
  return value.humanReviewStatus === 'pending' && value.speaker === 'Serena' &&
    ['Chinese', 'English'].includes(String(value.language)) &&
    authorization.scope === 'owner-publication-authorized' && authorization.completeListening === 'unverified' &&
    typeof authorization.recordSha256 === 'string' && sha256Pattern.test(authorization.recordSha256)
}

export function isPublicationAuthorizedNarrationPlan(value: unknown): value is PublicationAuthorizedNarrationPlan {
  if (!record(value) || value.status !== 'ready' || value.mimeType !== 'audio/mpeg') return false
  const sourcePath = value.sourcePath
  return isPublicationAuthorizedReview(value) &&
    sourcePath === `audio/narration.${value.language === 'Chinese' ? 'zh-CN' : 'en'}.mp3`
}

export function publicationAuthorizationCoversTrack(value: unknown, expected: NarrationTrackIdentity): boolean {
  return isAuthorization(value) && value.tracks.some(track => track.animalId === expected.animalId &&
    track.locale === expected.locale && track.phase === expected.phase && track.sha256 === expected.sha256)
}

async function readContainedFile(repositoryRoot: string, relativePath: string): Promise<Buffer> {
  const path = resolve(await realpath(repositoryRoot), relativePath)
  const details = await lstat(path)
  if (!details.isFile() || details.isSymbolicLink() || await realpath(path) !== path) throw new Error('Expected a contained regular file.')
  return readFile(path)
}

/** Public metadata records publication authority separately from complete listening. */
export async function verifyNarrationPublicationAuthorization(
  plan: unknown,
  expected: NarrationTrackIdentity,
  repositoryRoot: string,
): Promise<boolean> {
  if (!isPublicationAuthorizedReview(plan) || plan.language !== (expected.locale === 'zh-CN' ? 'Chinese' : 'English')) return false
  try {
    const bytes = await readContainedFile(repositoryRoot, recordPath)
    const value: unknown = JSON.parse(bytes.toString())
    if (digest(bytes) !== plan.publicationAuthorization.recordSha256 || !isAuthorization(value) ||
        !publicationAuthorizationCoversTrack(value, expected)) return false
    const track = value.tracks.find(track => track.animalId === expected.animalId && track.locale === expected.locale && track.phase === expected.phase)!
    return digest(await readContainedFile(repositoryRoot, track.assetPath)) === expected.sha256
  } catch {
    return false
  }
}

/** Verify every authorized file and the corresponding comparison playback metadata. */
export async function validateNarrationPublicationAuthorization(repositoryRoot: string): Promise<boolean> {
  try {
    const bytes = await readContainedFile(repositoryRoot, recordPath)
    const value: unknown = JSON.parse(bytes.toString())
    if (!isAuthorization(value)) return false
    for (const track of value.tracks) {
      if (digest(await readContainedFile(repositoryRoot, track.assetPath)) !== track.sha256) return false
    }
    const manifest: unknown = JSON.parse((await readContainedFile(repositoryRoot, 'src/scale-encounter/audio/additions-manifest.json')).toString())
    if (!record(manifest) || !Array.isArray(manifest.tracks)) return false
    const expected = value.tracks.filter(track => track.phase !== 'gallery')
    const comparisons = manifest.tracks.filter(track => record(track) && ('publicationAuthorization' in track ||
      expected.some(entry => track.animalId === entry.animalId && track.locale === entry.locale && track.phase === entry.phase)))
    if (comparisons.length !== expected.length) return false
    const seen = new Set<string>()
    for (const track of comparisons) {
      if (!isPublicationAuthorizedReview(track) || track.publicationAuthorization.recordSha256 !== digest(bytes)) return false
      const candidate = track as unknown as Record<string, unknown>
      const identity = `${String(candidate.animalId)}/${String(candidate.locale)}/${String(candidate.phase)}`
      const binding = expected.find(entry => entry.animalId === candidate.animalId && entry.locale === candidate.locale && entry.phase === candidate.phase)
      if (!binding || seen.has(identity) || binding.sha256 !== candidate.sha256 ||
          binding.assetPath !== `src/scale-encounter/audio/${String(candidate.file)}` ||
          track.language !== (binding.locale === 'zh-CN' ? 'Chinese' : 'English')) return false
      seen.add(identity)
    }
    return true
  } catch {
    return false
  }
}
