import { test, expect, chromium, type Page } from '@playwright/test'
import { createReadStream } from 'node:fs'
import { stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import process from 'node:process'

async function digest(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
async function counts(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('gift-fsrs-learning')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const names = [
        'decks',
        'questions',
        'studyStates',
        'reviewLogs',
        'importSources',
        'media',
        'imports',
      ]
      const tx = db.transaction(names)
      return Object.fromEntries(
        await Promise.all(
          names.map(async (name) => {
            const request = tx.objectStore(name).count()
            const count = await new Promise<number>((resolve, reject) => {
              request.onsuccess = () => resolve(request.result)
              request.onerror = () => reject(request.error)
            })
            return [name, count]
          }),
        ),
      )
    } finally {
      db.close()
    }
  })
}
async function installReadGuard(page: Page) {
  const guard = () => {
    const original = Blob.prototype.arrayBuffer
    Blob.prototype.arrayBuffer = function () {
      if (this.size > 4 * 1024 ** 2) throw new Error('Unbounded backup binary read')
      return original.call(this)
    }
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      let request: IDBRequest
      try {
        request = put.call(this, value, key)
      } catch (error) {
        console.log('BACKUP_WRITE_ERROR', this.name, String(error))
        throw error
      }
      const name = this.name
      request.addEventListener('error', () =>
        console.log('BACKUP_WRITE_ERROR', name, request.error?.name),
      )
      return request
    }
  }
  await page.addInitScript(guard)
  await page.evaluate(guard)
}
async function download(page: Page, path: string) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'バックアップを保存' }).click()
  await (await pending).saveAs(path)
  await expect(page.getByRole('button', { name: 'バックアップを保存' })).toBeEnabled()
}

test('large backup survives download, full deletion, restore and byte-identical re-export', async ({}, info) => {
  test.skip(
    !process.env.ANKI_BACKUP_FILE && !process.env.BACKUP_SYNTHETIC_MIB,
    'Opt-in large data validation',
  )
  test.setTimeout(300_000)
  const context = await chromium.launchPersistentContext(info.outputPath('browser-profile'), {
    headless: true,
    baseURL: `http://127.0.0.1:${process.env.E2E_PORT ?? 4173}`,
    locale: 'ja-JP',
  })
  const page = await context.newPage()
  try {
    const errors: string[] = []
    page.on('console', (message) => {
      if (message.text().startsWith('BACKUP_WRITE_ERROR')) console.log(message.text())
    })
    page.on('pageerror', (error) => {
      errors.push(error.message)
      console.error(error.message)
    })
    await page.goto('/import')
    await page
      .locator('input[type=file]')
      .setInputFiles(
        process.env.ANKI_BACKUP_FILE ?? '../anki-import/tests/fixtures/official-21b.apkg',
      )
    await expect(page.getByRole('heading', { name: 'APKGプレビュー' })).toBeVisible({
      timeout: 90_000,
    })
    await page.getByRole('button', { name: '問題集として保存' }).click()
    await expect(page).toHaveURL(/\/decks(?:\/|$)/, { timeout: 90_000 })
    const syntheticMiB = Number(process.env.BACKUP_SYNTHETIC_MIB ?? 0)
    if (syntheticMiB)
      await page.evaluate(async (mib) => {
        const request = indexedDB.open('gift-fsrs-learning')
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const block = new Uint8Array(1024 ** 2).fill(173)
        const blob = new Blob(Array.from({ length: mib }, () => block))
        const tx = db.transaction('importSources', 'readwrite')
        const now = new Date().toISOString()
        tx.objectStore('importSources').put({
          id: 'synthetic-source',
          sourceType: 'anki-package',
          sourceHash: 'synthetic',
          sourceFileName: 'synthetic.bin',
          revision: 1,
          sourceArchive: blob,
          importedAt: now,
          updatedAt: now,
        })
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        })
        db.close()
      }, syntheticMiB)
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: '設定' })).toBeVisible()
    await installReadGuard(page)
    const storageBefore = await page.evaluate(() => navigator.storage.estimate())
    console.log('Storage before export', JSON.stringify(storageBefore))
    const expectedCounts = await counts(page)
    const first = info.outputPath('first.fukushu')
    let start = Date.now()
    await download(page, first)
    const exportMs = Date.now() - start
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'すべて削除' }).click()
    await expect(page).toHaveURL('/')
    await page.goto('/settings')
    expect((await counts(page)).questions).toBe(0)
    console.log(
      'Storage after deletion',
      JSON.stringify(await page.evaluate(() => navigator.storage.estimate())),
    )
    await installReadGuard(page)
    start = Date.now()
    await Promise.all([
      page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame()),
      page.locator('input[type=file][accept*="json"]').setInputFiles(first),
    ])
    await expect(page.getByRole('heading', { name: '設定' })).toBeVisible()
    await expect
      .poll(
        async () => {
          try {
            return await counts(page)
          } catch (error) {
            if (error instanceof Error && error.message.includes('Execution context was destroyed'))
              return null
            throw error
          }
        },
        { timeout: 120_000 },
      )
      .toEqual(expectedCounts)
    await expect(page.getByRole('button', { name: 'バックアップを保存' })).toBeEnabled()
    const restoreMs = Date.now() - start
    await installReadGuard(page)
    const second = info.outputPath('second.fukushu')
    await download(page, second)
    expect(await digest(second)).toBe(await digest(first))
    expect(errors).toEqual([])
    const result = {
      source: process.env.ANKI_BACKUP_FILE ?? 'official fixture + synthetic binary',
      syntheticMiB,
      browserProfile: 'persistent',
      counts: expectedCounts,
      storageBefore,
      bytes: (await stat(first)).size,
      exportMs,
      restoreMs,
      sha256: await digest(first),
      maxBinaryReadBytes: 4 * 1024 ** 2,
    }
    await writeFile(info.outputPath('measurement.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result))
  } finally {
    await context.close()
  }
})
