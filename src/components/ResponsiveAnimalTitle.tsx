import { useLayoutEffect, useRef } from 'react'

interface ResponsiveAnimalTitleProps {
  readonly as?: 'h1' | 'h2'
  readonly children: string
  readonly locale: 'zh-CN' | 'en'
}

const TITLE_FIT_SAFETY_RATIO = 0.985

export function ResponsiveAnimalTitle({
  as: Heading = 'h2',
  children,
  locale,
}: ResponsiveAnimalTitleProps) {
  const titleRef = useRef<HTMLHeadingElement>(null)

  useLayoutEffect(() => {
    const title = titleRef.current
    if (!title) {
      return
    }

    const clearFit = () => {
      title.style.removeProperty('font-size')
      title.removeAttribute('data-title-fitted')
    }
    clearFit()
    if (locale !== 'en') {
      return
    }

    let cancelled = false
    let animationFrame = 0
    let measuredWidth = -1
    let settledResizeTimer = 0

    const fitTitle = () => {
      if (cancelled) {
        return
      }

      clearFit()

      const availableWidth = title.clientWidth
      const requiredWidth = title.scrollWidth
      const naturalFontSize = Number.parseFloat(getComputedStyle(title).fontSize)
      if (
        availableWidth <= 0 ||
        requiredWidth <= availableWidth ||
        !Number.isFinite(naturalFontSize)
      ) {
        return
      }

      const fittedFontSize =
        naturalFontSize *
        (availableWidth / requiredWidth) *
        TITLE_FIT_SAFETY_RATIO
      title.style.fontSize = `${fittedFontSize}px`
      title.dataset.titleFitted = 'true'
    }

    const scheduleFit = () => {
      cancelAnimationFrame(animationFrame)
      animationFrame = requestAnimationFrame(fitTitle)
    }

    const scheduleResizeFit = () => {
      scheduleFit()
      window.clearTimeout(settledResizeTimer)
      settledResizeTimer = window.setTimeout(scheduleFit, 180)
    }

    fitTitle()

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            const nextWidth = title.clientWidth
            if (Math.abs(nextWidth - measuredWidth) <= 0.5) {
              return
            }
            measuredWidth = nextWidth
            scheduleFit()
          })
    resizeObserver?.observe(title)
    window.addEventListener('resize', scheduleResizeFit)

    void document.fonts?.ready.then(scheduleFit)

    return () => {
      cancelled = true
      cancelAnimationFrame(animationFrame)
      window.clearTimeout(settledResizeTimer)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', scheduleResizeFit)
      clearFit()
    }
  }, [children, locale])

  return (
    <Heading className="animal-title" ref={titleRef} tabIndex={-1}>
      {children}
    </Heading>
  )
}
