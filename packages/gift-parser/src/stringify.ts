import type { GiftContent, GiftDocument, GiftQuestion, StringifyGiftOptions } from './types'

const escape = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/([~=#{}:])/g, '\\$1')
const renderContent = (value: GiftContent): string =>
  `${value.format === 'plain' ? '' : `[${value.format}]`}${escape(value.value)}`
const feedback = (value?: GiftContent): string => (value ? `#${escape(value.value)}` : '')
const weight = (value: number): string => (value === 100 ? '=' : `~%${value}%`)

function renderQuestion(question: GiftQuestion): string {
  const heading = `${question.name ? `::${escape(question.name)}::` : ''}${renderContent(question.prompt)}`
  const general = question.generalFeedback ? `####${escape(question.generalFeedback.value)}` : ''
  if (question.kind === 'description') return heading
  if (question.kind === 'essay') return `${heading}{${general}}`
  if (question.kind === 'true-false') {
    const wrongFeedback = question.correctAnswer ? question.falseFeedback : question.trueFeedback
    const correctFeedback = question.correctAnswer ? question.trueFeedback : question.falseFeedback
    return `${heading}{${question.correctAnswer ? 'TRUE' : 'FALSE'}${feedback(wrongFeedback)}${feedback(correctFeedback)}${general}}`
  }
  if (question.kind === 'matching')
    return `${heading}{${question.pairs.map((pair) => `=${escape(pair.left.value)} -> ${escape(pair.right.value)}`).join('')}${general}}`
  if (question.kind === 'short-answer')
    return `${heading}{${question.answers.map((answer) => `${weight(answer.weight)}${escape(answer.value)}${feedback(answer.feedback)}`).join('')}${general}}`
  if (question.kind === 'multiple-choice')
    return `${heading}{${question.answers.map((answer) => `${weight(answer.weight)}${escape(answer.content.value)}${feedback(answer.feedback)}`).join('')}${general}}`
  return `${heading}{#${question.answers
    .map((answer) => {
      const prefix = answer.weight === 100 ? '=' : `=%${answer.weight}%`
      const value =
        answer.type === 'numerical-range'
          ? `${answer.min}..${answer.max}`
          : answer.type === 'numerical-tolerance'
            ? `${answer.value}:${answer.tolerance}`
            : `${answer.value}`
      return `${prefix}${value}${feedback(answer.feedback)}`
    })
    .join('')}${general}}`
}

export function stringifyGift(document: GiftDocument, options: StringifyGiftOptions = {}): string {
  const eol = options.lineEnding ?? '\n'
  return document.children
    .map((block) =>
      block.type === 'comment'
        ? `//${block.value}`
        : block.type === 'category'
          ? `$CATEGORY: ${block.path.map((part) => escape(part).replaceAll('/', '//')).join('/')}`
          : renderQuestion(block),
    )
    .join(`${eol}${eol}`)
}
