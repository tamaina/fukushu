import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const directory = resolve(process.argv[2] ?? '.cache/anki-corpus')
const output = resolve(process.argv[3] ?? 'docs/compatibility')
mkdirSync(output, { recursive: true })
const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
const manifest = readdirSync(directory)
  .filter((f) => f.endsWith('.apkg'))
  .sort()
  .map((file) => read(resolve(directory, file.replace('.apkg', '.json'))))
const rows = manifest.map((source) => {
  const library = read(resolve(directory, 'reports', `${source.id}.json`))
  library.errorExamples = library.errorExamples?.map(({ card, ...diagnostic }) => ({
    ...diagnostic,
    ...(card ? { card: { deckId: card.deckId, key: card.key, cardId: card.cardId } } : {}),
  }))
  const browser = read(resolve(directory, 'browser-reports', `${source.id}.json`))
  const native = read(resolve(directory, `${source.id}.oracle.json`))
  if (library.sha256 !== source.sha256 || browser.sha256 !== source.sha256)
    throw new Error(`Stale evidence for ${source.id}`)
  return {
    source,
    library,
    browser,
    oracle: {
      version: '25.9',
      collection: native.collection,
      schema: native.schema,
      cards: native.cards,
      notes: native.notes,
      nativeImportCards: native.nativeImportCards,
      samples: native.samples.length,
    },
  }
})
const codePaths = [
  ...readdirSync('packages/anki-import/src')
    .filter((f) => f.endsWith('.ts'))
    .map((f) => `packages/anki-import/src/${f}`),
  'packages/app/src/application/importApkg.ts',
  'packages/app/src/application/apkgStore.ts',
  'packages/app/src/components/AnkiFrame.vue',
  'packages/app/src/components/ContentRenderer.vue',
  'packages/app/src/utils/renderMath.ts',
]
const implementation = Object.fromEntries(
  codePaths.map((path) => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]),
)
const result = {
  generatedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  implementation,
  rows,
}
writeFileSync(
  resolve(output, 'apkg-public-manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
)
writeFileSync(resolve(output, 'apkg-public-results.json'), JSON.stringify(result, null, 2) + '\n')
console.log(
  JSON.stringify(
    rows.map((r) => ({
      id: r.source.id,
      cards: r.library.outputCards,
      parse: r.library.status,
      browser: r.browser.status,
      reproducible: r.library.reproducible,
    })),
    null,
    2,
  ),
)
