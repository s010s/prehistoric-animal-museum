import {
  SCALE_ENCOUNTER_ECOLOGY_DENSITIES,
  type ScaleEncounterEcologyDensity,
} from '../viewer/scale-encounter-ecology-density'

interface EcologyDensitySwitcherProps {
  readonly current: ScaleEncounterEcologyDensity
  readonly locale: 'en' | 'zh-CN'
  readonly onChange: (density: ScaleEncounterEcologyDensity) => void
}

const labels = {
  current: { en: 'Current', 'zh-CN': '当前' },
  '1.25x': { en: '1.25×', 'zh-CN': '1.25 倍' },
  '1.5x': { en: '1.5×', 'zh-CN': '1.5 倍' },
} as const

export function EcologyDensitySwitcher({
  current,
  locale,
  onChange,
}: EcologyDensitySwitcherProps) {
  if (import.meta.env.MODE === 'production') return null

  return (
    <div
      aria-label={locale === 'zh-CN' ? '生态密度实验' : 'Ecology density experiment'}
      className="scale-encounter-density-switcher"
      role="group"
    >
      <span>{locale === 'zh-CN' ? '生态密度' : 'Ecology density'}</span>
      <div>
        {SCALE_ENCOUNTER_ECOLOGY_DENSITIES.map((density) => (
          <button
            aria-label={
              locale === 'zh-CN'
                ? `切换到 ${labels[density]['zh-CN']}生态密度`
                : `Switch to ${labels[density].en} ecology density`
            }
            aria-pressed={current === density}
            key={density}
            onClick={() => onChange(density)}
            type="button"
          >
            {labels[density][locale]}
          </button>
        ))}
      </div>
    </div>
  )
}
