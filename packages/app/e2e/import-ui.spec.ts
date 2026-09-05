import { expect, test } from '@playwright/test'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { strToU8, zipSync } from 'fflate'

test.use({ serviceWorkers: 'block' })
test('analysis replaces inputs, cancellation returns to input, and results hide the picker', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const NativeWorker = Worker
    window.Worker = class extends NativeWorker {
      postMessage() {
        sessionStorage.setItem('analysis-started', 'yes')
      }
      terminate() {
        sessionStorage.setItem('analysis-terminated', 'yes')
        super.terminate()
      }
    }
  })
  await page.goto('/import')
  await page
    .locator('input[type=file]')
    .setInputFiles('../anki-import/tests/fixtures/official-21b.apkg')
  await expect(page.getByRole('heading', { name: '解析中…' })).toBeVisible()
  await expect(page.locator('textarea')).toHaveCount(0)
  await expect(page.locator('input[type=file]')).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('analysis-started')))
    .toBe('yes')
  await page.screenshot({ path: test.info().outputPath('analysis.png'), fullPage: true })
  await page.getByRole('button', { name: '解析をキャンセル' }).click()
  expect(await page.evaluate(() => sessionStorage.getItem('analysis-terminated'))).toBe('yes')
  await expect(page.locator('input[type=file]')).toHaveCount(1)
  await page.getByLabel('形式').selectOption('gift')
  await page.getByLabel('GIFTテキスト').fill('問題 {TRUE}')
  await page.getByRole('button', { name: '解析する', exact: true }).click()
  await expect(page.getByText('1 問を読み込みます。')).toBeVisible()
  await expect(page.locator('input[type=file]')).toHaveCount(0)
  await page.getByRole('button', { name: '入力・ファイルを変更' }).click()
  await expect(page.getByLabel('GIFTテキスト')).toHaveValue('問題 {TRUE}')
})

test('diagnostics identify cards and simple HTML can be imported without an iframe', async ({
  page,
}) => {
  const SQL = await initSqlJs({
    locateFile: () => createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm'),
  })
  const db = new SQL.Database()
  db.run(
    'create table col(ver integer,models text,decks text);create table notes(id integer,guid text,mid integer,flds text,tags text);create table cards(id integer,nid integer,did integer,ord integer);create table revlog(id integer,cid integer,ease integer,type integer)',
  )
  db.run('insert into col values(11,?,?)', [
    JSON.stringify({
      1: {
        name: 'Simple',
        flds: [{ name: 'Front' }, { name: 'Back' }],
        tmpls: [
          {
            ord: 0,
            qfmt: '<div>{{Front}}</div><script>bad()</script>',
            afmt: '<p>{{Front}}</p><hr><p><b>{{Back}}</b></p><script>bad()</script>',
          },
        ],
        css: '.card{color:red}',
      },
    }),
    JSON.stringify({
      1: { name: 'Default' },
      2: { name: 'ほかの空デッキ' },
      3: { name: '日本史' },
    }),
  ])
  db.run('insert into notes values(1,"guid",1,?,"");', ['鎌倉幕府\x1f1192年'])
  db.run('insert into cards values(1,1,3,0)')
  const buffer = Buffer.from(zipSync({ 'collection.anki21': db.export(), media: strToU8('{}') }))
  db.close()
  await page.goto('/import')
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'simple.apkg', mimeType: 'application/zip', buffer })
  await expect(page.getByRole('heading', { name: 'APKGプレビュー' })).toBeVisible()
  await expect(page.locator('input[type=file]')).toHaveCount(0)
  await expect(page.getByLabel('プレビューするdeck').locator('option')).toHaveCount(1)
  const warnings = page.getByRole('region', { name: '診断' })
  await expect(warnings.locator('details')).toHaveCount(1)
  await warnings.locator('summary').click()
  await expect(warnings.getByText('日本史')).toBeVisible()
  await expect(warnings.getByText('鎌倉幕府', { exact: false })).toBeVisible()
  await warnings.getByRole('link', { name: 'この問題を確認' }).click()
  await expect(page.getByLabel(/シンプルなカードを通常表示に変換/)).toBeChecked()
  await expect(page.locator('iframe')).toHaveCount(0)
  await page.getByLabel(/シンプルなカードを通常表示に変換/).uncheck()
  await expect(page.frameLocator('iframe').first().getByText('鎌倉幕府')).toBeVisible()
  await page.getByLabel(/シンプルなカードを通常表示に変換/).check()
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect(page.locator('#apkg-card-preview strong')).toHaveText('1192年')
  const spacing = await page.locator('#apkg-card-preview .markdown-content').evaluate((el) => {
    const paragraphs = el.querySelectorAll('p'),
      rule = el.querySelector('hr')!
    return {
      before: rule.getBoundingClientRect().top - paragraphs[0]!.getBoundingClientRect().bottom,
      after: paragraphs[1]!.getBoundingClientRect().top - rule.getBoundingClientRect().bottom,
      lineHeight: parseFloat(getComputedStyle(el).lineHeight),
      whiteSpace: getComputedStyle(el).whiteSpace,
    }
  })
  expect(spacing.whiteSpace).toBe('normal')
  expect(spacing.before).toBeLessThan(spacing.lineHeight)
  expect(spacing.after).toBeLessThan(spacing.lineHeight)
  await page.screenshot({ path: test.info().outputPath('review.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: test.info().outputPath('review-mobile-dark.png'), fullPage: true })
  await page.getByRole('button', { name: '問題集として保存' }).click()
  await expect(page).toHaveURL(/\/decks\//)
  const formats = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('gift-fsrs-learning')
      r.onsuccess = () => resolve(r.result)
    })
    return new Promise<string[]>((resolve) => {
      const r = db.transaction('questions').objectStore('questions').getAll()
      r.onsuccess = () => {
        resolve(r.result.map((q) => q.payload.answer.format))
        db.close()
      }
    })
  })
  expect(formats).toEqual(['markdown'])
})
