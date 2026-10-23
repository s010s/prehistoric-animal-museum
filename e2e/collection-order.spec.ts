import { expect, test } from '@playwright/test'
import { mainCollection } from '../src/content/collections/main'
import { releaseCandidateAnimalIds } from '../src/content/release-candidate'
const originalAnimalIds = [
  'stegosaurus',
  'pteranodon',
  'pachycephalosaurus',
  'ichthyosaur',
  'tyrannosaurus-rex',
  'rhamphorhynchus',
  'triceratops',
  'apatosaurus',
  'plesiosaurus',
  'gigantoraptor',
  'tupandactylus',
  'mammoth',
  'megalodon',
  'maiasaura',
  'sauropelta',
  'meganeura',
  'dilophosaurus',
  'mosasaurus',
  'spinosaurus',
  'lystrosaurus',
  'baryonyx',
  'archaeopteryx',
  'carnotaurus',
  'anomalocaris'
]


for (const locale of ['zh-CN', 'en'] as const) {
  test(`${locale} mixes the twelve additions and keeps Stegosaurus first`, async ({ page }, testInfo) => {
    await page.goto(`./${locale}/`)
    const museum = page.locator('#museum-experience')
    await expect(museum).toHaveAttribute('data-ready-animal-id', 'stegosaurus', { timeout: 20_000 })
    const cards = page.locator('.animal-card[data-animal-id]')
    await expect(cards).toHaveCount(36)
    const order = await cards.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-animal-id')!))
    const additions = new Set<string>(releaseCandidateAnimalIds)
    const positions = order.flatMap((id, index) => additions.has(id) ? [index] : [])
    expect(order[0]).toBe('stegosaurus')
    expect(new Set(order).size).toBe(36)
    expect(order.filter((id) => !additions.has(id))).toEqual(originalAnimalIds)
    expect(order.filter((id) => additions.has(id)).sort()).toEqual([...additions].sort())
    expect(positions[0]).toBeLessThan(6)
    expect(positions.at(-1)).toBeGreaterThan(30)
    for (let index = 1; index < positions.length; index++) {
      expect(positions[index] - positions[index - 1]).toBeGreaterThan(1)
      expect(positions[index] - positions[index - 1]).toBeLessThanOrEqual(4)
    }
    await page.reload()
    await expect(cards).toHaveCount(36)
    expect(await cards.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-animal-id')))).toEqual(order)
    await expect(museum).toHaveAttribute('data-ready-animal-id', 'stegosaurus', { timeout: 20_000 })
    await page.getByRole('button', { name: locale === 'zh-CN' ? '上一只动物' : 'Previous animal', exact: true }).click()
    await expect(museum).toHaveAttribute('data-ready-animal-id', order.at(-1)!, { timeout: 20_000 })
    await page.getByRole('button', { name: locale === 'zh-CN' ? '下一只动物' : 'Next animal', exact: true }).click()
    await expect(museum).toHaveAttribute('data-ready-animal-id', 'stegosaurus', { timeout: 20_000 })
    expect(order).toEqual(mainCollection.animalIds)
    await testInfo.attach('collection-order.json', { body: JSON.stringify({ locale, order, additionPositions: positions.map((index) => index + 1) }, null, 2), contentType: 'application/json' })
    await testInfo.attach('collection-order.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  })
}
