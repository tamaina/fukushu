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
  sourceType: 'gift' | 'anki-text'
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
export interface MatchingPair {
  id: string
  left: QuizContent
  right: QuizContent
}
export interface MatchingQuestion extends QuizQuestionBase {
  kind: 'matching'
  pairs: MatchingPair[]
  /** Transient option order prepared for a study session. */
  matchingOptionOrder?: string[]
}
export interface EssayQuestion extends QuizQuestionBase {
  kind: 'essay'
}
export interface DescriptionQuestion extends QuizQuestionBase {
  kind: 'description'
}
export interface FlashcardQuestion extends QuizQuestionBase {
  kind: 'flashcard'
  answer: QuizContent
  /** When true, the learner types the plain-text answer before revealing the card back. */
  typeAnswer?: boolean
  acceptedAnswer?: string
  ankiNoteType?: string
  ankiTags?: string[]
}
export interface UnsupportedQuestion extends QuizQuestionBase {
  kind: 'unsupported'
  /** Kept so version 1 backups made by older releases remain readable. */
  sourceKind: 'matching' | 'essay' | 'description'
}
export type QuizQuestion =
  | SingleChoiceQuestion
  | MultipleChoiceQuestion
  | TrueFalseQuestion
  | ShortAnswerQuestion
  | NumericalQuestion
  | MatchingQuestion
  | EssayQuestion
  | DescriptionQuestion
  | FlashcardQuestion
  | UnsupportedQuestion
export interface GradeResult {
  score: number
  correct: boolean
  feedback: QuizContent[]
}
