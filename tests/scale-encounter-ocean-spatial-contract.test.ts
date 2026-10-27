import { Box3, DodecahedronGeometry, Euler, Quaternion, Vector3 } from 'three'
import {
  OCEAN_SEABED_CLEARANCE_METERS,
  OCEAN_SURFACE_EXCLUSION_METERS,
  OCEAN_WATER_SURFACE_Y,
  OCEAN_WATER_VOLUME_BOUNDS,
  createOceanGroundedPlacement,
  diagnoseOceanSpatialContract,
  oceanBedYAt,
} from '../src/scale-encounter/environments/ocean/ocean-spatial-contract'

describe('ocean spatial contract', () => {
  it('keeps the surface, bounded volume and procedural bed in one metre-scale Y-up world', () => {
    expect(OCEAN_WATER_SURFACE_Y).toBe(12.5)
    expect(OCEAN_WATER_VOLUME_BOUNDS.max.y).toBe(OCEAN_WATER_SURFACE_Y)
    expect(OCEAN_WATER_VOLUME_BOUNDS.min.y).toBeLessThan(-18)

    const samples = [-96, -48, 0, 48, 96].flatMap((x) =>
      [-96, -48, 0, 48, 96].map((z) => oceanBedYAt(x, z)),
    )
    expect(Math.min(...samples)).toBeGreaterThan(-17)
    expect(Math.max(...samples)).toBeLessThan(-13)
    expect(Math.max(...samples)).toBeLessThan(OCEAN_WATER_SURFACE_Y)
  })

  it('grounds the fully transformed object bounds instead of trusting the model origin', () => {
    const geometry = new DodecahedronGeometry(0.5, 0)
    geometry.computeBoundingBox()
    if (!geometry.boundingBox) throw new Error('missing-test-bounds')
    const placement = createOceanGroundedPlacement(geometry.boundingBox, {
      burialDepth: 0.17,
      layer: 'near-water',
      name: 'rotated-rock',
      positionXZ: [31, -18],
      rotation: new Quaternion().setFromEuler(new Euler(0.31, 1.17, -0.19)),
      scale: new Vector3(2.7, 0.83, 1.9),
    })

    expect(placement.worldBottomY).toBeCloseTo(
      placement.targetBedY - placement.burialDepth,
      10,
    )
    expect(Math.abs(placement.groundingError)).toBeLessThan(1e-10)
    geometry.dispose()
  })

  it('reports legal subject and camera samples separately from grounded-object overlap', () => {
    const context = {
      animalBounds: new Box3(
        new Vector3(-5, -1.5, -1.5),
        new Vector3(7, 3, 1.5),
      ),
      avatarBounds: new Box3(
        new Vector3(-16.5, -7.2, 8.5),
        new Vector3(-15.8, -6.1, 9.2),
      ),
      cameraSamples: [
        { label: 'overview-default', position: new Vector3(1, 3, 24) },
        { label: 'pov-min', position: new Vector3(-7.3, -2.7, 4.6) },
        { label: 'pov-max', position: new Vector3(-21, -8.5, 12.2) },
      ],
    }
    const diagnostics = diagnoseOceanSpatialContract(context, [], true)

    expect(diagnostics.cameraViolations).toEqual([])
    expect(diagnostics.subjectViolations).toEqual([])
    expect(diagnostics.corridorOverlapCount).toBe(0)
    expect(diagnostics.waterSurface.exclusionMeters).toBe(
      OCEAN_SURFACE_EXCLUSION_METERS,
    )
    expect(diagnostics.hiddenSeabedBoundary.clearanceMeters).toBe(
      OCEAN_SEABED_CLEARANCE_METERS,
    )
    expect(diagnostics.hiddenSeabedBoundary.visibleInCandidate).toBe(true)
  })

  it('fails a camera that crosses the declared surface or seafloor boundary', () => {
    const context = {
      animalBounds: new Box3(
        new Vector3(-1, -1, -1),
        new Vector3(1, 1, 1),
      ),
      avatarBounds: new Box3(
        new Vector3(-3, -3, -1),
        new Vector3(-2, -2, 0),
      ),
      cameraSamples: [
        {
          label: 'surface-crossing',
          position: new Vector3(0, OCEAN_WATER_SURFACE_Y, 0),
        },
        {
          label: 'bed-crossing',
          position: new Vector3(0, oceanBedYAt(0, 0), 0),
        },
      ],
    }
    const diagnostics = diagnoseOceanSpatialContract(context, [], false)
    expect(diagnostics.cameraViolations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ boundary: 'surface', label: 'surface-crossing' }),
        expect.objectContaining({ boundary: 'seabed', label: 'bed-crossing' }),
      ]),
    )
  })
})
