import { expect, test, type Locator } from '@playwright/test'

async function openingFrame(trigger: Locator, layer: string) {
  return trigger.evaluate((button, selector) => new Promise<{
    distance: number; widthRatio: number
  } | null>((resolve) => {
    const origin = button.getBoundingClientRect()
    const observer = new MutationObserver(() => {
      const surface = document.querySelector(`${selector} > .museum-motion-surface`)
      if (!surface) return
      const box = surface.getBoundingClientRect()
      observer.disconnect()
      clearTimeout(timeout)
      resolve({
        distance: Math.hypot(box.left + (box.width - origin.width) / 2 - origin.left,
          box.top + (box.height - origin.height) / 2 - origin.top),
        widthRatio: box.width / origin.width,
      })
    })
    observer.observe(document.body, { subtree: true, childList: true })
    const timeout = window.setTimeout(() => { observer.disconnect(); resolve(null) }, 2_000)
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }), layer)
}

test('sharing opens from its icon and immediately yields to another keyboard open', async ({ page }, testInfo) => {
  await page.goto('./zh-CN/?animal=stegosaurus')
  const trigger = page.getByRole('button', { name: '分享剑龙' })
  const layer = page.locator('.share-dialog-layer')
  const panel = page.getByRole('dialog', { name: '分享这次发现' })
  const frame = await openingFrame(trigger, '.share-dialog-layer')
  expect(frame).not.toBeNull()
  expect(frame!.distance).toBeLessThan(4)
  expect(frame!.widthRatio).toBeCloseTo(1, 1)
  const emptySpaceHitsScrim = await panel.evaluate(element => {
    const layer = element.parentElement!
    const actions = element.querySelector('.share-dialog-action')!
    const animations = layer.getAnimations({ subtree: true })
    for (const animation of animations) { animation.pause(); animation.currentTime = 0 }
    const box = actions.getBoundingClientRect()
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    for (const animation of animations) animation.play()
    return hit?.classList.contains('share-dialog-backdrop')
  })
  expect(emptySpaceHitsScrim).toBe(true)
  await expect(panel.getByRole('button', { name: '关闭', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await trigger.press('Enter')
  await expect(panel).toBeVisible()
  await expect(layer.locator('.museum-motion-surface')).toHaveCount(0)
  await testInfo.attach('share-at-rest', { body: await panel.screenshot(), contentType: 'image/png' })

  const finalPaint = await panel.evaluate((element) => new Promise<boolean | null>((resolve) => {
    const layer = element.parentElement!
    const backdrop = layer.querySelector('.share-dialog-backdrop')!
    const observer = new MutationObserver((mutations) => {
      if (!mutations.some(({ removedNodes }) => [...removedNodes].some((node) =>
        node instanceof Element && node.classList.contains('museum-motion-surface')))) return
      observer.disconnect()
      clearTimeout(timeout)
      const paints = (node: Element) => node.isConnected && getComputedStyle(node).visibility === 'visible'
        && Number(getComputedStyle(node).opacity) > 0.01
      resolve(paints(element) || paints(backdrop))
    })
    observer.observe(layer, { childList: true, subtree: true })
    const timeout = window.setTimeout(() => { observer.disconnect(); resolve(null) }, 1_500)
    element.querySelector('button')!.click()
  }))
  expect(finalPaint).toBe(false)
  await testInfo.attach('share-handoff', { body: JSON.stringify({ frame, finalPaint }), contentType: 'application/json' })
  await expect(trigger).toBeFocused()
})

test('a cancelled phone share drag settles back and reduced motion stays in place', async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL, viewport: { width: 390, height: 844 },
    hasTouch: true, isMobile: true, colorScheme: 'dark',
  })
  try {
    const page = await context.newPage()
    await page.goto('./en/?animal=pachycephalosaurus')
    const trigger = page.getByRole('button', { name: 'Share Pachycephalosaurus' })
    const panel = page.getByRole('dialog', { name: 'Share this discovery' })
    const surface = page.locator('.share-dialog-layer .museum-motion-surface')
    await trigger.tap()
    await expect(panel).toBeVisible()
    await expect(surface).toHaveCount(0)
    const position = (await panel.boundingBox())!.y
    const header = (await panel.getByRole('heading', { name: 'Share this discovery' }).boundingBox())!
    const start = { x: header.x + header.width / 2, y: header.y + header.height / 2 }
    const touch = await context.newCDPSession(page)
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x, y: start.y + 68 }] })
    await expect.poll(async () => (await panel.boundingBox())!.y).toBeGreaterThan(position + 35)
    await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    await expect.poll(async () => (await panel.boundingBox())!.y).toBeCloseTo(position, 0)
    await testInfo.attach('phone-share-at-rest', { body: await panel.screenshot(), contentType: 'image/png' })

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
    await trigger.press('Enter')
    await expect(panel).toBeVisible()
    await expect(surface).toHaveCount(0)
    await expect(panel).toHaveCSS('transform', 'none')
    await expect(panel.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
  } finally {
    await context.close()
  }
})

test('flight controls, coastal notes and the postcard pocket keep their source and focus', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await page.goto('./en/?animal=pteranodon&experience=flight')
  const flight = page.locator('.flight-experience')
  await expect(flight).toHaveAttribute('data-flight-phase', 'ready', { timeout: 60_000 })
  const gear = page.getByRole('button', { name: 'Flight & scenery' })
  const settingsFrame = await openingFrame(gear, '.flight-experience')
  expect(settingsFrame).not.toBeNull()
  expect(settingsFrame!.distance).toBeLessThan(4)
  const scenery = page.getByRole('tab', { name: 'Scenery' })
  await expect(scenery).toBeFocused()
  const tabTravel = await scenery.evaluate((tab) => new Promise<boolean>((resolve) => {
    const tabs = tab.parentElement!
    const observer = new MutationObserver(() => {
      if (!tabs.querySelector('.museum-motion-highlight')) return
      observer.disconnect()
      clearTimeout(timeout)
      resolve(true)
    })
    observer.observe(tabs, { childList: true })
    const timeout = window.setTimeout(() => { observer.disconnect(); resolve(false) }, 1_000)
    tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
  }))
  expect(tabTravel).toBe(true)
  await expect(page.getByRole('tab', { name: 'Views' })).toBeFocused()
  await page.locator('summary').filter({ hasText: 'Look a little closer' }).click({ timeout: 8_000 })
  const topic = page.getByRole('button', { name: /Light on water/ })
  await topic.scrollIntoViewIfNeeded()
  const noteFrame = await openingFrame(topic, '.flight-observation-backdrop')
  expect(noteFrame).not.toBeNull()
  expect(noteFrame!.distance).toBeLessThan(4)
  const note = page.getByRole('dialog', { name: 'Why does water sparkle?' })
  const noteClose = note.getByRole('button', { name: 'Close and stay paused' })
  await expect(noteClose).toBeFocused()
  await note.getByText('For grown-ups', { exact: true }).click()
  await expect(note.locator('details')).toHaveAttribute('open', '')
  await expect(note).toMatchAriaSnapshot(`
    - dialog "Why does water sparkle?":
      - button "Close and stay paused"
      - heading "Why does water sparkle?" [level=3]
  `)
  await noteClose.click()
  await expect(note).toHaveCount(0)
  await expect(topic).toBeFocused()
  await expect(gear).toHaveAttribute('aria-expanded', 'true')

  const pocket = page.getByRole('button', { name: 'View postcards, 0' })
  const galleryFrame = await openingFrame(pocket, '.flight-postcards')
  expect(galleryFrame).not.toBeNull()
  expect(galleryFrame!.distance).toBeLessThan(4)
  await expect(page.getByRole('button', { name: 'Close postcards' })).toBeFocused()
  await expect(gear).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByText('See something you love? Take a postcard.')).toBeVisible()
  await expect(flight.locator('.museum-motion-surface')).toHaveCount(0)
  await testInfo.attach('flight-panels', { body: JSON.stringify({ settingsFrame, noteFrame, galleryFrame, tabTravel }), contentType: 'application/json' })
  await testInfo.attach('empty-postcard-gallery', { body: await page.locator('#flight-postcard-gallery').screenshot(), contentType: 'image/png' })
  await page.keyboard.press('Escape')
  await expect(pocket).toBeFocused()
  await expect(pocket).toHaveAttribute('aria-expanded', 'false')

  await page.getByRole('button', { name: 'Take a postcard' }).click()
  const filledPocket = page.getByRole('button', { name: 'View postcards, 1' })
  await expect(filledPocket).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => filledPocket.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  const photoCarried = await filledPocket.evaluate((button) => new Promise<number | null>((resolve) => {
    const source = button.querySelector('img')!
    const observer = new MutationObserver(() => {
      const visual = document.querySelector<HTMLImageElement>('.museum-motion-visual img')
      if (visual?.src !== source.src) return
      const box = visual.getBoundingClientRect()
      observer.disconnect()
      clearTimeout(timeout)
      resolve(Math.abs(box.width / box.height - source.naturalWidth / source.naturalHeight))
    })
    observer.observe(document.body, { childList: true, subtree: true })
    const timeout = window.setTimeout(() => { observer.disconnect(); resolve(null) }, 1_500)
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }))
  expect(photoCarried).not.toBeNull()
  expect(photoCarried!).toBeLessThan(.04)
  const gallery = page.getByRole('region', { name: 'Postcards from this flight' })
  await expect(gallery.getByRole('img', { name: 'The coastal view you captured' })).toBeVisible()
  await expect(page.locator('.museum-motion-visual')).toHaveCount(0)
  await gallery.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(pocket).toBeFocused()
  await expect(gallery.getByText('See something you love? Take a postcard.')).toBeVisible()

  await gear.click()
  await expect(page.getByRole('tab', { name: 'Views' })).toBeFocused()
  const noBlankFrame = await page.getByRole('button', { name: /By the water/ }).evaluate(button => {
    return new Promise<boolean | null>(resolve => {
      const observer = new MutationObserver(() => {
        const layer = document.querySelector('.flight-view-preparing')
        const still = layer?.querySelector('.flight-view-still')
        if (!layer || !still) return
        observer.disconnect()
        clearTimeout(timeout)
        resolve([layer, still].every(node => getComputedStyle(node).backgroundColor === 'rgba(0, 0, 0, 0)'))
      })
      observer.observe(document.body, { childList: true, subtree: true })
      const timeout = window.setTimeout(() => { observer.disconnect(); resolve(null) }, 2_000)
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  })
  expect(noBlankFrame).toBe(true)
  await expect(page.getByRole('button', { name: 'Back to flight', exact: true })).toBeVisible({ timeout: 15_000 })
})

test('phone flight settings and postcards keep the same controls with reduced motion', async ({ browser }, testInfo) => {
  test.setTimeout(75_000)
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL, viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, reducedMotion: 'reduce',
  })
  try {
    const page = await context.newPage()
    await page.goto('./zh-CN/?animal=pteranodon&experience=flight')
    const flight = page.locator('.flight-experience')
    await expect(flight).toHaveAttribute('data-flight-phase', 'ready', { timeout: 60_000 })
    const gear = page.getByRole('button', { name: '飞行与风景', exact: true })
    await gear.tap()
    const settings = page.getByRole('region', { name: '飞行与风景', exact: true })
    await expect(settings).toBeVisible()
    await expect(settings).toHaveCSS('transform', 'none')
    await expect(page.getByRole('tab', { name: '风景' })).toBeFocused()
    await page.getByRole('tab', { name: '飞行', exact: true }).tap()
    const view = page.getByRole('tabpanel', { name: '飞行', exact: true })
    await expect(view).toHaveCSS('translate', 'none')
    await testInfo.attach('phone-flight-settings', { body: await settings.screenshot(), contentType: 'image/png' })
    const pocket = page.getByRole('button', { name: '查看明信片，0张' })
    await pocket.tap()
    await expect(gear).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('button', { name: '关闭明信片' })).toBeFocused()
    await expect(flight.locator('.museum-motion-surface')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(pocket).toBeFocused()
  } finally {
    await context.close()
  }
})

test('reset view eases around the exhibit from the last dragged frame', async ({ page }, testInfo) => {
  await page.goto('./en/?animal=stegosaurus&skyMotionRecord=1')
  const canvas = page.locator('.viewer-canvas')
  await expect(page.getByRole('button', { name: 'Focus on the model' })).toBeEnabled({ timeout: 20_000 })
  await expect(canvas).toHaveAttribute('data-review-motion-camera', /position/)
  const original = await canvas.evaluate((node) => {
    const { position, target } = JSON.parse((node as HTMLElement).dataset.reviewMotionCamera!) as {
      position: number[]; target: number[]
    }
    return position.map((value, i) => value - target[i]!)
  })
  const box = (await canvas.boundingBox())!
  const x = box.x + box.width * 0.65, y = box.y + box.height * 0.48
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - box.width * 0.36, y + box.height * 0.05, { steps: 10 })
  await page.mouse.up()

  const samples = await page.getByRole('button', { name: 'Reset the view' }).evaluate((button) => {
    const canvas = document.querySelector<HTMLElement>('.viewer-canvas')!
    const read = () => {
      const { position, target } = JSON.parse(canvas.dataset.reviewMotionCamera!) as {
        position: number[]; target: number[]
      }
      return position.map((value, i) => value - target[i]!)
    }
    return new Promise<number[][]>((resolve) => {
      const samples = [read()]
      const start = performance.now()
      const observer = new MutationObserver(() => {
        const elapsed = performance.now() - start
        if (elapsed <= 480) samples.push(read())
        else { observer.disconnect(); resolve(samples) }
      })
      observer.observe(canvas, { attributes: true, attributeFilter: ['data-review-motion-camera'] })
      window.setTimeout(() => { observer.disconnect(); resolve(samples) }, 1_500)
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  })
  const angle = (a: number[], b: number[]) => Math.acos(Math.min(1, Math.max(-1,
    a.reduce((dot, value, i) => dot + value * b[i]!, 0) / (Math.hypot(...a) * Math.hypot(...b)),
  )))
  const start = samples[0]!, end = samples.at(-1)!, sweep = angle(start, end)
  expect(sweep).toBeGreaterThan(0.65)
  expect(angle(end, original)).toBeLessThan(0.12)
  expect(samples.filter((point) => angle(point, start) > 0.12 && angle(point, end) > 0.12).length).toBeGreaterThanOrEqual(2)
  expect(Math.min(...samples.map((point) => Math.hypot(...point))))
    .toBeGreaterThan(Math.min(Math.hypot(...start), Math.hypot(...end)) * 0.92)
  await expect(page.getByText('The view has been reset.', { exact: true })).toBeAttached()

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - box.width * 0.36, y + box.height * 0.05, { steps: 10 })
  await page.mouse.up()
  const reduced = await page.getByRole('button', { name: 'Reset the view' }).evaluate(button => {
    const canvas = document.querySelector<HTMLElement>('.viewer-canvas')!
    const read = () => {
      const { position, target } = JSON.parse(canvas.dataset.reviewMotionCamera!) as { position: number[]; target: number[] }
      return position.map((value, i) => value - target[i]!)
    }
    return new Promise<{ before: number[]; after: number[] }>((resolve) => {
      const before = read()
      const observer = new MutationObserver(() => {
        observer.disconnect()
        resolve({ before, after: read() })
      })
      observer.observe(canvas, { attributeFilter: ['data-review-motion-camera'] })
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  })
  expect(angle(reduced.before, reduced.after)).toBeGreaterThan(.65)
  expect(angle(reduced.after, original)).toBeLessThan(.12)
  await testInfo.attach('reset-camera-orbit', { body: JSON.stringify({ sweep, samples, reduced }), contentType: 'application/json' })
})
