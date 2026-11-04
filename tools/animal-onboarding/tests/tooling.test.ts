import { describe, expect, it } from 'vitest'

import { scoreCandidate } from '../src/profile'
import type { CandidateIntake, IntakeDimensions } from '../src/types'

const maximumDimensions: IntakeDimensions = {
  anatomy: 20,
  editability: 15,
  materials: 10,
  performance: 10,
  normalization: 10,
  animation: 10,
  familiarity: 10,
  ecology: 10,
  scientificIdentity: 5,
}

describe('candidate intake', () => {
  it('never recommends an explicitly held candidate', () => {
    const candidate: CandidateIntake = {
      id: 'held-candidate',
      displayName: 'Held candidate',
      sourceUrl: 'https://example.test/model',
      author: 'Example Author',
      licenseId: 'CC-BY-4.0',
      directSourceVerified: true,
      downloadAllowed: true,
      modificationAllowed: true,
      redistributionAllowed: true,
      dimensions: maximumDimensions,
      disposition: 'hold',
    }
    expect(scoreCandidate(candidate)).toMatchObject({
      recommended: false,
    })
  })
})
