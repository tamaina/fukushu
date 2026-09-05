import { describe, expect, it } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { boundedZip, boundedZstd } from '../src/archive'
import { safeAnkiCss, safeAnkiHtml } from '../src/safety'
import { renderTemplate } from '../src/template'
describe('bounded decoders and template isolation', () => {
  it('rejects traversal and forged expansion sizes before decoding', () => {
    expect(() => boundedZip(zipSync({ '../x': strToU8('x') }))).toThrow('APKG_PATH_TRAVERSAL')
    const bytes = zipSync({ x: strToU8('small') })
    const view = new DataView(bytes.buffer)
    for (let i = 0; i < bytes.length - 4; i++)
      if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 600 * 1024 ** 2, true)
    expect(() => boundedZip(bytes)).toThrow('APKG_ZIP_BOMB')
  })
  it('rejects truncated archives and excessive zstd windows', () => {
    const bytes = zipSync({ x: strToU8('small') })
    expect(() => boundedZip(bytes.slice(0, -1))).toThrow()
    expect(() =>
      boundedZstd(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0, 0xff, 1, 0, 0]), 1024),
    ).toThrow('APKG_ZSTD_LIMIT')
    expect(() =>
      boundedZstd(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x20, 1, 9, 0, 0]), 1024),
    ).toThrow('APKG_TRUNCATED')
  })
  it('removes embedded stylesheet and escaped CSS URL functions', () => {
    expect(
      safeAnkiHtml(
        '<div><style>body{display:none}</style><img srcset="https://bad/x 2x" onerror="alert(1)"></div>',
      ),
    ).not.toMatch(/style|srcset|onerror/)
    expect(
      safeAnkiCss('.card{color:red;background:u\\72l(https://bad/x)}@import "https://bad/y";'),
    ).not.toContain('bad')
    expect(
      safeAnkiCss('.card{color:red;background:u\\72l(https://bad/x)}@import "https://bad/y";'),
    ).toContain('color:red')
    expect(safeAnkiCss('.card{color:red}')).toContain('color:red')
  })
  it('handles nested conditions and unknown fields without silent deletion', () => {
    const p = renderTemplate(
      '{{#A}}one{{#B}}{{B}}{{/B}}{{/A}}{{^C}}three{{/C}}',
      { A: 'yes', B: 'two', C: '' },
      '',
      0,
    )
    expect(p.html).toBe('onetwothree')
    expect(
      renderTemplate('{{#Image}}present{{/Image}}', { Image: '<img src="photo.png">' }, '', 0).html,
    ).toBe('present')
    expect(renderTemplate('{{unknown:X}}', { X: 'test' }, '', 0).warnings).toHaveLength(1)
    expect(() => renderTemplate('{{#A}}', { A: 'yes' }, '', 0)).toThrow()
  })
  it('reveals type answers and labels clozes per active ordinal', () => {
    expect(renderTemplate('{{type:A}}', { A: '<b>answer</b>' }, '', 0, true).html).toContain(
      'answer',
    )
    const fields = { Text: '{{c1::鎌倉幕府}}は{{c1::1192年}}、{{c2::日本}}' }
    const p = renderTemplate('{{cloze:Text}}', fields, '', 0)
    expect(p.html).toContain('ア')
    expect(p.html).toContain('イ')
    expect(p.html).toContain('日本')
    const q = renderTemplate('{{cloze:Text}}', fields, '', 1)
    expect(q.html).toContain('鎌倉幕府')
    expect(q.html).not.toContain('イ')
  })
})
