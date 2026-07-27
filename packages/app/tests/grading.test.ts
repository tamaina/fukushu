import { describe, expect, it, vi } from 'vitest'
import { gradeQuestion } from '../src/domain/quiz/grading'
import type {
  MatchingQuestion,
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
  it('grades matching pairs only when every pair is correct', () => {
    const question: MatchingQuestion = {
      ...base,
      kind: 'matching',
      pairs: [
        {
          id: 'a',
          left: { format: 'plain', value: 'Japan' },
          right: { format: 'plain', value: 'Tokyo' },
        },
        {
          id: 'b',
          left: { format: 'plain', value: 'France' },
          right: { format: 'plain', value: 'Paris' },
        },
      ],
    }
    expect(gradeQuestion(question, ['a\u0000a', 'b\u0000b'])).toEqual({
      score: 100,
      correct: true,
      feedback: [],
    })
    expect(gradeQuestion(question, ['a\u0000b', 'b\u0000b'])).toMatchObject({
      score: 50,
      correct: false,
    })
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
      sourceOrder: 0,
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
  it('shuffles matching prompts and options independently', () => {
    const payload: MatchingQuestion = {
      ...base,
      kind: 'matching',
      pairs: [
        {
          id: 'a',
          left: { format: 'plain', value: 'A' },
          right: { format: 'plain', value: '1' },
        },
        {
          id: 'b',
          left: { format: 'plain', value: 'B' },
          right: { format: 'plain', value: '2' },
        },
        {
          id: 'c',
          left: { format: 'plain', value: 'C' },
          right: { format: 'plain', value: '3' },
        },
      ],
    }
    const record = {
      id: 'q',
      deckId: 'd',
      sourceKey: 'q',
      sourceOrder: 0,
      kind: payload.kind,
      payload,
      enabled: true,
      enabledKey: 1,
      createdAt: '',
      updatedAt: '',
    } satisfies QuestionRecord
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const prepared = prepareQuestion(record, true).payload as MatchingQuestion
    expect(prepared.pairs.map((pair) => pair.id)).toEqual(['b', 'c', 'a'])
    expect(prepared.matchingOptionOrder).toEqual(['c', 'a', 'b'])
    vi.restoreAllMocks()
  })
})
