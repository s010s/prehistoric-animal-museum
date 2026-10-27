import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import {
  SKY_PROTOTYPE_FLIGHT_APPROXIMATION_LIMITATION,
  createPrototypeFlightApproximation,
  prototypeFlightPivotWorldPosition,
} from '../prototypes/scale-encounter-sky/prototype-flight-approximation'

function fixture() {
  const avatarRoot = new Group()
  const body = new Mesh(
    new BoxGeometry(0.32, 1.1, 0.24),
    new MeshBasicMaterial(),
  )
  body.position.set(0.02, 0.55, -0.01)
  avatarRoot.add(body)
  avatarRoot.rotation.y = Math.PI / 2
  avatarRoot.updateMatrixWorld(true)
  return { avatarRoot, body }
}

function expectVectorClose(
  actual: Readonly<Vector3>,
  expected: Readonly<Vector3>,
  places = 8,
) {
  expect(actual.x).toBeCloseTo(expected.x, places)
  expect(actual.y).toBeCloseTo(expected.y, places)
  expect(actual.z).toBeCloseTo(expected.z, places)
}

describe('sky prototype flight approximation', () => {
  it('uses the rendered standing bounds centre as the immutable pivot', () => {
    const { avatarRoot } = fixture()
    const sourceBounds = new Box3().setFromObject(avatarRoot, true)
    const expectedPivot = sourceBounds.getCenter(new Vector3())
    const approximation = createPrototypeFlightApproximation(
      avatarRoot,
      new Vector3(0, 0, -1),
    )
    expectVectorClose(approximation.pivotLocal, expectedPivot)
    expectVectorClose(
      prototypeFlightPivotWorldPosition(approximation),
      expectedPivot,
    )
    approximation.setEnabled(false)
    expectVectorClose(
      prototypeFlightPivotWorldPosition(approximation),
      expectedPivot,
    )
  })

  it('maps the standing body axis onto the locked negative-Z flight axis', () => {
    const { avatarRoot } = fixture()
    const approximation = createPrototypeFlightApproximation(
      avatarRoot,
      new Vector3(0, 0, -4),
    )
    const snapshot = approximation.getSnapshot()
    expectVectorClose(
      new Vector3(...snapshot.approximatedBodyAxisWorld),
      new Vector3(0, 0, -1),
    )
    expect(snapshot.flightDirectionWorld).toEqual([0, 0, -1])
    expect(snapshot.rotationEulerDegrees).toEqual({
      order: 'XYZ',
      x: -90,
      y: 0,
      z: 0,
    })
    expect(snapshot.rotationQuaternion.x).toBeCloseTo(-Math.SQRT1_2, 8)
    expect(snapshot.rotationQuaternion.w).toBeCloseTo(Math.SQRT1_2, 8)
  })

  it('is reversible without changing source identity or reclassifying Idle_Land', () => {
    const { avatarRoot } = fixture()
    const sourceYaw = avatarRoot.rotation.y
    const approximation = createPrototypeFlightApproximation(
      avatarRoot,
      new Vector3(0, 0, -1),
    )
    approximation.carrier.position.set(2, 4, 6)
    approximation.setEnabled(false)
    const snapshot = approximation.getSnapshot()
    const actualStandingBounds = new Box3().setFromObject(
      approximation.carrier,
      true,
    )
    expectVectorClose(
      actualStandingBounds.min,
      snapshot.sourceBoundsAtCurrentPlacement.min,
    )
    expectVectorClose(
      actualStandingBounds.max,
      snapshot.sourceBoundsAtCurrentPlacement.max,
    )
    expect(avatarRoot.rotation.y).toBe(sourceYaw)
    expect(snapshot.modelTransformBaked).toBe(false)
    expect(snapshot.sourceAnimationReclassified).toBe(false)
    expect(snapshot.limitation).toBe(
      SKY_PROTOTYPE_FLIGHT_APPROXIMATION_LIMITATION,
    )
  })

  it('turns height into longitudinal depth while keeping finite dynamic bounds', () => {
    const { avatarRoot } = fixture()
    const approximation = createPrototypeFlightApproximation(
      avatarRoot,
      new Vector3(0, 0, -1),
    )
    const transformed = approximation.getSnapshot().transformedDynamicBounds
    const size = transformed.getSize(new Vector3())
    expect(size.z).toBeCloseTo(1.1, 5)
    expect(size.y).toBeCloseTo(0.32, 5)
    expect(transformed.isEmpty()).toBe(false)
  })

  it('rejects an undefined flight direction', () => {
    const { avatarRoot } = fixture()
    expect(() =>
      createPrototypeFlightApproximation(avatarRoot, new Vector3()),
    ).toThrow('sky-prototype-flight-direction-invalid')
  })
})
