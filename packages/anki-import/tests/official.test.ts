import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { parseApkg } from '../src'

const wasmUrl = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm')
describe('Anki interoperability independently of the app', () => {
  it.each([
    ['official-anki2', 'anki2', 1],
    ['official-anki21', 'anki21', 9],
    ['official-21b', '21b', 9],
  ] as const)('reads %s', async (name, format, count) => {
    const result = await parseApkg(new Uint8Array(readFileSync(`tests/fixtures/${name}.apkg`)), {
      wasmUrl,
    })
    expect(result.format).toBe(format)
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(result.stats.cardCount).toBe(count)
    const cards = result.decks.flatMap((d) => d.cards)
    expect(cards).toHaveLength(count)
    expect(cards.every((c) => c.key && c.source.cardId)).toBe(true)
    if (format !== 'anki2') {
      expect(result.media).toHaveLength(2)
      expect(result.media.every((m) => m.data.length === m.size)).toBe(true)
      expect(cards.find((c) => c.acceptedAnswer)?.backHtml).toContain('東京')
      expect(cards.flatMap((c) => c.reviews)).toHaveLength(36)
      expect(cards.filter((c) => c.rendering.mode === 'template')).toHaveLength(1)
    }
  })
})
