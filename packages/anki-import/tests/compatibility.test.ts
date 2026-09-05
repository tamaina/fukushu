import { describe, expect, it } from 'vitest'
import { convertArchive, renderTemplate } from '../src'
import { safeAnkiSvg } from '../src/safety'
import { replaceLegacyLatex } from '../src/latex'
import type { DecodedArchive } from '../src/archive'

function archive(qfmt = '{{Front}}', afmt = '{{Back}}'): DecodedArchive {
  return {
    format: 'anki2',
    files: {},
    rows: {
      col: [
        {
          models: JSON.stringify({
            1: {
              name: 'Basic',
              flds: [{ name: 'Front' }, { name: 'Back' }],
              tmpls: [{ ord: 0, name: 'Forward', qfmt, afmt }],
              css: '',
            },
          }),
          decks: JSON.stringify({ 1: { name: 'Parent::Child' } }),
        },
      ],
      notes: [{ id: 1, guid: 'same', mid: 1, flds: '問題\x1fanswer', tags: 'tag-a tag-b' }],
      cards: [{ id: 10, nid: 1, did: 1, ord: 0 }],
      revlog: [],
    },
  }
}
describe('public-deck compatibility regressions', () => {
  it('renders Japanese reading filters as ruby or plain readings', () => {
    const fields = { Word: '彼[かれ] は <b>学生[がくせい]</b>' }
    const html = renderTemplate('{{furigana:Word}}', fields, '', 0).html
    expect(html).toContain('<ruby>彼<rt>かれ</rt></ruby>')
    expect(html).toContain('<b><ruby>学生<rt>がくせい</rt></ruby></b>')
    expect(renderTemplate('{{kana:Word}}', fields, '', 0).html).toBe('かれ は <b>がくせい</b>')
    expect(renderTemplate('{{kanji:Word}}', fields, '', 0).html).toBe('彼 は <b>学生</b>')
  })
  it('resolves special fields and retains type-answer on FrontSide', async () => {
    const parsed = await convertArchive(
      archive(
        '{{Front}} {{type:Back}}',
        '{{FrontSide}} {{Subdeck}} {{Deck}} {{Type}} {{Tags}} {{Card}}',
      ),
    )
    const card = parsed.decks[0]!.cards[0]!
    expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(card.backHtml).toContain('answer')
    expect(card.backHtml).toContain('Child Parent::Child Basic tag-a tag-b Forward')
    expect(card.acceptedAnswer).toBe('answer')
  })
  it('disambiguates duplicate GUIDs without dropping cards', async () => {
    const input = archive()
    input.rows.notes!.push({ ...input.rows.notes![0], id: 2 })
    input.rows.cards!.push({ id: 11, nid: 2, did: 1, ord: 0 })
    const first = await convertArchive(input)
    expect(first.decks[0]!.cards.map((c) => c.key)).toEqual(['same:0:note:1', 'same:0:note:2'])
    input.rows.cards!.reverse()
    const second = await convertArchive(input)
    expect(second.decks[0]!.cards.map((c) => c.key).sort()).toEqual(
      first.decks[0]!.cards.map((c) => c.key).sort(),
    )
  })
  it('uses Anki-compatible legacy LaTeX filenames and safe fallback delimiters', async () => {
    const media = new Map([
      ['latex-ef30b3f4141c33a5bf7044b0d1961d3399c05d50.png', { id: 'a', url: 'fukushu-media:a' }],
    ])
    const warnings: string[] = []
    expect(
      await replaceLegacyLatex('[latex]one<br>and<div>two[/latex]', media, (m) => warnings.push(m)),
    ).toContain('src="fukushu-media:a"')
    expect(await replaceLegacyLatex('[$$]x^2[/$$]', new Map(), (m) => warnings.push(m))).toBe(
      '\\[x^2\\]',
    )
    expect(warnings).toEqual([])
  })
  it('keeps static SVG geometry and local gradients while removing active resources', () => {
    const result = safeAnkiSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><defs><linearGradient id="g"><stop stop-color="red"/></linearGradient></defs><rect width="50" height="30" fill="url(#g)"/><script>alert(1)</script><foreignObject><iframe src="https://trap.invalid"/></foreignObject><use href="https://trap.invalid/x.svg#g"/></svg>',
    )
    expect(result).toContain('url(#g)')
    expect(result).not.toMatch(/onload|script|foreignObject|iframe|trap.invalid/)
    expect(() =>
      safeAnkiSvg('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>'),
    ).toThrow()
  })
})
