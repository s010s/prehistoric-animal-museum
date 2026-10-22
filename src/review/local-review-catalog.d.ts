/* eslint-disable @typescript-eslint/consistent-type-imports --
 * Ambient virtual modules cannot use a normal relative type import without
 * turning this declaration into an invalid module augmentation.
 */
declare module 'virtual:local-review-catalog' {
  const localReviewAnimals: readonly import('./types').DisplayableAnimalPackage[]
  export { localReviewAnimals }
}

declare module 'virtual:expansion-manifest' {
  const expansionManifest: import('./expansion-manifest').ExpansionReviewManifest
  export { expansionManifest }
}
