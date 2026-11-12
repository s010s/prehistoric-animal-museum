import { expect, test, type Locator } from '@playwright/test'

async function sampleSelection(rail: Locator, from: string, to: string, holdAtHalfway = false) {
  const sample = await rail.evaluate((track, { from, to, holdAtHalfway }) => {
    const card = (id: string) => track.querySelector<HTMLElement>(`[data-animal-id="${id}"]`)!
    const source = card(from), target = card(to)
    const read = (element: HTMLElement) => {
      const { x, y, width, height } = element.getBoundingClientRect()
      const port = track.getBoundingClientRect()
      const style = getComputedStyle(element)
      return {
        x: x - port.x + track.scrollLeft,
        y: y - port.y + track.scrollTop,
        width, height, radius: style.borderBottomLeftRadius, shadow: style.boxShadow, opacity: Number(style.opacity),
      }
    }
    const before = read(source)
    return new Promise<{
      before: ReturnType<typeof read>
      source: ReturnType<typeof read>
      target: ReturnType<typeof read>
      frames: ReturnType<typeof read>[][]
    } | null>((resolve) => {
      const observer = new MutationObserver(() => {
        if (target.dataset.selected !== 'true') return
        const marks = [...track.querySelectorAll<HTMLElement>('.museum-motion-highlight--rail')]
        if (!marks.length) return
        const animations = marks.map(mark => mark.getAnimations()[0])
        if (animations.some(animation => !animation)) return
        observer.disconnect()
        clearTimeout(timeout)
        const frames = [0, .5, .995].map(progress => {
          for (const animation of animations) {
            animation!.pause()
            animation!.currentTime = Number(animation!.effect!.getTiming().duration) * progress
          }
          return marks.map(read)
        })
        resolve({ before, source: read(source), target: read(target), frames })
        for (const animation of animations) {
          if (holdAtHalfway) animation!.currentTime = Number(animation!.effect!.getTiming().duration) * .5
          else animation!.play()
        }
      })
      observer.observe(track, { childList: true, subtree: true })
      const timeout = window.setTimeout(() => { observer.disconnect(); resolve(null) }, 8_000)
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
    })
  }, { from, to, holdAtHalfway })
  expect(sample, 'a selection paints its transition before settling').not.toBeNull()
  return sample!
}

type SelectionSample = Awaited<ReturnType<typeof sampleSelection>>

function expectSlide(sample: SelectionSample) {
  const { before, source, target, frames } = sample
  expect(frames.map(frame => frame.length)).toEqual([1, 1, 1])
  expect(frames[0]![0]!.x).toBeCloseTo(source.x, 0)
  expect(frames[0]![0]!.y).toBeCloseTo(source.y, 0)
  expect(frames[0]![0]!.shadow).toBe(before.shadow)
  expect(frames[2]![0]!.x).toBeCloseTo(target.x, 0)
  const halfway = frames[1]![0]!
  expect(halfway.x).toBeGreaterThan(Math.min(source.x, target.x))
  expect(halfway.x).toBeLessThan(Math.max(source.x, target.x))
  for (const [mark] of frames) {
    expect(mark!.width).toBeCloseTo(before.width, 0)
    expect(mark!.height).toBeCloseTo(before.height, 0)
    expect(mark!.radius).toBe(before.radius)
    expect(mark!.shadow).toContain('inset')
  }
}

function expectCrossFade({ source, target, frames }: SelectionSample) {
  expect(frames.map(frame => frame.length)).toEqual([2, 2, 2])
  const outgoing = frames[0]!.findIndex(mark => Math.abs(mark.x - source.x) < .5)
  expect(outgoing).toBeGreaterThanOrEqual(0)
  const incoming = 1 - outgoing
  for (const frame of frames) {
    expect(frame[outgoing]!.x).toBeCloseTo(source.x, 0)
    expect(frame[incoming]!.x).toBeCloseTo(target.x, 0)
  }
  expect(frames[0]![outgoing]!.opacity).toBeCloseTo(1, 1)
  expect(frames[2]![outgoing]!.opacity).toBeLessThan(.05)
  expect(frames[0]![incoming]!.opacity).toBeCloseTo(0, 1)
  expect(frames[2]![incoming]!.opacity).toBeGreaterThan(.95)
}

test('adjacent rail cards carry the same rounded bottom edge and distant cards cross-fade', async ({ page }, testInfo) => {
  await page.goto('./zh-CN/')
  await expect(page.getByRole('button', { name: '专注看模型' })).toBeEnabled({ timeout: 20_000 })
  const rail = page.locator('.animal-rail')
  const target = rail.locator('[data-animal-id="pteranodon"]')
  await target.hover()
  await expect(target).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, -1)')
  const adjacent = await sampleSelection(rail, 'stegosaurus', 'pteranodon')
  expectSlide(adjacent)
  await expect(rail.locator('.museum-motion-highlight--rail')).toHaveCount(0)
  await expect(target).toHaveCSS('transform', 'none')
  await expect(target).toHaveCSS('box-shadow', adjacent.frames[2]![0]!.shadow)
  const atRestTop = await target.evaluate(card => {
    const rail = card.closest('.animal-rail')!
    return card.getBoundingClientRect().top - rail.getBoundingClientRect().top + rail.scrollTop
  })
  expect(adjacent.frames[2]![0]!.y).toBeCloseTo(atRestTop, 0)

  const held = await sampleSelection(rail, 'pteranodon', 'pachycephalosaurus', true)
  const reversed = await sampleSelection(rail, 'pachycephalosaurus', 'pteranodon')
  expect(reversed.frames[0]![0]!.x).toBeCloseTo(held.frames[1]![0]!.x, 0)
  expect(reversed.frames[0]![0]!.shadow).toBe(held.frames[1]![0]!.shadow)
  expect(reversed.frames[2]![0]!.x).toBeCloseTo(reversed.target.x, 0)
  await expect(rail.locator('.museum-motion-highlight--rail')).toHaveCount(0)

  const distant = await sampleSelection(rail, 'pteranodon', 'regaliceratops')
  expectCrossFade(distant)
  await expect(rail.locator('[data-animal-id="regaliceratops"]')).toHaveAttribute('aria-current', 'true')

  await rail.locator('[data-animal-id="ichthyosaur"]').evaluate(card => {
    const focusButton = document.querySelector<HTMLButtonElement>('[aria-label="专注看模型"]')!
    const animalCard = card as HTMLElement
    animalCard.click()
    focusButton.click()
  })
  await expect(rail).toHaveCount(0)
  await expect(page.getByRole('img', { name: /鱼龙类三维模型/ })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: '退出模型专注模式' }).click()
  await expect(rail.locator('[data-animal-id="ichthyosaur"]')).toHaveAttribute('aria-current', 'true')
  const afterFocus = await sampleSelection(rail, 'ichthyosaur', 'opabinia')
  expectSlide(afterFocus)
  await testInfo.attach('desktop-rail-frames', { body: JSON.stringify({ adjacent, distant, held, reversed, afterFocus }, null, 2), contentType: 'application/json' })
})

test('the phone rail keeps the same contour and cross-fades with reduced motion', async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
  })
  try {
    const page = await context.newPage()
    await page.goto('./zh-CN/')
    await expect(page.getByRole('button', { name: '专注看模型' })).toBeEnabled({ timeout: 20_000 })
    const rail = page.locator('.animal-rail')
    const adjacent = await sampleSelection(rail, 'stegosaurus', 'pteranodon')
    expectSlide(adjacent)
    await expect(rail.locator('.museum-motion-highlight--rail')).toHaveCount(0)

    await page.emulateMedia({ reducedMotion: 'reduce' })
    const reduced = await sampleSelection(rail, 'pteranodon', 'pachycephalosaurus')
    expectCrossFade(reduced)
    await testInfo.attach('phone-rail-frames', { body: JSON.stringify({ adjacent, reduced }, null, 2), contentType: 'application/json' })
  } finally {
    await context.close()
  }
})
