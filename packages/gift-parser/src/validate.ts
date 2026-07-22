import type { GiftDiagnostic, GiftDocument, ValidateGiftOptions } from './types'

export function validateGift(
  document: GiftDocument,
  options: ValidateGiftOptions = {},
): GiftDiagnostic[] {
  const diagnostics: GiftDiagnostic[] = []
  const questions = document.children.filter((block) => block.type === 'question')
  const maxQuestions = options.maxQuestions ?? 20_000
  if (questions.length > maxQuestions)
    diagnostics.push({
      severity: 'error',
      code: 'GIFT_TOO_MANY_QUESTIONS',
      message: `問題数が上限の${maxQuestions}問を超えています。`,
      range: document.range,
    })
  for (const question of questions) {
    if (question.kind === 'matching' && question.pairs.length < 3)
      diagnostics.push({
        severity: 'error',
        code: 'GIFT_MATCHING_TOO_FEW_PAIRS',
        message: '組み合わせ問題には3組以上の対応が必要です。',
        range: question.range,
      })
    if (question.prompt.value.length > (options.maxPromptLength ?? 100_000))
      diagnostics.push({
        severity: 'error',
        code: 'GIFT_PROMPT_TOO_LONG',
        message: '問題文が長すぎます。',
        range: question.prompt.range,
      })
    const answerCount =
      question.kind === 'multiple-choice' ||
      question.kind === 'short-answer' ||
      question.kind === 'numerical'
        ? question.answers.length
        : question.kind === 'matching'
          ? question.pairs.length
          : 0
    if (answerCount > (options.maxAnswers ?? 100))
      diagnostics.push({
        severity: 'error',
        code: 'GIFT_TOO_MANY_ANSWERS',
        message: '選択肢または解答候補が多すぎます。',
        range: question.range,
      })
  }
  return diagnostics
}
