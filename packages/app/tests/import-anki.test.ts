import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { parseDelimited, previewAnkiText } from '../src/application/importAnki'
import { readAnkiArchive } from '../src/application/importAnkiArchive'
import { previewGift } from '../src/application/importGift'
import giftSample from '../../../samples/import/sample.gift?raw'
import textSample from '../../../samples/import/sample-anki.txt?raw'
import csvSample from '../../../samples/import/sample-anki.csv?raw'
import tsvSample from '../../../samples/import/sample-anki.tsv?raw'

describe('Anki text import', () => {
  it('parses quoted separators and multiline fields', () => {
    const parsed = parseDelimited('"front, one","back\nline"\nsecond,answer', ',')
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.rows).toEqual([
      ['front, one', 'back\nline'],
      ['second', 'answer'],
    ])
  })

  it('generates forward and reverse cards from the Anki note type header', async () => {
    const preview = await previewAnkiText(
      '#separator:Tab\n#notetype:Basic (and reversed card)\n東京\t日本の首都',
      {},
      'geography.tsv',
    )
    expect(preview.diagnostics).toEqual([])
    expect(preview.decks[0]?.questions).toHaveLength(2)
    expect(preview.decks[0]?.questions.map((question) => question.sourceKey)).toEqual([
      expect.stringContaining(':forward'),
      expect.stringContaining(':reverse'),
    ])
  })

  it('splits deck-column rows and expands each cloze number', async () => {
    const preview = await previewAnkiText(
      '#separator:Tab\n#notetype:Cloze\n#deck column:3\n{{c1::東京}}は{{c2::日本}}の首都\t補足\t地理\n{{c1::水}}は液体\t補足\t科学',
    )
    expect(preview.decks.map((deck) => [deck.name, deck.questions.length])).toEqual([
      ['地理', 2],
      ['科学', 1],
    ])
    expect(preview.decks[0]?.questions[0]?.prompt.value).toContain('cloze-label">ア')
    expect(preview.decks[0]?.questions[0]?.prompt.value).toContain('日本')
  })

  it('labels each active deletion by occurrence while making other numbers visible', async () => {
    const same = await previewAnkiText(
      '#separator:Tab\n#notetype:Cloze\n{{c1::鎌倉幕府}}は{{c1::1192年}}に成立した\t解説',
    )
    expect(same.decks[0]?.questions).toHaveLength(1)
    expect(same.decks[0]?.questions[0]?.prompt.value).toContain('cloze-label">ア')
    expect(same.decks[0]?.questions[0]?.prompt.value).toContain('cloze-label">イ')

    const separate = await previewAnkiText(
      '#separator:Tab\n#notetype:Cloze\n{{c1::鎌倉幕府}}は{{c2::1192年}}に成立した\t解説',
    )
    expect(separate.decks[0]?.questions).toHaveLength(2)
    expect(separate.decks[0]?.questions[0]?.prompt.value).toContain('1192年')
    expect(separate.decks[0]?.questions[1]?.prompt.value).toContain('鎌倉幕府')
    expect(separate.decks[0]?.questions[1]?.prompt.value).toContain('cloze-label">ア')
    expect(separate.decks[0]?.questions[1]?.prompt.value).not.toContain('cloze-label">イ')
  })

  it('embeds ZIP media and reports missing references', () => {
    const zipped = zipSync({
      'cards.tsv': strToU8(
        '#separator:Tab\n#html:true\nQ\t<img src="pic.png"> [sound:missing.mp3]',
      ),
      'pic.png': new Uint8Array([137, 80, 78, 71]),
    })
    const archive = readAnkiArchive(zipped.buffer as ArrayBuffer)
    expect(archive.source).toContain('data:image/png;base64,')
    expect(archive.missingMedia).toEqual(['missing.mp3'])
  })

  it('keeps every checked-in import sample valid', async () => {
    const gift = await previewGift(giftSample, 'sample-deck')
    expect(gift.diagnostics.filter((item) => item.severity === 'error')).toEqual([])

    for (const [name, source] of [
      ['sample-anki.txt', textSample],
      ['sample-anki.csv', csvSample],
      ['sample-anki.tsv', tsvSample],
    ] as const) {
      const preview = await previewAnkiText(source, {}, name)
      expect(preview.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
      expect(preview.decks.flatMap((deck) => deck.questions).length).toBeGreaterThan(0)
    }
  })
})
