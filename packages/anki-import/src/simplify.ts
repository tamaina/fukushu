import { parse, walk } from 'css-tree'
import type { SimplifiedContent } from './types'

/** Explicitly lossy typography simplification; hidden/generated/interactive content is excluded. */
export function simplifyHtml(html: string, css: string): SimplifiedContent | undefined {
  const presentation = new Set([
    'color',
    'background-color',
    'font',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'line-height',
    'text-align',
    'text-decoration',
    'letter-spacing',
    'word-spacing',
    'margin',
    'margin-top',
    'margin-right',
    'margin-bottom',
    'margin-left',
    'padding',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'border',
    'border-width',
    'border-color',
    'border-style',
    'border-radius',
  ])
  try {
    let unsafe = false
    walk(parse(css), (node) => {
      if (node.type === 'Atrule' || node.type === 'Raw' || node.type === 'PseudoElementSelector')
        unsafe = true
      if (node.type === 'Declaration' && !presentation.has(node.property.toLowerCase()))
        unsafe = true
    })
    if (unsafe) return
  } catch {
    return
  }
  const root = new DOMParser().parseFromString(html, 'text/html').body
  const allowed = new Set([
    'DIV',
    'P',
    'SPAN',
    'BR',
    'HR',
    'B',
    'STRONG',
    'EM',
    'I',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
  ])
  for (const el of root.querySelectorAll('*')) {
    if (
      !allowed.has(el.tagName) ||
      el.hasAttribute('hidden') ||
      el.getAttribute('aria-hidden') === 'true' ||
      el.classList.contains('cloze-blank')
    )
      return
    if (el.hasAttribute('style')) {
      let unsafe = false
      try {
        walk(parse(el.getAttribute('style')!, { context: 'declarationList' }), (n) => {
          if (
            (n.type === 'Declaration' && !presentation.has(n.property.toLowerCase())) ||
            n.type === 'Raw'
          )
            unsafe = true
        })
      } catch {
        return
      }
      if (unsafe) return
    }
  }
  const markdown = !!root.querySelector('b,strong,em,i,h1,h2,h3,h4,h5,h6,hr')
  const escape = (text: string) =>
    markdown ? text.replace(/[\\`*_{}[\]<>#!|~+\-.]/g, '\\$&') : text
  function render(node: Node): string {
    if (node.nodeType === 3) return escape(node.textContent ?? '')
    if (node.nodeType !== 1) return ''
    const el = node as Element,
      children = [...el.childNodes].map(render).join('')
    if (el.tagName === 'BR') return markdown ? '  \n' : '\n'
    if (el.tagName === 'HR') return '\n\n---\n\n'
    if (['B', 'STRONG', 'EM', 'I'].includes(el.tagName)) {
      const marker = ['B', 'STRONG'].includes(el.tagName) ? '**' : '*'
      const trimmed = children.trim()
      return trimmed ? children.replace(trimmed, marker + trimmed + marker) : children
    }
    if (/^H[1-6]$/.test(el.tagName))
      return `\n\n${'#'.repeat(Number(el.tagName[1]))} ${children}\n\n`
    if (['P', 'DIV'].includes(el.tagName)) return `\n\n${children}\n\n`
    return children
  }
  const value = [...root.childNodes]
    .map(render)
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return value ? { format: markdown ? 'markdown' : 'plain', value } : undefined
}
