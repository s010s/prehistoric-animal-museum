import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { initializeAnimalRun } from '../src/run-init'

async function repository(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'animal-run-init-'))
}

describe('animal run initialization', () => {
  it('refuses to overwrite an existing animal run', async () => {
    const root = await repository()
    const sourcePath = join(root, 'source.glb')
    await writeFile(sourcePath, Buffer.from('source'))
    const options = {
      animalId: 'baryonyx',
      sourcePath,
      repositoryRoot: root,
    } as const
    const first = await initializeAnimalRun(options)
    const before = await readFile(first.files.sourceRecord, 'utf8')

    await expect(initializeAnimalRun(options)).rejects.toThrow(
      'refusing overwrite',
    )
    expect(await readFile(first.files.sourceRecord, 'utf8')).toBe(before)
  })

  it('refuses an existing candidate workspace before creating the run', async () => {
    const root = await repository()
    const sourcePath = join(root, 'source.glb')
    const candidateDirectory = join(root, 'assets/candidates/baryonyx')
    const runDirectory = join(
      root,
      '.handoff/animal-onboarding-runs/baryonyx',
    )
    await writeFile(sourcePath, Buffer.from('source'))
    await mkdir(candidateDirectory, { recursive: true })
    await writeFile(join(candidateDirectory, 'keep.txt'), 'owner data')

    await expect(
      initializeAnimalRun({
        animalId: 'baryonyx',
        sourcePath,
        repositoryRoot: root,
      }),
    ).rejects.toThrow('candidate directory already exists; refusing overwrite')
    expect(await readFile(join(candidateDirectory, 'keep.txt'), 'utf8')).toBe(
      'owner data',
    )
    await expect(lstat(runDirectory)).rejects.toThrow()
  })

  it('does not follow a symlinked run parent outside the repository', async () => {
    const root = await repository()
    const external = await repository()
    const sourcePath = join(root, 'source.glb')
    const runsRoot = join(root, '.handoff/animal-onboarding-runs')
    await writeFile(sourcePath, Buffer.from('source'))
    await mkdir(runsRoot, { recursive: true })
    await symlink(external, join(runsRoot, 'linked-parent'))

    await expect(
      initializeAnimalRun({
        animalId: 'carnotaurus',
        sourcePath,
        runDirectory:
          '.handoff/animal-onboarding-runs/linked-parent/carnotaurus',
        repositoryRoot: root,
      }),
    ).rejects.toThrow('must not contain symlinks or files')
    await expect(lstat(join(external, 'carnotaurus'))).rejects.toThrow()
  })

  it('refuses a symlinked candidate workspace or candidate root', async () => {
    const root = await repository()
    const external = await repository()
    const sourcePath = join(root, 'source.glb')
    const candidatesRoot = join(root, 'assets/candidates')
    await writeFile(sourcePath, Buffer.from('source'))
    await mkdir(candidatesRoot, { recursive: true })
    await symlink(external, join(candidatesRoot, 'oviraptor'))

    await expect(
      initializeAnimalRun({
        animalId: 'oviraptor',
        sourcePath,
        repositoryRoot: root,
      }),
    ).rejects.toThrow('candidate directory already exists; refusing overwrite')

    const secondRoot = await repository()
    const secondSourcePath = join(secondRoot, 'source.glb')
    const externalCandidates = await repository()
    await writeFile(secondSourcePath, Buffer.from('source'))
    await mkdir(join(secondRoot, 'assets'))
    await symlink(externalCandidates, join(secondRoot, 'assets/candidates'))
    await expect(
      initializeAnimalRun({
        animalId: 'oviraptor',
        sourcePath: secondSourcePath,
        repositoryRoot: secondRoot,
      }),
    ).rejects.toThrow('assets/candidates must not contain symlinks or files')
    await expect(lstat(join(externalCandidates, 'oviraptor'))).rejects.toThrow()
  })
})
