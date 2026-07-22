import {
  parseGift,
  validateGift,
  type GiftContent,
  type GiftDiagnostic,
  type GiftQuestion,
} from '@fukushu/gift-parser'
import type { QuizContent, QuizQuestion } from '../domain/quiz/types'
import { createId, sha256 } from '../utils/id'

const toContent = (value: GiftContent): QuizContent => ({
  format: value.format,
  value: value.value,
})
const normalize = (value: string): string => value.trim().replace(/\s+/g, ' ')
const fingerprint = (question: GiftQuestion, categoryPath: string[]): string =>
  JSON.stringify({
    kind: question.kind,
    prompt: normalize(question.prompt.value),
    categoryPath,
    answer:
      question.kind === 'multiple-choice'
        ? question.answers.map((a) => [normalize(a.content.value), a.weight])
        : question.kind === 'true-false'
          ? question.correctAnswer
          : question.kind === 'short-answer'
            ? question.answers.map((a) => [normalize(a.value), a.weight])
            : question.kind === 'numerical'
              ? question.answers
              : question.kind,
  })

async function convert(
  question: GiftQuestion,
  deckId: string,
  categoryPath: string[],
  sourceKey: string,
): Promise<QuizQuestion> {
  const common = {
    id: createId(),
    deckId,
    sourceKey,
    ...(question.name === undefined ? {} : { name: question.name }),
    prompt: toContent(question.prompt),
    ...(question.generalFeedback ? { explanation: toContent(question.generalFeedback) } : {}),
    categoryPath,
    sourceRange: question.range,
    ...(/\[(?:no-shuffle|fixed|固定)\]/i.test(question.name ?? '')
      ? { shuffleChoices: false }
      : {}),
  }
  if (question.kind === 'multiple-choice')
    return {
      ...common,
      kind: question.mode === 'single' ? 'single-choice' : 'multiple-choice',
      choices: question.answers.map((answer) => ({
        id: createId(),
        content: toContent(answer.content),
        weight: answer.weight,
        ...(answer.feedback ? { feedback: toContent(answer.feedback) } : {}),
      })),
    }
  if (question.kind === 'true-false')
    return {
      ...common,
      kind: 'true-false',
      correctAnswer: question.correctAnswer,
      ...(question.trueFeedback ? { trueFeedback: toContent(question.trueFeedback) } : {}),
      ...(question.falseFeedback ? { falseFeedback: toContent(question.falseFeedback) } : {}),
    }
  if (question.kind === 'short-answer')
    return {
      ...common,
      kind: 'short-answer',
      answers: question.answers.map((answer) => ({
        value: answer.value,
        weight: answer.weight,
        ...(answer.feedback ? { feedback: toContent(answer.feedback) } : {}),
      })),
    }
  if (question.kind === 'numerical')
    return {
      ...common,
      kind: 'numerical',
      answers: question.answers.map((answer) =>
        answer.type === 'numerical-exact'
          ? {
              type: 'exact',
              value: answer.value,
              weight: answer.weight,
              ...(answer.feedback ? { feedback: toContent(answer.feedback) } : {}),
            }
          : answer.type === 'numerical-tolerance'
            ? {
                type: 'tolerance',
                value: answer.value,
                tolerance: answer.tolerance,
                weight: answer.weight,
                ...(answer.feedback ? { feedback: toContent(answer.feedback) } : {}),
              }
            : {
                type: 'range',
                min: answer.min,
                max: answer.max,
                weight: answer.weight,
                ...(answer.feedback ? { feedback: toContent(answer.feedback) } : {}),
              },
      ),
    }
  return { ...common, kind: 'unsupported', sourceKind: question.kind }
}

export interface ImportPreview {
  source: string
  sourceHash: string
  diagnostics: GiftDiagnostic[]
  questions: QuizQuestion[]
  counts: Record<string, number>
}
export async function previewGift(source: string, deckId: string): Promise<ImportPreview> {
  const parsed = parseGift(source)
  const diagnostics = [...parsed.diagnostics, ...validateGift(parsed.document)]
  const names = new Map<string, number>()
  for (const block of parsed.document.children)
    if (block.type === 'question' && block.name)
      names.set(block.name, (names.get(block.name) ?? 0) + 1)
  let categoryPath: string[] = []
  const questions: QuizQuestion[] = []
  const keys = new Set<string>()
  for (const block of parsed.document.children) {
    if (block.type === 'category') {
      categoryPath = block.path
      continue
    }
    if (block.type !== 'question') continue
    const hash = await sha256(fingerprint(block, categoryPath))
    const key =
      block.name && names.get(block.name) === 1
        ? block.name
        : block.name
          ? `${categoryPath.join('/')}:${block.name}`
          : hash
    if (keys.has(key))
      diagnostics.push({
        severity: 'error',
        code: 'GIFT_SOURCE_KEY_COLLISION',
        message: '同じ問題IDになる問題が複数あります。',
        range: block.range,
      })
    keys.add(key)
    questions.push(await convert(block, deckId, [...categoryPath], key))
  }
  const counts: Record<string, number> = {}
  for (const question of questions) counts[question.kind] = (counts[question.kind] ?? 0) + 1
  return { source, sourceHash: await sha256(source), diagnostics, questions, counts }
}
