import { Check, Languages } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n/I18nProvider'
import { buildLocaleUrl, systemLocale, type Locale, type LocalePreference } from '../i18n/locale'

const choices: readonly LocalePreference[] = ['system', 'zh-CN', 'en']
const popoverGap = 9
const viewportMargin = 12
const preferredPopoverWidth = 304

function subscribeSystemLocale(change: () => void): () => void {
  window.addEventListener('languagechange', change)
  return () => window.removeEventListener('languagechange', change)
}

function readSystemLocale(): Locale {
  return systemLocale(navigator.languages.length > 0 ? navigator.languages : [navigator.language])
}

interface PopoverPosition {
  readonly accentSoft: string
  readonly left: number
  readonly top: number
  readonly width: number
}

export function LanguageMenu({ localeHrefs }: {
  readonly localeHrefs?: Readonly<Record<Locale, string>> | undefined
} = {}) {
  const { locale, messages, preference, setPreference } = useI18n()
  const [open, setOpen] = useState(false)
  const [popoverPosition, setPopoverPosition] =
    useState<PopoverPosition | null>(null)
  const menuId = useId()
  const menuRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef(new Map<LocalePreference, HTMLButtonElement | HTMLAnchorElement>())
  const detectedSystemLocale = useSyncExternalStore(subscribeSystemLocale, readSystemLocale, () => locale)
  const [browserLocation, setBrowserLocation] = useState<string | null>(null)

  const labelFor = (choice: LocalePreference): ReactNode => {
    if (choice === 'system') {
      const resolved = detectedSystemLocale
      const resolvedLabel =
        resolved === 'zh-CN'
          ? messages.language.chinese
          : messages.language.english
      const fullLabel = messages.language.systemResolved(resolvedLabel)
      const resolvedLabelStart = fullLabel.indexOf(resolvedLabel)
      return (
        <span lang={locale}>
          {fullLabel.slice(0, resolvedLabelStart)}
          <span lang={resolved}>{resolvedLabel}</span>
          {fullLabel.slice(resolvedLabelStart + resolvedLabel.length)}
        </span>
      )
    }
    return (
      <span lang={choice}>
        {choice === 'zh-CN'
          ? messages.language.chinese
          : messages.language.english}
      </span>
    )
  }

  const close = (restoreFocus = false) => {
    setOpen(false)
    setPopoverPosition(null)
    if (restoreFocus) {
      queueMicrotask(() => triggerRef.current?.focus())
    }
  }

  const openAt = (choice: LocalePreference) => {
    setBrowserLocation(window.location.href)
    setOpen(true)
    queueMicrotask(() => itemRefs.current.get(choice)?.focus())
  }

  const positionPopover = useCallback(() => {
    const trigger = triggerRef.current
    const menu = menuRef.current
    if (!trigger || !menu) {
      return
    }

    const viewport = window.visualViewport
    const viewportLeft = viewport?.offsetLeft ?? 0
    const viewportTop = viewport?.offsetTop ?? 0
    const viewportWidth = viewport?.width ?? window.innerWidth
    const viewportHeight = viewport?.height ?? window.innerHeight
    const viewportRight = viewportLeft + viewportWidth
    const viewportBottom = viewportTop + viewportHeight
    const triggerBox = trigger.getBoundingClientRect()
    const menuHeight = menu.getBoundingClientRect().height
    const width = Math.min(
      preferredPopoverWidth,
      Math.max(0, viewportWidth - viewportMargin * 2),
    )
    const minLeft = viewportLeft + viewportMargin
    const maxLeft = Math.max(minLeft, viewportRight - viewportMargin - width)
    const left = Math.min(
      Math.max(triggerBox.right - width, minLeft),
      maxLeft,
    )
    const below = triggerBox.bottom + popoverGap
    const above = triggerBox.top - popoverGap - menuHeight
    const availableBelow = viewportBottom - viewportMargin - below
    const availableAbove =
      triggerBox.top - popoverGap - (viewportTop + viewportMargin)
    const preferredTop =
      menuHeight <= availableBelow || availableBelow >= availableAbove
        ? below
        : above
    const maxTop = Math.max(
      viewportTop + viewportMargin,
      viewportBottom - viewportMargin - menuHeight,
    )
    const top = Math.min(
      Math.max(preferredTop, viewportTop + viewportMargin),
      maxTop,
    )
    const accentSoft = getComputedStyle(trigger).getPropertyValue(
      '--animal-accent-soft',
    )

    setPopoverPosition((current) => {
      const next = { accentSoft, left, top, width }
      return current?.accentSoft === next.accentSoft &&
        current.left === next.left &&
        current.top === next.top &&
        current.width === next.width
        ? current
        : next
    })
  }, [])

  useLayoutEffect(() => {
    if (!open) {
      return
    }

    positionPopover()
    const viewport = window.visualViewport
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(positionPopover)
    if (triggerRef.current) observer?.observe(triggerRef.current)
    if (menuRef.current) observer?.observe(menuRef.current)
    window.addEventListener('resize', positionPopover)
    window.addEventListener('scroll', positionPopover, true)
    viewport?.addEventListener('resize', positionPopover)
    viewport?.addEventListener('scroll', positionPopover)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', positionPopover)
      window.removeEventListener('scroll', positionPopover, true)
      viewport?.removeEventListener('resize', positionPopover)
      viewport?.removeEventListener('scroll', positionPopover)
    }
  }, [open, positionPopover])

  useEffect(() => {
    if (!open) {
      return
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        close()
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  const handleMenuKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    const currentIndex = choices.findIndex(
      (choice) => itemRefs.current.get(choice) === document.activeElement,
    )
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      const trigger = triggerRef.current
      const focusTarget = event.shiftKey
        ? trigger
        : Array.from(
            document.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).find(
            (element, index, elements) =>
              index > elements.indexOf(trigger!) &&
              !menuRef.current?.contains(element) &&
              !element.closest('[inert]'),
          )
      close()
      queueMicrotask(() => (focusTarget ?? trigger)?.focus())
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const choice = event.key === 'Home' ? choices[0] : choices.at(-1)
      if (choice) itemRefs.current.get(choice)?.focus()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return
    }
    event.preventDefault()
    const offset = event.key === 'ArrowDown' ? 1 : -1
    const index =
      currentIndex < 0
        ? 0
        : (currentIndex + offset + choices.length) % choices.length
    const choice = choices[index]
    if (choice) itemRefs.current.get(choice)?.focus()
  }

  const menu = (
    <div
      aria-label={messages.language.menuLabel}
      className="language-menu__popover"
      data-positioned={popoverPosition !== null}
      hidden={!open}
      id={menuId}
      onKeyDown={handleMenuKeyDown}
      ref={menuRef}
      role="menu"
      style={{
        '--animal-accent-soft': popoverPosition?.accentSoft || undefined,
        display: open ? undefined : 'none',
        left: popoverPosition?.left ?? 0,
        top: popoverPosition?.top ?? 0,
        width: popoverPosition?.width ?? preferredPopoverWidth,
      } as CSSProperties}
    >
      {choices.map((choice) => {
        const props = {
          'aria-checked': preference === choice,
          className: 'language-menu__choice',
          ref: (element: HTMLAnchorElement | HTMLButtonElement | null) => {
            if (element) itemRefs.current.set(choice, element)
            else itemRefs.current.delete(choice)
          },
          role: 'menuitemradio' as const,
          tabIndex: -1,
        }
        const contents = <>
          <span aria-hidden="true" className="language-menu__radio" />
          <span>{labelFor(choice)}</span>
          <span aria-hidden="true" className="language-menu__selected-mark">
            <Check size={17} strokeWidth={3} />
          </span>
        </>
        const choose = () => {
          setPreference(choice)
          close(true)
        }
        return choice === 'system' ? (
          <button {...props} key={choice} onClick={choose} type="button">
            {contents}
          </button>
        ) : (
          <a
            {...props}
            data-locale-link={choice}
            href={browserLocation
              ? buildLocaleUrl(browserLocation, choice)
              : localeHrefs?.[choice]}
            hrefLang={choice}
            key={choice}
            lang={choice}
            onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
              event.preventDefault()
              choose()
            }}
            onKeyDown={(event) => {
              if (event.key === ' ') {
                event.preventDefault()
                choose()
              }
            }}
          >
            {contents}
          </a>
        )
      })}
    </div>
  )

  return (
    <div className="language-menu" ref={rootRef}>
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={messages.language.buttonLabel}
        className="language-menu__trigger"
        onClick={() => {
          if (open) close()
          else openAt(preference)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            openAt(event.key === 'ArrowDown' ? choices[0]! : choices.at(-1)!)
          }
        }}
        ref={triggerRef}
        type="button"
      >
        <Languages aria-hidden="true" size={20} strokeWidth={2.1} />
        <span>{locale === 'zh-CN' ? '中' : 'EN'}</span>
      </button>
      {open ? createPortal(menu, document.body) : menu}
    </div>
  )
}
