import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { GitHubStarPrompt } from '../src/components/GitHubStarPrompt'
import { I18nProvider } from '../src/i18n/I18nProvider'
import { GITHUB_STAR_PROMPT_DELAY_MS } from '../src/github'

describe('GitHubStarPrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
    window.localStorage.setItem('museum.locale', 'zh-CN')
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    window.localStorage.clear()
  })

  it('pauses the visit timer while the page is hidden', async () => {
    let visibilityState: DocumentVisibilityState = 'visible'
    const originalVisibilityState = Object.getOwnPropertyDescriptor(
      document,
      'visibilityState',
    )
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    })

    try {
      render(<Prompt />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
      })
      visibilityState = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
      expect(
        screen.queryByRole('complementary', { name: '支持这座博物馆' }),
      ).not.toBeInTheDocument()

      visibilityState = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(29_999)
      })
      expect(
        screen.queryByRole('complementary', { name: '支持这座博物馆' }),
      ).not.toBeInTheDocument()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(
        screen.getByRole('complementary', { name: '支持这座博物馆' }),
      ).toBeVisible()
    } finally {
      if (originalVisibilityState) {
        Object.defineProperty(
          document,
          'visibilityState',
          originalVisibilityState,
        )
      }
    }
  })

  it('defers display while blocked and cools down after dismissal', async () => {
    const { rerender } = render(<Prompt blocked />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GITHUB_STAR_PROMPT_DELAY_MS)
    })
    expect(
      screen.queryByRole('complementary', { name: '支持这座博物馆' }),
    ).not.toBeInTheDocument()

    rerender(<Prompt />)
    const prompt = screen.getByRole('complementary', {
      name: '支持这座博物馆',
    })
    fireEvent.click(screen.getByRole('button', { name: '暂时不用' }))
    expect(prompt).not.toBeInTheDocument()

    cleanup()
    render(<Prompt />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GITHUB_STAR_PROMPT_DELAY_MS)
    })
    expect(
      screen.queryByRole('complementary', { name: '支持这座博物馆' }),
    ).not.toBeInTheDocument()
  })
})
function Prompt({ blocked = false }: { readonly blocked?: boolean }) {
  return (
    <I18nProvider>
      <GitHubStarPrompt blocked={blocked} start />
    </I18nProvider>
  )
}
