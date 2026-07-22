import type { DBSchema } from 'idb'
import type { QuizQuestion } from '../../domain/quiz/types'

export interface StoredFsrsCard {
  due: string
  stability: number
  difficulty: number
  elapsedDays: number
  scheduledDays: number
  reps: number
  lapses: number
  state: number
  lastReview?: string
}
export interface StoredFsrsReviewLog {
  rating: number
  state: number
  due: string
  stability: number
  difficulty: number
  elapsedDays: number
  lastElapsedDays: number
  scheduledDays: number
  review: string
}
export interface DeckRecord {
  id: string
  name: string
  description?: string
  sourceType: 'gift'
  sourceFileName?: string
  sourceHash: string
  sourceText?: string
  importedAt: string
  updatedAt: string
  questionCount: number
  enabledQuestionCount: number
}
export interface QuestionRecord {
  id: string
  deckId: string
  sourceKey: string
  kind: QuizQuestion['kind']
  payload: QuizQuestion
  enabled: boolean
  enabledKey: 0 | 1
  createdAt: string
  updatedAt: string
}
export interface StudyStateRecord {
  questionId: string
  deckId: string
  card: StoredFsrsCard
  suspended: boolean
  suspendedKey: 0 | 1
  buriedUntil?: string
  updatedAt: string
}
export interface ReviewLogRecord {
  id: string
  questionId: string
  deckId: string
  reviewedAt: string
  rating: 'again' | 'hard' | 'good' | 'easy'
  correct: boolean
  selectedAnswerIds?: string[]
  responseText?: string
  durationMs?: number
  fsrsLog: StoredFsrsReviewLog
}
export interface SettingsRecord {
  id: 'global'
  desiredRetention: number
  newQuestionsPerDay: number
  maxReviewsPerDay: number | null
  shuffleChoices: boolean
  showImmediateFeedback: boolean
  locale: 'ja' | 'en'
  theme: 'system' | 'light' | 'dark'
}
export interface ImportRecord {
  id: string
  deckId: string
  importedAt: string
  sourceHash: string
  added: number
  changed: number
  disabled: number
}
export interface FukushuDb extends DBSchema {
  decks: { key: string; value: DeckRecord }
  questions: {
    key: string
    value: QuestionRecord
    indexes: {
      'by-deck': string
      'by-deck-source': [string, string]
      'by-deck-enabled': [string, number]
    }
  }
  studyStates: {
    key: string
    value: StudyStateRecord
    indexes: {
      'by-due': string
      'by-deck-due': [string, string]
      'by-deck-suspended': [string, number]
    }
  }
  reviewLogs: {
    key: string
    value: ReviewLogRecord
    indexes: {
      'by-question': string
      'by-deck-reviewed-at': [string, string]
      'by-reviewed-at': string
    }
  }
  settings: { key: string; value: SettingsRecord }
  imports: { key: string; value: ImportRecord; indexes: { 'by-deck': string } }
}
export const defaultSettings: SettingsRecord = {
  id: 'global',
  desiredRetention: 0.9,
  newQuestionsPerDay: 20,
  maxReviewsPerDay: null,
  shuffleChoices: true,
  showImmediateFeedback: true,
  locale: 'ja',
  theme: 'system',
}
