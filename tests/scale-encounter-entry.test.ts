import { loadDirectScaleEncounter } from 'virtual:scale-encounter-entry'

describe('scale encounter module boundary', () => {
  it('loads the real encounter entry in test mode', async () => {
    expect(loadDirectScaleEncounter).not.toBeNull()

    const module = await loadDirectScaleEncounter?.()

    expect(module?.DirectScaleEncounter).toBeTypeOf('function')
  })
})
