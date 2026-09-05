import { expect, it } from 'vitest'
import { simplifyHtml } from '../src/simplify'
import { convertArchive } from '../src'
import type { DecodedArchive } from '../src/archive'

it('converts simple blocks to text and preserves basic emphasis as Markdown', () => {
  expect(simplifyHtml('<div>問題<br>続き</div>', '.card{font-size:24px;color:red}')).toEqual({
    format: 'plain',
    value: '問題\n続き',
  })
  expect(simplifyHtml('<p>これは<strong>重要</strong></p>', '')).toEqual({
    format: 'markdown',
    value: 'これは**重要**',
  })
  expect(simplifyHtml('<div>literal * text</div>', '')?.value).toBe('literal * text')
  expect(simplifyHtml('<p>A<strong> bold </strong>B</p>', '')?.value).toBe('A **bold** B')
})
it('does not reveal hidden content or flatten complex cards', () => {
  for (const html of [
    '<div hidden>answer</div>',
    '<span class="cloze-blank">ア</span>',
    '<img src="x">',
    '<details>answer</details>',
    '<table><tr><td>x</td></tr></table>',
  ])
    expect(simplifyHtml(html, '')).toBeUndefined()
  expect(simplifyHtml('<div>answer</div>', '.answer{display:none}')).toBeUndefined()
  expect(simplifyHtml('<div style="visibility:hidden">answer</div>', '')).toBeUndefined()
})
function archive(): DecodedArchive {
  return {
    files: {},
    format: 'anki21',
    rows: {
      col: [
        {
          models: JSON.stringify({
            1: {
              name: 'Simple',
              flds: [{ name: 'Front' }, { name: 'Back' }],
              tmpls: [
                {
                  ord: 0,
                  qfmt: '<div>{{Front}}</div><script>bad()</script>',
                  afmt: '<p>{{Back}}</p><script>bad()</script>',
                },
              ],
              css: '.card {color: red}',
            },
          }),
          decks: JSON.stringify({
            1: { name: 'Default' },
            2: { name: '空デッキ' },
            3: { name: '日本史' },
          }),
        },
      ],
      notes: [{ id: 1, guid: 'guid', mid: 1, flds: '鎌倉幕府\x1f1192年', tags: '' }],
      cards: [{ id: 10, nid: 1, did: 3, ord: 0 }],
      revlog: [],
    },
  }
}
it('identifies affected cards, suggests simplification, and omits all empty decks', async () => {
  const parsed = await convertArchive(archive())
  expect(parsed.decks.map((d) => d.name)).toEqual(['日本史'])
  const warnings = parsed.diagnostics.filter((d) => d.code === 'APKG_UNSAFE_HTML')
  expect(warnings).toHaveLength(2)
  expect(warnings[0]!.card).toMatchObject({
    deckName: '日本史',
    key: 'guid:0',
    cardId: '10',
    excerpt: '鎌倉幕府',
  })
  expect(parsed.decks[0]!.cards[0]!.simplified?.back).toEqual({ format: 'plain', value: '1192年' })
})
it('retains a populated Default deck', async () => {
  const decoded = archive()
  decoded.rows.cards![0]!.did = 1
  expect((await convertArchive(decoded)).decks.map((d) => d.name)).toEqual(['Default'])
})
