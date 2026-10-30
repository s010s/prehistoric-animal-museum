// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Texture } from 'three'
import { applyPhorusrhacosSubjectGrade } from '../src/viewer/phorusrhacos-subject-grade'

// Failure-first contract: a Compare-only correction must never change a
// Gallery/shared material, lose texture/normal/alpha inputs, or leak a clone.
describe('Phorusrhacos comparison subject grade', () => {
  it('leaves Gallery and other animals untouched', () => {
    for (const context of [{ animalId: 'phorusrhacos', mode: 'gallery' as const }, { animalId: 'regaliceratops', mode: 'comparison' as const }]) {
      const root = new Group()
      const material = new MeshStandardMaterial({ color: '#89736f' })
      const mesh = new Mesh(new BoxGeometry(), material)
      root.add(mesh)
      const lease = applyPhorusrhacosSubjectGrade(root, context)
      expect(lease.materialCount).toBe(0)
      expect(mesh.material).toBe(material)
      lease.restore()
      expect(mesh.material).toBe(material)
    }
  })

  it('isolates shared material users and retains all authored surface inputs', () => {
    const map = new Texture(), normalMap = new Texture(), alphaMap = new Texture()
    const material = new MeshStandardMaterial({ map, normalMap, alphaMap, roughness: .82, metalness: 0, transparent: true, opacity: .65, color: '#987876' })
    material.normalScale.set(.48, .48)
    const root = new Group(), mesh = new Mesh(new BoxGeometry(), material)
    const outsideMesh = new Mesh(new BoxGeometry(), material)
    root.add(mesh)
    const originalColor = material.color.clone()
    const lease = applyPhorusrhacosSubjectGrade(root, { animalId: 'phorusrhacos', mode: 'comparison' })
    const clone = mesh.material
    expect(lease.materialCount).toBe(1)
    expect(clone).not.toBe(material)
    expect(outsideMesh.material).toBe(material)
    expect(material.color.equals(originalColor)).toBe(true)
    expect(clone.map).toBe(map)
    expect(clone.normalMap).toBe(normalMap)
    expect(clone.alphaMap).toBe(alphaMap)
    expect(clone.normalScale.equals(material.normalScale)).toBe(true)
    expect(clone.roughness).toBe(.82)
    expect(clone.metalness).toBe(0)
    expect(clone.opacity).toBe(.65)
    expect(clone.transparent).toBe(true)
    lease.restore()
    expect(mesh.material).toBe(material)
  })

  it('shares one clone within the subject and restores original arrays exactly once', () => {
    const material = new MeshStandardMaterial(), basic = new MeshBasicMaterial()
    const originalArray = [material, basic]
    const a = new Mesh(new BoxGeometry(), originalArray), b = new Mesh(new BoxGeometry(), material)
    const root = new Group(); root.add(a, b)
    const lease = applyPhorusrhacosSubjectGrade(root, { animalId: 'phorusrhacos', mode: 'comparison' })
    const assigned = a.material
    const clone = b.material
    expect(lease.materialCount).toBe(1)
    expect(assigned[0]).toBe(clone)
    expect(assigned[1]).toBe(basic)
    const disposed = vi.fn(); clone.addEventListener('dispose', disposed)
    const sourceDisposed = vi.fn(); material.addEventListener('dispose', sourceDisposed)
    lease.restore(); lease.restore()
    expect(a.material).toBe(originalArray)
    expect(b.material).toBe(material)
    expect(disposed).toHaveBeenCalledTimes(1)
    expect(sourceDisposed).not.toHaveBeenCalled()
  })

  it('does not overwrite a later material assignment on exit', () => {
    const material = new MeshStandardMaterial(), later = new MeshStandardMaterial()
    const mesh = new Mesh(new BoxGeometry(), material), root = new Group(); root.add(mesh)
    const lease = applyPhorusrhacosSubjectGrade(root, { animalId: 'phorusrhacos', mode: 'comparison' })
    mesh.material = later
    lease.restore()
    expect(mesh.material).toBe(later)
  })

  it('allows repeated entry and exit without reusing disposed clones', () => {
    const material = new MeshStandardMaterial(), mesh = new Mesh(new BoxGeometry(), material), root = new Group(); root.add(mesh)
    const first = applyPhorusrhacosSubjectGrade(root, { animalId: 'phorusrhacos', mode: 'comparison' })
    const oldClone = mesh.material
    first.restore()
    const second = applyPhorusrhacosSubjectGrade(root, { animalId: 'phorusrhacos', mode: 'comparison' })
    expect(mesh.material).not.toBe(oldClone)
    expect(mesh.material).not.toBe(material)
    second.restore()
    expect(mesh.material).toBe(material)
  })
})
