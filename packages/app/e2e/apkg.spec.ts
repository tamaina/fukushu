import { expect, test, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { strToU8, zipSync } from 'fflate'

async function records(page: Page, store: string) {
  return page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('gift-fsrs-learning')
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    try {
      return await new Promise<unknown[]>((resolve, reject) => {
        const r = db.transaction(name).objectStore(name).getAll()
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      })
    } finally {
      db.close()
    }
  }, store)
}
test('official 21b: preview, progress, repeat import, backup and offline', async ({
  page,
  context,
}) => {
  await page.goto('/import')
  await page
    .locator('input[type=file]')
    .setInputFiles('../anki-import/tests/fixtures/official-21b.apkg')
  await expect(page.getByRole('heading', { name: 'APKGプレビュー' })).toBeVisible()
  await page.getByLabel('プレビューするdeck').selectOption({ label: 'APKG英語' })
  await expect(page.frameLocator('iframe').first().locator('img')).toHaveJSProperty(
    'naturalWidth',
    1,
  )
  await expect(page.frameLocator('iframe').first().locator('audio')).toHaveAttribute(
    'src',
    /^blob:/,
  )
  await page.getByLabel('プレビューするdeck').selectOption({ label: 'APKG日本史' })
  await page.getByLabel('カード', { exact: true }).selectOption({ label: '3' })
  await expect(page.frameLocator('iframe').first().getByText('独自カード')).toBeVisible()
  await page.getByRole('button', { name: '問題集として保存' }).click()
  await expect(page).toHaveURL('/decks')
  expect(await records(page, 'reviewLogs')).toHaveLength(36)
  await page.goto('/import')
  await page
    .locator('input[type=file]')
    .setInputFiles('../anki-import/tests/fixtures/official-updated.apkg')
  await expect(page.getByLabel('取込先')).toHaveValue('')
  const candidate = page.getByLabel('取込先').locator('option').filter({ hasText: 'を更新' })
  await expect(candidate).toHaveCount(1)
  await page.getByLabel('取込先').selectOption({ label: (await candidate.textContent())! })
  await page.getByLabel('Ankiの学習履歴を取り込む').uncheck()
  await page.getByRole('button', { name: '問題集として保存' }).click()
  await expect(page).toHaveURL('/decks')
  await expect(page.getByRole('link', { name: /APKG語彙/ })).toHaveCount(1)
  expect(await records(page, 'reviewLogs')).toHaveLength(36)
  const before = await records(page, 'questions')
  await page.goto('/import')
  await page
    .locator('input[type=file]')
    .setInputFiles('../anki-import/tests/fixtures/official-updated.apkg')
  await expect(page.getByLabel('取込先')).not.toHaveValue('')
  await page.getByLabel('Ankiの学習履歴を取り込む').uncheck()
  await page.getByRole('button', { name: '問題集として保存' }).click()
  await expect(page).toHaveURL('/decks')
  expect(await records(page, 'questions')).toHaveLength(before.length)
  expect(await records(page, 'reviewLogs')).toHaveLength(36)
  await page.goto('/settings')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'JSONを保存' }).click()
  const path = test.info().outputPath('apkg.json')
  await (await download).saveAs(path)
  await Promise.all([
    page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame()),
    page.locator('input[type=file][accept*="json"]').setInputFiles(path),
  ])
  await expect(page.getByRole('heading', { name: '設定' })).toBeVisible()
  expect(await records(page, 'reviewLogs')).toHaveLength(36)
  expect(await records(page, 'media')).toHaveLength(2)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: '設定' })).toBeVisible()
  await context.setOffline(true)
  await page.goto('/import')
  await page
    .locator('input[type=file]')
    .setInputFiles('../anki-import/tests/fixtures/official-21b.apkg')
  await expect(page.getByRole('heading', { name: 'APKGプレビュー' })).toBeVisible()
  await context.setOffline(false)
})

test('progress off starts fresh and imported cards can be studied', async ({ page }) => {
  await page.goto('/import')
  await page
    .locator('input[type=file]')
    .setInputFiles('../anki-import/tests/fixtures/official-21b.apkg')
  await page.getByLabel('Ankiの学習履歴を取り込む').uncheck()
  await page.getByRole('button', { name: '問題集として保存' }).click()
  await expect(page).toHaveURL('/decks')
  expect(await records(page, 'reviewLogs')).toHaveLength(0)
  await page.getByRole('link', { name: /APKG英語/ }).click()
  await page.getByRole('link', { name: 'この問題集を学習' }).click()
  await expect(page.getByRole('button', { name: '答えを見る' })).toBeVisible()
  const typedAnswer = page.getByRole('textbox', { name: '解答', exact: true })
  if (await typedAnswer.count()) await typedAnswer.fill('東京')
  await page.getByRole('button', { name: '答えを見る' }).click()
  await page.getByRole('button', { name: 'わかった', exact: true }).click()
  await expect.poll(async () => (await records(page, 'reviewLogs')).length).toBe(1)
})

test('untrusted HTML and CSS cannot affect the host or make requests', async ({ page }) => {
  const SQL = await initSqlJs({
    locateFile: () => createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm'),
  })
  const db = new SQL.Database()
  db.run(
    'create table col(ver integer,models text,decks text);create table notes(id integer,guid text,mid integer,flds text,tags text);create table cards(id integer,nid integer,did integer,ord integer);create table revlog(id integer,cid integer,ease integer,type integer)',
  )
  const css =
    '.card{color:rgb(12,34,56)}@import "https://trap.invalid/a";div{background:u\\72l(https://trap.invalid/b)}'
  const attack =
    '<div><style>body{display:none!important}</style><img src="https://trap.invalid/img" srcset="https://trap.invalid/set 2x" onerror="alert(1)"><iframe src="https://trap.invalid/frame"></iframe><script>top.document.body.remove()</script>{{Front}}</div>'
  db.run('insert into col values(11,?,?)', [
    JSON.stringify({
      1: {
        name: 'Custom',
        css,
        flds: [{ name: 'Front' }, { name: 'Back' }],
        tmpls: [{ ord: 0, qfmt: attack, afmt: '{{Back}}' }],
      },
    }),
    JSON.stringify({ 1: { name: '安全性' } }),
  ])
  db.run('insert into notes values(1,"guid",1,?," ")', ['visible text<img src="flag.svg">'])
  db.run('insert into cards values(1,1,1,0)')
  const bytes = zipSync({
    'collection.anki21': db.export(),
    media: strToU8('{"0":"flag.svg"}'),
    0: strToU8(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="20" onload="alert(1)"><rect width="32" height="20" fill="red"/><script>fetch("https://trap.invalid/svg")</script><foreignObject><iframe src="https://trap.invalid/frame"/></foreignObject><image href="https://trap.invalid/image"/></svg>',
    ),
  })
  db.close()
  const external: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('trap.invalid')) external.push(request.url())
  })
  await page.goto('/import')
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'attack.apkg', mimeType: 'application/zip', buffer: Buffer.from(bytes) })
  await expect(page.frameLocator('iframe').first().getByText('visible text')).toBeVisible()
  await expect(page.frameLocator('iframe').first().locator('img[src^="blob:"]')).toHaveJSProperty(
    'naturalWidth',
    32,
  )
  await expect(page.getByRole('heading', { name: '問題集を読み込む' })).toBeVisible()
  await expect(page.locator('iframe').first()).toHaveAttribute('sandbox', 'allow-same-origin')
  expect(await page.locator('body').evaluate((el) => getComputedStyle(el).display)).not.toBe('none')
  expect(
    await page
      .frameLocator('iframe')
      .first()
      .locator('body')
      .evaluate((el) => getComputedStyle(el).color),
  ).toBe('rgb(12, 34, 56)')
  expect(external).toEqual([])
})
