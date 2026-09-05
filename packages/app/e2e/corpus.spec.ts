import { expect, test } from '@playwright/test'
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const directory = process.env.ANKI_CORPUS_DIR ? resolve(process.env.ANKI_CORPUS_DIR) : undefined
const ids = process.env.ANKI_CORPUS_FILES?.split(',')
const files = directory
  ? readdirSync(directory).filter(
      (f) => f.endsWith('.apkg') && (!ids || ids.includes(f.replace('.apkg', ''))),
    )
  : []
test.skip(!directory, 'Opt-in public corpus; no network download is performed by tests')
for (const file of files)
  test(`public ${file}`, async ({ page }) => {
    test.setTimeout(180000)
    const id = file.replace('.apkg', ''),
      source = JSON.parse(readFileSync(resolve(directory!, `${id}.json`), 'utf8'))
    const report: Record<string, unknown> = { id, sha256: source.sha256, samples: [] }
    const external: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.protocol.startsWith('http') && !['127.0.0.1', 'localhost'].includes(url.hostname))
        external.push(url.origin)
    })
    try {
      if (source.bytes > 256 * 1024 ** 2) {
        report.status = 'capacity-excluded'
        return
      }
      const parsed = JSON.parse(readFileSync(resolve(directory!, 'reports', `${id}.json`), 'utf8'))
      await page.goto('/import')
      await page.locator('input[type=file]').setInputFiles(resolve(directory!, file))
      await expect(page.locator('.apkg-result, [role=alert]').first()).toBeVisible({
        timeout: 90000,
      })
      if (!(await page.locator('.apkg-result').count())) {
        report.status = 'import-error'
        report.error = await page.getByRole('alert').textContent()
        return
      }
      const save = page.getByRole('button', { name: '問題集として保存' })
      report.saveEnabled = await save.isEnabled()
      if (!report.saveEnabled) {
        report.status = 'blocked-diagnostics'
        expect.soft(report.saveEnabled).toBe(true)
        return
      }
      const oracle = JSON.parse(readFileSync(resolve(directory!, `${id}.oracle.json`), 'utf8'))
      const candidates = parsed.samples as {
        id: string
        key: string
        deckIndex: number
        cardIndex: number
      }[]
      const selected = [] as typeof candidates
      for (const feature of [
        'svg-image',
        'type-answer',
        'mathjax',
        'latex',
        'raster-image',
        'sound',
        'code',
        'cloze',
      ]) {
        const sample = candidates.find((c) => {
          const s = oracle.samples.find((s: { id: string }) => s.id === c.id)
          return (feature === 'latex' ? s?.features : s?.renderFeatures)?.includes(feature)
        })
        if (sample && !selected.includes(sample)) selected.push(sample)
      }
      if (candidates[0] && !selected.includes(candidates[0])) selected.push(candidates[0])
      for (const sample of selected.slice(0, 5)) {
        const previous = await page.locator('#apkg-card-preview').innerHTML()
        const oldDeck = await page.getByLabel('プレビューするdeck').inputValue(),
          oldCard = await page.getByLabel('カード', { exact: true }).inputValue()
        await page
          .getByLabel('プレビューするdeck')
          .selectOption({ value: String(sample.deckIndex) })
        await page
          .getByLabel('カード', { exact: true })
          .selectOption({ value: String(sample.cardIndex) })
        if (oldDeck !== String(sample.deckIndex) || oldCard !== String(sample.cardIndex))
          await expect.poll(() => page.locator('#apkg-card-preview').innerHTML()).not.toBe(previous)
        await expect
          .poll(() =>
            page.locator('#apkg-card-preview iframe').evaluateAll((frames) =>
              frames.every((node) => {
                const f = node as HTMLIFrameElement
                return (
                  !!f.srcdoc &&
                  f.contentDocument?.readyState === 'complete' &&
                  f.contentDocument.body.innerHTML ===
                    new DOMParser().parseFromString(f.srcdoc, 'text/html').body.innerHTML
                )
              }),
            ),
          )
          .toBe(true)
        const inspection = await page.locator('#apkg-card-preview').evaluate((root) => {
          const roots: Element[] = [
            root,
            ...[...root.querySelectorAll('iframe')].flatMap((f) =>
              f.contentDocument?.body ? [f.contentDocument.body] : [],
            ),
          ]
          const images = roots
            .flatMap((r) => [...r.querySelectorAll('img')])
            .map((img) => ({
              internal: img.src.startsWith('blob:') || img.src.startsWith('data:'),
              loaded: img.complete && img.naturalWidth > 0,
            }))
          const text = roots
            .map((r) => {
              const clone = r.cloneNode(true) as Element
              clone.querySelectorAll('pre,code,script,style').forEach((e) => e.remove())
              return clone.textContent ?? ''
            })
            .join('')
          return {
            images,
            rawMath:
              /\\[\[(]|\[latex\]|\[\$\]/.test(text) ||
              roots.some((r) =>
                [...r.querySelectorAll('.katex annotation')].some((a) =>
                  /^\].*\[\/$/s.test(a.textContent ?? ''),
                ),
              ),
            katex: roots.reduce((n, r) => n + r.querySelectorAll('.katex').length, 0),
            audio: roots.reduce((n, r) => n + r.querySelectorAll('audio').length, 0),
          }
        })
        const reference = oracle.samples.find((s: { id: string }) => s.id === sample.id)
        const typedField = /\[\[type:([^\]]+)\]\]/.exec(reference.front)?.[1]
        const typedAnswerVisible =
          !typedField ||
          (await page.locator('#apkg-card-preview .preview-answer').evaluate((root, expected) => {
            const plain =
              new DOMParser()
                .parseFromString(expected, 'text/html')
                .body.textContent?.replace(/\[sound:[^\]]+\]/g, '')
                .trim() ?? ''
            const text =
              (root.textContent ?? '') +
              [...root.querySelectorAll('iframe')]
                .map((f) => f.contentDocument?.body.textContent ?? '')
                .join('')
            return !!plain && text.includes(plain)
          }, reference.fields[typedField]))
        ;(report.samples as unknown[]).push({ id: sample.id, ...inspection, typedAnswerVisible })
        expect.soft(typedAnswerVisible).toBe(true)
        expect.soft(inspection.images.every((image) => image.internal && image.loaded)).toBe(true)
        expect.soft(inspection.rawMath).toBe(false)
        await page
          .locator('#apkg-card-preview')
          .screenshot({ path: test.info().outputPath(`${sample.id}.png`) })
      }
      await save.click()
      await expect
        .poll(
          async () =>
            /\/decks(?:\/|$)/.test(page.url()) || (await page.getByRole('alert').count()) > 0,
          { timeout: 60000 },
        )
        .toBe(true)
      if (!/\/decks(?:\/|$)/.test(page.url())) {
        report.status = 'save-error'
        report.error = await page.getByRole('alert').allTextContents()
        expect.soft(report.status).toBe('saved')
        return
      }
      report.saved = true
      const stored = await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => {
          const r = indexedDB.open('gift-fsrs-learning')
          r.onsuccess = () => resolve(r.result)
        })
        const counts: Record<string, number> = {}
        for (const store of ['questions', 'studyStates', 'media'])
          counts[store] = await new Promise<number>((resolve) => {
            const r = db.transaction(store).objectStore(store).count()
            r.onsuccess = () => resolve(r.result)
          })
        db.close()
        return counts
      })
      report.stored = stored
      expect.soft(stored.questions).toBe(parsed.outputCards)
      if (['coding-combined', 'probability'].includes(id)) {
        const identities = async () =>
          page.evaluate(async () => {
            const db = await new Promise<IDBDatabase>((resolve) => {
              const r = indexedDB.open('gift-fsrs-learning')
              r.onsuccess = () => resolve(r.result)
            })
            const result = await new Promise<string>((resolve) => {
              const r = db.transaction('questions').objectStore('questions').getAll()
              r.onsuccess = () =>
                resolve(JSON.stringify(r.result.map((q) => [q.id, q.sourceKey, q.deckId])))
            })
            db.close()
            return result
          })
        const before = await identities()
        await page.goto('/import')
        await page.locator('input[type=file]').setInputFiles(resolve(directory!, file))
        await expect(page.getByLabel('取込先')).not.toHaveValue('')
        await page.getByLabel('Ankiの学習履歴を取り込む').uncheck()
        await page.getByRole('button', { name: '問題集として保存' }).click()
        await expect(page).toHaveURL(/\/decks(?:\/|$)/, { timeout: 60000 })
        report.repeatImportStable = before === (await identities())
        expect.soft(report.repeatImportStable).toBe(true)
      }
      report.status = (
        report.samples as Array<{
          rawMath: boolean
          typedAnswerVisible?: boolean
          images: { internal: boolean; loaded: boolean }[]
        }>
      ).some(
        (s) =>
          s.rawMath ||
          s.typedAnswerVisible === false ||
          s.images.some((i) => !i.loaded || !i.internal),
      )
        ? 'visual-differences'
        : 'saved'
      report.externalOrigins = [...new Set(external)]
      expect(external).toEqual([])
    } catch (error) {
      report.status = 'exception'
      report.error = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      mkdirSync(resolve(directory!, 'browser-reports'), { recursive: true })
      writeFileSync(
        resolve(directory!, 'browser-reports', `${id}.json`),
        JSON.stringify(report, null, 2) + '\n',
      )
    }
  })
