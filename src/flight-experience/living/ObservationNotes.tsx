import { TransientScrollbar } from '../../components/TransientScrollbar'
import { usePanelMotion } from '../../components/usePanelMotion'
import { useTransientScrollbar } from '../../components/useTransientScrollbar'
import { drawerCurve, readOrigin, type MotionOrigin } from '../../motion'
import { createPortal } from 'react-dom'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BookOpen, X } from 'lucide-react'
import type { FlightRuntime } from '../FlightRuntime'
import { observationCards } from './observation-content'
import { useFlightDisclosures } from '../useFlightDisclosures'

/** Optional reading, not a discovery checklist. Opening a note explicitly pauses. */
export function ObservationNotes({ runtime, locale }: { runtime: FlightRuntime; locale: 'en' | 'zh-CN' }) {
 const zh = locale === 'zh-CN', [selection, setSelection] = useState<{ index: number; open: boolean } | null>(null)
 const open = selection?.open ?? false
 const card = selection && observationCards[locale][selection.index]!
 const { scrollRef, handleScroll, isScrolling, metrics } = useTransientScrollbar(open)
 const cardRoot = useRef<HTMLElement>(null), trigger = useRef<HTMLButtonElement | null>(null)
 const scrim = useRef<HTMLDivElement>(null), origin = useRef<MotionOrigin | null>(null)
 const closeCard = () => {
  setSelection(current => current && { ...current, open: false })
  runtime.setObservationCard(false)
  trigger.current?.focus({ preventScroll: true })
 }
 const { present, exiting, handle } = usePanelMotion({
  open, panel: cardRoot, trigger, origin, backdrop: scrim,
  phone: 400, desktop: 270, easing: drawerCurve, stagger: 25, onDismiss: closeCard,
 })
 const toggleDisclosure = useFlightDisclosures(open)
 const titles = zh ? ['水面的光', '移动的云影', '飞过的同伴'] : ['Light on water', 'Moving cloud shadows', 'Passing companions']
 const conditions = zh ? ['迎着阳光看水面时', '云影清楚可辨时', '同伴从远处经过时'] : ['When sunlight catches the water', 'When cloud shadows are visible', 'When companions pass nearby']
 useLayoutEffect(() => {
  if (!open) return
  if (scrollRef.current) scrollRef.current.scrollTop = 0
  cardRoot.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
 }, [open, scrollRef, selection?.index])
 useEffect(() => () => runtime.setObservationCard(false), [runtime])
 return <details className="flight-observation-notes">
  <summary><BookOpen size={18} aria-hidden="true"/><span>{zh ? '看看这片风景' : 'Look a little closer'}<small>{zh ? '给好奇的你，三段小小的说明' : 'Three short notes for curious minds'}</small></span></summary>
  <div className="flight-note-topics">{titles.map((title, index) => <button type="button" key={title} aria-haspopup="dialog" onClick={event => { trigger.current = event.currentTarget; origin.current = readOrigin(event.currentTarget, event.detail === 0); runtime.setObservationCard(true); setSelection({ index, open: true }) }}><span>{title}<small>{conditions[index]}</small></span><span aria-hidden="true">↗</span></button>)}</div>
  {present && card && createPortal(<div className="flight-observation-backdrop" data-exiting={exiting} aria-hidden={exiting || undefined} inert={exiting}>
   <div ref={scrim} className="flight-observation-scrim" aria-hidden="true"/>
   <section ref={cardRoot} className="flight-observation-card" role={open ? 'dialog' : undefined} aria-modal={open || undefined} aria-label={card.title} onKeyDown={event => {
   if (event.key === 'Escape') { event.preventDefault(); closeCard() }
   if (event.key === 'Tab') {
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button,summary,a[href]')].filter(element => !element.closest('details:not([open])') || element.tagName === 'SUMMARY')
    const first = focusable[0], last = focusable.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
   }
   event.stopPropagation()
  }}>
   <div className="flight-card__heading"><span className="flight-eyebrow flight-note-handle" {...handle} onPointerDown={event => {
    if (window.matchMedia('(max-width: 600px)').matches) handle.onPointerDown(event)
   }}>{zh ? '风景手记' : 'COASTAL NOTES'}</span><button type="button" aria-label={zh ? '关闭，保持暂停' : 'Close and stay paused'} onClick={closeCard}><X size={19}/></button></div>
   <div className="flight-note-scroll-shell" data-scrollable={metrics.isScrollable}><div ref={scrollRef} className="flight-note-scroll museum-scrollbar" onScroll={handleScroll} onWheel={event=>event.stopPropagation()} onClick={toggleDisclosure}><div className="flight-note-body">
   <p className="flight-note-paused">{zh ? '景色已暂停，声音已静音' : 'Scenery paused and sound muted'}</p>
   <h3>{card.title}</h3><p>{card.body}</p>
   <details><summary>{zh ? '给家长的说明' : 'For grown-ups'}</summary><p>{card.parent}</p>{card.url ? <a href={card.url} target="_blank" rel="noreferrer">{card.source}</a> : <small>{card.source}</small>}</details>
   <p className="flight-note-paused">{zh ? '关闭后仍会停在这里，准备好再继续飞翔。' : 'Closing keeps you paused. Resume flying when you are ready.'}</p>
   </div></div><TransientScrollbar isScrolling={isScrolling} metrics={metrics}/></div>
  </section></div>, document.querySelector('.flight-experience') ?? document.body)}
 </details>
}
