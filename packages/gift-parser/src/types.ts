export interface SourcePosition {
  offset: number
  line: number
  column: number
}
export interface SourceRange {
  start: SourcePosition
  end: SourcePosition
}
export type GiftTextFormat = 'plain' | 'html' | 'markdown' | 'moodle' | 'auto'
export interface GiftContent {
  type: 'content'
  format: GiftTextFormat
  value: string
  range: SourceRange
}
export interface GiftQuestionBase {
  type: 'question'
  kind: GiftQuestionKind
  name?: string
  prompt: GiftContent
  generalFeedback?: GiftContent
  format: GiftTextFormat
  range: SourceRange
}
export type GiftQuestionKind =
  | 'multiple-choice'
  | 'true-false'
  | 'short-answer'
  | 'matching'
  | 'numerical'
  | 'essay'
  | 'description'
export interface GiftChoiceAnswer {
  type: 'choice-answer'
  content: GiftContent
  weight: number
  feedback?: GiftContent
  range: SourceRange
}
export interface GiftMultipleChoiceQuestion extends GiftQuestionBase {
  kind: 'multiple-choice'
  mode: 'single' | 'multiple'
  answers: GiftChoiceAnswer[]
}
export interface GiftTrueFalseQuestion extends GiftQuestionBase {
  kind: 'true-false'
  correctAnswer: boolean
  trueFeedback?: GiftContent
  falseFeedback?: GiftContent
}
export interface GiftShortAnswer {
  type: 'short-answer-option'
  value: string
  weight: number
  feedback?: GiftContent
  range: SourceRange
}
export interface GiftShortAnswerQuestion extends GiftQuestionBase {
  kind: 'short-answer'
  answers: GiftShortAnswer[]
}
export interface GiftMatchingPair {
  type: 'matching-pair'
  left: GiftContent
  right: GiftContent
  range: SourceRange
}
export interface GiftMatchingQuestion extends GiftQuestionBase {
  kind: 'matching'
  pairs: GiftMatchingPair[]
}
export interface GiftNumericalBase {
  weight: number
  feedback?: GiftContent
  range: SourceRange
}
export interface GiftExactNumericalAnswer extends GiftNumericalBase {
  type: 'numerical-exact'
  value: number
}
export interface GiftToleranceNumericalAnswer extends GiftNumericalBase {
  type: 'numerical-tolerance'
  value: number
  tolerance: number
}
export interface GiftRangeNumericalAnswer extends GiftNumericalBase {
  type: 'numerical-range'
  min: number
  max: number
}
export type GiftNumericalAnswer =
  GiftExactNumericalAnswer | GiftToleranceNumericalAnswer | GiftRangeNumericalAnswer
export interface GiftNumericalQuestion extends GiftQuestionBase {
  kind: 'numerical'
  answers: GiftNumericalAnswer[]
}
export interface GiftEssayQuestion extends GiftQuestionBase {
  kind: 'essay'
}
export interface GiftDescriptionQuestion extends GiftQuestionBase {
  kind: 'description'
}
export type GiftQuestion =
  | GiftMultipleChoiceQuestion
  | GiftTrueFalseQuestion
  | GiftShortAnswerQuestion
  | GiftMatchingQuestion
  | GiftNumericalQuestion
  | GiftEssayQuestion
  | GiftDescriptionQuestion
export interface GiftCategoryDirective {
  type: 'category'
  path: string[]
  range: SourceRange
}
export interface GiftComment {
  type: 'comment'
  value: string
  range: SourceRange
}
export type GiftBlock = GiftCategoryDirective | GiftQuestion | GiftComment
export interface GiftDocument {
  type: 'document'
  version: 1
  children: GiftBlock[]
  range: SourceRange
}
export interface GiftDiagnostic {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  range: SourceRange
}
export interface ParseGiftOptions {
  preserveComments?: boolean
}
export interface ValidateGiftOptions {
  maxQuestions?: number
  maxPromptLength?: number
  maxAnswers?: number
}
export interface StringifyGiftOptions {
  lineEnding?: '\n' | '\r\n'
}
export interface ParseGiftResult {
  document: GiftDocument
  diagnostics: GiftDiagnostic[]
}
