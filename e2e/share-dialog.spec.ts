import { expect, test } from '@playwright/test'

const exhibitUrl = 'https://leon-made-this.work/museum/zh-CN/animals/stegosaurus/'

test('shares the selected exhibit and exports its card', async ({ context, page }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
  })
  const response = await page.goto('./zh-CN/?animal=stegosaurus')
  expect(response?.ok()).toBe(true)

  const trigger = page.getByRole('button', { name: '分享剑龙' })
  await expect(trigger).toBeVisible()
  await trigger.click()

  const dialog = page.getByRole('dialog', { name: '分享这次发现' })
  await expect(dialog).toBeVisible()
  await testInfo.attach('desktop-share-dialog', { body: await page.screenshot(), contentType: 'image/png' })
  const xUrl = new URL((await dialog.getByRole('link', { name: /发到 X/ }).getAttribute('href'))!)
  const threadsUrl = new URL((await dialog.getByRole('link', { name: /发到 Threads/ }).getAttribute('href'))!)
  expect(xUrl.searchParams.get('url')).toBe(exhibitUrl)
  expect(threadsUrl.searchParams.get('url')).toBe(exhibitUrl)

  await dialog.getByRole('button', { name: /复制展项链接/ }).click()
  await expect(dialog.getByText('展项链接已复制')).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(exhibitUrl)

  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /保存图片/ }).click()
  const download = await downloadPromise
  const cardPath = testInfo.outputPath('stegosaurus-share-card.png')
  await download.saveAs(cardPath)
  await testInfo.attach('stegosaurus-share-card', { path: cardPath, contentType: 'image/png' })

  await dialog.getByRole('button', { name: '关闭' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
})
