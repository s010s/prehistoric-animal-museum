import {
  MAMMOTH_PALAEOENVIRONMENT_ANCHOR,
  computeMammothOverviewFittingFieldOfView,
  createMammothPalaeoenvironmentCandidate,
  mammothPalaeoenvironmentGroundY,
} from '../src/scale-encounter/environments/glacier'

describe('mammoth palaeoenvironment teaching composite', () => {
  it('fits the narrow overview against minimum zoom without changing wide framing', () => {
    const mobileFittingFieldOfView =
      computeMammothOverviewFittingFieldOfView(30, 390 / 844)

    expect(mobileFittingFieldOfView).toBeGreaterThan(24)
    expect(mobileFittingFieldOfView).toBeLessThan(25)
    expect(computeMammothOverviewFittingFieldOfView(30, 16 / 9)).toBe(30)
    expect(() => computeMammothOverviewFittingFieldOfView(30, 0)).toThrow(
      'mammoth-overview-aspect-out-of-range',
    )
  })

  it('records the chosen place, time, season and distant-ice role without claiming a site photograph', () => {
    expect(MAMMOTH_PALAEOENVIRONMENT_ANCHOR.id).toBe(
      'eastern-alps-mis3-teaching-composite-v1',
    )
    expect(MAMMOTH_PALAEOENVIRONMENT_ANCHOR.reconstructionType).toBe(
      'teaching-composite',
    )
    expect(MAMMOTH_PALAEOENVIRONMENT_ANCHOR.location.region).toContain(
      'Lower Inn Valley',
    )
    expect(MAMMOTH_PALAEOENVIRONMENT_ANCHOR.time.interval).toContain(
      '47–43 cal ka BP',
    )
    expect(MAMMOTH_PALAEOENVIRONMENT_ANCHOR.seasonClimate.season).toBe(
      '晚春清晨',
    )
    expect(MAMMOTH_PALAEOENVIRONMENT_ANCHOR.iceRole.type).toBe(
      'distant-high-elevation-glacier-and-ice-covered-ridge',
    )
    expect(MAMMOTH_PALAEOENVIRONMENT_ANCHOR.unknowns.join(' ')).toContain(
      '教学型综合复原',
    )
  })

  it('keeps the established mammoth-child rail level and moves relief outside it', () => {
    for (const x of [-12, -8, -4, 0, 4, 6]) {
      expect(mammothPalaeoenvironmentGroundY(x, 0)).toBeCloseTo(0, 8)
    }
    expect(Math.abs(mammothPalaeoenvironmentGroundY(52, -44))).toBeGreaterThan(
      0.08,
    )
  })

  it('switches A, B and C without changing the shared subject contract', () => {
    const candidate = createMammothPalaeoenvironmentCandidate('A')
    expect(candidate.layers.background.visible).toBe(true)
    expect(candidate.layers.farIceMass.visible).toBe(true)
    expect(candidate.layers.groundSurface.visible).toBe(false)
    expect(candidate.layers.nearGround.visible).toBe(false)
    const a = candidate.diagnostics().resourceEstimate

    candidate.setVariant('B')
    expect(candidate.layers.groundSurface.visible).toBe(true)
    expect(candidate.layers.snowLayer.visible).toBe(true)
    expect(candidate.layers.nearGround.visible).toBe(false)
    expect(candidate.fog()).toBeNull()
    const b = candidate.diagnostics().resourceEstimate

    candidate.setVariant('C')
    expect(candidate.layers.nearGround.visible).toBe(true)
    expect(candidate.layers.midSteppe.visible).toBe(true)
    expect(candidate.layers.farLandform.visible).toBe(true)
    expect(candidate.layers.atmosphere.visible).toBe(true)
    expect(candidate.fog()).not.toBeNull()
    const c = candidate.diagnostics().resourceEstimate

    expect(b.triangles).toBeGreaterThan(a.triangles)
    expect(c.triangles).toBeGreaterThan(b.triangles)
    expect(c.drawCalls).toBeGreaterThan(b.drawCalls)
    candidate.dispose()
  })

  it('keeps ice remote and leaves dangerous ice layers empty', () => {
    const candidate = createMammothPalaeoenvironmentCandidate('C')
    const diagnostics = candidate.diagnostics()
    expect(diagnostics.farIceVolume.minimumCorridorSeparationMeters).toBeGreaterThan(
      180,
    )
    expect(diagnostics.farIceVolume.role).toContain('不可接近')
    expect(diagnostics.crevasseCount).toBe(0)
    expect(diagnostics.iceTowerCount).toBe(0)
    expect(diagnostics.groundSurface.kind).toBe(
      'unglaciated-loess-and-permafrost-topsoil',
    )
    expect(diagnostics.groundSurface.supportsSubjects).toBe(true)
    expect(diagnostics.snowLayer.supportsSubjects).toBe(false)
    candidate.dispose()
  })

  it('offers bounded surface states without turning the valley into a white ice field', () => {
    const candidate = createMammothPalaeoenvironmentCandidate(
      'C',
      'wind-scoured',
    )
    const windScoured = candidate.diagnostics()
    candidate.setSurfaceState('balanced')
    const balanced = candidate.diagnostics()
    candidate.setSurfaceState('late-snow')
    const lateSnow = candidate.diagnostics()

    expect(windScoured.snowLayer.approximateCoverFraction).toBe(0.12)
    expect(balanced.snowLayer.approximateCoverFraction).toBe(0.22)
    expect(lateSnow.snowLayer.approximateCoverFraction).toBe(0.34)
    expect(windScoured.layerCounts.snowPatches).toBeLessThan(
      balanced.layerCounts.snowPatches,
    )
    expect(balanced.layerCounts.snowPatches).toBeLessThan(
      lateSnow.layerCounts.snowPatches,
    )
    expect(lateSnow.snowLayer.approximateCoverFraction).toBeLessThan(0.5)
    candidate.dispose()
  })
})
