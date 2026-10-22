/* eslint-disable @typescript-eslint/consistent-type-imports --
 * Ambient virtual modules cannot use a normal relative type import without
 * turning this declaration into an invalid module augmentation.
 */
declare module 'virtual:canonical-comparison-extension' {
  export const comparisonMetadata: Readonly<Record<string, import('./canonical-extension').CanonicalComparisonMetadata>>
  export const comparisonAudio: Readonly<Record<string, Readonly<Record<import('../content/types').Locale, Readonly<Record<'intro' | 'transition' | 'arrival', import('./canonical-extension').CanonicalComparisonAudio>>>>>>
  export const idleContacts: Readonly<Record<string, import('./canonical-extension').CanonicalIdleContactSamples>>
  export const motionFootprints: Readonly<Record<string, import('./canonical-extension').CanonicalMotionFootprint>>
}
