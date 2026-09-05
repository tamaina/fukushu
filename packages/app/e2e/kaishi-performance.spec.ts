import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'

test('Kaishi: bounded previews, deck navigation and study startup', async ({ page }) => {
  test.skip(!process.env.ANKI_PERF_FILE, 'Opt-in real APKG performance check')
  test.setTimeout(180000)
  const timings: Record<string, number> = {}
  await page.goto('/import')
  let start = Date.now()
  await page.locator('input[type=file]').setInputFiles(resolve(process.env.ANKI_PERF_FILE!))
  await expect(page.getByRole('button', { name: '問題集として保存' })).toBeEnabled({
    timeout: 90000,
  })
  timings.analysisMs = Date.now() - start
  start = Date.now()
  await page.getByRole('button', { name: '問題集として保存' }).click()
  await expect(page).toHaveURL(/\/decks\/[^/]+$/, { timeout: 60000 })
  await expect(page.locator('.question-list > li')).toHaveCount(50)
  timings.saveAndDetailMs = Date.now() - start
  await expect(page.locator('iframe')).toHaveCount(0)
  const deckId = page.url().split('/').at(-1)!
  await page.locator('.preview-trigger').first().click()
  await expect(page.locator('dialog[open]')).toBeVisible()
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  await expect(page.locator('iframe')).toHaveCount(0)
  await page.getByRole('button', { name: '次へ', exact: true }).click()
  await expect(page.locator('.question-list > li')).toHaveCount(50)
  start = Date.now()
  await page.goto('/decks')
  await expect(page.getByRole('link', { name: /Kaishi 1.5k/ })).toBeVisible()
  timings.decksMs = Date.now() - start
  start = Date.now()
  await page.goto(`/study?deck=${deckId}`)
  await expect(page.getByRole('button', { name: '答えを見る', exact: true })).toBeVisible()
  timings.studyMs = Date.now() - start
  expect(await page.locator('iframe').count()).toBeLessThanOrEqual(2)
  const session = await page.context().newCDPSession(page)
  const heap = await session.send('Runtime.getHeapUsage')
  timings.jsHeapMiB = heap.usedSize / 1024 ** 2
  await test.info().attach('performance', {
    body: JSON.stringify(timings, null, 2),
    contentType: 'application/json',
  })
  console.log(JSON.stringify(timings))
})
