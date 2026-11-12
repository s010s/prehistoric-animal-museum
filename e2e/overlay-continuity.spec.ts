import { expect, test } from '@playwright/test'

const exits = [
  { name: 'closing the guide', trigger: 'Open the full museum guide', panel: '.collection-sheet',
    scrim: '.collection-backdrop', action: '[aria-label="Close the museum guide"]' },
  { name: 'choosing an animal', trigger: 'Open the full museum guide', panel: '.collection-sheet',
    scrim: '.collection-backdrop', action: '[data-collection-animal-id="pteranodon"]' },
  { name: 'closing the grown-ups guide', trigger: 'Guide for grown-ups', panel: '.parent-drawer[role="dialog"]',
    scrim: '.drawer-backdrop', action: '[aria-label="Close the guide for grown-ups"]' },
] as const

for (const exit of exits) {
  test(`${exit.name} never repaints the departing panel or scrim`, async ({ page }, testInfo) => {
    await page.goto('./en/')
    await expect(page.getByRole('button', { name: 'Focus on the model' })).toBeEnabled({ timeout: 20_000 })
    await page.getByRole('button', { name: exit.trigger, exact: true }).click()
    await expect(page.locator(exit.panel)).toBeVisible()
    await expect(page.locator('.museum-motion-surface')).toHaveCount(0)
    await page.locator(exit.panel).locator(exit.action).scrollIntoViewIfNeeded()

    const handoff = await page.evaluate(async ({ panel, scrim, action }) => {
      const dialog = document.querySelector<HTMLElement>(panel)!
      const layer = dialog.parentElement!
      const backdrop = layer.querySelector<HTMLElement>(scrim)!
      const button = dialog.querySelector<HTMLElement>(action)!
      const paints = (element: HTMLElement) => {
        if (!element.isConnected || !element.getClientRects().length) return false
        const style = getComputedStyle(element)
        return style.visibility === 'visible' && Number(style.opacity) > 0.015
      }

      return new Promise<{ panel: boolean; scrim: boolean } | null>((resolve) => {
        const observer = new MutationObserver((mutations) => {
          const removedSurface = mutations.some((mutation) =>
            Array.from(mutation.removedNodes).some((node) =>
              node instanceof Element && node.classList.contains('museum-motion-surface'),
            ),
          )
          if (!removedSurface) return
          observer.disconnect()
          window.clearTimeout(timeout)
          // This handoff happens before React removes the retained dialog.
          resolve({ panel: paints(dialog), scrim: paints(backdrop) })
        })
        observer.observe(layer, { childList: true, subtree: true })
        const timeout = window.setTimeout(() => {
          observer.disconnect()
          resolve(null)
        }, 1_500)
        button.click()
      })
    }, exit)

    await testInfo.attach('exit-paint-handoff', {
      body: JSON.stringify(handoff, null, 2),
      contentType: 'application/json',
    })
    expect(handoff).toEqual({ panel: false, scrim: false })
    if (exit.name === 'choosing an animal') {
      await expect(page.getByRole('heading', { name: 'Pteranodon', exact: true })).toBeFocused()
    }
    await page.getByRole('button', { name: exit.trigger, exact: true }).click()
    await expect(page.locator(exit.panel)).toBeVisible()
  })
}

test('a guide selection blends the incoming scene over the last visible scene', async ({ page }) => {
  await page.goto('./en/')
  await expect(page.getByRole('button', { name: 'Focus on the model' })).toBeEnabled({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Open the full museum guide' }).click()
  const card = page.locator('[data-collection-animal-id="pteranodon"]')
  await card.scrollIntoViewIfNeeded()
  const alpha = await card.evaluate(async (button) => {
    return new Promise<number | null>((resolve) => {
      const deadline = performance.now() + 8_000
      const sample = () => {
        const next = document.querySelector('.scene-background--incoming')
        const prior = document.querySelector('.scene-background--outgoing')
        if (next && prior) {
          const nextOpacity = Number(getComputedStyle(next).opacity)
          if (nextOpacity > 0.2 && nextOpacity < 0.85) {
            resolve(Number(getComputedStyle(prior).opacity))
            return
          }
        }
        if (performance.now() >= deadline) resolve(null)
        else requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
      button.click()
    })
  })
  expect(alpha).toBe(1)
})
