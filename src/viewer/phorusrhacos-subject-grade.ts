import {
  Mesh,
  MeshStandardMaterial,
  type Material,
  type Object3D,
} from 'three'

export const PHORUSRHACOS_SUBJECT_GRADE_REVISION =
  'phorusrhacos-comparison-authored-albedo-v1' as const

export const PHORUSRHACOS_SUBJECT_GRADE = {
  midtoneExponent: 1.4,
  saturation: 1.06,
} as const

export interface PhorusrhacosSubjectGradeContext {
  readonly animalId: string
  readonly mode: 'gallery' | 'comparison'
}

export interface PhorusrhacosSubjectGradeLease {
  readonly materialCount: number
  restore(): void
}

interface MeshMaterialLease {
  readonly mesh: Mesh
  readonly original: Material | Material[]
  readonly assigned: Material | Material[]
}

/**
 * Restores the bird's grey/brown midtone separation under Compare lighting.
 * Only its albedo is graded; authored white and black remain anchored. The
 * environment, child, texture objects and source materials stay untouched.
 */
export function applyPhorusrhacosSubjectGrade(
  root: Object3D,
  context: PhorusrhacosSubjectGradeContext,
): PhorusrhacosSubjectGradeLease {
  if (context.animalId !== 'phorusrhacos' || context.mode !== 'comparison') {
    return { materialCount: 0, restore: () => {} }
  }

  const clones = new Map<MeshStandardMaterial, MeshStandardMaterial>()
  const bindings: MeshMaterialLease[] = []
  const { midtoneExponent, saturation } = PHORUSRHACOS_SUBJECT_GRADE
  let restored = false

  const restore = (): void => {
    if (restored) return
    restored = true
    for (const binding of bindings) {
      if (binding.mesh.material === binding.assigned) {
        binding.mesh.material = binding.original
      }
    }
    for (const clone of clones.values()) clone.dispose()
  }

  const gradeMaterial = (material: Material): Material => {
    if (!(material instanceof MeshStandardMaterial)) return material
    const existing = clones.get(material)
    if (existing) return existing

    const clone = material.clone()
    const originalOnBeforeCompile = material.onBeforeCompile.bind(clone)
    const originalProgramCacheKey = material.customProgramCacheKey.bind(material)
    clone.onBeforeCompile = function onBeforeCompile(shader, renderer) {
      originalOnBeforeCompile(shader, renderer)
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float phorusrhacosSubjectLuma = dot(
          diffuseColor.rgb,
          vec3(0.2126, 0.7152, 0.0722)
        );
        float phorusrhacosSubjectGradedLuma = pow(
          max(phorusrhacosSubjectLuma, 0.0),
          ${midtoneExponent.toFixed(4)}
        );
        float phorusrhacosSubjectGain = phorusrhacosSubjectLuma > 0.0001
          ? phorusrhacosSubjectGradedLuma / phorusrhacosSubjectLuma
          : 1.0;
        diffuseColor.rgb = clamp(
          mix(
            vec3(phorusrhacosSubjectGradedLuma),
            diffuseColor.rgb * phorusrhacosSubjectGain,
            ${saturation.toFixed(4)}
          ),
          vec3(0.0),
          vec3(1.0)
        );`,
      )
    }
    clone.customProgramCacheKey = () =>
      `${originalProgramCacheKey()}|` +
      `${PHORUSRHACOS_SUBJECT_GRADE_REVISION}|` +
      `${midtoneExponent.toFixed(4)}|${saturation.toFixed(4)}`
    clone.needsUpdate = true
    clones.set(material, clone)
    return clone
  }

  try {
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return
      const mesh = object as Mesh
      const original = mesh.material
      const assigned = Array.isArray(original)
        ? original.map(gradeMaterial)
        : gradeMaterial(original)
      if (Array.isArray(original) && Array.isArray(assigned)) {
        if (assigned.every((material, index) => material === original[index])) {
          return
        }
      } else if (assigned === original) {
        return
      }
      bindings.push({ mesh, original, assigned })
      mesh.material = assigned
    })
  } catch (error) {
    restore()
    throw error
  }

  return { materialCount: clones.size, restore }
}
