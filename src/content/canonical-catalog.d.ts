/* eslint-disable @typescript-eslint/consistent-type-imports --
 * Ambient virtual modules cannot use a normal relative type import without
 * turning this declaration into an invalid module augmentation.
 */
declare module 'virtual:canonical-animal-catalog' {
  export const animalModules: Readonly<Record<string, import('./types').AnimalModule>>
}

declare module 'virtual:canonical-model-previews' {
  export const modelPreviewModules: Readonly<Record<string, string>>
}

declare module 'virtual:canonical-credits' {
  export const credits: readonly import('./types').CreditEntry[]
}
