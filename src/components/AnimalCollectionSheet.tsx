import { createPortal } from 'react-dom'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Footprints, X } from 'lucide-react'
import type { Habitat } from '../content/types'
import { useI18n } from '../i18n/I18nProvider'
import { sheetCurve, type MotionOrigin } from '../motion'
import { IconButton } from './IconButton'
import { LanguageMenu } from './LanguageMenu'
import { ElevatorContinuousView } from './schemes/ElevatorContinuousView'
import { usePanelMotion } from './usePanelMotion'

export type HabitatFilter = 'all' | Habitat

export interface CollectionAnimal {
  readonly classification: string
  readonly id: string
  readonly name: string
  readonly thumbnail: string
  readonly habitat: Habitat
}

interface AnimalCollectionSheetProps {
  readonly animals: readonly CollectionAnimal[]
  readonly currentAnimalId: string
  readonly loadingAnimalId: string | null
  readonly loadingPhase: 'checking-cache' | 'downloading' | 'preparing' | null
  readonly loadingPercent: number | null
  readonly onClose: () => void
  readonly onSelect: (animalId: string, card: HTMLButtonElement, keyboard: boolean) => void
  readonly open: boolean
  readonly motionOrigin: React.RefObject<MotionOrigin | null>
  readonly returnFocusTo: React.RefObject<HTMLElement | null>
}

const focusableSelector = [
  'button:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function AnimalCollectionSheet({
  animals,
  currentAnimalId,
  loadingAnimalId,
  loadingPhase,
  loadingPercent,
  onClose,
  onSelect,
  open,
  motionOrigin,
  returnFocusTo,
}: AnimalCollectionSheetProps) {
  const { messages } = useI18n()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const { present, exiting: isExiting, handle } = usePanelMotion({
    open, panel: dialogRef, trigger: returnFocusTo, origin: motionOrigin,
    backdrop: backdropRef, phone: 420, desktop: 280, easing: sheetCurve, onDismiss: onClose,
  })

  const currentAnimalHabitat = useMemo(() => {
    if (!currentAnimalId) return null
    return animals.find((a) => a.id === currentAnimalId)?.habitat || null
  }, [animals, currentAnimalId])

  const [prevOpen, setPrevOpen] = useState(open)
  const [prevAnimalId, setPrevAnimalId] = useState(currentAnimalId)
  const [activeHabitat, setActiveHabitat] = useState<HabitatFilter>(() => {
    return currentAnimalHabitat ?? 'air'
  })

  // Align the habitat before the guide paints.
  if (open !== prevOpen || currentAnimalId !== prevAnimalId) {
    setPrevOpen(open)
    setPrevAnimalId(currentAnimalId)

    if (open && currentAnimalHabitat && activeHabitat !== currentAnimalHabitat) {
      setActiveHabitat(currentAnimalHabitat)
    }
  }

  const animalNumberMap = useMemo(() => {
    const map = new Map<string, string>()
    animals.forEach((animal, index) => {
      map.set(animal.id, String(index + 1).padStart(2, '0'))
    })
    return map
  }, [animals])

  useEffect(() => {
    if (!open) {
      return
    }

    const returnTarget = returnFocusTo.current
    dialogRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialogRef.current) {
        return
      }
      const controls = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      )
      const first = controls[0]
      const last = controls.at(-1)
      if (!first || !last) {
        return
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      returnTarget?.focus()
    }
  }, [currentAnimalId, open, returnFocusTo])

  if (!present) {
    return null
  }

  const handleClose = () => {
    if (isExiting) return
    onClose()
  }

  const renderCard = (animal: CollectionAnimal, index = 0) => {
    const current = animal.id === currentAnimalId
    const loading = animal.id === loadingAnimalId
    const number = animalNumberMap.get(animal.id) ?? ''

    return (
      <div
        key={animal.id}
        role="listitem"
        style={{ '--card-index': Math.min(index, 11) } as React.CSSProperties}
      >
        <button
          aria-current={current ? 'true' : undefined}
          aria-label={messages.collection.cardLabel(animal.name, current)}
          className="collection-card"
          data-collection-animal-id={animal.id}
          data-current={current}
          data-habitat={animal.habitat}
          data-loading={loading}
          onClick={(event) => onSelect(animal.id, event.currentTarget, event.detail === 0)}
          type="button"
        >
          <span className="collection-card__number" aria-hidden="true">
            {number}
          </span>
          <span className="collection-card__image">
            <img
              alt=""
              decoding="async"
              loading="eager"
              src={animal.thumbnail}
            />
          </span>
          <span className="collection-card__copy">
            <strong>{animal.name}</strong>
            <small>{animal.classification}</small>
          </span>
          {loading ? (
            <span className="collection-card__state">
              {loadingPhase === 'preparing'
                ? messages.collection.opening
                : loadingPercent === null
                  ? messages.collection.preparing
                  : messages.collection.downloading(loadingPercent)}
            </span>
          ) : null}
        </button>
      </div>
    )
  }

  return createPortal(
    <div className="collection-layer">
      <div
        aria-hidden="true"
        className="collection-backdrop"
        data-exiting={isExiting ? 'true' : undefined}
        ref={backdropRef}
        onMouseDown={(event) => {
          if (!isExiting && event.currentTarget === event.target) {
            handleClose()
          }
        }}
      />
      <section
        aria-hidden={isExiting ? 'true' : undefined}
        aria-labelledby={titleId}
        aria-modal={isExiting ? undefined : 'true'}
        className="collection-sheet"
        data-exiting={isExiting ? 'true' : undefined}
        data-habitat={activeHabitat}
        data-ux-mode="elevator"
        inert={isExiting ? true : undefined}
        ref={dialogRef}
        role={isExiting ? undefined : 'dialog'}
        tabIndex={-1}
      >
        <div aria-hidden="true" className="collection-atmosphere">
          <div className="collection-atmosphere__sky-rays" />
          <div className="collection-atmosphere__caustics" />
          <div className="collection-atmosphere__strata" />
          <div className="collection-atmosphere__vignette" />
        </div>
        <div aria-hidden="true" className="collection-sheet__handle museum-motion-handle" {...handle} />
        <header className="collection-sheet__header">
          <div>
            <p className="collection-sheet__eyebrow">
              <Footprints aria-hidden="true" size={17} strokeWidth={2.2} />
              {messages.collection.friends(animals.length)}
            </p>
            <h2 id={titleId}>{messages.collection.title}</h2>
            <p>{messages.collection.intro}</p>
          </div>
          <div className="collection-sheet__actions">
            <LanguageMenu />
            <IconButton
              hideTooltipOnFocus
              icon={X}
              label={messages.collection.close}
              onClick={handleClose}
              ref={closeButtonRef}
            />
          </div>
        </header>

        <ElevatorContinuousView
          animals={animals}
          currentAnimalId={currentAnimalId}
          onHabitatInViewChange={setActiveHabitat}
          renderCard={renderCard}
        />
      </section>
    </div>,
    document.body,
  )
}
