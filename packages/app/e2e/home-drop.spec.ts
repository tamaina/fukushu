import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

for (const name of ['sample.gift', 'sample.tsv', 'unsupported.pdf']) {
  test(`home drop passes ${name} to the import screen`, async ({ page }) => {
    await page.goto('/')
    const zone = page.locator('.home-import-drop')
    const transfer = await page.evaluateHandle((name) => {
      const data = new DataTransfer()
      data.items.add(new File([name.endsWith('.tsv') ? '問題\t解答' : '問題 {TRUE}'], name))
      return data
    }, name)
    await zone.dispatchEvent('dragenter', { dataTransfer: transfer })
    await expect(zone).toHaveClass(/dragging/)
    await zone.getByRole('heading').dispatchEvent('dragenter', { dataTransfer: transfer })
    await zone.getByRole('heading').dispatchEvent('dragleave', { dataTransfer: transfer })
    await expect(zone).toHaveClass(/dragging/)
    await zone.dispatchEvent('drop', { dataTransfer: transfer })
    await expect(page).toHaveURL(/\/import$/)
    if (name.endsWith('.pdf')) {
      await expect(page.getByRole('alert')).toContainText('ファイルを選択してください')
    } else {
      await expect(page.getByRole('button', { name: '問題集として保存' })).toBeEnabled()
      await page.getByRole('button', { name: '問題集として保存' }).click()
      await expect(page).toHaveURL(/\/decks\//)
    }
    await page.goto('/import')
    await expect(page.locator('input[type=file]')).toBeVisible()
    await expect(page.getByRole('button', { name: '問題集として保存' })).toHaveCount(0)
  })
}
