import { expect, test, type Page } from '@playwright/test'

async function openGuide(page: Page) {
  const response = await page.goto('./zh-CN/')
  expect(response?.ok()).toBe(true)
  await expect(
    page.getByRole('heading', { level: 2, name: '剑龙' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '打开全馆图鉴' }).click()
  return page.getByRole('dialog', { name: '全馆图鉴' })
}

test('searches the guide by name and clears back to the elevator', async ({
  page,
}) => {
  const dialog = await openGuide(page)
  const search = dialog.getByRole('searchbox', { name: '搜索动物' })

  await search.fill('剑龙')
  await expect(dialog.getByRole('status')).toHaveText('找到 1 位朋友')
  await expect(dialog.locator('.collection-card')).toHaveCount(1)
  await expect(
    dialog.getByRole('button', { name: /前往剑龙展台/ }),
  ).toBeVisible()

  await dialog.getByRole('button', { name: '清除搜索' }).click()
  await expect(dialog.locator('.elevator-layout')).toBeVisible()
})

test('shows a friendly empty state for an unknown query', async ({ page }) => {
  const dialog = await openGuide(page)
  const search = dialog.getByRole('searchbox', { name: '搜索动物' })

  await search.fill('不存在的朋友')
  await expect(dialog.getByText('没有找到“不存在的朋友”')).toBeVisible()
  await expect(dialog.locator('.collection-card')).toHaveCount(0)

  await dialog.getByRole('button', { name: '清除搜索' }).last().click()
  await expect(dialog.locator('.collection-card').first()).toBeVisible()
})
