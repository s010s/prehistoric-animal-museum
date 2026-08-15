import type { Group } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

const localEnvironmentRoute =
  '/__museum-review-assets/scale-encounter-environments'

function reviewCandidateUrl(bundledUrl: URL, fileName: string): string {
  if (
    import.meta.env.MODE === 'development' ||
    import.meta.env.MODE === 'review'
  ) {
    return `${localEnvironmentRoute}/${fileName}`
  }
  return bundledUrl.href
}

const sourceUrl = reviewCandidateUrl(
  new URL(
    '../../assets/candidates/scale-encounter-environments/forest-ecology-real-v2.glb',
    import.meta.url,
  ),
  'forest-ecology-real-v2.glb',
)

const treeSourceUrl = reviewCandidateUrl(
  new URL(
    '../../assets/candidates/scale-encounter-environments/real-tree-lods-v1.glb',
    import.meta.url,
  ),
  'real-tree-lods-v1.glb',
)

let templatePromise: Promise<Group> | null = null

export function loadReviewCandidateForestEcology(): Promise<Group> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  templatePromise ??= Promise.all([
    loader.loadAsync(sourceUrl),
    loader.loadAsync(treeSourceUrl),
  ])
    .then(([ecologyGltf, treeGltf]) => {
      const template = ecologyGltf.scene
      template.name = 'scale-encounter-real-forest-ecology-v2-template'
      treeGltf.scene.name = 'scale-encounter-real-tree-lods-v1-template'
      template.add(treeGltf.scene)
      return template
    })
    .catch((error: unknown) => {
      templatePromise = null
      throw error
    })
  return templatePromise
}
