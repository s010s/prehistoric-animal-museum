export const sheetCurve = 'cubic-bezier(.16, 1, .3, 1)'
export const drawerCurve = 'cubic-bezier(.2, .8, .2, 1)'
export const settleCurve = 'cubic-bezier(.32, .72, 0, 1)'
export const encounterCurve = 'cubic-bezier(.22, 1, .36, 1)'

export const reducedMotionMedia = '(prefers-reduced-motion: reduce)'

export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(reducedMotionMedia).matches
}

export function motionTime(phone: number, desktop: number, keyboard = false): number {
  if (reducedMotion()) return 150
  if (window.matchMedia('(max-width: 767px), (max-height: 560px) and (max-width: 1000px)').matches) {
    return phone
  }
  return keyboard ? Math.round(desktop * 0.72) : desktop
}

/** The animation owns only the paint. A resize or a changed motion preference settles it. */
export function playMotion(
  element: Element,
  frames: Keyframe[],
  { holdEnd = false, ...options }: KeyframeAnimationOptions & { holdEnd?: boolean },
  settle: () => void = () => {},
): Animation | null {
  if (typeof element.animate !== 'function') {
    settle()
    return null
  }
  const animation = element.animate(frames, { fill: 'both', ...options })
  const preference = window.matchMedia(reducedMotionMedia)
  const finish = () => animation.finish()
  const cleanup = () => {
    preference.removeEventListener('change', finish)
    window.removeEventListener('resize', finish)
  }
  preference.addEventListener('change', finish)
  window.addEventListener('resize', finish)
  void animation.finished.then(() => {
    cleanup()
    if (!holdEnd) animation.cancel()
    settle()
  }, cleanup)
  return animation
}

export interface MotionOrigin {
  readonly element: HTMLElement
  readonly rect: DOMRectReadOnly
  readonly radius: number
  readonly fill: string
  readonly backgroundImage: string
  readonly border: string
  readonly shadow: string
  readonly keyboard: boolean
}

export function readOrigin(element: HTMLElement | null, keyboard = false): MotionOrigin | null {
  if (!element) return null
  const rect = element.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  const style = getComputedStyle(element)
  return {
    element,
    rect,
    radius: Math.min(parseFloat(style.borderTopLeftRadius) || 0, rect.height / 2),
    fill: style.backgroundColor,
    backgroundImage: style.backgroundImage,
    border: style.borderColor,
    shadow: style.boxShadow,
    keyboard,
  }
}

export function boxTransform(from: DOMRectReadOnly, to: DOMRectReadOnly): string {
  return `translate3d(${to.x - from.x}px, ${to.y - from.y}px, 0) scale(${to.width / from.width}, ${to.height / from.height})`
}

export function solidMotionFill(color: string): string {
  if (color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return 'var(--surface)'
  const opaque = `rgb(from ${color} r g b / 1)`
  return CSS.supports('color', opaque) ? opaque : color
}

export function placeVisual(visual: HTMLElement, rect: DOMRectReadOnly): void {
  Object.assign(visual.style, {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  })
}

export function collapseSurface(from: MotionOrigin, to: MotionOrigin, duration: number, easing: string) {
  if (reducedMotion()) return null
  const surface = document.createElement('div')
  surface.className = 'museum-motion-surface museum-motion-surface--detached'
  surface.setAttribute('aria-hidden', 'true')
  surface.inert = true
  placeVisual(surface, from.rect)
  surface.style.backgroundImage = from.backgroundImage
  surface.style.borderStyle = 'solid'
  surface.style.borderWidth = '1px'
  document.body.append(surface)
  const animation = playMotion(surface, [
    { transform: 'none', backgroundColor: from.fill, borderColor: from.border,
      borderRadius: `${from.radius}px`, boxShadow: from.shadow },
    { transform: boxTransform(from.rect, to.rect), backgroundColor: to.fill, borderColor: to.border,
      borderRadius: `${to.radius * from.rect.width / to.rect.width}px / ${to.radius * from.rect.height / to.rect.height}px`,
      boxShadow: to.shadow },
  ], { duration, easing }, () => surface.remove())
  return () => {
    animation?.cancel()
    surface.remove()
  }
}

type PaintedElement = HTMLElement | SVGElement

export interface VisualSnapshot {
  readonly original: PaintedElement
  readonly paint: PaintedElement
  readonly rect: DOMRectReadOnly
  readonly text: boolean
  readonly containedImage?: true
  readonly scroll: ReadonlyArray<{ element: HTMLElement; left: number; top: number }>
}

function visualRect(element: PaintedElement, text: boolean): DOMRectReadOnly | null {
  const rect = element.getBoundingClientRect()
  if (!rect.width || !rect.height || rect.right <= 0 || rect.bottom <= 0 ||
      rect.left >= window.innerWidth || rect.top >= window.innerHeight) return null
  if (!text) return rect
  const range = document.createRange()
  range.selectNodeContents(element)
  const lines = Array.from(range.getClientRects()).filter((line) => line.width > 0)
  // A wrapped name cannot land on one line by scaling its box.
  if (lines.length !== 1) return null
  const line = lines[0]!
  if (line.left < rect.left - 2 || line.right > rect.right + 2) return null
  return new DOMRect(line.left, rect.top, line.width, rect.height)
}

const paintProperties = [
  'display', 'color', 'font-family', 'font-size', 'font-style', 'font-weight',
  'font-variation-settings', 'letter-spacing',
  'line-height', 'text-align', 'text-shadow', 'text-transform', 'white-space',
  'text-wrap', 'margin', 'border', 'border-radius', 'background', 'box-shadow', 'overflow',
  'object-fit', 'object-position', 'stroke', 'stroke-width', 'fill',
  'transform', 'transform-origin', 'translate',
] as const

const layoutProperties = [
  'box-sizing', 'padding', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'flex', 'flex-direction', 'flex-wrap', 'gap', 'justify-content', 'align-items', 'align-self',
  'grid-template-columns', 'grid-template-rows', 'grid-template-areas', 'grid-area', 'text-decoration',
] as const

export function captureVisual(
  element: PaintedElement | null,
  text = false,
  opacityOnly = false,
  freezeLayout = false,
): VisualSnapshot | null {
  if (!element || (!opacityOnly && reducedMotion())) return null
  const rect = visualRect(element, text)
  if (!rect) return null
  const paint = text ? document.createElement('span') : element.cloneNode(true) as PaintedElement
  if (text) paint.textContent = element.textContent
  const originals = text ? [element] : [element, ...element.querySelectorAll<PaintedElement>('*')]
  const copies = [paint, ...paint.querySelectorAll<PaintedElement>('*')]
  const scroll: VisualSnapshot['scroll'][number][] = []
  const properties = freezeLayout ? [...paintProperties, ...layoutProperties] : paintProperties
  for (const [index, original] of originals.entries()) {
    const copy = copies[index]!
    const style = getComputedStyle(original)
    for (const property of properties) {
      copy.style.setProperty(property, style.getPropertyValue(property))
    }
    copy.removeAttribute('id')
    copy.removeAttribute('tabindex')
    // The exhibit title selector belongs to the real heading, including during a flight.
    copy.classList.remove('animal-title')
    if (original instanceof HTMLElement && copy instanceof HTMLElement &&
        (original.scrollLeft || original.scrollTop)) {
      scroll.push({ element: copy, left: original.scrollLeft, top: original.scrollTop })
    }
    if (original instanceof HTMLImageElement && copy instanceof HTMLImageElement) {
      // Do not fetch a second image or show a broken-image icon in flight.
      if (original.complete && original.naturalWidth > 0) {
        copy.src = original.currentSrc || original.src
        copy.loading = 'eager'
      } else {
        copy.style.visibility = 'hidden'
        copy.removeAttribute('src')
        copy.removeAttribute('srcset')
      }
    }
  }
  Object.assign(paint.style, {
    position: 'relative',
    inset: 'auto',
    width: '100%',
    height: '100%',
    margin: '0',
    transform: 'none',
    opacity: '1',
    ...(text ? { display: 'block', textAlign: 'left', whiteSpace: 'nowrap' } : {}),
  })
  return { original: element, paint, rect, text, scroll }
}

function containedImageBox(image: HTMLImageElement): { rect: DOMRectReadOnly; radius: number } | null {
  const box = visualRect(image, false)
  const naturalWidth = image.naturalWidth || Number(image.getAttribute('width'))
  const naturalHeight = image.naturalHeight || Number(image.getAttribute('height'))
  if (!box || !naturalWidth || !naturalHeight) return null
  const scale = Math.min(box.width / naturalWidth, box.height / naturalHeight)
  const width = naturalWidth * scale, height = naturalHeight * scale
  const x = (box.width - width) / 2, y = (box.height - height) / 2
  const radius = parseFloat(getComputedStyle(image).borderTopLeftRadius) || 0
  return { rect: new DOMRect(box.x + x, box.y + y, width, height), radius: Math.max(0, radius - Math.max(x, y)) }
}

/** Use the centered photo pixels, without the blank area in an object-fit thumbnail. */
export function captureContainedImage(image: HTMLImageElement): VisualSnapshot | null {
  const box = containedImageBox(image)
  const snapshot = box && captureVisual(image)
  if (!snapshot || !box) return null
  snapshot.paint.style.objectFit = 'fill'
  snapshot.paint.style.borderRadius = `${box.radius}px`
  return { ...snapshot, rect: box.rect, containedImage: true }
}

function restoreScroll(snapshot: VisualSnapshot): void {
  for (const { element, left, top } of snapshot.scroll) {
    element.scrollLeft = left
    element.scrollTop = top
  }
}

/** A single, inert visual travels between two live elements with fixed hit targets. */
export class SharedFlight {
  private readonly layer = document.createElement('div')
  private readonly unmask = new Map<PaintedElement, string>()
  private animation: Animation | null = null
  private paintAnimation: Animation | null = null
  private target: PaintedElement | null = null
  private stopFollowing: (() => void) | null = null

  constructor(private readonly snapshot: VisualSnapshot) {
    this.layer.className = 'museum-motion-visual'
    this.layer.setAttribute('aria-hidden', 'true')
    this.layer.inert = true
    placeVisual(this.layer, snapshot.rect)
    this.layer.append(snapshot.paint)
    document.body.append(this.layer)
    restoreScroll(snapshot)
    this.mask(snapshot.original)
  }

  private mask(element: PaintedElement) {
    if (!this.unmask.has(element)) this.unmask.set(element, element.style.opacity)
    element.style.opacity = '0'
  }

  private restore(element: PaintedElement) {
    const opacity = this.unmask.get(element)
    if (opacity === undefined) return
    element.style.opacity = opacity
    this.unmask.delete(element)
  }

  flyTo(target: PaintedElement | null, duration: number, easing = settleCurve): boolean {
    const image = this.snapshot.containedImage && target instanceof HTMLImageElement ? target : null
    const destination = target && (image ? containedImageBox(image)?.rect : visualRect(target, this.snapshot.text))
    if (!target || !destination || reducedMotion()) {
      this.cancel()
      return false
    }
    this.stopFollowing?.()
    if (this.target && this.target !== target && this.target !== this.snapshot.original) {
      this.restore(this.target)
    }
    this.target = target
    this.mask(target)
    const animateTo = (box: DOMRectReadOnly, remaining: number) => {
      const current = getComputedStyle(this.layer).transform
      const paint = this.snapshot.paint
      const fromStyle = getComputedStyle(paint)
      const fromColor = fromStyle.color
      const fromRadius = fromStyle.borderRadius
      const toStyle = getComputedStyle(target)
      const radius = image ? containedImageBox(image)?.radius ?? 0 : parseFloat(toStyle.borderTopLeftRadius) || 0
      const endRadius = `${radius * this.snapshot.rect.width / box.width}px / ${radius * this.snapshot.rect.height / box.height}px`
      this.animation?.cancel()
      this.paintAnimation?.cancel()
      this.paintAnimation = playMotion(paint, [
        { color: fromColor, borderRadius: fromRadius },
        { color: toStyle.color, borderRadius: endRadius },
      ], { duration: remaining, easing })
      this.animation = playMotion(this.layer, [
        { transform: current },
        { transform: boxTransform(this.snapshot.rect, box) },
      ], { duration: remaining, easing }, () => this.cancel())
    }
    const endTime = performance.now() + duration
    let lastBox = destination
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const box = image ? containedImageBox(image)?.rect : visualRect(target, this.snapshot.text)
        const remaining = endTime - performance.now()
        if (!box || remaining <= 16) {
          this.cancel()
        } else if (Math.abs(box.x - lastBox.x) > 0.5 || Math.abs(box.y - lastBox.y) > 0.5) {
          lastBox = box
          animateTo(box, remaining)
        }
      })
    }
    this.stopFollowing = () => {
      document.removeEventListener('scroll', onScroll, true)
      cancelAnimationFrame(frame)
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    animateTo(destination, duration)
    return this.animation !== null
  }

  cancel(): void {
    this.stopFollowing?.()
    this.stopFollowing = null
    this.animation?.cancel()
    this.paintAnimation?.cancel()
    this.animation = null
    this.paintAnimation = null
    for (const element of this.unmask.keys()) this.restore(element)
    this.target = null
    this.layer.remove()
  }

  get running(): boolean {
    return this.layer.isConnected
  }
}

export function flyVisual(
  snapshot: VisualSnapshot | null,
  target: PaintedElement | null,
  duration: number,
  easing = settleCurve,
): SharedFlight | null {
  if (!snapshot || !target) return null
  const flight = new SharedFlight(snapshot)
  return flight.flyTo(target, duration, easing) ? flight : null
}

export function fadeLeaving(
  snapshot: VisualSnapshot,
  host: HTMLElement,
  duration: number,
  clip?: DOMRectReadOnly,
) {
  const layer = document.createElement('div')
  layer.className = 'museum-motion-visual'
  layer.setAttribute('aria-hidden', 'true')
  layer.inert = true
  placeVisual(layer, snapshot.rect)
  if (clip) {
    const box = snapshot.rect
    layer.style.clipPath = `inset(${Math.max(0, clip.top - box.top)}px ${Math.max(0, box.right - clip.right)}px ${Math.max(0, box.bottom - clip.bottom)}px ${Math.max(0, clip.left - box.left)}px)`
  }
  layer.append(snapshot.paint)
  host.append(layer)
  restoreScroll(snapshot)
  const animation = playMotion(layer, [{ opacity: 1 }, { opacity: 0 }],
    { duration, easing: 'ease-out' }, () => layer.remove())
  return () => {
    animation?.cancel()
    layer.remove()
  }
}
