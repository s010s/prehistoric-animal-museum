import { useLayoutEffect, useRef, type RefObject } from 'react'
import { captureVisual, flyVisual, motionTime, playMotion, reducedMotion, type SharedFlight } from '../motion'

interface ExhibitMotionOptions {
  readonly museum: RefObject<HTMLElement | null>
  readonly rail: RefObject<HTMLDivElement | null>
  readonly collectionOpen: boolean
  readonly animalId: string
  readonly readyId: string | null
  readonly returnFocusTo: RefObject<HTMLElement | null>
  readonly collectionKeyboard: boolean
}

interface ExhibitFlight {
  readonly id: string
  readonly keyboard: boolean
  readonly image: SharedFlight | null
  direction: 'into-guide' | 'into-exhibit'
  title: SharedFlight | null
  awaitingExhibit: boolean
}

function matchingCard(root: ParentNode | null, attribute: string, id: string) {
  return root?.querySelector<HTMLElement>(`[${attribute}="${CSS.escape(id)}"]`) ?? null
}

function part(card: Element | null, selector: string): HTMLElement | null {
  return card?.querySelector<HTMLElement>(selector) ?? null
}

function visibleIn(element: HTMLElement | null, scroller: HTMLElement | null): HTMLElement | null {
  if (!element || !scroller) return null
  const rect = element.getBoundingClientRect()
  const clip = scroller.getBoundingClientRect()
  return rect.right > clip.left && rect.left < clip.right &&
    rect.bottom > clip.top && rect.top < clip.bottom ? element : null
}

export function useExhibitMotion({
  museum, rail, collectionOpen, animalId, readyId, returnFocusTo, collectionKeyboard,
}: ExhibitMotionOptions) {
  const current = useRef<ExhibitFlight | null>(null)
  const wasOpen = useRef(false)
  const cancel = () => {
    current.current?.image?.cancel()
    current.current?.title?.cancel()
    current.current = null
  }
  useLayoutEffect(() => () => cancel(), [])

  useLayoutEffect(() => {
    const opening = collectionOpen && !wasOpen.current
    const closing = !collectionOpen && wasOpen.current
    wasOpen.current = collectionOpen
    const heading = part(museum.current, '.animal-title')
    const railCard = matchingCard(rail.current, 'data-animal-id', animalId)
    if (opening) {
      const guide = document.querySelector('.collection-sheet:not([data-exiting])')
      const card = matchingCard(guide, 'data-collection-animal-id', animalId)
      const scroller = card?.closest<HTMLElement>('.elevator-scrollable') ?? null
      const image = visibleIn(part(card, '.collection-card__image'), scroller)
      const title = visibleIn(part(card, '.collection-card__copy strong'), scroller)
      const duration = motionTime(550, 360, collectionKeyboard)
      const previous = current.current
      if (previous?.id === animalId && previous.title?.running && title) {
        previous.title.flyTo(title, duration)
        previous.image?.flyTo(image, duration)
        previous.direction = 'into-guide'
        previous.awaitingExhibit = false
        return
      }
      cancel()
      current.current = {
        id: animalId, keyboard: collectionKeyboard, direction: 'into-guide', awaitingExhibit: false,
        image: flyVisual(captureVisual(visibleIn(part(railCard, '.thumbnail-frame'), rail.current)), image, duration),
        title: flyVisual(captureVisual(heading, true), title, duration),
      }
      return
    }
    const flight = current.current
    if (closing && flight?.direction === 'into-guide') {
      const duration = motionTime(420, 280, collectionKeyboard)
      if (flight.title?.running) flight.title.flyTo(heading, duration)
      if (flight.image?.running) {
        flight.image.flyTo(visibleIn(part(railCard, '.thumbnail-frame'), rail.current), duration)
      }
      flight.direction = 'into-exhibit'
    }
    if (collectionOpen || !flight?.awaitingExhibit || flight.id !== readyId || flight.id !== animalId) return
    flight.awaitingExhibit = false
    const duration = motionTime(550, 360, flight.keyboard)
    const titleGroup = heading?.closest('.title-lockup')
    // The fitted title must already be in its final box when we measure it.
    for (const animation of titleGroup?.getAnimations() ?? []) animation.finish()
    if (titleGroup && reducedMotion()) {
      playMotion(titleGroup, [{ opacity: 0 }, { opacity: 1 }],
        { duration, easing: 'ease-out' })
    }
    const moving = flight.title?.running
      ? flight.title.flyTo(heading, duration)
      : Boolean(flight.title = flyVisual(captureVisual(part(railCard, 'strong'), true), heading, duration))
    if (moving) {
      for (const companion of titleGroup?.querySelectorAll('.animal-eyebrow, .child-intro') ?? []) {
        playMotion(companion, [{ opacity: 0 }, { opacity: 0, offset: 0.48 }, { opacity: 1 }],
          { duration, easing: 'linear' })
      }
    }
    if (heading) {
      // The dialog may still be restoring focus in its passive cleanup.
      window.requestAnimationFrame(() => {
        if (current.current === flight && heading.isConnected &&
            (document.activeElement === returnFocusTo.current ||
              document.activeElement === document.body)) {
          heading.focus({ preventScroll: true })
        }
      })
    }
  }, [animalId, collectionKeyboard, collectionOpen, museum, rail, readyId, returnFocusTo])

  const select = (id: string, card: HTMLElement, keyboard: boolean) => {
    const previous = current.current
    const duration = motionTime(550, 360, keyboard)
    const destination = matchingCard(rail.current, 'data-animal-id', id)
    if (previous?.id === id && previous.direction === 'into-guide' &&
        (previous.title?.running || previous.image?.running)) {
      previous.direction = 'into-exhibit'
      if (previous.image?.running) {
        previous.image.flyTo(visibleIn(part(destination, '.thumbnail-frame'), rail.current), duration)
      }
      if (previous.title?.running) previous.title.flyTo(part(museum.current, '.animal-title'), duration)
      return
    }
    const image = captureVisual(part(card, '.collection-card__image'))
    const title = captureVisual(part(card, '.collection-card__copy strong'), true)
    cancel()
    if (id !== readyId) destination?.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' })
    const awaitingExhibit = id !== readyId
    current.current = {
      id, keyboard, direction: 'into-exhibit', awaitingExhibit,
      image: flyVisual(image, visibleIn(part(destination, '.thumbnail-frame'), rail.current), duration),
      title: flyVisual(title, awaitingExhibit ? part(destination, 'strong') : part(museum.current, '.animal-title'), duration),
    }
  }

  return {
    select,
    cancelUnless(id: string) {
      if (current.current?.id !== id) cancel()
    },
    cancel,
  }
}
