import { useEffect } from 'react'
import {
  SCALE_ENCOUNTER_ENVIRONMENT_VARIANTS,
  type ScaleEncounterEnvironmentVariant,
} from '../viewer/scale-encounter-environment'

// PROTOTYPE — four forest environment treatments on the existing museum
// route. The active treatment is shareable through ?variant= and this entire
// control stays outside production and review builds.
interface EnvironmentPrototypeSwitcherProps {
  readonly current: ScaleEncounterEnvironmentVariant
  readonly locale: 'en' | 'zh-CN'
  readonly onChange: (variant: ScaleEncounterEnvironmentVariant) => void
}

const labels = {
  baseline: { en: 'A — V3 baseline', 'zh-CN': 'A — V3 基线' },
  'ground-slice': { en: 'B — Ground slice', 'zh-CN': 'B — 地面样板' },
  'hybrid-slice': { en: 'C — Hybrid slice', 'zh-CN': 'C — 混合环境' },
  'production-slice': {
    en: 'D — Production study',
    'zh-CN': 'D — 成品技术样',
  },
} as const

function editableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.matches('input, textarea, select, [contenteditable="true"]') ||
    target.closest('[contenteditable="true"]') !== null
  )
}

export function EnvironmentPrototypeSwitcher({
  current,
  locale,
  onChange,
}: EnvironmentPrototypeSwitcherProps) {
  const prototypeEnabled =
    import.meta.env.MODE === 'development' || import.meta.env.MODE === 'e2e'
  const currentIndex = SCALE_ENCOUNTER_ENVIRONMENT_VARIANTS.indexOf(current)
  const cycle = (direction: -1 | 1) => {
    const nextIndex =
      (currentIndex + direction + SCALE_ENCOUNTER_ENVIRONMENT_VARIANTS.length) %
      SCALE_ENCOUNTER_ENVIRONMENT_VARIANTS.length
    const next = SCALE_ENCOUNTER_ENVIRONMENT_VARIANTS[nextIndex]
    if (next) onChange(next)
  }

  useEffect(() => {
    if (!prototypeEnabled) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (editableTarget(event.target)) return
      const direction =
        event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : null
      if (direction === null) return
      event.preventDefault()
      const nextIndex =
        (currentIndex + direction +
          SCALE_ENCOUNTER_ENVIRONMENT_VARIANTS.length) %
        SCALE_ENCOUNTER_ENVIRONMENT_VARIANTS.length
      const next = SCALE_ENCOUNTER_ENVIRONMENT_VARIANTS[nextIndex]
      if (next) onChange(next)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentIndex, onChange, prototypeEnabled])

  if (!prototypeEnabled) return null

  return (
    <div
      aria-label={locale === 'zh-CN' ? '森林环境原型' : 'Forest environment prototypes'}
      className="scale-encounter-variant-switcher"
      role="group"
    >
      <button
        aria-label={locale === 'zh-CN' ? '上一个环境原型' : 'Previous environment prototype'}
        onClick={() => cycle(-1)}
        type="button"
      >
        ←
      </button>
      <span aria-live="polite">{labels[current][locale]}</span>
      <button
        aria-label={locale === 'zh-CN' ? '下一个环境原型' : 'Next environment prototype'}
        onClick={() => cycle(1)}
        type="button"
      >
        →
      </button>
    </div>
  )
}
