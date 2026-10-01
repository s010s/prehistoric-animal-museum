import type { Scene, PerspectiveCamera, Vector3, WebGLRenderer } from 'three'
import type { OceanEnvironmentCandidate } from '../ocean-environment-candidate'
export interface OceanRefractedRuntime {
 readonly diagnostics: Readonly<Record<string, unknown>>
 update(time: number, reducedMotion: boolean, camera: PerspectiveCamera): void
 render(scene: Scene, camera: PerspectiveCamera): void
 dispose(): void
}
export function createOceanRefractedRuntime(renderer: WebGLRenderer, candidate: OceanEnvironmentCandidate, origin?: Vector3): OceanRefractedRuntime
