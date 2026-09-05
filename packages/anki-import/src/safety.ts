import DOMPurify from 'dompurify'
import { parse, generate, walk } from 'css-tree'
export { safeAnkiSvg } from './svg'

export function safeAnkiCss(css: string, onRemoved?: () => void): string {
  try {
    const ast = parse(css)
    walk(ast, function (node, item, list) {
      if (
        (node.type === 'Atrule' && !['media', 'supports'].includes(node.name.toLowerCase())) ||
        node.type === 'Raw' ||
        (node.type === 'Declaration' &&
          /(?:url|image-set|expression|behavior|binding|\\)/i.test(generate(node)))
      ) {
        onRemoved?.()
        if (item && list) {
          list.remove(item)
          return this.skip
        } else throw new Error('Unsupported CSS')
      }
    })
    return generate(ast).replaceAll('<', '\\3c ')
  } catch {
    onRemoved?.()
    return ''
  }
}

export function safeAnkiHtml(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_URI_REGEXP: /^fukushu-media:[a-f0-9]{64}$/,
    FORBID_TAGS: [
      'style',
      'script',
      'iframe',
      'object',
      'embed',
      'form',
      'svg',
      'math',
      'link',
      'meta',
      'base',
      'video',
      'source',
    ],
    FORBID_ATTR: [
      'srcset',
      'href',
      'xlink:href',
      'poster',
      'background',
      'action',
      'formaction',
      'srcdoc',
      'autoplay',
    ],
    ADD_TAGS: ['audio'],
    ADD_ATTR: ['controls', 'preload'],
  })
  const root = document.createElement('div')
  root.innerHTML = clean
  for (const el of root.querySelectorAll('*')) {
    if (el.hasAttribute('style')) {
      const css = safeAnkiCss(`a{${el.getAttribute('style')}}`)
      el.setAttribute('style', css.slice(css.indexOf('{') + 1, css.lastIndexOf('}')))
    }
    const src = el.getAttribute('src')
    if (src && !/^fukushu-media:[a-f0-9]{64}$/.test(src)) el.removeAttribute('src')
  }
  return root.innerHTML
}
