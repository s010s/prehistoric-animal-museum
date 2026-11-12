import { useCallback, useEffect, useId, useRef, useState, type MouseEvent } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { GITHUB_LICENSING_URL, GITHUB_REPOSITORY_URL } from '../github'
import { useI18n } from '../i18n/I18nProvider'
import type { Locale } from '../i18n/locale'
import {
  captureVisual, drawerCurve, fadeLeaving, motionTime, playMotion, reducedMotion, type MotionOrigin,
} from '../motion'
import { IconButton } from './IconButton'
import { LanguageMenu } from './LanguageMenu'
import { OfficialLinks } from './OfficialLinks'
import { TransientScrollbar } from './TransientScrollbar'
import { useTransientScrollbar } from './useTransientScrollbar'
import { usePanelMotion } from './usePanelMotion'

export interface ParentReviewFacts {
  readonly badge: string
  readonly checks: readonly string[]
  readonly displayLabel: string
  readonly note: string
  readonly packageStatus: 'published' | 'draft'
  readonly stateLabel: '已听审' | '草稿'
  readonly status: string
}

export interface ParentFacts {
  animalName: string
  assetCredits: Array<{
    attribution: string
    licenseName: string
    licenseUrl: string
    sourceTitle: string
    sourceUrl?: string
  }>
  classification: string
  classificationNote: string
  diet: string
  discoveryRegions: string[]
  researchSize: string
  researchSizeNote: string
  size: string
  sizeLabel: string
  narrationScript: readonly [string, string]
  period: string
  researchReviewedOn: string
  researchUncertaintyNotes: readonly string[]
  review?: ParentReviewFacts
  sources: Array<{
    accessedOn: string
    title: string
    url: string
  }>
}

interface ParentDrawerProps {
  localeHrefs?: Readonly<Record<Locale, string>>
  facts: ParentFacts
  onClose: () => void
  open: boolean
  motionOrigin: React.RefObject<MotionOrigin | null>
  returnFocusTo: React.RefObject<HTMLElement | null>
  showReviewDetails?: boolean
}

const focusableSelector = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function displaySourceTitle(title: string): string {
  return title.replace(/[—–]/g, '-')
}

export function ParentDrawer({
  localeHrefs,
  facts,
  onClose,
  open,
  motionOrigin,
  returnFocusTo,
  showReviewDetails = false,
}: ParentDrawerProps) {
  const { locale, messages } = useI18n()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const { present, exiting, handle } = usePanelMotion({
    open, panel: drawerRef, trigger: returnFocusTo, origin: motionOrigin,
    backdrop: backdropRef, phone: 390, desktop: 260, easing: drawerCurve, onDismiss: onClose,
  })
  const [showScrollCue, setShowScrollCue] = useState(false)
  const scrollHintId = useId()
  const titleId = useId()
  const review = showReviewDetails ? facts.review : undefined
  const { handleScroll, isScrolling, metrics, scrollRef } =
    useTransientScrollbar(open)
  const disclosureMoves = useRef(new Map<Element, Animation>())
  const leaveDisclosure = useRef<(() => void) | null>(null)

  useEffect(() => () => {
    for (const animation of disclosureMoves.current.values()) animation.cancel()
    disclosureMoves.current.clear()
    leaveDisclosure.current?.()
  }, [open])

  const toggleDisclosure = (event: MouseEvent<HTMLElement>) => {
    const details = event.currentTarget.parentElement
    if (!(details instanceof HTMLDetailsElement) || event.defaultPrevented) return
    event.preventDefault()
    const reduced = reducedMotion()
    const duration = motionTime(220, 160, event.detail === 0)
    const followers = new Map<Element, number>()
    for (let sibling = details.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
      if (!reduced) followers.set(sibling, sibling.getBoundingClientRect().top)
    }
    for (const animation of disclosureMoves.current.values()) animation.cancel()
    disclosureMoves.current.clear()
    leaveDisclosure.current?.()

    const body = details.querySelector<HTMLElement>('.source-list')
    const outgoing = details.open ? captureVisual(body, false, true) : null
    const scroller = scrollRef.current
    const summaryTop = event.currentTarget.getBoundingClientRect().top
    details.open = !details.open
    if (scroller) {
      const displacement = event.currentTarget.getBoundingClientRect().top - summaryTop
      if (Math.abs(displacement) > 1) scroller.scrollTop += displacement
    }
    if (outgoing && drawerRef.current && scroller) {
      leaveDisclosure.current = fadeLeaving(outgoing, drawerRef.current,
        reduced ? duration : Math.round(duration * 0.3), scroller.getBoundingClientRect())
    }
    for (const [element, top] of followers) {
      const offset = top - element.getBoundingClientRect().top
      if (Math.abs(offset) < 1) continue
      const animation = playMotion(element, [{ translate: `0 ${offset}px` }, { translate: 'none' }],
        { duration, easing: 'ease-in-out' }, () => disclosureMoves.current.delete(element))
      if (animation) disclosureMoves.current.set(element, animation)
    }
    if (details.open && body) {
      const frames = reduced
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0 }, { opacity: 0, offset: 0.48 }, { opacity: 1 }]
      const animation = playMotion(body, frames, { duration, easing: 'linear' },
        () => disclosureMoves.current.delete(body))
      if (animation) disclosureMoves.current.set(body, animation)
    }
  }

  const updateScrollCue = useCallback(() => {
    const scroll = scrollRef.current
    if (!scroll) {
      setShowScrollCue(false)
      return
    }
    const remaining =
      scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight
    setShowScrollCue(scroll.scrollHeight > scroll.clientHeight + 2 && remaining > 4)
  }, [scrollRef])

  useEffect(() => {
    if (!open) {
      return
    }

    const returnTarget = returnFocusTo.current
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !drawerRef.current) {
        return
      }
      const controls = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(focusableSelector),
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
  }, [open, returnFocusTo])

  useEffect(() => {
    if (!open) {
      return
    }
    const scroll = scrollRef.current
    if (!scroll) {
      return
    }
    const timer = window.setTimeout(updateScrollCue, 0)
    scroll.addEventListener('scroll', updateScrollCue, { passive: true })
    window.addEventListener('resize', updateScrollCue)
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(updateScrollCue)
    observer?.observe(scroll)
    if (scroll.firstElementChild) {
      observer?.observe(scroll.firstElementChild)
    }

    return () => {
      window.clearTimeout(timer)
      scroll.removeEventListener('scroll', updateScrollCue)
      window.removeEventListener('resize', updateScrollCue)
      observer?.disconnect()
    }
  }, [facts, open, scrollRef, updateScrollCue])

  return (
    <div className="drawer-layer" hidden={!present} data-exiting={exiting || undefined}>
      <div
        aria-hidden="true"
        className="drawer-backdrop"
        ref={backdropRef}
        onMouseDown={(event) => {
          if (open && event.currentTarget === event.target) {
            onClose()
          }
        }}
      />
      <section
        aria-hidden={exiting || undefined}
        aria-labelledby={titleId}
        aria-modal={open || undefined}
        className="parent-drawer"
        inert={exiting || undefined}
        ref={drawerRef}
        role={open ? 'dialog' : undefined}
      >
        <div className="drawer-handle museum-motion-handle" aria-hidden="true" {...handle} />
        <header className="drawer-header">
          <div>
            <p className="drawer-eyebrow">{messages.parent.eyebrow}</p>
            <h2 id={titleId}>{messages.parent.title}</h2>
          </div>
          <div className="drawer-header__actions">
            <LanguageMenu localeHrefs={localeHrefs} />
            <IconButton
              hideTooltipOnFocus
              icon={X}
              label={messages.parent.close}
              onClick={onClose}
              ref={closeButtonRef}
            />
          </div>
        </header>
        <div className="drawer-scroll-shell">
          <div
            aria-describedby={showScrollCue ? scrollHintId : undefined}
            className="drawer-scroll museum-scrollbar"
            onScroll={handleScroll}
            ref={scrollRef}
          >
            <div>
            <dl className="fact-grid">
              <div>
                <dt>{messages.parent.period}</dt>
                <dd>{facts.period}</dd>
              </div>
              <div>
                <dt>{messages.parent.regions}</dt>
                <dd>{messages.parent.joinRegions(facts.discoveryRegions)}</dd>
              </div>
              <div>
                <dt>{facts.sizeLabel}</dt>
                <dd>{facts.size}</dd>
              </div>
              <div>
                <dt>{messages.parent.diet}</dt>
                <dd>{facts.diet}</dd>
              </div>
              <div className="fact-grid__wide">
                <dt>{messages.parent.classification}</dt>
                <dd>
                  {facts.classification}
                  {locale === 'zh-CN' ? '。' : '. '}
                  {facts.classificationNote}
                </dd>
              </div>
            </dl>
            {review ? (
              <section
                aria-label="本地评审记录"
                className="review-note"
                data-package-status={review.packageStatus}
              >
                <details>
                  <summary>
                    <span>评审备注（仅本地可见）</span>
                    <span>{review.displayLabel}</span>
                  </summary>
                  <div className="review-note__body">
                    <h3>{review.status}</h3>
                    <p>{review.note}</p>
                    <h4>本轮检查</h4>
                    <ul>
                      {review.checks.map((check) => (
                        <li key={check}>{check}</li>
                      ))}
                    </ul>
                  </div>
                </details>
              </section>
            ) : null}
            <div className="narration-transcript">
              <p className="drawer-eyebrow">{messages.parent.eyebrow}</p>
              <h3>{messages.parent.narration}</h3>
              <p>{facts.narrationScript.join(locale === 'zh-CN' ? '' : ' ')}</p>
            </div>
            <details className="research-disclosure source-disclosure">
              <summary onClick={toggleDisclosure}>{messages.parent.research(facts.animalName)}</summary>
              <div className="research-disclosure__body source-list">
                <h3>{messages.parent.researchOverview}</h3>
                <p>
                  {messages.parent.researchSummary({
                    animalName: facts.animalName,
                    classification: facts.classification,
                    classificationNote: facts.classificationNote,
                    diet: facts.diet,
                    period: facts.period,
                    regions: messages.parent.joinRegions(facts.discoveryRegions),
                    size: facts.researchSize,
                    sizeLabel: facts.sizeLabel,
                    sizeNote: facts.researchSizeNote,
                  })}
                </p>
                <h3>{messages.parent.reconstructionLimits}</h3>
                <ul className="research-disclosure__notes">
                  {facts.researchUncertaintyNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
                <h3>{messages.parent.scientificSources}</h3>
                <ul>
                  {facts.sources.map((source) => (
                    <li key={source.url}>
                      <a href={source.url} rel="noreferrer" target="_blank">
                        {displaySourceTitle(source.title)}
                      </a>
                      <small>
                        {messages.parent.sourceAccessedOn(source.accessedOn)}
                      </small>
                    </li>
                  ))}
                </ul>
                <p className="research-disclosure__byline">
                  {messages.parent.researchByline(facts.researchReviewedOn)}
                </p>
              </div>
            </details>
            <details className="source-disclosure">
              <summary onClick={toggleDisclosure}>{messages.parent.credits}</summary>
              <div className="source-list">
                <ul>
                  {facts.assetCredits.map((credit) => (
                    <li key={`${credit.sourceTitle}:${credit.licenseUrl}`}>
                      {credit.sourceUrl ? (
                        <a href={credit.sourceUrl} rel="noreferrer" target="_blank">
                          {displaySourceTitle(credit.sourceTitle)}
                        </a>
                      ) : (
                        displaySourceTitle(credit.sourceTitle)
                      )}
                      {locale === 'zh-CN' ? '：' : ': '}
                      {credit.attribution}{' '}
                      <a href={credit.licenseUrl} rel="noreferrer" target="_blank">
                        {credit.licenseName}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
            <details className="source-disclosure">
              <summary onClick={toggleDisclosure}>{messages.parent.licensing}</summary>
              <div className="source-list">
                <p>{messages.parent.licensingBody}</p>
                <div className="source-link-actions">
                  <a
                    href={GITHUB_REPOSITORY_URL}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {messages.parent.repository}
                  </a>
                  <a
                    href={GITHUB_LICENSING_URL}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {messages.parent.fullLicensing}
                  </a>
                </div>
              </div>
            </details>
              <OfficialLinks compact />
            </div>
          </div>
          <TransientScrollbar isScrolling={isScrolling} metrics={metrics} />
        </div>
        <p className="sr-only" id={scrollHintId}>
          {messages.parent.moreHint}
        </p>
        <div
          aria-hidden="true"
          className="drawer-scroll-cue"
          data-visible={showScrollCue}
        >
          <ChevronDown size={17} strokeWidth={2.2} />
          <span>{messages.parent.more}</span>
        </div>
      </section>
    </div>
  )
}
