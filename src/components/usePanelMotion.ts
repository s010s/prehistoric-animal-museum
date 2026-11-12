import { useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import {
  boxTransform,
  motionTime,
  placeVisual,
  playMotion,
  readOrigin,
  reducedMotion,
  solidMotionFill,
  type MotionOrigin,
} from '../motion'

interface PanelMotionOptions {
  readonly open: boolean
  readonly panel: RefObject<HTMLElement | null>
  readonly trigger: RefObject<HTMLElement | null>
  readonly origin: RefObject<MotionOrigin | null>
  readonly backdrop?: RefObject<HTMLElement | null>
  readonly ready?: boolean
  readonly phone: number
  readonly desktop: number
  readonly easing: string
  readonly stagger?: number
  readonly collapse?: boolean
  readonly onDismiss?: () => void
}

interface RunningPanelMotion {
  readonly surface: HTMLElement | null
  readonly animations: Animation[]
  readonly dispose: () => void
}

interface Drag {
  readonly opening: RunningPanelMotion | null
  readonly pointer: number
  readonly start: number
  readonly travel: number
  lastY: number
  lastTime: number
  velocity: number
  distance: number
}

function cornerAt(origin: MotionOrigin, base: DOMRectReadOnly): string {
  return `${origin.radius * base.width / origin.rect.width}px / ${origin.radius * base.height / origin.rect.height}px`
}

function createSurface(panel: HTMLElement, base: DOMRectReadOnly): HTMLElement {
  const style = getComputedStyle(panel)
  const surface = document.createElement('div')
  surface.className = 'museum-motion-surface'
  surface.setAttribute('aria-hidden', 'true')
  surface.inert = true
  placeVisual(surface, base)
  Object.assign(surface.style, {
    background: style.background,
    border: style.border,
    borderRadius: style.borderRadius,
    boxShadow: style.boxShadow,
    backdropFilter: style.backdropFilter,
    zIndex: style.zIndex,
  })
  panel.before(surface)
  return surface
}

/** Keep live controls in their final layout. The surface carries the visual move. */
export function usePanelMotion({
  open,
  panel,
  trigger,
  origin,
  backdrop,
  ready = true,
  phone,
  desktop,
  easing,
  stagger = 0,
  collapse = true,
  onDismiss,
}: PanelMotionOptions) {
  const [retained, setRetained] = useState(open)
  const lastOpen = useRef(false)
  const running = useRef<RunningPanelMotion | null>(null)
  const drag = useRef<Drag | null>(null)
  const rebound = useRef<Animation[]>([])
  const releaseVelocity = useRef(0)
  const cancelRebound = () => {
    for (const animation of rebound.current) animation.cancel()
    rebound.current = []
  }

  useLayoutEffect(() => () => {
    running.current?.dispose()
    running.current = null
    cancelRebound()
    lastOpen.current = false
  }, [])

  useLayoutEffect(() => {
    const node = panel.current
    if (!node || !ready || open === lastOpen.current) return
    lastOpen.current = open
    if (open) setRetained(true)

    const contents = Array.from(node.children)
    const previous = running.current
    const previousSurface = readOrigin(previous?.surface ?? null)
    const previousOpacity = previous ? contents.map((child) => getComputedStyle(child).opacity) : []
    const panelOpacity = previous ? getComputedStyle(node).opacity : null
    const scrim = backdrop?.current
    const scrimOpacity = scrim && previous ? getComputedStyle(scrim).opacity : null
    if (open) {
      delete node.dataset.motionExited
      if (scrim) delete scrim.dataset.motionExited
    }
    const dragTransform = getComputedStyle(node).transform
    const dragged = dragTransform !== 'none' ? readOrigin(node) : null
    const dragTranslation = node.style.translate ? getComputedStyle(node).translate : 'none'
    previous?.dispose()
    running.current = null

    node.style.removeProperty('transform')
    node.style.removeProperty('transform-origin')
    cancelRebound()
    drag.current = null

    const destination = readOrigin(node)
    const anchor = open
      ? origin.current ?? readOrigin(trigger.current)
      : readOrigin(trigger.current, origin.current?.keyboard) ?? origin.current
    const reduce = reducedMotion()
    const normalDuration = motionTime(phone, desktop, anchor?.keyboard)
    const velocity = releaseVelocity.current
    releaseVelocity.current = 0
    const duration = velocity > 0.35 && !reduce
      ? Math.max(160, Math.round(normalDuration / (1 + velocity * 0.45)))
      : normalDuration
    const surface = anchor && destination && (open || collapse) && !reduce && typeof node.animate === 'function'
      ? createSurface(node, destination.rect)
      : null
    const animations: Animation[] = []
    const track = (animation: Animation | null) => {
      if (animation) animations.push(animation)
      return animation
    }
    const dispose = () => {
      for (const animation of animations) animation.cancel()
      surface?.remove()
      if (node.classList.contains('museum-motion-panel')) {
        node.classList.add('museum-motion-paint-reset')
        node.classList.remove('museum-motion-panel')
        // Restore the actual surface before allowing habitat paint transitions again.
        void getComputedStyle(node).backgroundColor
        node.classList.remove('museum-motion-paint-reset')
      }
      node.style.removeProperty('transform')
      node.style.removeProperty('transform-origin')
      node.style.removeProperty('translate')
    }
    const run = { surface, animations, dispose }
    running.current = run
    const finish = () => {
      if (running.current !== run) return
      if (!open) {
        // React may retain the layer until its next commit. Hide its paint before
        // cancelling fill effects that would otherwise show the resting panel.
        node.dataset.motionExited = 'true'
        if (scrim) scrim.dataset.motionExited = 'true'
      }
      dispose()
      running.current = null
      if (!open) setRetained(false)
    }

    if (scrim) {
      const rest = getComputedStyle(scrim).opacity
      track(playMotion(scrim, [
        { opacity: scrimOpacity ?? (open ? 0 : rest) },
        { opacity: open ? rest : 0 },
      ], { duration, easing, holdEnd: true }))
    }
    if (!surface || !destination || !anchor) {
      const rest = getComputedStyle(node).opacity
      const start = panelOpacity ?? (open ? 0 : rest)
      track(playMotion(node, [{ opacity: start }, { opacity: open ? rest : 0 }],
        { duration: reduce ? duration : Math.min(duration, 180), easing: 'ease', holdEnd: true }, finish))
      return
    }

    node.classList.add('museum-motion-panel')
    if (!open && dragged) {
      node.style.transformOrigin = 'top center'
      node.style.transform = dragTransform
    }
    if (!open && dragTranslation !== 'none') node.style.translate = dragTranslation

    const from = previousSurface ?? (open ? anchor : dragged ?? destination)
    const to = open ? destination : anchor
    const frame = (endpoint: MotionOrigin, opaque = false) => ({
      transform: boxTransform(destination.rect, endpoint.rect),
      borderRadius: cornerAt(endpoint, destination.rect),
      backgroundColor: opaque ? solidMotionFill(endpoint.fill) : endpoint.fill,
      borderColor: endpoint.border,
      boxShadow: endpoint.shadow,
    })
    for (const [index, child] of contents.entries()) {
      const rest = getComputedStyle(child).opacity
      const start = previousOpacity[index] ?? (open ? 0 : rest)
      const delay = open ? Math.min(0.8, 0.48 + (index * stagger) / duration) : 0
      // When a real scrim covers a modal's future content, a press in that
      // still-empty space belongs to the scrim, not to an unseen link.
      const revealPointer = open && Number(start) < .08 && child.hasAttribute('data-motion-reveal-pointer')
      const frames = open
        ? [
          { opacity: start, ...(revealPointer ? { pointerEvents: 'none' } : {}) },
          { opacity: start, offset: delay, ...(revealPointer ? { pointerEvents: 'none' } : {}) },
          ...(revealPointer ? [{ opacity: String(Number(rest) * .15), pointerEvents: 'auto', offset: delay + (1 - delay) * .15 }] : []),
          { opacity: rest, ...(revealPointer ? { pointerEvents: 'auto' } : {}) },
        ]
        : [{ opacity: start }, { opacity: 0, offset: 0.3 }, { opacity: 0 }]
      track(playMotion(child, frames, { duration, easing: 'linear', holdEnd: true }))
    }
    track(playMotion(surface, [
      frame(from), { ...frame(from, true), offset: 0.02 },
      { ...frame(to, true), offset: 0.98 }, frame(to),
    ], { duration, easing, holdEnd: true }, finish))
  }, [backdrop, collapse, desktop, easing, open, origin, panel, phone, ready, stagger, trigger])

  const finishDrag = (event: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const current = drag.current
    const node = panel.current
    if (!node || current?.pointer !== event.pointerId) return
    drag.current = null
    const velocity = performance.now() - current.lastTime < 85 ? current.velocity : 0
    const projected = current.distance + Math.max(0, velocity) * 140
    if (!cancelled && current.distance > 12 && projected >= current.travel / 2) {
      releaseVelocity.current = Math.max(0, velocity)
      onDismiss?.()
      return
    }
    if (reducedMotion()) {
      node.style.removeProperty('transform')
      node.style.removeProperty('transform-origin')
      return
    }
    const duration = Math.min(300, 130 + current.distance / (1 + Math.abs(velocity)))
    const opening = current.opening
    if (opening?.surface && opening === running.current) {
      const surface = opening.surface
      const resume = () => {
        if (opening !== running.current) return
        surface.style.removeProperty('translate')
        node.style.removeProperty('translate')
        rebound.current = []
        for (const animation of opening.animations) animation.play()
      }
      if (current.distance === 0) {
        resume()
        return
      }
      const frames = [{ translate: `0 ${current.distance}px` }, { translate: 'none' }]
      const contentReturn = playMotion(node, frames, { duration, easing, holdEnd: true })
      const surfaceReturn = playMotion(surface, frames, { duration, easing }, () => {
        resume()
        contentReturn?.cancel()
      })
      rebound.current = [contentReturn, surfaceReturn].filter((animation) => animation !== null)
      return
    }
    const start = node.style.transform
    node.style.removeProperty('transform')
    const animation = playMotion(node, [{ transform: start || 'none' }, { transform: 'none' }], {
      duration,
      easing,
    }, () => {
      node.style.removeProperty('transform-origin')
      rebound.current = []
    })
    rebound.current = animation ? [animation] : []
  }

  const handle = {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      const node = panel.current
      if (!node || !open || !onDismiss || event.pointerType === 'mouse' ||
          !event.isPrimary) return
      const opening = running.current?.surface ? running.current : null
      const surface = opening?.surface
      const position = getComputedStyle(node).transform
      const offset = surface
        ? Number.parseFloat(getComputedStyle(surface).translate.split(' ')[1] ?? '0')
        : position === 'none' ? 0 : Math.max(0, new DOMMatrixReadOnly(position).m42)
      cancelRebound()
      const travel = Math.min(node.offsetHeight * 0.8, window.innerHeight * 0.55)
      drag.current = {
        opening, pointer: event.pointerId, start: event.clientY - offset, travel,
        lastY: event.clientY, lastTime: performance.now(), velocity: 0, distance: offset,
      }
      if (surface) {
        for (const animation of opening.animations) animation.pause()
        surface.style.translate = node.style.translate = `0 ${offset}px`
      } else if (position !== 'none') {
        node.style.transform = position
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const node = panel.current
      const current = drag.current
      if (!node || current?.pointer !== event.pointerId) return
      const distance = Math.max(0, event.clientY - current.start)
      const now = performance.now()
      current.velocity = (event.clientY - current.lastY) / Math.max(now - current.lastTime, 1)
      current.lastY = event.clientY
      current.lastTime = now
      current.distance = distance
      if (reducedMotion()) return
      if (current.opening?.surface && current.opening === running.current) {
        current.opening.surface.style.translate = node.style.translate = `0 ${distance}px`
        return
      }
      if (running.current) {
        running.current.dispose()
        running.current = null
      }
      const scale = 1 - 0.18 * Math.min(1, distance / current.travel)
      node.style.transformOrigin = 'top center'
      node.style.transform = `translate3d(0, ${distance}px, 0) scale(${scale})`
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => finishDrag(event, false),
    onPointerCancel: (event: PointerEvent<HTMLElement>) => finishDrag(event, true),
    onLostPointerCapture: (event: PointerEvent<HTMLElement>) => finishDrag(event, true),
  }

  return { present: open || retained, exiting: retained && !open, handle }
}
