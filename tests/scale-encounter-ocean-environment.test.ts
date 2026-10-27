import { Box3, Group, Vector3 } from 'three'
import {
  OCEAN_ENVIRONMENT_LAYERS,
  OCEAN_ENVIRONMENT_VARIANTS,
  createOceanEnvironmentCandidate,
} from '../src/scale-encounter/environments/ocean/ocean-environment-candidate'

describe('ocean environment candidate', () => {
  it('keeps A/B/C explicit and independently reversible', () => {
    expect(OCEAN_ENVIRONMENT_VARIANTS).toEqual(['A', 'B', 'C'])
    expect(OCEAN_ENVIRONMENT_LAYERS).toContain('water-surface')
    expect(OCEAN_ENVIRONMENT_LAYERS).toContain('seabed')
    expect(OCEAN_ENVIRONMENT_LAYERS).toContain('ecology-clues')

    const environment = createOceanEnvironmentCandidate({ variant: 'A' })
    expect(environment.getDiagnostics()).toMatchObject({
      fogDensity: 0,
      layers: {
        'background-scatter': true,
        'water-surface': false,
        'water-volume': false,
        seabed: false,
      },
      variant: 'A',
    })

    environment.setVariant('B')
    expect(environment.getDiagnostics()).toMatchObject({
      layers: {
        'background-scatter': true,
        'near-water': false,
        'water-surface': true,
        'water-volume': true,
        seabed: true,
      },
      variant: 'B',
    })
    expect(environment.getFog()?.density).toBeCloseTo(0.0055, 8)

    environment.setVariant('C')
    const candidate = environment.getDiagnostics()
    expect(candidate.layers['near-water']).toBe(true)
    expect(candidate.layers['mid-water']).toBe(true)
    expect(candidate.layers['far-volume']).toBe(true)
    expect(candidate.layers['suspended-particulate']).toBe(true)
    expect(candidate.layers['ecology-clues']).toBe(false)
    expect(candidate.browserIndependentDesignChecks.ecologyFallbackReason).toMatch(
      /No ocean ecology asset is approved/,
    )

    environment.setLayerEnabled('suspended-particulate', false)
    expect(
      environment.getDiagnostics().layers['suspended-particulate'],
    ).toBe(false)
    environment.setVariant('A')
    expect(environment.getDiagnostics().variant).toBe('A')
    environment.dispose()
  })

  it('keeps C to one low-coverage transparent draw and uses no repeated cards', () => {
    const environment = createOceanEnvironmentCandidate({ variant: 'C' })
    const diagnostics = environment.getDiagnostics()

    expect(diagnostics.resources.transparentDrawCalls).toBe(1)
    expect(diagnostics.resources.transparentMaterialCount).toBe(1)
    expect(diagnostics.resources.transparentScreenCoverageEstimate).toBeLessThan(
      0.02,
    )
    expect(diagnostics.alpha.cardCount).toBe(0)
    expect(diagnostics.alpha.repeatedCardGroups).toBe(0)
    expect(diagnostics.browserIndependentDesignChecks.repeatedFarCards).toBe(0)
    expect(diagnostics.browserIndependentDesignChecks.colourDiscontinuityBands).toBe(0)
    expect(diagnostics.resources.drawCalls).toBeLessThanOrEqual(8)
    environment.dispose()
  })

  it('diagnoses the frozen subject corridor and every transformed seafloor object', () => {
    const environment = createOceanEnvironmentCandidate({ variant: 'C' })
    environment.setObservationContext({
      animalBounds: new Box3(
        new Vector3(-4.8, -0.7, -1),
        new Vector3(7.2, 3.2, 1),
      ),
      avatarBounds: new Box3(
        new Vector3(-16.9, -7.5, 8.7),
        new Vector3(-16.2, -6.35, 9.2),
      ),
      cameraSamples: [
        { label: 'overview-min', position: new Vector3(1.2, 2.1, 32) },
        { label: 'overview-default', position: new Vector3(1.2, 2.1, 28) },
        { label: 'overview-max', position: new Vector3(1.2, 2.1, 25) },
        { label: 'pov-min', position: new Vector3(-7, -2, 4.7) },
        { label: 'pov-default', position: new Vector3(-15, -6, 9) },
        { label: 'pov-max', position: new Vector3(-21, -8.5, 12.5) },
      ],
    })
    const spatial = environment.getDiagnostics().spatial
    expect(spatial).not.toBeNull()
    expect(spatial?.cameraViolations).toEqual([])
    expect(spatial?.subjectViolations).toEqual([])
    expect(spatial?.corridorOverlapCount).toBe(0)
    expect(spatial?.objectGrounding.length).toBe(6)
    expect(
      spatial?.objectGrounding.every(
        ({ groundingError }) => Math.abs(groundingError) < 1e-9,
      ),
    ).toBe(true)
    environment.dispose()
  })

  it('accepts only explicitly approved ecology objects and never makes them default', () => {
    const clue = new Group()
    const environment = createOceanEnvironmentCandidate({
      approvedEcologyClues: [
        { id: 'approved-test-clue', object: clue, status: 'approved-for-ocean-slice' },
      ],
      variant: 'B',
    })
    expect(environment.getDiagnostics().layers['ecology-clues']).toBe(false)
    environment.setVariant('C')
    expect(environment.getDiagnostics().layers['ecology-clues']).toBe(true)
    expect(environment.getDiagnostics().approvedEcologyAssetIds).toEqual([
      'approved-test-clue',
    ])
    environment.dispose()
  })
})
