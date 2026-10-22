/** Explicit local build flag; a complete candidate keeps its draft status. */
declare const __MUSEUM_RELEASE_CANDIDATE__: boolean

export const releaseCandidateEnabled =
  typeof __MUSEUM_RELEASE_CANDIDATE__ !== 'undefined'
    ? __MUSEUM_RELEASE_CANDIDATE__
    : typeof process !== 'undefined' && process.env.MUSEUM_RELEASE_CANDIDATE === '1'

export const releaseCandidateAnimalIds = [
  'tullimonstrum', 'hallucigenia', 'parasaurolophus', 'ammonite',
  'dimetrodon', 'gallimimus', 'ankylosaurus', 'styxosaurus',
  'livyatan', 'opabinia', 'allosaurus-pandras', 'xiphactinus',
] as const

export const releaseCandidateComparisonIds = [
  'parasaurolophus', 'dimetrodon', 'gallimimus', 'ankylosaurus',
  'styxosaurus', 'livyatan', 'allosaurus-pandras', 'xiphactinus',
] as const
