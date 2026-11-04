import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'

describe('cubic-spline rotation resampling', () => {
  it('keeps every production ichthyosaur bone continuous through the loop', async () => {
    await MeshoptDecoder.ready
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
    const document = await io.read(
      'src/content/animals/ichthyosaur/model/model.glb',
    )
    const animation = document.getRoot().listAnimations()[0]!

    const quaternionAngle = (left: number[], right: number[]) => {
      const dot = Math.abs(
        left.reduce(
          (total, value, index) => total + value * right[index]!,
          0,
        ),
      )
      return (
        2 *
        Math.acos(
          Math.min(1, dot / (Math.hypot(...left) * Math.hypot(...right))),
        )
      )
    }

    for (const channel of animation.listChannels()) {
      const sampler = channel.getSampler()!
      const output = sampler.getOutput()!

      const quaternionAt = (index: number) =>
        output.getElement(index, [] as number[])
      let maximumStep = 0
      for (let index = 1; index < output.getCount(); index += 1) {
        maximumStep = Math.max(
          maximumStep,
          quaternionAngle(quaternionAt(index - 1), quaternionAt(index)),
        )
      }
      expect(maximumStep).toBeLessThan((2 * Math.PI) / 180)
      expect(
        quaternionAngle(
          quaternionAt(0),
          quaternionAt(output.getCount() - 1),
        ),
      ).toBeLessThan(1e-6)
    }
  })
})
