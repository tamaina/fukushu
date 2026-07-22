import type { SourceRange } from '@fukushu/gift-parser'

export type QuizTextFormat = 'plain' | 'html' | 'markdown' | 'moodle' | 'auto'
export interface QuizContent {
  format: QuizTextFormat
  value: string
}
export interface QuizDeck {
  id: string
  name: string
  description?: string
  sourceType: 'gift'
  sourceFileName?: string
  importedAt: string
  updatedAt: string
  questionCount: number
}
export interface QuizQuestionBase {
  id: string
  deckId: string
  sourceKey: string
  name?: string
  prompt: QuizContent
  categoryPath: string[]
  explanation?: QuizContent
  sourceRange?: SourceRange
  /** False when option order carries meaning. */
  shuffleChoices?: boolean
}
export interface QuizChoice {
  id: string
  content: QuizContent
  weight: number
  feedback?: QuizContent
}
export interface SingleChoiceQuestion extends QuizQuestionBase {
  kind: 'single-choice'
  choices: QuizChoice[]
}
export interface MultipleChoiceQuestion extends QuizQuestionBase {
  kind: 'multiple-choice'
  choices: QuizChoice[]
}
export interface TrueFalseQuestion extends QuizQuestionBase {
  kind: 'true-false'
  correctAnswer: boolean
  trueFeedback?: QuizContent
  falseFeedback?: QuizContent
}
export interface ShortAnswerOption {
  value: string
  weight: number
  feedback?: QuizContent
}
export interface ShortAnswerQuestion extends QuizQuestionBase {
  kind: 'short-answer'
  answers: ShortAnswerOption[]
}
export interface NumericalAnswer {
  type: 'exact' | 'tolerance' | 'range'
  value?: number
  tolerance?: number
  min?: number
  max?: number
  weight: number
  feedback?: QuizContent
}
export interface NumericalQuestion extends QuizQuestionBase {
  kind: 'numerical'
  answers: NumericalAnswer[]
}
export interface UnsupportedQuestion extends QuizQuestionBase {
  kind: 'unsupported'
  sourceKind: 'matching' | 'essay' | 'description'
}
export type QuizQuestion =
  | SingleChoiceQuestion
  | MultipleChoiceQuestion
  | TrueFalseQuestion
  | ShortAnswerQuestion
  | NumericalQuestion
  | UnsupportedQuestion
export interface GradeResult {
  score: number
  correct: boolean
  feedback: QuizContent[]
}
