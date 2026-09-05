import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { expect, test } from 'vitest'
import { decodeArchive, limits } from '../src/archive'
import { convertArchive } from '../src'

// Opt-in downloaded corpus. No third-party deck contents are committed or fetched by unit tests.
const directory = process.env.ANKI_CORPUS_DIR ? resolve(process.env.ANKI_CORPUS_DIR) : undefined
const selected = process.env.ANKI_CORPUS_FILES?.split(',')
const files = directory
  ? readdirSync(directory).filter(
      (f) => f.endsWith('.apkg') && (!selected || selected.includes(f.replace('.apkg', ''))),
    )
  : []
const wasmUrl = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm')
const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')
function visibleText(
  html: string,
  side: 'front' | 'back',
  fields: Record<string, string> = {},
): string {
  html = html
    .replace(/\[\[type:([^\]]+)\]\]/g, (_all, name: string) =>
      side === 'front' ? '' : (fields[name] ?? ''),
    )
    .replace(/\[anki:play:[qa]:\d+\]/g, '')
  const root = new DOMParser().parseFromString(html, 'text/html')
  root.querySelectorAll('style,script').forEach((el) => el.remove())
  if (side === 'front') root.querySelectorAll('.cloze,.cloze-blank').forEach((el) => el.remove())
  return (root.body.textContent ?? '')
    .replace(/\[sound:[^\]]+\]/g, '')
    .normalize('NFKC')
    .replace(/[\s\u200b]+/g, '')
    .trim()
}
test.skipIf(!directory)('public corpus is explicitly selected', () =>
  expect(files.length).toBeGreaterThan(0),
)
for (const file of files)
  test(
    file,
    async () => {
      const id = file.replace('.apkg', ''),
        bytes = new Uint8Array(readFileSync(resolve(directory!, file)))
      const source = JSON.parse(readFileSync(resolve(directory!, `${id}.json`), 'utf8'))
      const oracle = JSON.parse(readFileSync(resolve(directory!, `${id}.oracle.json`), 'utf8'))
      const started = Date.now()
      const originalArchiveLimit = limits.archive
      const capacityOverride =
        bytes.length > limits.archive && process.env.ANKI_CORPUS_ALLOW_LARGE === '1'
      if (capacityOverride) limits.archive = bytes.length
      const report: Record<string, unknown> = {
        id,
        source: source.sourceUrl,
        title: source.title,
        up: source.up,
        down: source.down,
        repositoryStars: source.repositoryStars,
        bytes: bytes.length,
        sha256: hash(bytes),
        inputCards: oracle.cards,
        inputNotes: oracle.notes,
        schema: oracle.schema,
        capacityOverride: capacityOverride ? ['archive'] : [],
      }
      try {
        expect(hash(bytes)).toBe(source.sha256)
        expect(hash(bytes)).toBe(oracle.sha256)
        const decoded = await decodeArchive(bytes, { wasmUrl })
        const result = await convertArchive(decoded)
        const cards = result.decks.flatMap((d) => d.cards)
        const diagnosticCounts: Record<string, number> = {}
        for (const d of result.diagnostics)
          diagnosticCounts[d.code] = (diagnosticCounts[d.code] ?? 0) + 1
        const digest = (parsed: typeof result) =>
          hash(
            JSON.stringify({
              ...parsed,
              media: parsed.media.map((m) => ({ id: m.id, mimeType: m.mimeType, size: m.size })),
            }),
          )
        const signature = digest(result)
        const repeated = await convertArchive(await decodeArchive(bytes, { wasmUrl }))
        const samples = (
          oracle.samples as Array<{
            id: string
            key: string
            front: string
            back: string
            fields: Record<string, string>
          }>
        ).map((sample) => {
          const card = cards.find((c) => c.source.cardId === sample.id)
          const deckIndex = result.decks.findIndex((d) =>
            d.cards.some((c) => c.source.cardId === sample.id),
          )
          const cardIndex =
            deckIndex < 0
              ? -1
              : result.decks[deckIndex]!.cards.findIndex((c) => c.source.cardId === sample.id)
          return {
            id: sample.id,
            key: card?.key ?? sample.key,
            deckIndex,
            cardIndex,
            found: !!card,
            frontTextEqual:
              !!card &&
              visibleText(card.frontHtml, 'front') ===
                visibleText(sample.front, 'front', sample.fields),
            backTextEqual:
              !!card &&
              visibleText(card.backHtml, 'back') ===
                visibleText(sample.back, 'back', sample.fields),
          }
        })
        const errors = result.diagnostics.filter((d) => d.severity === 'error')
        report.duplicateCardKeys = cards.length - new Set(cards.map((c) => c.key)).size
        Object.assign(report, {
          format: result.format,
          outputCards: cards.length,
          outputNotes: result.stats.noteCount,
          media: result.media.length,
          native: cards.filter((c) => c.rendering.mode === 'native').length,
          template: cards.filter((c) => c.rendering.mode === 'template').length,
          simplifiable: cards.filter((c) => c.simplified).length,
          diagnosticCounts,
          errorExamples: errors.slice(0, 8),
          signature,
          reproducible: signature === digest(repeated),
          samples,
          status: errors.length
            ? 'blocked-diagnostics'
            : cards.length !== oracle.cards
              ? 'card-loss'
              : 'parsed',
        })
        const mediaIds = new Set(result.media.map((m) => m.id))
        report.missingInternalReferences = cards.flatMap((c) =>
          [...(c.frontHtml + c.backHtml).matchAll(/fukushu-media:([a-f0-9]{64})/g)].filter(
            (m) => !mediaIds.has(m[1]!),
          ),
        ).length
        if (report.status === 'parsed' && diagnosticCounts.APKG_MISSING_MEDIA)
          report.status = 'partial-media'
        if (
          report.status === 'parsed' &&
          samples.some((s) => !s.frontTextEqual || !s.backTextEqual)
        )
          report.status = 'render-differences'
        if (report.duplicateCardKeys) report.status = 'duplicate-card-keys'
        expect.soft(report.reproducible).toBe(true)
        expect.soft(cards.length).toBe(oracle.cards)
        expect.soft(errors.length).toBe(0)
        expect.soft(report.missingInternalReferences).toBe(0)
        expect.soft(report.duplicateCardKeys).toBe(0)
        expect.soft(report.status).toBe('parsed')
      } catch (error) {
        report.status = 'exception'
        report.error = error instanceof Error ? error.message : String(error)
        throw error
      } finally {
        limits.archive = originalArchiveLimit
        report.elapsedMs = Date.now() - started
        mkdirSync(resolve(directory!, 'reports'), { recursive: true })
        writeFileSync(
          resolve(directory!, 'reports', `${id}.json`),
          JSON.stringify(report, null, 2) + '\n',
        )
        console.log(
          JSON.stringify({
            id,
            status: report.status,
            cards: report.outputCards,
            error: report.error,
            elapsedMs: report.elapsedMs,
          }),
        )
      }
    },
    180000,
  )
