import type { AtmosphereKind } from '../content/types'
import { AirAtmosphere } from './AirAtmosphere'
import { ForestAtmosphere } from './ForestAtmosphere'
import { IceAtmosphere } from './IceAtmosphere'
import { PlainsAtmosphere } from './PlainsAtmosphere'
import { UnderwaterAtmosphere } from './UnderwaterAtmosphere'

export function SceneAtmosphere({
  kind,
}: {
  readonly kind: AtmosphereKind
}) {
  switch (kind) {
    case 'air':
      return <AirAtmosphere />
    case 'forest':
      return <ForestAtmosphere />
    case 'ice':
      return <IceAtmosphere />
    case 'plains':
      return <PlainsAtmosphere />
    case 'underwater':
      return <UnderwaterAtmosphere />
  }
}
