import { useLayoutEffect, useRef, type RefObject } from 'react'
import { motionTime, playMotion, reducedMotion, sheetCurve } from '../motion'

interface MovingHighlightOptions {
  readonly root: RefObject<HTMLElement | null>
  readonly selected: string | null
  readonly attribute: string
  readonly variant: 'perspective' | 'language' | 'flight-tab' | 'flight-choice'
  readonly keyboard?: RefObject<boolean>
}

export function useMovingHighlight({ root, selected, attribute, variant, keyboard }: MovingHighlightOptions) {
  const previous = useRef<string | null>(null)
  const active = useRef<{ marker: HTMLElement; cancel: () => void } | null>(null)
  useLayoutEffect(() => () => active.current?.cancel(), [])

  useLayoutEffect(() => {
    const old = previous.current
    previous.current = selected
    const track = root.current
    if (!track || !old || !selected || old === selected) {
      if (old !== selected) active.current?.cancel()
      return
    }
    const items = Array.from(track.querySelectorAll<HTMLElement>(`[${attribute}]`))
    const source = items.find((item) => item.getAttribute(attribute) === old)
    const target = items.find((item) => item.getAttribute(attribute) === selected)
    const last = active.current?.marker.getBoundingClientRect()
    active.current?.cancel()
    if (!source || !target) return

    const port = track.getBoundingClientRect()
    const from = last ?? source.getBoundingClientRect()
    const to = target.getBoundingClientRect()
    if (!to.width || !to.height) return
    const underline = variant === 'flight-tab'
    const thickness = 2
    const point = (rect: DOMRectReadOnly) => ({
      x: rect.left - port.left - track.clientLeft + track.scrollLeft,
      y: (underline ? rect.bottom - thickness : rect.top) - port.top - track.clientTop + track.scrollTop,
      width: Math.max(1, rect.width),
      height: underline ? thickness : rect.height,
    })
    const start = last
      ? { ...point(from), y: from.top - port.top - track.clientTop + track.scrollTop,
        x: from.left - port.left - track.clientLeft + track.scrollLeft, width: from.width, height: from.height }
      : point(from)
    const end = point(to)
    const mark = document.createElement('span')
    mark.className = `museum-motion-highlight museum-motion-highlight--${variant}`
    mark.setAttribute('aria-hidden', 'true')
    const at = ({ x, y, width, height }: typeof start) =>
      `translate3d(${x}px, ${y}px, 0) scale(${width / end.width}, ${height / end.height})`
    mark.style.width = `${end.width}px`
    mark.style.height = `${end.height}px`
    if (variant === 'flight-choice') {
      const paint = getComputedStyle(target)
      mark.style.background = paint.backgroundColor
      mark.style.borderRadius = paint.borderRadius
      mark.style.boxShadow = paint.boxShadow
      mark.style.border = paint.border
    }
    track.dataset.movingHighlight = variant
    track.prepend(mark)

    const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
    const distance = horizontal ? end.x - start.x : end.y - start.y
    const elongation = Math.min(Math.abs(distance) * 0.32, end.width * 0.4)
    const elongated = {
      x: (start.x + end.x) / 2 - (horizontal && distance < 0 ? elongation : 0),
      y: (start.y + end.y) / 2,
      width: (start.width + end.width) / 2 + (horizontal ? elongation : 0),
      height: (start.height + end.height) / 2 * (underline ? 0.85 : 1),
    }
    const reduce = reducedMotion()
    if (reduce) {
      mark.style.left = `${end.x}px`
      mark.style.top = `${end.y}px`
    }
    const frames = reduce ? [{ opacity: 0 }, { opacity: 1 }]
      : [{ transform: at(start) }, { transform: at(elongated), offset: 0.46 }, { transform: at(end) }]
    let animation: Animation | null = null
    const cancel = () => {
      animation?.cancel()
      mark.remove()
      delete track.dataset.movingHighlight
      active.current = null
    }
    active.current = { marker: mark, cancel }
    animation = playMotion(mark, frames, {
      duration: variant === 'language' && !reduce ? 145
        : variant === 'flight-choice' ? motionTime(255, 185, keyboard?.current)
          : motionTime(420, 280, keyboard?.current),
      easing: variant === 'language' || variant === 'flight-choice' ? 'ease-in-out' : sheetCurve,
    }, cancel)
  }, [attribute, keyboard, root, selected, variant])
}
