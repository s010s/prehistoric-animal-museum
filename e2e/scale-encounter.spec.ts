import { expect, test } from '@playwright/test'

test('mobile tyrannosaurus-rex enters the child’s view and returns to the exhibit', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ height: 844, width: 390 })
  const response = await page.goto('./zh-CN/?animal=tyrannosaurus-rex')
  expect(response?.ok()).toBe(true)
  const trigger = page.getByRole('button', { name: '打开和霸王龙比一比' })
  await expect(trigger).toBeEnabled({ timeout: 30_000 })
  await trigger.click()

  const dialog = page.getByRole('dialog', { name: '和霸王龙比一比' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('radio', { name: /男孩/ }).check({ force: true })
  await dialog.getByRole('button', { name: '进入比一比' }).click()
  await expect(dialog.getByText('想象相遇', { exact: true })).toBeVisible()
  const childView = dialog.getByRole('button', { name: '从我的眼睛看' })
  await expect(childView).toBeVisible({ timeout: 30_000 })

  const playbackSettings = dialog.getByRole('button', {
    name: '打开声音与文字设置',
  })
  await playbackSettings.click()
  await dialog.getByRole('button', { name: '开关讲解旁白' }).click()
  await playbackSettings.click()
  await childView.click()
  await expect(dialog.getByRole('button', { name: '退后看全身' })).toBeVisible({
    timeout: 15_000,
  })

  await page.goBack()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('heading', { name: '霸王龙', exact: true })).toBeVisible()
  await expect(trigger).toBeFocused()
})
