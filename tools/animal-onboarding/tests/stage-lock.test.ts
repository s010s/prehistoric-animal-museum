import {
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { fileDigest } from '../src/io'
import { routeAssetRiskWithVerifiedRecords } from '../src/risk-routing'
import {
  createStageLock,
  recordL3Acceptance,
} from '../src/stage-lock'

async function contract(path: string): Promise<void> {
  const workspace = dirname(path)
  const sourcePath = join(workspace, 'source.glb')
  await writeFile(sourcePath, 'source-model')
  const sourceDigest = await fileDigest(sourcePath)
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      contractId: 'test-animal-contract',
      animalId: 'test-animal',
      baselineAssetSha256: sourceDigest.sha256,
      purpose: 'Test one isolated animal.',
      targetIssues: [
        {
          id: 'visible-idle',
          category: 'motion',
          severity: 'must-fix',
          currentProblem: 'No accepted loop.',
          expectedOutcome: 'Accepted loop.',
          verification: 'agent-visual-pass',
          requiredEvidence: ['loop-evidence'],
        },
      ],
      invariants: [
        {
          id: 'limbs-intact',
          category: 'anatomy',
          statement: 'Limbs remain intact.',
          verification: 'agent-visual-pass',
          baselineEvidence: ['baseline-anatomy-evidence'],
          candidateEvidence: ['candidate-anatomy-evidence'],
        },
      ],
      stateSequences: [
        {
          id: 'open-viewer',
          category: 'interaction',
          given: { state: 'closed', assertions: ['Viewer is closed.'] },
          when: { action: 'Open viewer.', conditions: [] },
          then: { state: 'opened', assertions: ['Viewer is open.'] },
          verification: 'machine-pass',
          requiredEvidence: ['interaction-evidence'],
        },
      ],
      evidenceRequirements: [
        {
          id: 'loop-evidence',
          category: 'motion',
          kind: 'full-loop-video',
          stage: 'runtime',
          description: 'Complete loop.',
          requiredFor: 'agent-visual-pass',
          perspectives: ['side'],
          sampleTimesSeconds: [],
          fullCycle: true,
        },
        {
          id: 'baseline-anatomy-evidence',
          category: 'anatomy',
          kind: 'still',
          stage: 'baseline',
          description: 'Baseline anatomy view.',
          requiredFor: 'agent-visual-pass',
          perspectives: ['side'],
          sampleTimesSeconds: [0],
          fullCycle: false,
        },
        {
          id: 'candidate-anatomy-evidence',
          category: 'anatomy',
          kind: 'still',
          stage: 'candidate',
          description: 'Candidate anatomy view.',
          requiredFor: 'agent-visual-pass',
          perspectives: ['side'],
          sampleTimesSeconds: [0],
          fullCycle: false,
        },
        {
          id: 'interaction-evidence',
          category: 'interaction',
          kind: 'runtime-state',
          stage: 'runtime',
          description: 'Viewer open sequence.',
          requiredFor: 'machine-pass',
          perspectives: ['front'],
          sampleTimesSeconds: [0],
          fullCycle: false,
        },
      ],
    }),
  )
  await writeFile(
    join(workspace, 'source-record.json'),
    JSON.stringify({
      schemaVersion: 1,
      kind: 'animal-onboarding-source-record',
      animalId: 'test-animal',
      source: {
        path: sourcePath,
        ...sourceDigest,
      },
      requirementsTemplate: {
        reviewContractPath: path,
        reviewContractSha256: '0'.repeat(64),
        targetIssuesSha256: '1'.repeat(64),
        invariantsSha256: '2'.repeat(64),
        evidenceRequirementsSha256: '3'.repeat(64),
      },
      blockingPlaceholders: [
        {
          id: 'source-rights',
          resolved: true,
          fields: [
            'source.title',
            'source.author',
            'source.pageUrl',
            'source.licenseId',
            'source.licenseName',
            'source.licenseUrl',
            'source.accessedOn',
            'source.directSourceVerified',
            'source.downloadAllowed',
            'source.modificationAllowed',
            'source.redistributionAllowed',
          ],
        },
        {
          id: 'scientific-identity',
          resolved: true,
          fields: ['science', 'reviewContract.invariants'],
        },
        {
          id: 'requirements-contract',
          resolved: true,
          fields: [
            'reviewContract.targetIssues',
            'reviewContract.invariants',
            'reviewContract.evidenceRequirements',
          ],
        },
        {
          id: 'presentation',
          resolved: true,
          fields: [
            'presentation',
            'capturePlanInput.reviewUrl',
            'capturePlanInput.cameraAngles',
          ],
        },
      ],
    }),
  )
  const rights = {
    title: 'Verified test animal source',
    author: 'Fixture Author',
    pageUrl: 'https://example.com/test-animal',
    licenseId: 'CC0-1.0',
    licenseName: 'CC0 1.0 Universal',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    accessedOn: '2026-08-31',
    directSourceVerified: true,
    downloadAllowed: true,
    modificationAllowed: true,
    redistributionAllowed: true,
  }
  const rightsEvidencePath = join(workspace, 'source-rights-evidence.json')
  await writeFile(
    rightsEvidencePath,
    JSON.stringify({
      schemaVersion: 1,
      kind: 'source-rights-evidence',
      animalId: 'test-animal',
      source: { ...rights, modelSha256: sourceDigest.sha256 },
    }),
  )
  await writeFile(
    join(workspace, 'profile.json'),
    JSON.stringify({
      schemaVersion: 1,
      id: 'test-animal',
      status: 'draft',
      runDirectory: workspace,
      source: {
        ...rights,
        sourceModelPath: sourcePath,
        evidencePaths: [rightsEvidencePath],
      },
      science: {
        displayName: 'Test Animal',
        classificationLabel: 'Test clade',
        identityScope: 'Exact fixture identity',
        confidence: 'high',
        sourceUrls: ['https://example.com/test-animal/science'],
        uncertaintyNotes: ['Fixture-only scientific scope.'],
        humanReviewStatus: 'pending',
      },
      model: { outputPath: join(workspace, 'candidate-model.glb') },
      presentation: {
        initialYawDegrees: -35,
        initialHeadSide: 'left',
        safeAreaPadding: 0.12,
        shadow: 'ground',
      },
    }),
  )
  await writeFile(
    join(workspace, 'capture-plan-input.json'),
    JSON.stringify({
      animalId: 'test-animal',
      finalGlbPath: join(workspace, 'candidate-model.glb'),
      reviewUrl: 'http://127.0.0.1:4173/',
      captureMode: 'review-efficient',
      primaryViewportId: 'desktop',
      primaryCameraAngleId: 'initial',
      auxiliaryCameraAngleIds: ['opposite', 'rear'],
      viewports: [
        { id: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1 },
      ],
      cameraAngles: [
        {
          id: 'initial',
          yawDegrees: -35,
          pitchDegrees: 8,
          distance: 4.5,
          target: [0, 0.5, 0],
        },
        {
          id: 'opposite',
          yawDegrees: 145,
          pitchDegrees: 8,
          distance: 4.5,
          target: [0, 0.5, 0],
        },
        {
          id: 'rear',
          yawDegrees: 215,
          pitchDegrees: 8,
          distance: 4.5,
          target: [0, 0.5, 0],
        },
      ],
      animation: {
        clipName: 'Idle',
        durationSeconds: 8,
        sampleTimesSeconds: [0, 2, 4, 6, 8],
      },
      globalBaseline: {
        id: 'production-golden',
        required: true,
        reportPath: join(workspace, 'golden-baseline-report.json'),
      },
    }),
  )
}

function inspection(
  workspace: string,
  lock: Awaited<ReturnType<typeof createStageLock>>,
  acceptance?: Awaited<ReturnType<typeof recordL3Acceptance>>,
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    animalId: 'test-animal',
    inspectionId: 'test-animal-source-v1',
    sourcePackage: {
      modelPresent: true,
      directSourceVerified: true,
      modificationAllowed: true,
      redistributionAllowed: true,
      primaryFormat: 'glb',
      runtimeReadyGlb: true,
      editableSource: true,
      texturesComplete: true,
      topology: 'verified-clean',
      semanticParts: 'complete',
      rig: 'verified',
      skinWeights: 'verified',
      animations: 'verified',
      transparency: 'none',
      evidencePaths: [`${workspace}/source.json`],
    },
    plannedOperations: ['new-rig'],
    knownIssues: [
      {
        id: 'visible-idle-known-issue',
        category: 'motion',
        severity: 'must-fix',
        scope: 'localized',
        description: 'The loop has not yet been accepted.',
        reviewContractBinding: {
          subjectType: 'target-issue',
          subjectId: 'visible-idle',
          evidenceRequirementIds: ['loop-evidence'],
        },
      },
    ],
    executionControls: {
      ...lock.inspectionBindings,
      l3Acceptance: acceptance?.inspectionAcceptance ?? {
        status: 'not-accepted',
        acceptedBy: null,
        acceptedOn: null,
        recordPath: null,
        recordSha256: null,
        acceptedReviewContractSha256: null,
      },
      parallelRequested: true,
    },
  }
}

async function acceptL3(
  workspace: string,
  contractPath: string,
  acceptancePath: string,
  lock: Awaited<ReturnType<typeof createStageLock>>,
): Promise<Awaited<ReturnType<typeof recordL3Acceptance>>> {
  await writeFile(
    join(workspace, 'asset-inspection.json'),
    JSON.stringify(inspection(workspace, lock)),
  )
  return recordL3Acceptance(
    'test-animal',
    workspace,
    contractPath,
    acceptancePath,
    'Leon',
    '2026-08-31',
  )
}

describe('per-animal stage lock', () => {
  it('rejects missing, linked or semantically false rights evidence despite resolved flags', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'animal-stage-lock-'))
    const workspace = join(parent, 'test-animal')
    await mkdir(workspace)
    const contractPath = join(workspace, 'review-contract.json')
    const evidencePath = join(workspace, 'source-rights-evidence.json')
    await contract(contractPath)
    const initialEvidence = await readFile(evidencePath, 'utf8')

    await unlink(evidencePath)
    await expect(
      createStageLock(
        'test-animal',
        workspace,
        contractPath,
        join(workspace, 'stage-lock.json'),
      ),
    ).rejects.toThrow(/must be a non-symlink regular file/)

    const outside = join(parent, 'outside-rights.json')
    await writeFile(outside, initialEvidence)
    await symlink(outside, evidencePath)
    await expect(
      createStageLock(
        'test-animal',
        workspace,
        contractPath,
        join(workspace, 'stage-lock.json'),
      ),
    ).rejects.toThrow(/must be a non-symlink regular file/)

    await unlink(evidencePath)
    const falseEvidence = JSON.parse(initialEvidence) as Record<string, unknown>
    ;(falseEvidence.source as Record<string, unknown>).modificationAllowed = false
    await writeFile(evidencePath, JSON.stringify(falseEvidence))
    await expect(
      createStageLock(
        'test-animal',
        workspace,
        contractPath,
        join(workspace, 'stage-lock.json'),
      ),
    ).rejects.toThrow(/modificationAllowed must be true/)
  })

  it('rejects an acceptance whose owner and lock bindings do not match inspection', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'animal-stage-lock-'))
    const workspace = join(parent, 'test-animal')
    await mkdir(workspace)
    const contractPath = join(workspace, 'review-contract.json')
    const lockPath = join(workspace, 'stage-lock.json')
    const acceptancePath = join(workspace, 'l3-acceptance.json')
    await contract(contractPath)
    await writeFile(join(workspace, 'source.json'), '{}')
    const lock = await createStageLock(
      'test-animal',
      workspace,
      contractPath,
      lockPath,
    )
    const acceptance = await acceptL3(
      workspace,
      contractPath,
      acceptancePath,
      lock,
    )
    const record = JSON.parse(await readFile(acceptancePath, 'utf8')) as Record<
      string,
      unknown
    >
    record.acceptedBy = 'Mallory'
    record.stageLockSha256 = 'f'.repeat(64)
    await writeFile(acceptancePath, JSON.stringify(record))
    const value = inspection(workspace, lock, acceptance)
    const controls = value.executionControls as Record<string, unknown>
    const l3 = controls.l3Acceptance as Record<string, unknown>
    l3.recordSha256 = (await fileDigest(acceptancePath)).sha256
    const result = await routeAssetRiskWithVerifiedRecords(value)
    expect(result.canStart).toBe(false)
    expect(result.blockingReasons).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/different or stale stage lock/),
        expect.stringMatching(/owner or date/),
      ]),
    )
  })

  it('binds acceptance to the canonical pre-acceptance route scope', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'animal-stage-lock-'))
    const workspace = join(parent, 'test-animal')
    await mkdir(workspace)
    const contractPath = join(workspace, 'review-contract.json')
    const lockPath = join(workspace, 'stage-lock.json')
    const acceptancePath = join(workspace, 'l3-acceptance.json')
    await contract(contractPath)
    await writeFile(join(workspace, 'source.json'), '{}')
    const lock = await createStageLock(
      'test-animal',
      workspace,
      contractPath,
      lockPath,
    )
    const acceptance = await acceptL3(
      workspace,
      contractPath,
      acceptancePath,
      lock,
    )
    const acceptedInspection = inspection(workspace, lock, acceptance)
    await writeFile(
      join(workspace, 'asset-inspection.json'),
      JSON.stringify(acceptedInspection),
    )
    await expect(
      routeAssetRiskWithVerifiedRecords(acceptedInspection),
    ).resolves.toMatchObject({ canStart: true })

    ;(acceptedInspection.plannedOperations as string[]).push(
      'anatomy-reconstruction',
    )
    const tampered = await routeAssetRiskWithVerifiedRecords(acceptedInspection)
    expect(tampered.canStart).toBe(false)
    expect(tampered.blockingReasons).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/canonical pre-acceptance inspection revision/),
        expect.stringMatching(/route scope is stale/),
      ]),
    )
  })
})
