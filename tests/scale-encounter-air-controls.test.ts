import { MathUtils, Vector3 } from 'three'
import {
  scaleEncounterAirHeadAxisFor,
  scaleEncounterAirPresentationYawRadians,
  scaleEncounterOrbitAngularSpeedRadiansPerSecond,
} from '../src/viewer/scale-encounter-air-presentation'

describe.each(['review', 'production'])('air encounter head direction and comfortable orbit in %s mode', mode => {
  beforeEach(() => vi.stubEnv('MODE', mode))
  afterEach(() => vi.unstubAllEnvs())
  it.each([
    ['pteranodon', '+z'],
    ['rhamphorhynchus', '-x'],
    ['tupandactylus', '-x'],
    ['sordes', '+x'],
    ['anurognathus', '+x'],
    ['quetzalcoatlus', '+x'],
  ] as const)('points %s toward the child without relying on its wing measurement axis', (id, axis) => {
    expect(scaleEncounterAirHeadAxisFor(id)).toBe(axis)
    const sourceForward = axis === '+z' ? new Vector3(0, 0, 1)
      : new Vector3(axis === '+x' ? 1 : -1, 0, 0)
    const displayedForward = sourceForward.applyAxisAngle(new Vector3(0, 1, 0), scaleEncounterAirPresentationYawRadians(id)!)
    expect(displayedForward.distanceTo(new Vector3(0, 0, 1))).toBeLessThan(1e-10)
    // The child sits on +Z. The same facing reads down in a portrait stack
    // and left in a landscape pair; no model scaling participates here.
    const elevation = MathUtils.degToRad(70)
    const portraitUp = new Vector3(0, Math.cos(elevation), -Math.sin(elevation))
    const landscapeRight = new Vector3(-Math.sin(elevation), Math.cos(elevation), 0)
      .cross(new Vector3(Math.cos(elevation), Math.sin(elevation), 0))
    expect(displayedForward.dot(portraitUp)).toBeLessThan(-.9)
    expect(displayedForward.dot(landscapeRight)).toBeLessThan(-.9)
  })

  it('does not guess a head axis for a future or grounded animal', () => {
    expect(scaleEncounterAirPresentationYawRadians('archaeopteryx')).toBeNull()
    expect(scaleEncounterAirPresentationYawRadians('meganeura')).toBeNull()
    expect(scaleEncounterAirPresentationYawRadians('unreviewed-air-animal')).toBeNull()
  })

  it.each([12, 21, 30])('keeps the air orbit cadence independent of proximity up to %sm', maximumDistance => {
    const definition = { habitat: 'air' as const, maximumDistance }
    const near = scaleEncounterOrbitAngularSpeedRadiansPerSecond(definition, 1.2, 1)
    const far = scaleEncounterOrbitAngularSpeedRadiansPerSecond(definition, maximumDistance, 1)
    expect(near).toBeCloseTo(far, 12)
    expect(near).toBeLessThanOrEqual(MathUtils.degToRad(20))
    expect(far * maximumDistance).toBeLessThanOrEqual(4 + 1e-10)
    expect(scaleEncounterOrbitAngularSpeedRadiansPerSecond(definition, 1.2, 1.6)).toBeCloseTo(near * 1.6, 12)
  })

  it('preserves the grounded and water travel-speed policies', () => {
    expect(scaleEncounterOrbitAngularSpeedRadiansPerSecond({ habitat: 'land', maximumDistance: 30 }, 4, 1)).toBeCloseTo(2.8 / 4, 12)
    expect(scaleEncounterOrbitAngularSpeedRadiansPerSecond({ habitat: 'water', maximumDistance: 30 }, 4, 1.4)).toBeCloseTo(1.2 / 4 * 1.4, 12)
  })
})
