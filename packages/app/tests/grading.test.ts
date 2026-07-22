import { describe, expect, it } from 'vitest'
import { gradeQuestion } from '../src/domain/quiz/grading'
import type {
  MultipleChoiceQuestion,
  NumericalQuestion,
  ShortAnswerQuestion,
} from '../src/domain/quiz/types'
import { prepareQuestion } from '../src/application/study'
import type { QuestionRecord } from '../src/infrastructure/db/schema'
const base = {
  id: 'q',
  deckId: 'd',
  sourceKey: 'q',
  prompt: { format: 'plain' as const, value: 'Q' },
  categoryPath: [],
}
describe('grading', () => {
  it('requires full score for correctness', () => {
    const question: MultipleChoiceQuestion = {
      ...base,
      kind: 'multiple-choice',
      choices: [
        { id: 'a', content: { format: 'plain', value: 'A' }, weight: 50 },
        { id: 'b', content: { format: 'plain', value: 'B' }, weight: 50 },
        { id: 'x', content: { format: 'plain', value: 'X' }, weight: -50 },
      ],
    }
    expect(gradeQuestion(question, ['a']).score).toBe(50)
    expect(gradeQuestion(question, ['a', 'x'])).toMatchObject({ score: 50, correct: false })
    expect(gradeQuestion(question, ['a', 'b']).correct).toBe(true)
  })
  it('grades numerical tolerance and range', () => {
    const question: NumericalQuestion = {
      ...base,
      kind: 'numerical',
      answers: [
        { type: 'tolerance', value: 3.14, tolerance: 0.01, weight: 100 },
        { type: 'range', min: 9, max: 11, weight: 100 },
      ],
    }
    expect(gradeQuestion(question, ['3.145']).correct).toBe(true)
    expect(gradeQuestion(question, ['10']).correct).toBe(true)
  })
  it('grades short answers case-insensitively with Unicode normalization', () => {
    const question: ShortAnswerQuestion = {
      ...base,
      kind: 'short-answer',
      answers: [{ value: 'Blue', weight: 100 }],
    }
    expect(gradeQuestion(question, [' blue ']).correct).toBe(true)
    expect(
      gradeQuestion({ ...question, answers: [{ value: 'Ａ', weight: 100 }] }, ['a']).correct,
    ).toBe(true)
  })
  it('does not shuffle fixed or special trailing choices', () => {
    const payload: MultipleChoiceQuestion = {
      ...base,
      kind: 'multiple-choice',
      choices: [
        { id: 'a', content: { format: 'plain', value: 'A' }, weight: 100 },
        { id: 'all', content: { format: 'plain', value: 'All of the above' }, weight: 0 },
      ],
    }
    const record = {
      id: 'q',
      deckId: 'd',
      sourceKey: 'q',
      kind: payload.kind,
      payload,
      enabled: true,
      enabledKey: 1,
      createdAt: '',
      updatedAt: '',
    } satisfies QuestionRecord
    expect(prepareQuestion(record, true).payload).toEqual(payload)
    expect(
      (
        prepareQuestion({ ...record, payload: { ...payload, shuffleChoices: false } }, true)
          .payload as MultipleChoiceQuestion
      ).choices,
    ).toEqual(payload.choices)
  })
})
