import { expect, test, type Locator } from '@playwright/test'

async function center(element: Locator) {
  const box = await element.boundingBox()
  if (!box) throw new Error('The transition endpoint is outside the layout')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

test('opens the full guide from its real trigger and lets the next click through on close', async ({
  page,
}, testInfo) => {
  await page.goto('./zh-CN/')
  const entry = page.getByRole('button', { name: '打开全馆图鉴' })
  const guideEntry = page.getByRole('button', { name: '给家长的资料' })
  const origin = await center(entry)
  const next = await center(guideEntry)
  const guide = page.getByRole('dialog', { name: '全馆图鉴' })

  // Sample the visual shell on its first animation frame, before it can settle.
  const firstFrame = await entry.evaluate((button) => {
    return new Promise<{ x: number; y: number } | null>((resolve) => {
      const read = new MutationObserver(() => {
        const shell = document.querySelector<HTMLElement>('.museum-motion-surface')
        if (!shell) return
        const rect = shell.getBoundingClientRect()
        read.disconnect()
        resolve({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
      })
      read.observe(document.body, { childList: true, subtree: true })
      setTimeout(() => {
        read.disconnect()
        resolve(null)
      }, 1_000)
      button.click()
    })
  })
  expect(firstFrame).not.toBeNull()
  expect(Math.abs(firstFrame!.x - origin.x)).toBeLessThan(4)
  expect(Math.abs(firstFrame!.y - origin.y)).toBeLessThan(4)
  await expect(guide).toBeFocused()
  await expect(page.locator('.museum-motion-surface')).toHaveCount(0)
  await testInfo.attach('guide-at-rest', {
    body: await guide.screenshot(),
    contentType: 'image/png',
  })

  await page.keyboard.press('Escape')
  await page.mouse.click(next.x, next.y)
  await expect(page.getByRole('dialog', { name: '给家长的资料' })).toBeVisible()
  await expect(page.getByRole('button', { name: '关闭家长资料' })).toBeFocused()
})

test('a cancelled phone drag settles back into the open guide', async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })
  try {
    const page = await context.newPage()
    await page.goto('./zh-CN/')
    await page.getByRole('button', { name: '打开全馆图鉴' }).tap()
    const sheet = page.getByRole('dialog', { name: '全馆图鉴' })
    await expect(sheet).toBeVisible()
    await expect(page.locator('.museum-motion-surface')).toHaveCount(0)
    const origin = await center(sheet)
    const handle = await center(sheet.locator('.collection-sheet__handle'))
    const touch = await context.newCDPSession(page)
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [handle],
    })
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: handle.x, y: handle.y + 95 }],
    })
    await expect.poll(async () => (await center(sheet)).y).toBeGreaterThan(origin.y + 25)
    await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    await expect.poll(async () => (await center(sheet)).y).toBeCloseTo(origin.y, 0)
    await expect(sheet).toBeFocused()
    await sheet.getByRole('button', { name: '关闭全馆图鉴' }).tap()
    await expect(sheet).toHaveCount(0)
    await expect(page.getByRole('button', { name: '打开全馆图鉴' })).toBeFocused()
  } finally {
    await context.close()
  }
})

test('grabbing the opening phone guide continues from its current frame', async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })
  try {
    const page = await context.newPage()
    await page.goto('./zh-CN/')
    await page.getByRole('button', { name: '打开全馆图鉴' }).tap()
    const surface = page.locator('.collection-layer .museum-motion-surface')
    const sheet = page.getByRole('dialog', { name: '全馆图鉴' })
    const start = await surface.evaluate((element) => {
      for (const animation of element.parentElement!.getAnimations({ subtree: true })) {
        if (animation instanceof CSSAnimation) continue
        animation.pause()
        animation.currentTime = 215
      }
      const box = element.getBoundingClientRect()
      const scrim = element.parentElement!.querySelector('.collection-backdrop')!
      return { top: box.top, width: box.width, scrim: getComputedStyle(scrim).opacity }
    })
    const handle = await center(sheet.locator('.collection-sheet__handle'))
    const touch = await context.newCDPSession(page)
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [handle] })
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: handle.x, y: handle.y + 45 }],
    })
    await expect(surface).toHaveCount(1)
    const dragged = await surface.evaluate((element) => {
      const box = element.getBoundingClientRect()
      const scrim = element.parentElement!.querySelector('.collection-backdrop')!
      return { top: box.top, width: box.width, scrim: getComputedStyle(scrim).opacity }
    })
    expect(dragged.top - start.top).toBeCloseTo(45, 0)
    expect(dragged.width).toBeCloseTo(start.width, 0)
    expect(dragged.scrim).toBe(start.scrim)
    await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    await expect(surface).toHaveCount(0)
    await expect(sheet).toBeFocused()
  } finally {
    await context.close()
  }
})

test('reduced motion keeps the menu and dialog in place and restores keyboard focus', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' })
  await page.goto('./en/')
  const entry = page.getByRole('button', { name: 'Open the full museum guide' })
  await entry.press('Enter')
  const guide = page.getByRole('dialog', { name: 'Museum guide' })
  await expect(guide).toBeFocused()
  await expect(page.locator('.museum-motion-surface')).toHaveCount(0)
  expect(await guide.evaluate((element) => getComputedStyle(element).transform)).toBe('none')

  const language = guide.getByRole('button', { name: /Change language/ })
  await language.press('ArrowDown')
  const menu = page.getByRole('menu', { name: 'Choose interface language' })
  await expect(menu).toBeVisible()
  expect(await menu.evaluate((element) => getComputedStyle(element).transform)).toBe('none')
  await page.keyboard.press('Escape')
  await expect(language).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(entry).toBeFocused()
})

test('a scrolled guide card with a missing thumbnail lands on the real exhibit title', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./en/')
  await expect(page.getByRole('button', { name: 'Focus on the model' })).toBeEnabled({
    timeout: 20_000,
  })
  await page.getByRole('button', { name: 'Open the full museum guide' }).click()
  const guide = page.getByRole('dialog', { name: 'Museum guide' })
  const card = guide.getByRole('button', { name: 'go to the Pachycephalosaurus exhibit' })
  await card.scrollIntoViewIfNeeded()
  await card.locator('img').evaluate((image) => {
    image.removeAttribute('src')
  })
  await card.press('Enter')
  await expect(guide).toHaveCount(0)
  const heading = page.getByRole('heading', { level: 2, name: 'Pachycephalosaurus' })
  await expect(heading).toBeFocused({ timeout: 20_000 })
  await expect(page.locator('.museum-motion-visual')).toHaveCount(0)
  await expect(heading).toHaveCSS('opacity', '1')
  await expect(page).toHaveURL(/animal=pachycephalosaurus/)
})

test('browser Back during encounter setup restores the exhibit and its trigger', async ({ page }) => {
  await page.goto('./en/')
  const trigger = page.getByRole('button', { name: 'Open a same-scale encounter with Stegosaurus' })
  await expect(trigger).toBeEnabled({ timeout: 20_000 })
  await trigger.click()
  await expect(page.getByRole('dialog', { name: /Compare with Stegosaurus|Opening/ })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { level: 2, name: 'Stegosaurus' })).toBeVisible()
  await expect(trigger).toBeFocused()
  await expect(page.locator('.museum-motion-visual, .museum-motion-surface')).toHaveCount(0)
})
