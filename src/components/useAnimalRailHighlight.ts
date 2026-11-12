import { useLayoutEffect, useRef, type RefObject } from 'react'
import { motionTime, playMotion, reducedMotion, settleCurve } from '../motion'

interface RailPaint {
  rect: DOMRectReadOnly
  radius: string
  borderWidth: string
  shadow: string
  opacity: number
}

interface RailAnimation {
  marker: HTMLSpanElement
  cancel: () => void
}

function restingBox(rect: DOMRectReadOnly, style: CSSStyleDeclaration) {
  if (style.transform === 'none') return rect
  // A card can still be lifting on hover or shrinking on press at selection.
  // Undo that translate and scale to land on its resting outline.
  const { a: scaleX, d: scaleY, e: offsetX, f: offsetY } = new DOMMatrixReadOnly(style.transform)
  const [originX = 0, originY = 0] = style.transformOrigin.split(' ').map(Number.parseFloat)
  return new DOMRectReadOnly(
    rect.left - offsetX + (scaleX - 1) * originX,
    rect.top - offsetY + (scaleY - 1) * originY,
    rect.width / scaleX,
    rect.height / scaleY,
  )
}

function readPaint(element: HTMLElement, { shadow, resting = false }: { shadow?: string; resting?: boolean } = {}): RailPaint {
  const style = getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  return {
    rect: resting ? restingBox(rect, style) : rect,
    radius: style.borderRadius,
    borderWidth: style.borderWidth,
    shadow: shadow ?? style.boxShadow,
    opacity: Number(style.opacity),
  }
}

function placePaint(rail: HTMLElement, port: DOMRectReadOnly, paint: RailPaint) {
  const marker = document.createElement('span')
  marker.className = 'museum-motion-highlight museum-motion-highlight--rail'
  marker.setAttribute('aria-hidden', 'true')
  Object.assign(marker.style, {
    left: `${paint.rect.left - port.left - rail.clientLeft + rail.scrollLeft}px`,
    top: `${paint.rect.top - port.top - rail.clientTop + rail.scrollTop}px`,
    width: `${paint.rect.width}px`,
    height: `${paint.rect.height}px`,
    borderRadius: paint.radius,
    borderWidth: paint.borderWidth,
    boxShadow: paint.shadow,
  })
  rail.append(marker)
  return marker
}

function overlapsPort(rect: DOMRectReadOnly, port: DOMRectReadOnly) {
  return rect.right > port.left && rect.left < port.right &&
    rect.bottom > port.top && rect.top < port.bottom
}

export function useAnimalRailHighlight(
  root: RefObject<HTMLDivElement | null>,
  selected: string | null,
  keyboard: RefObject<boolean>,
) {
  const previous = useRef<{ id: string; shadow: string } | null>(null)
  const active = useRef<RailAnimation | null>(null)
  const fading = useRef(new Map<string, RailAnimation>())

  useLayoutEffect(() => {
    const departures = fading.current
    return () => {
      active.current?.cancel()
      for (const entry of departures.values()) entry.cancel()
      previous.current = null
    }
  }, [])

  useLayoutEffect(() => {
    const rail = root.current
    const prior = previous.current
    if (!rail || !selected) {
      active.current?.cancel()
      for (const entry of fading.current.values()) entry.cancel()
      previous.current = null
      return
    }
    if (prior?.id === selected) return

    const cards = [...rail.querySelectorAll<HTMLElement>('.animal-card[data-animal-id]')]
    const sourceIndex = cards.findIndex(card => card.dataset.animalId === prior?.id)
    const targetIndex = cards.findIndex(card => card.dataset.animalId === selected)
    const source = cards[sourceIndex], target = cards[targetIndex]
    const from = active.current ? readPaint(active.current.marker)
      : source && prior ? readPaint(source, { shadow: prior.shadow }) : null
    // Read the destination after restoring its normal shadow. These changes
    // happen in the same layout effect, before the browser paints them.
    active.current?.cancel()
    const to = target && readPaint(target, { resting: true })
    previous.current = to ? { id: selected, shadow: to.shadow } : null
    if (!prior || !from || !to || !to.rect.width || typeof rail.animate !== 'function') return

    const port = rail.getBoundingClientRect()
    const returning = fading.current.get(selected)
    const returned = returning && readPaint(returning.marker)
    const atDestination = returned && Math.abs(returned.rect.left - to.rect.left) < .5 &&
      Math.abs(returned.rect.top - to.rect.top) < .5
    if (atDestination) returning.cancel()

    const slide = !reducedMotion() && !atDestination && sourceIndex >= 0 &&
      Math.abs(sourceIndex - targetIndex) === 1 && overlapsPort(from.rect, port) && overlapsPort(to.rect, port) &&
      from.radius === to.radius && from.borderWidth === to.borderWidth &&
      Math.abs(from.rect.width - to.rect.width) < .5 && Math.abs(from.rect.height - to.rect.height) < .5
    const fadeTiming = { duration: 150, easing: 'ease-in-out' }

    if (!slide && from.opacity > 0 && from.rect.width) {
      fading.current.get(prior.id)?.cancel()
      const marker = placePaint(rail, port, from)
      marker.style.opacity = '0'
      let animation: Animation | null = null
      const cancel = () => {
        animation?.cancel()
        marker.remove()
        fading.current.delete(prior.id)
      }
      fading.current.set(prior.id, { marker, cancel })
      animation = playMotion(marker, [{ opacity: from.opacity }, { opacity: 0 }], fadeTiming, cancel)
    }

    rail.dataset.movingHighlight = 'rail'
    const marker = placePaint(rail, port, to)
    let animation: Animation | null = null
    const cancel = () => {
      animation?.cancel()
      marker.remove()
      delete rail.dataset.movingHighlight
      active.current = null
    }
    active.current = { marker, cancel }
    animation = slide ? playMotion(marker, [
      {
        transform: `translate(${from.rect.left - to.rect.left}px, ${from.rect.top - to.rect.top}px)`,
        boxShadow: from.shadow,
        opacity: from.opacity,
      },
      { transform: 'none', boxShadow: to.shadow, opacity: 1 },
    ], { duration: motionTime(240, 180, keyboard.current), easing: settleCurve }, cancel)
      : playMotion(marker, [{ opacity: atDestination ? returned.opacity : 0 }, { opacity: 1 }], fadeTiming, cancel)
  }, [keyboard, root, selected])
}
