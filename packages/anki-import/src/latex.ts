/** Anki's legacy image names are SHA-1 of the normalized, math-wrapped LaTeX body. */
export async function replaceLegacyLatex(
  html: string,
  media: Map<string, { id: string; url: string }>,
  warn: (message: string) => void,
): Promise<string> {
  const pattern =
    /\[latex\]([\s\S]+?)\[\/latex\]|\[\$\]([\s\S]+?)\[\/\$\]|\[\$\$\]([\s\S]+?)\[\/\$\$\]/gi
  let result = '',
    offset = 0
  for (const match of html.matchAll(pattern)) {
    result += html.slice(offset, match.index)
    offset = match.index! + match[0].length
    const body =
      match[1] ??
      (match[2] !== undefined
        ? `$${match[2]}$`
        : `\\begin{displaymath}${match[3]}\\end{displaymath}`)
    const latex = (
      new DOMParser().parseFromString(body.replace(/<br\s*\/?\s*>|<div>/gi, '\n'), 'text/html').body
        .textContent ?? ''
    ).replaceAll('\u00a0', ' ')
    const digest = [
      ...new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(latex))),
    ]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    const image = media.get(`latex-${digest}.png`) ?? media.get(`latex-${digest}.svg`)
    const escape = (s: string) =>
      s
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
    if (image) result += `<img class="latex" alt="${escape(latex)}" src="${image.url}">`
    else if (match[2] !== undefined || match[3] !== undefined) {
      const raw = match[2] ?? match[3]!
      result +=
        (match[2] !== undefined ? '\\(' : '\\[') +
        escape(raw) +
        (match[2] !== undefined ? '\\)' : '\\]')
    } else {
      warn(`LaTeX画像が見つかりません: latex-${digest}`)
      result += `<code>${escape(match[0])}</code>`
    }
  }
  return result + html.slice(offset)
}
