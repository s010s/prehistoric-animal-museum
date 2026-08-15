import { createScaleEncounterForestScatter } from '../src/viewer/scale-encounter-forest-scatter-prototype'

describe('scale encounter forest scatter prototype', () => {
  it.each([
    ['ground-slice', 39, 12, 3],
    ['hybrid-slice', 78, 24, 6],
  ] as const)(
    'keeps the %s density inside its instancing budget',
    (variant, ferns, rocks, logs) => {
      const scatter = createScaleEncounterForestScatter(variant)
      expect(scatter.ferns).toHaveLength(ferns)
      expect(scatter.rocks).toHaveLength(rocks)
      expect(scatter.logs).toHaveLength(logs)
    },
  )

  it('leaves the full 22 m child and animal clearing untouched', () => {
    const scatter = createScaleEncounterForestScatter('hybrid-slice')
    const placements = [
      ...scatter.ferns,
      ...scatter.rocks,
      ...scatter.logs,
    ]
    expect(
      Math.min(...placements.map(({ x, z }) => Math.hypot(x, z))),
    ).toBeGreaterThan(22)
  })

  it('rebuilds to the same fixed-seed composition without jumping', () => {
    const first = createScaleEncounterForestScatter('hybrid-slice')
    const second = createScaleEncounterForestScatter('hybrid-slice')
    expect(second).toEqual(first)
  })

  it('adds the middle distance without moving the ground-slice placements', () => {
    const ground = createScaleEncounterForestScatter('ground-slice')
    const hybrid = createScaleEncounterForestScatter('hybrid-slice')
    expect(hybrid.ferns.slice(0, ground.ferns.length)).toEqual(ground.ferns)
    expect(hybrid.rocks.slice(0, ground.rocks.length)).toEqual(ground.rocks)
    expect(hybrid.logs.slice(0, ground.logs.length)).toEqual(ground.logs)
    expect(hybrid.ferns.slice(ground.ferns.length)).toSatisfy(
      (placements: typeof hybrid.ferns) =>
        placements.every((placement) => placement.tier === 'middle'),
    )
  })

  it('uses clustered, non-regular spacing rather than rows or a radial grid', () => {
    const { ferns } = createScaleEncounterForestScatter('hybrid-slice')
    const nearestDistances = ferns.map((placement, index) =>
      Math.min(
        ...ferns
          .filter((_, otherIndex) => otherIndex !== index)
          .map((other) =>
            Math.hypot(placement.x - other.x, placement.z - other.z),
          ),
      ),
    )
    const roundedDistances = new Set(
      nearestDistances.map((distance) => distance.toFixed(1)),
    )
    const locallyClustered = nearestDistances.filter(
      (distance) => distance < 12,
    )

    expect(roundedDistances.size).toBeGreaterThan(24)
    expect(locallyClustered.length).toBeGreaterThan(ferns.length * 0.55)
    expect(Math.max(...nearestDistances) - Math.min(...nearestDistances)).toBeGreaterThan(8)
  })
})
