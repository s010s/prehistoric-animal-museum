import type { DirectScaleEncounter } from './DirectScaleEncounter'

export type DirectScaleEncounterLoader = () => Promise<{
  readonly DirectScaleEncounter: typeof DirectScaleEncounter
}>
