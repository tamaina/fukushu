type Node =
  | { kind: 'text'; text: string }
  | { kind: 'field'; name: string }
  | { kind: 'section'; name: string; negative: boolean; children: Node[] }
export function parseTemplate(source: string): Node[] {
  const root: Node[] = []
  const stack = [{ name: '', nodes: root }]
  let offset = 0
  for (const match of source.matchAll(/{{([\s\S]*?)}}/g)) {
    const current = stack.at(-1)!
    current.nodes.push({ kind: 'text', text: source.slice(offset, match.index) })
    const token = match[1]!.trim()
    offset = match.index! + match[0].length
    if (token.startsWith('#') || token.startsWith('^')) {
      const node: Node = {
        kind: 'section',
        name: token.slice(1),
        negative: token[0] === '^',
        children: [],
      }
      current.nodes.push(node)
      stack.push({ name: node.name, nodes: node.children })
    } else if (token.startsWith('/')) {
      if (stack.length === 1 || current.name !== token.slice(1))
        throw new Error('条件の閉じ方が不正です')
      stack.pop()
    } else current.nodes.push({ kind: 'field', name: token })
  }
  if (stack.length !== 1) throw new Error('条件が閉じていません')
  root.push({ kind: 'text', text: source.slice(offset) })
  return root
}
const escape = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const text = (s: string) => new DOMParser().parseFromString(s, 'text/html').body.textContent ?? ''
function reading(value: string, mode: string): string {
  const root = new DOMParser().parseFromString(value, 'text/html').body
  const walker = root.ownerDocument.createTreeWalker(root, 4)
  // Snapshot text nodes before replacing them. This also keeps field attributes intact.
  const texts: globalThis.Node[] = []
  while (walker.nextNode()) texts.push(walker.currentNode)
  for (const node of texts) {
    if (node.parentElement?.closest('ruby,script,style')) continue
    const source = node.textContent ?? ''
    const fragment = root.ownerDocument.createDocumentFragment()
    let end = 0
    for (const match of source.matchAll(/([^\s[\]]+)\[([^\]]+)\]/g)) {
      if (match[2]!.startsWith('sound:')) continue
      fragment.append(source.slice(end, match.index))
      end = match.index! + match[0].length
      if (mode === 'furigana') {
        const ruby = root.ownerDocument.createElement('ruby'),
          rt = root.ownerDocument.createElement('rt')
        ruby.append(match[1]!)
        rt.textContent = match[2]!
        ruby.append(rt)
        fragment.append(ruby)
      } else fragment.append(mode === 'kana' ? match[2]! : match[1]!)
    }
    fragment.append(source.slice(end))
    node.parentNode?.replaceChild(fragment, node)
  }
  return root.innerHTML
}
export function renderTemplate(
  source: string,
  fields: Record<string, string>,
  front: string,
  ordinal: number,
  reveal = false,
) {
  let acceptedAnswer: string | undefined,
    blank = 0
  const warnings: string[] = []
  function render(nodes: Node[]): string {
    return nodes
      .map((node) => {
        if (node.kind === 'text') return node.text
        if (node.kind === 'section')
          return (!!text(fields[node.name] ?? '').trim() ||
            /<(?:img|audio)\b/i.test(fields[node.name] ?? '')) !== node.negative
            ? render(node.children)
            : ''
        if (node.name === 'FrontSide') return front
        const parts = node.name.split(':'),
          name = parts.pop()!
        if (!Object.hasOwn(fields, name)) {
          warnings.push(`未定義フィールド: ${name}`)
          return escape(`{{${node.name}}}`)
        }
        let value = fields[name]!
        for (const filter of parts.reverse()) {
          if (filter === 'text') value = escape(text(value))
          else if (['furigana', 'kana', 'kanji'].includes(filter)) value = reading(value, filter)
          else if (filter === 'hint') value = `<details><summary>ヒント</summary>${value}</details>`
          else if (filter === 'type') {
            acceptedAnswer = text(value)
              .replace(/\[sound:[^\]]+\]/g, '')
              .trim()
            value = reveal ? `<span class="type-answer">${escape(acceptedAnswer)}</span>` : ''
          } else if (filter === 'cloze')
            value = value.replace(
              /{{c(\d+)::([\s\S]*?)(?:::(.*?))?}}/gi,
              (_all, n: string, answer: string, hint?: string) => {
                if (Number(n) !== ordinal + 1) return answer
                if (reveal) return `<mark>${answer}</mark>`
                const label =
                  [...'アイウエオカキクケコサシスセソタチツテトナニヌネノ'][blank++] ??
                  String(blank)
                return `<span class="cloze-blank"><span class="cloze-label">${label}</span>${hint ? `<span class="cloze-hint">${hint}</span>` : ''}</span>`
              },
            )
          else {
            warnings.push(`未対応フィルター: ${filter}`)
            return escape(`{{${node.name}}}`)
          }
        }
        return value
      })
      .join('')
  }
  return { html: render(parseTemplate(source)), acceptedAnswer, warnings }
}

/** Only exact stock layouts/styles, or bare field substitution, can discard the template. */
export function nativeTemplate(
  qfmt: string,
  afmt: string,
  css: string,
  fields: Record<string, string>,
): boolean {
  const normalize = (s: string) => s.replace(/\s+/g, '')
  if (Object.values(fields).some((value) => /<(?:div|table|style)|\bstyle\s*=/i.test(value)))
    return false
  if (!css.trim() && /^\s*{{[^{}:]+}}\s*$/.test(qfmt) && /^\s*{{[^{}:]+}}\s*$/.test(afmt))
    return true
  const stock =
    '.card{font-family:arial;font-size:20px;line-height:1.5;text-align:center;color:black;background-color:white;}'
  const cloze = stock + '.cloze{font-weight:bold;color:blue;}.nightMode.cloze{color:lightblue;}'
  if (![stock, cloze].includes(normalize(css))) return false
  const front = normalize(qfmt),
    back = normalize(afmt)
  return [
    ['{{Front}}', '{{FrontSide}}<hrid=answer>{{Back}}'],
    ['{{Back}}', '{{FrontSide}}<hrid=answer>{{Front}}'],
    ['{{#AddReverse}}{{Back}}{{/AddReverse}}', '{{FrontSide}}<hrid=answer>{{Front}}'],
    ['{{Front}}{{type:Back}}', '{{Front}}<hrid=answer>{{type:Back}}'],
    ['{{cloze:Text}}', '{{cloze:Text}}<br>{{BackExtra}}'],
  ].some(([q, a]) => front === q && back === a)
}
