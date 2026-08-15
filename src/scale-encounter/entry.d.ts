/* eslint-disable @typescript-eslint/consistent-type-imports --
 * Ambient virtual modules cannot use a normal relative type import without
 * turning this declaration into an invalid module augmentation.
 */
declare module 'virtual:scale-encounter-entry' {
  const loadDirectScaleEncounter:
    | import('./entry-contract').DirectScaleEncounterLoader
    | null

  export { loadDirectScaleEncounter }
}
