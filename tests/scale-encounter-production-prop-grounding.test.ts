import {
  BatchedMesh,
  Box3,
  BoxGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Texture,
  Vector3,
  type BufferGeometry,
} from 'three'
import {
  createScaleEncounterEnvironment,
  disposeScaleEncounterEnvironment,
} from '../src/viewer/scale-encounter-environment'
import {
  SCALE_ENCOUNTER_PRODUCTION_ECOLOGY_TEMPLATE_NAMES,
  type ScaleEncounterProductionEcologyPlacement,
} from '../src/viewer/scale-encounter-production-forest-scatter'
import { scaleEncounterProductionPropTranslationY } from '../src/viewer/scale-encounter-production-prop-grounding'
import { scaleEncounterProductionTerrainHeightAtWorld } from '../src/viewer/scale-encounter-production-terrain'

describe('scale encounter production prop grounding', () => {
  it('aligns the transformed template bottom to the terrain plus a small burial', () => {
    const templateBounds = new Box3(
      new Vector3(-0.8, 0.4, -0.5),
      new Vector3(1.1, 1.7, 0.9),
    )
    const placement = new Object3D()
    placement.position.set(31, 0, -47)
    placement.rotation.set(0.08, 1.17, -0.06)
    placement.scale.set(1.4, 0.82, 1.1)
    placement.updateMatrix()
    const templateHierarchy = new Matrix4().makeTranslation(0.25, 0.63, -0.18)
    const zeroHeightInstance = new Matrix4().multiplyMatrices(
      placement.matrix,
      templateHierarchy,
    )
    const terrainSurfaceWorldY = 2.37
    const burialDepthMeters = 0.035

    const translationY = scaleEncounterProductionPropTranslationY(
      templateBounds,
      zeroHeightInstance,
      terrainSurfaceWorldY,
      burialDepthMeters,
    )
    const finalMatrix = new Matrix4()
      .makeTranslation(0, translationY, 0)
      .multiply(zeroHeightInstance)
    const finalBounds = templateBounds.clone().applyMatrix4(finalMatrix)

    expect(finalBounds.min.y).toBeCloseTo(
      terrainSurfaceWorldY - burialDepthMeters,
      10,
    )
  })

  it('grounds every authored family to D terrain and strips the cached root transform', () => {
    const props = new Group()
    props.position.set(84, 9, -63)
    props.rotation.y = 0.41
    const sourceMaterial = new MeshStandardMaterial()

    for (const [index, name] of SCALE_ENCOUNTER_PRODUCTION_ECOLOGY_TEMPLATE_NAMES.entries()) {
      const geometry = new BoxGeometry(1, 1, 1)
      geometry.translate(0, 0.86, 0)
      const mesh = new Mesh(geometry, sourceMaterial)
      mesh.name = name
      mesh.position.set(
        0.018 * index,
        0.32 + (index % 4) * 0.07,
        -0.011 * index,
      )
      mesh.rotation.set(0.04 * index, -0.12 * index, 0.02)
      props.add(mesh)
    }

    const environment = createScaleEncounterEnvironment(
      'land',
      'production-slice',
      new Texture(),
      {
        animalId: 'tyrannosaurus-rex',
        forestProps: props,
      },
    )
    expect(environment).not.toBeNull()
    if (!environment) return

    const propRoot = environment.root.getObjectByName(
      'scale-encounter-real-forest-props',
    ) as Group
    const propBatch = propRoot.children.find((child) =>
      child.name.includes('-rock-'),
    )
    expect(propBatch).toBeInstanceOf(BatchedMesh)
    if (!(propBatch instanceof BatchedMesh)) return
    const samples = propBatch.userData.scaleEncounterEcologySamples as Array<{
      readonly burialDepth: number
      readonly groundingError: number
      readonly instanceId: number
      readonly placement: ScaleEncounterProductionEcologyPlacement
      readonly terrainY: number
      readonly templateName: string
      readonly worldBottomY: number
    }>
    const sample = samples.find(
      ({ templateName }) => templateName === 'rock_07_lod0',
    )
    expect(sample).toBeDefined()
    if (!sample) return

    const sourceRock = props.getObjectByName('rock_07_lod0') as Mesh
    const rockGeometry = sourceRock.geometry
    const instanceMatrix = new Matrix4()
    propBatch.getMatrixAt(sample.instanceId, instanceMatrix)
    rockGeometry.computeBoundingBox()
    const instanceBounds = rockGeometry.boundingBox
      ?.clone()
      .applyMatrix4(instanceMatrix)
    expect(instanceBounds).toBeDefined()
    if (!instanceBounds) return

    const terrainSurfaceWorldY =
      scaleEncounterProductionTerrainHeightAtWorld(
        sample.placement.x,
        sample.placement.z,
      )
    expect(sample.terrainY).toBeCloseTo(terrainSurfaceWorldY, 8)
    expect(sample.groundingError).toBeCloseTo(0, 8)
    expect(sample.worldBottomY).toBeCloseTo(instanceBounds.min.y, 6)
    expect(terrainSurfaceWorldY - instanceBounds.min.y).toBeCloseTo(
      sample.burialDepth,
      6,
    )
    // The cached template root's +9 m offset must not lift the population.
    expect(instanceBounds.min.y).toBeLessThan(3)

    disposeScaleEncounterEnvironment(environment)
    props.traverse((object) => {
      if (object instanceof Mesh) {
        ;(object.geometry as BufferGeometry).dispose()
      }
    })
    sourceMaterial.dispose()
  })
})
