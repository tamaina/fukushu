import DOMPurify from 'dompurify'
import { parse, generate, walk } from 'css-tree'

function localPaint(value: string): boolean {
  if (
    /[\\]|(?:expression|javascript|@import|image-set|https?:|\/\/|data:|file:|blob:)/i.test(value)
  )
    return false
  return [...value.matchAll(/url\(([^)]*)\)/gi)].every((m) =>
    /^['"]?#[\w.:-]+['"]?$/.test(m[1]!.trim()),
  )
}
/** Static SVG images only. No scripts, animation, foreign documents or external resources. */
export function safeAnkiSvg(source: string): string {
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(source)) throw new Error('APKG_UNSAFE_SVG')
  source = source.replace(/<!DOCTYPE[^>]*>/gi, '')
  const original = new DOMParser().parseFromString(source, 'image/svg+xml')
  if (original.querySelector('parsererror') || original.documentElement.localName !== 'svg')
    throw new Error('APKG_INVALID_SVG')
  const clean = DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: [
      'script',
      'foreignObject',
      'animate',
      'animateMotion',
      'animateTransform',
      'set',
      'image',
      'a',
    ],
    FORBID_ATTR: ['onload', 'onerror'],
  })
  const doc = new DOMParser().parseFromString(clean, 'image/svg+xml')
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg')
    throw new Error('APKG_INVALID_SVG')
  for (const el of [doc.documentElement, ...doc.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      if (/^xmlns(?::|$)/.test(attr.name)) continue
      if (
        /^on/i.test(attr.name) ||
        attr.name === 'xml:base' ||
        (/(?:^|:)href$/.test(attr.name) && !/^#[\w.:-]+$/.test(attr.value)) ||
        !localPaint(attr.value)
      )
        el.removeAttribute(attr.name)
    }
    if (el.localName === 'style') {
      try {
        const ast = parse(el.textContent ?? '')
        walk(ast, function (node, item, list) {
          if (
            node.type === 'Atrule' ||
            node.type === 'Raw' ||
            (node.type === 'Declaration' && !localPaint(generate(node)))
          ) {
            if (item && list) {
              list.remove(item)
              return this.skip
            }
            throw new Error('Unsafe SVG CSS')
          }
        })
        el.textContent = generate(ast)
      } catch {
        el.remove()
      }
    }
  }
  return new XMLSerializer().serializeToString(doc.documentElement)
}
