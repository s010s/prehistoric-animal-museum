import { expect, test, type Page } from '@playwright/test'

const nestedPath = '/prehistoric-animal-museum/'

async function openMuseum(
  page: Page,
  query = '',
  options: { waitForModel?: boolean } = {},
): Promise<void> {
  const response = await page.goto(`./zh-CN/${query}`)
  expect(response?.ok()).toBe(true)
  await expect(
    page.getByRole('heading', { level: 1, name: '史前动物博物馆' }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: '剑龙' })).toBeVisible()
  if (options.waitForModel !== false) {
    await expect(page.getByRole('button', { name: '专注看模型' })).toBeEnabled({
      timeout: 20_000,
    })
    await expect(page.locator('.viewer-canvas')).toBeVisible()
  }
}

async function switchToEnglish(page: Page): Promise<void> {
  await page.getByRole('button', { name: '切换语言，当前简体中文' }).click()
  await page.getByRole('menuitemradio', { name: 'English' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
}

test('loads from the nested static base with Chinese semantics and accessible tooltips', async ({
  page,
}) => {
  await openMuseum(page)

  expect(new URL(page.url()).pathname).toBe(`${nestedPath}zh-CN/`)
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')

  await expect(
    page.getByText('看看它背上的两排骨板，像不像一列起伏的小山？', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '听它的介绍' }),
  ).toBeEnabled()
  await expect(
    page.getByRole('link', { name: '查看剑龙' }),
  ).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('.viewer-canvas')).toHaveAttribute(
    'aria-label',
    '剑龙三维模型，可拖动旋转并缩放',
  )

  const reset = page.getByRole('button', { name: '恢复初始视角' })
  await reset.hover()
  const tooltipId = await reset.getAttribute('aria-describedby')
  expect(tooltipId).toBeTruthy()
  const tooltip = page.locator(`#${tooltipId ?? ''}`)
  await expect(tooltip).toHaveRole('tooltip')
  await expect(tooltip).toHaveText('恢复初始视角')
})

test('opens the creator story and lets a parent find source and licence links', async ({
  page,
}) => {
  await openMuseum(page)
  const trigger = page.getByRole('button', {
    name: '了解Leon做了个和这座博物馆',
  })
  await trigger.click()

  const dialog = page.getByRole('dialog', { name: '关于这座博物馆' })
  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByText('一个程序员爸爸，为女儿做的小博物馆'),
  ).toBeVisible()
  await expect(
    dialog.getByRole('link', { name: '在 GitHub 查看源码' }),
  ).toHaveAttribute(
    'href',
    'https://github.com/s010s/prehistoric-animal-museum',
  )
  await expect(
    dialog.getByRole('link', { name: '查看许可与素材说明' }),
  ).toHaveAttribute(
    'href',
    'https://github.com/s010s/prehistoric-animal-museum/blob/main/LICENSING.md',
  )

  await dialog.getByRole('button', { name: '关闭关于这座博物馆' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()

  await page.getByRole('button', { name: '给家长的资料' }).click()
  const parentDialog = page.getByRole('dialog', { name: '给家长的资料' })
  const disclosure = parentDialog.getByText('开源与许可')
  await disclosure.click()
  await expect(
    parentDialog.getByRole('link', { name: '查看 GitHub 项目' }),
  ).toHaveAttribute(
    'href',
    'https://github.com/s010s/prehistoric-animal-museum',
  )
  await expect(
    parentDialog.getByRole('link', { name: '查看完整许可说明' }),
  ).toHaveAttribute(
    'href',
    'https://github.com/s010s/prehistoric-animal-museum/blob/main/LICENSING.md',
  )
})

test('selects an animal from the full guide and shows loading and retry feedback', async ({
  page,
}) => {
  const viewport = { width: 390, height: 844 }
  await page.setViewportSize(viewport)
  await openMuseum(page, '?fixtures=1')

  await page.getByRole('button', { name: '打开全馆图鉴' }).click()
  let dialog = page.getByRole('dialog', { name: '全馆图鉴' })
  await dialog.getByRole('button', { name: '前往慢慢龙展台' }).click()

  const slowCard = page.locator(
    '.animal-card[data-animal-id="fixture-slow"]',
  )
  await expect(slowCard.locator('.card-status')).toBeVisible()
  await expect(slowCard.locator('.card-status')).toContainText(
    /正在请它出来|下载中|正在打开/,
  )

  await expect(page.getByRole('heading', { name: '慢慢龙' })).toBeVisible({
    timeout: 20_000,
  })
  await page.getByRole('button', { name: '打开全馆图鉴' }).click()
  dialog = page.getByRole('dialog', { name: '全馆图鉴' })
  await dialog.getByRole('button', { name: '前往再试龙展台' }).click()

  const retryCard = page.locator(
    '.animal-card[data-animal-id="fixture-retry"]',
  )
  await expect(retryCard.getByText('点我再试')).toBeVisible()
})

test('shows a distinct stage loader while the first animal is arriving', async ({
  page,
}) => {
  await page.route('**/*.glb', async (route) => {
    await new Promise((resolve) => {
      setTimeout(resolve, 850)
    })
    await route.continue()
  })

  await openMuseum(page, '', { waitForModel: false })
  const loader = page.locator('.stage-loading')

  await expect(loader).toBeVisible()
  await expect(page.locator('.model-still')).toBeVisible()
  await expect(
    page.getByRole('progressbar', { name: '3D 模型加载进度' }),
  ).toBeVisible()
  await expect(
    page.getByText(/正在下载 3D 模型 · \d+%/),
  ).toBeVisible({ timeout: 1_000 })
  await expect(loader).toHaveCount(0, { timeout: 20_000 })
  await expect(page.locator('.viewer-canvas')).toBeVisible()
})

test('keeps the fast selection when an uncancellable slow result arrives later', async ({
  page,
}) => {
  await openMuseum(page, '?fixtures=1')
  await page.getByRole('button', { name: '查看慢慢龙' }).click()
  await page.getByRole('button', { name: '查看快快龙' }).click()

  await expect(page.getByRole('heading', { name: '快快龙' })).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.locator('.viewer-canvas')).toHaveAttribute(
    'aria-label',
    '快快龙三维模型，可拖动旋转并缩放',
  )

  // The slow fixture ignores cancellation; wait for its late success before
  // checking that the chosen exhibit and its parent facts still agree.
  await page.waitForTimeout(1_400)
  await expect(page.getByRole('heading', { name: '快快龙' })).toBeVisible()
  await page.getByRole('button', { name: '给家长的资料' }).click()
  await expect(page.getByText('测试时期：快快龙', { exact: true })).toBeVisible()
  await expect(page.getByText('测试展区：快快龙', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭家长资料' }).click()
})

test('keeps the current exhibit on failure and succeeds when the visitor retries', async ({
  page,
}) => {
  await openMuseum(page, '?fixtures=1')
  const retryCard = page.getByRole('button', { name: '查看再试龙' })

  await retryCard.click()
  await expect(
    page.getByText('点我再试'),
  ).toBeVisible()
  await expect(retryCard).toHaveAccessibleName(
    '查看再试龙，加载失败，点击重试',
  )
  await expect(page.locator('p[role="status"]')).toContainText(
    '再试龙暂时没准备好，可以点击它的卡片重试。',
  )
  await expect(page.getByRole('heading', { name: '剑龙', exact: true })).toBeVisible()

  await retryCard.click()
  await expect(page.getByRole('heading', { name: '再试龙' })).toBeVisible({
    timeout: 20_000,
  })
  await expect(
    page.getByText('点我再试'),
  ).toHaveCount(0)
})

test('shows the poster for an initial model failure and succeeds on explicit retry', async ({
  page,
}) => {
  let firstModelRequest = true
  await page.route('**/*.glb', async (route) => {
    if (firstModelRequest) {
      firstModelRequest = false
      await route.fulfill({
        body: 'deterministic model request failure',
        contentType: 'text/plain',
        status: 503,
      })
      return
    }
    await route.continue()
  })
  await openMuseum(page, '', {
    waitForModel: false,
  })

  await expect(page.getByText('今天先看看它的静态模型吧')).toBeVisible()
  await expect(
    page.getByText('它暂时没准备好，再点一次试试。'),
  ).toBeVisible()
  await expect(page.getByAltText('剑龙的透明背景静态模型图')).toBeVisible()
  await expect(
    page.getByRole('button', { name: '专注看模型' }),
  ).toBeDisabled()

  await page.getByRole('button', { name: '重新加载模型' }).click()
  await expect(page.getByText('今天先看看它的静态模型吧')).toHaveCount(0, {
    timeout: 20_000,
  })
  await expect(
    page.getByRole('button', { name: '专注看模型' }),
  ).toBeEnabled()
})

test('keeps content, navigation, narration state, and parent facts in WebGL fallback', async ({
  page,
}) => {
  await page.addInitScript({
    content: `(() => {
      const originalGetContext = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (contextId, ...args) {
        if (contextId === 'webgl' || contextId === 'webgl2') {
          return null
        }
        return originalGetContext.call(this, contextId, ...args)
      }
    })()`,
  })
  await openMuseum(page, '', {
    waitForModel: false,
  })

  await expect(page.getByText('今天先看看它的静态模型吧')).toBeVisible()
  await expect(
    page.getByText('这个浏览器现在不能显示 3D 模型。'),
  ).toBeVisible()
  await expect(page.getByAltText('剑龙的透明背景静态模型图')).toBeVisible()
  await expect(
    page.getByRole('button', { name: '听它的介绍' }),
  ).toBeEnabled()
  await expect(
    page.getByRole('button', { name: '专注看模型' }),
  ).toBeDisabled()
  await expect(page.getByRole('region', { name: '动物选择' })).toBeVisible()

  await page.getByRole('button', { name: '重新加载模型' }).click()
  await expect(page.getByText('今天先看看它的静态模型吧')).toBeVisible()
  await expect(page.getByAltText('剑龙的透明背景静态模型图')).toBeVisible()
  await expect(
    page.getByRole('button', { name: '专注看模型' }),
  ).toBeDisabled()

  await page.getByRole('button', { name: '给家长的资料' }).click()
  await expect(
    page.getByRole('dialog', { name: '给家长的资料' }),
  ).toBeVisible()
  await expect(
    page
      .getByRole('dialog', { name: '给家长的资料' })
      .getByText('晚侏罗世', { exact: true }),
  ).toBeVisible()
})

test('keeps the narrow-touch data reminder and shows uncached large-model advice', async ({
  browser,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL
  if (typeof baseURL !== 'string') {
    throw new Error('The Playwright project must provide a baseURL')
  }
  const context = await browser.newContext({
    baseURL,
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
    viewport: { width: 390, height: 844 },
  })
  const page = await context.newPage()

  try {
    await openMuseum(page, '?fixtures=1')
    const notice = page.locator('.model-data-notice')
    await expect(notice).toContainText(
      '3D 动物会使用一些流量，连接 Wi‑Fi 时观看会更顺畅',
    )
    await expect(notice).toHaveAttribute('role', 'status')

    await page.getByRole('button', { name: '关闭模型流量提示' }).click()
    await expect(notice).toHaveCount(0)

    await page.getByRole('button', { name: '查看慢慢龙' }).click()
    await expect(notice).toContainText(
      '慢慢龙的 3D 模型约 9.0 MiB，第一次下载的数据量较大，加载可能会久一点',
      { timeout: 5_000 },
    )
    await expect(page.getByRole('heading', { name: '慢慢龙' })).toBeVisible({
      timeout: 20_000,
    })
    await expect(notice).toHaveCount(0)

    await page.getByRole('button', { name: '查看快快龙' }).click()
    await expect(page.getByRole('heading', { name: '快快龙' })).toBeVisible({
      timeout: 20_000,
    })
    await expect(notice).toHaveCount(0)

    await page.getByRole('button', { name: '查看慢慢龙' }).click()
    await expect(page.getByRole('heading', { name: '慢慢龙' })).toBeVisible({
      timeout: 20_000,
    })
    await expect(notice).toHaveCount(0)

    await page.reload()
    await page.waitForTimeout(1_500)
    await expect(notice).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '慢慢龙' })).toBeVisible({
      timeout: 20_000,
    })
    await expect(notice).toHaveCount(0)
  } finally {
    await context.close()
  }
})

const familyViewports = [
  { name: 'phone-390x844', width: 390, height: 844 },
  { name: 'desktop-wide-1280x720', width: 1280, height: 720 },
] as const

test.describe('required responsive viewports', () => {
  for (const viewport of familyViewports) {
    test(`${viewport.name} supports the animal rail, parent guide, and model focus`, async ({
      page,
    }) => {
      test.setTimeout(60_000)
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await openMuseum(page, '?fixtures=1')

      const lastCard = page.getByRole('button', { name: '查看再试龙' })
      await lastCard.scrollIntoViewIfNeeded()
      await expect(lastCard).toBeInViewport()
      await lastCard.focus()
      await expect(lastCard).toBeFocused()

      await page.getByRole('button', { name: '给家长的资料' }).click()
      await expect(page.getByRole('dialog', { name: '给家长的资料' })).toBeVisible()
      await page.getByRole('button', { name: '关闭家长资料' }).click()

      await page.getByRole('button', { name: '专注看模型' }).click()
      await expect(page.getByRole('button', { name: '退出模型专注模式' })).toBeVisible()
      await expect(page.getByRole('heading', { name: '剑龙' })).toHaveCount(0)
      await expect(page.getByRole('region', { name: '动物选择' })).toHaveCount(0)

      await page.keyboard.press('Escape')
      await expect(page.getByRole('heading', { name: '剑龙' })).toBeVisible()
      await expect(page.getByRole('region', { name: '动物选择' })).toBeVisible()
      await switchToEnglish(page)
      await expect(page.getByRole('heading', { name: 'Stegosaurus' })).toBeVisible()
    })
  }
})
