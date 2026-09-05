import renderMathInElement from 'katex/contrib/auto-render'

/** Both normal cards and sandboxed cards use the same bounded, non-trusting math renderer. */
export function renderCardMath(element: HTMLElement): void {
  // MathJax accepts inline markup/line breaks inside delimiters. Normalize it before KaTeX's text-node scanner.
  element.innerHTML = element.innerHTML.replace(/\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g, (source) => {
    const node = document.createElement('div')
    node.innerHTML = source
    for (const blank of node.querySelectorAll('.cloze-blank')) {
      const label = (blank.querySelector('.cloze-label')?.textContent ?? '…').replace(
        /[\\{}$%&#_^~]/g,
        '',
      )
      blank.replaceWith(document.createTextNode(`\\boxed{\\text{${label}}}`))
    }
    node.querySelectorAll('br').forEach((br) => br.replaceWith(document.createTextNode('\n')))
    return (node.textContent ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
  })
  renderMathInElement(element, {
    delimiters: [
      { left: '\\[', right: '\\]', display: true },
      { left: '$$', right: '$$', display: true },
      { left: '\\(', right: '\\)', display: false },
    ],
    throwOnError: true,
    errorCallback: () => {
      element.dataset.mathError = 'true'
    },
    strict: false,
    trust: false,
    maxExpand: 1000,
    globalGroup: true,
    macros: {},
  })
}
