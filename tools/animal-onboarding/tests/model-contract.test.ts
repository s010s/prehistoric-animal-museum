import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { sourceRiskRouteGate } from '../src/gates'
import { verifySourceBaseline } from '../src/model-contract'
import { initializeAnimalRun } from '../src/run-init'
import { routeAssetRiskWithVerifiedRecords } from '../src/risk-routing'
import type { AnimalOnboardingProfile } from '../src/types'

describe('source baseline integrity', () => {
  it('detects source replacement after initialization', async () => {
    const root = await mkdtemp(join(tmpdir(), 'source-baseline-'))
    const sourcePath = join(root, 'incoming', 'baryonyx.glb')
    await mkdir(join(root, 'incoming'))
    await writeFile(sourcePath, 'original source bytes')
    const initialized = await initializeAnimalRun({
      animalId: 'baryonyx',
      sourcePath,
      repositoryRoot: root,
    })
    const profile = JSON.parse(
      await readFile(initialized.files.profile, 'utf8'),
    ) as AnimalOnboardingProfile

    const before = await verifySourceBaseline(
      profile,
      initialized.files.reviewContract,
    )
    expect(before).toMatchObject({
      pass: true,
      sourceModelSha256: before.baselineAssetSha256,
    })

    await writeFile(sourcePath, 'changed source bytes')
    const after = await verifySourceBaseline(
      profile,
      initialized.files.reviewContract,
    )
    expect(after.pass).toBe(false)
    expect(after.errors).toContain(
      'source model SHA-256 no longer matches reviewContract.baselineAssetSha256',
    )

    const inspection = JSON.parse(
      await readFile(initialized.files.assetInspection, 'utf8'),
    ) as {
      executionControls: {
        animalWorkspacePath: string
        reviewContractPath: string
      }
      sourcePackage: { evidencePaths: string[] }
    }
    inspection.executionControls.animalWorkspacePath = initialized.runDirectory
    inspection.executionControls.reviewContractPath =
      initialized.files.reviewContract
    inspection.sourcePackage.evidencePaths = [initialized.files.sourceRecord]
    await writeFile(
      initialized.files.assetInspection,
      `${JSON.stringify(inspection, null, 2)}\n`,
    )
    const route = await routeAssetRiskWithVerifiedRecords(inspection)
    await writeFile(
      join(initialized.runDirectory, 'asset-risk-route.json'),
      `${JSON.stringify(route, null, 2)}\n`,
    )
    const sourceGate = await sourceRiskRouteGate({
      ...profile,
      runDirectory: initialized.runDirectory,
    })
    expect(sourceGate.status).toBe('fail')
    expect(sourceGate.summary).toMatch(/no longer matches/)
  })
})
