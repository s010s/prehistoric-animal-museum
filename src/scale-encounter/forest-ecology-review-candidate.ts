import type { Group } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { loadReviewCandidateForestProps } from './forest-props-review-candidate'

function reviewCandidateUrl(bundledUrl: URL): string {
  return bundledUrl.href
}

const sourceUrl = reviewCandidateUrl(
  new URL(
    './assets/environments/forest-ecology-real-v2.glb',
    import.meta.url,
  ),
)

const treeSourceUrl = reviewCandidateUrl(
  new URL(
    './assets/environments/real-tree-lods-v1.glb',
    import.meta.url,
  ),
)

let ecologyTemplatePromise: Promise<Group> | null = null
let templatePromise: Promise<Group> | null = null

export function loadReviewCandidateForestEcologyProps(): Promise<Group> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  ecologyTemplatePromise ??= loader
    .loadAsync(sourceUrl)
    .then((ecologyGltf) => {
      ecologyGltf.scene.name =
        'scale-encounter-real-forest-ecology-v2-props-template'
      return ecologyGltf.scene
    })
    .catch((error: unknown) => {
      ecologyTemplatePromise = null
      throw error
    })
  return ecologyTemplatePromise
}

export function loadReviewCandidateForestEcology(): Promise<Group> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  templatePromise ??= Promise.all([
    loadReviewCandidateForestEcologyProps(),
    loader.loadAsync(treeSourceUrl),
    loadReviewCandidateForestProps(),
  ])
    .then(([ecologyProps, treeGltf, nearProps]) => {
      const template = ecologyProps.clone()
      template.name = 'scale-encounter-real-forest-ecology-v2-template'
      treeGltf.scene.name = 'scale-encounter-real-tree-lods-v1-template'
      template.add(treeGltf.scene)
      // Keep the original per-object PBR scans for the walkable foreground;
      // the compact ecology atlas remains a middle-distance asset.
      template.add(nearProps.clone())
      return template
    })
    .catch((error: unknown) => {
      templatePromise = null
      throw error
    })
  return templatePromise
}
