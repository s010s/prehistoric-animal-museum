import { useLayoutEffect, useRef, type MouseEvent } from 'react'
import { captureVisual, fadeLeaving, motionTime, playMotion, reducedMotion } from '../motion'

/** Commit native details immediately; only the visible paint moves. */
export function useFlightDisclosures(scope: boolean | string) {
  const moves = useRef<Animation[]>([])
  const departures = useRef<Array<() => void>>([])
  const clear = () => {
    moves.current.forEach(animation => animation.cancel())
    departures.current.forEach(cancel => cancel())
    moves.current = []
    departures.current = []
  }
  useLayoutEffect(() => clear, [scope])

  return (event: MouseEvent<HTMLElement>) => {
    if (event.defaultPrevented || !(event.target instanceof Element)) return
    const summary = event.target.closest('summary')
    const details = summary?.parentElement
    const scroll = event.currentTarget
    if (!summary || !scroll.contains(summary) || !(details instanceof HTMLDetailsElement) ||
        details.firstElementChild !== summary || event.target.closest('a,button,input,select')) return
    event.preventDefault()
    const reduce = reducedMotion()
    const duration = motionTime(240, 175, event.detail === 0)
    const clip = scroll.getBoundingClientRect()
    const summaryTop = summary.getBoundingClientRect().top
    const followers = new Map<Element, DOMRectReadOnly>()
    if (!reduce) {
      for (let row: Element | null = details; row && row !== scroll; row = row.parentElement) {
        for (let sibling = row.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
          const box = sibling.getBoundingClientRect()
          if (box.height) followers.set(sibling, box)
        }
      }
    }
    const content = Array.from(details.children).filter((node): node is HTMLElement =>
      node instanceof HTMLElement && node !== summary)
    const outgoing = details.open ? content.flatMap(node => {
      const box = node.getBoundingClientRect()
      if (box.top >= clip.bottom || box.bottom <= clip.top || Number(getComputedStyle(node).opacity) < .08) return []
      const snapshot = captureVisual(node, false, true, true)
      return snapshot ? [snapshot] : []
    }) : []
    clear()
    details.open = !details.open
    const displacement = summary.getBoundingClientRect().top - summaryTop
    if (Math.abs(displacement) > 1) scroll.scrollTop += displacement
    const track = (animation: Animation | null) => { if (animation) moves.current.push(animation) }
    for (const snapshot of outgoing) {
      departures.current.push(fadeLeaving(snapshot, document.body, reduce ? 150 : duration * .32, clip))
    }
    for (const [node, from] of followers) {
      const to = node.getBoundingClientRect()
      const dy = from.top - to.top
      if (Math.abs(dy) > 1 && (to.bottom > clip.top || from.bottom > clip.top) &&
          (to.top < clip.bottom || from.top < clip.bottom)) {
        track(playMotion(node, [{ translate: `0 ${dy}px` }, { translate: 'none' }], { duration, easing: 'ease-in-out' }))
      }
    }
    if (details.open) {
      for (const node of content) track(playMotion(node, [
        { opacity: 0 }, ...(reduce ? [] : [{ opacity: 0, offset: .48 }]), { opacity: getComputedStyle(node).opacity },
      ], { duration, easing: 'linear' }))
    }
  }
}
