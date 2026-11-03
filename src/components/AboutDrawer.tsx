import { useEffect, useId, useRef } from 'react'
import { Code2, ExternalLink, X } from 'lucide-react'
import { GITHUB_LICENSING_URL, GITHUB_REPOSITORY_URL } from '../github'
import { useI18n } from '../i18n/I18nProvider'
import type { Locale } from '../i18n/locale'
import { IconButton } from './IconButton'
import { LanguageMenu } from './LanguageMenu'
import { OfficialLinks } from './OfficialLinks'
import { TransientScrollbar } from './TransientScrollbar'
import { useTransientScrollbar } from './useTransientScrollbar'

interface AboutDrawerProps {
  readonly localeHrefs?: Readonly<Record<Locale, string>>
  readonly onClose: () => void
  readonly open: boolean
  readonly returnFocusTo: React.RefObject<HTMLElement | null>
}

const focusableSelector = [
  'button:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function AboutDrawer({
  localeHrefs,
  onClose,
  open,
  returnFocusTo,
}: AboutDrawerProps) {
  const { messages } = useI18n()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const titleId = useId()
  const { handleScroll, isScrolling, metrics, scrollRef } =
    useTransientScrollbar(open)

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

  return (
    <div className="drawer-layer" hidden={!open}>
      <div
        aria-hidden="true"
        className="drawer-backdrop"
        onMouseDown={(event) => {
          if (event.currentTarget === event.target) {
            onClose()
          }
        }}
      />
      <section
        aria-labelledby={titleId}
        aria-modal={open || undefined}
        className="parent-drawer about-drawer"
        ref={drawerRef}
        role="dialog"
      >
        <div className="drawer-handle" aria-hidden="true" />
        <header className="drawer-header">
          <div>
            <p className="drawer-eyebrow">{messages.about.eyebrow}</p>
            <h2 id={titleId}>{messages.about.title}</h2>
          </div>
          <div className="drawer-header__actions">
            <LanguageMenu localeHrefs={localeHrefs} />
            <IconButton
              hideTooltipOnFocus
              icon={X}
              label={messages.about.close}
              onClick={onClose}
              ref={closeButtonRef}
            />
          </div>
        </header>
        <div className="drawer-scroll-shell">
          <div
            className="drawer-scroll museum-scrollbar about-drawer__scroll"
            onScroll={handleScroll}
            ref={scrollRef}
          >
            <div className="about-drawer__body">
            <section className="about-story">
              <h3>{messages.about.heading}</h3>
              {messages.about.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
            <OfficialLinks compact />
            <div className="about-links">
              <a
                className="about-link about-link--primary"
                href={GITHUB_REPOSITORY_URL}
                rel="noreferrer"
                target="_blank"
              >
                <Code2 aria-hidden="true" size={20} strokeWidth={2.1} />
                <span>{messages.about.source}</span>
                <ExternalLink aria-hidden="true" size={16} strokeWidth={2} />
              </a>
              <a
                className="about-link about-link--secondary"
                href={GITHUB_LICENSING_URL}
                rel="noreferrer"
                target="_blank"
              >
                <span>{messages.about.licensing}</span>
                <ExternalLink aria-hidden="true" size={16} strokeWidth={2} />
              </a>
            </div>
            </div>
          </div>
          <TransientScrollbar isScrolling={isScrolling} metrics={metrics} />
        </div>
      </section>
    </div>
  )
}
