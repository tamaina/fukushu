import { expect, it } from 'vitest'
import { renderCardMath } from '../src/utils/renderMath'
it('renders macros across blocks and line breaks without leaking between cards', () => {
  const root = document.createElement('div')
  root.innerHTML = '\\(\\newcommand{\\myOp}{\\operatorname{E}}<br>\\) then \\(\\myOp[X]\\)'
  renderCardMath(root)
  expect(root.querySelectorAll('.katex')).toHaveLength(2)
  expect(root.querySelector('.katex-error')).toBeNull()
  const other = document.createElement('div')
  other.textContent = '\\(\\myOp[X]\\)'
  renderCardMath(other)
  expect(other.dataset.mathError).toBe('true')
  expect(other.textContent).toContain('\\myOp')
})
it('renders cloze blanks in math without enabling trusted HTML commands', () => {
  const root = document.createElement('div')
  root.innerHTML =
    '\\(x = <span class="cloze-blank"><span class="cloze-label">ア</span></span>\\) \\(\\href{https://trap.invalid}{link}\\)'
  renderCardMath(root)
  expect(root.querySelector('.katex')).not.toBeNull()
  expect(root.querySelector('a[href]')).toBeNull()
})
