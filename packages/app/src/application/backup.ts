import * as v from 'valibot'
import { database, settingsRepository } from '../infrastructure/db/database'
import type {
  DeckRecord,
  QuestionRecord,
  ReviewLogRecord,
  SettingsRecord,
  StudyStateRecord,
} from '../infrastructure/db/schema'

export interface AppBackup {
  format: 'gift-fsrs-learning-backup'
  version: 1
  exportedAt: string
  appVersion: string
  settings: SettingsRecord
  decks: DeckRecord[]
  questions: QuestionRecord[]
  studyStates: StudyStateRecord[]
  reviewLogs: ReviewLogRecord[]
}

const iso = () => v.pipe(v.string(), v.isoTimestamp())
const integer = (minimum = 0) => v.pipe(v.number(), v.finite(), v.integer(), v.minValue(minimum))
const bounded = (minimum: number, maximum: number) =>
  v.pipe(v.number(), v.finite(), v.minValue(minimum), v.maxValue(maximum))
const FormatSchema = v.picklist(['plain', 'html', 'markdown', 'moodle', 'auto'])
const ContentSchema = v.strictObject({ format: FormatSchema, value: v.string() })
const PositionSchema = v.strictObject({ offset: integer(), line: integer(1), column: integer(1) })
const RangeSchema = v.strictObject({ start: PositionSchema, end: PositionSchema })
const commonQuestion = {
  id: v.string(),
  deckId: v.string(),
  sourceKey: v.string(),
  name: v.optional(v.string()),
  prompt: ContentSchema,
  categoryPath: v.array(v.string()),
  explanation: v.optional(ContentSchema),
  sourceRange: v.optional(RangeSchema),
  shuffleChoices: v.optional(v.boolean()),
}
const ChoiceSchema = v.strictObject({
  id: v.string(),
  content: ContentSchema,
  weight: bounded(-100, 100),
  feedback: v.optional(ContentSchema),
})
const ShortAnswerSchema = v.strictObject({
  value: v.string(),
  weight: bounded(-100, 100),
  feedback: v.optional(ContentSchema),
})
const NumericalAnswerSchema = v.variant('type', [
  v.strictObject({
    type: v.literal('exact'),
    value: v.pipe(v.number(), v.finite()),
    weight: bounded(-100, 100),
    feedback: v.optional(ContentSchema),
  }),
  v.strictObject({
    type: v.literal('tolerance'),
    value: v.pipe(v.number(), v.finite()),
    tolerance: v.pipe(v.number(), v.finite(), v.minValue(0)),
    weight: bounded(-100, 100),
    feedback: v.optional(ContentSchema),
  }),
  v.strictObject({
    type: v.literal('range'),
    min: v.pipe(v.number(), v.finite()),
    max: v.pipe(v.number(), v.finite()),
    weight: bounded(-100, 100),
    feedback: v.optional(ContentSchema),
  }),
])
const QuizQuestionSchema = v.variant('kind', [
  v.strictObject({
    ...commonQuestion,
    kind: v.literal('single-choice'),
    choices: v.array(ChoiceSchema),
  }),
  v.strictObject({
    ...commonQuestion,
    kind: v.literal('multiple-choice'),
    choices: v.array(ChoiceSchema),
  }),
  v.strictObject({
    ...commonQuestion,
    kind: v.literal('true-false'),
    correctAnswer: v.boolean(),
    trueFeedback: v.optional(ContentSchema),
    falseFeedback: v.optional(ContentSchema),
  }),
  v.strictObject({
    ...commonQuestion,
    kind: v.literal('short-answer'),
    answers: v.array(ShortAnswerSchema),
  }),
  v.strictObject({
    ...commonQuestion,
    kind: v.literal('numerical'),
    answers: v.array(NumericalAnswerSchema),
  }),
  v.strictObject({
    ...commonQuestion,
    kind: v.literal('unsupported'),
    sourceKind: v.picklist(['matching', 'essay', 'description']),
  }),
])
const CardSchema = v.strictObject({
  due: iso(),
  stability: v.pipe(v.number(), v.finite(), v.minValue(0)),
  difficulty: v.pipe(v.number(), v.finite(), v.minValue(0)),
  elapsedDays: integer(),
  scheduledDays: integer(),
  reps: integer(),
  lapses: integer(),
  state: v.pipe(integer(), v.maxValue(3)),
  lastReview: v.optional(iso()),
})
const FsrsLogSchema = v.strictObject({
  rating: v.pipe(integer(1), v.maxValue(4)),
  state: v.pipe(integer(), v.maxValue(3)),
  due: iso(),
  stability: v.pipe(v.number(), v.finite(), v.minValue(0)),
  difficulty: v.pipe(v.number(), v.finite(), v.minValue(0)),
  elapsedDays: integer(),
  lastElapsedDays: integer(),
  scheduledDays: integer(),
  review: iso(),
})
const SettingsSchema = v.strictObject({
  id: v.literal('global'),
  desiredRetention: bounded(0.8, 0.97),
  newQuestionsPerDay: v.pipe(integer(), v.maxValue(200)),
  maxReviewsPerDay: v.nullable(v.pipe(integer(1), v.maxValue(1000))),
  checkpointInterval: v.optional(v.pipe(integer(), v.maxValue(1000)), 20),
  shuffleChoices: v.boolean(),
  showImmediateFeedback: v.boolean(),
  locale: v.picklist(['ja', 'en']),
  theme: v.picklist(['system', 'light', 'dark']),
})
const DeckSchema = v.strictObject({
  id: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  studyMode: v.optional(v.picklist(['flashcard', 'quiz']), 'quiz'),
  sourceType: v.literal('gift'),
  sourceFileName: v.optional(v.string()),
  sourceHash: v.string(),
  sourceText: v.optional(v.string()),
  importedAt: iso(),
  updatedAt: iso(),
  questionCount: integer(),
  enabledQuestionCount: integer(),
})
const QuestionSchema = v.strictObject({
  id: v.string(),
  deckId: v.string(),
  sourceKey: v.string(),
  sourceOrder: v.optional(integer()),
  kind: v.picklist([
    'single-choice',
    'multiple-choice',
    'true-false',
    'short-answer',
    'numerical',
    'unsupported',
  ]),
  payload: QuizQuestionSchema,
  enabled: v.boolean(),
  enabledKey: v.union([v.literal(0), v.literal(1)]),
  createdAt: iso(),
  updatedAt: iso(),
})
const StudyStateSchema = v.strictObject({
  questionId: v.string(),
  deckId: v.string(),
  card: CardSchema,
  suspended: v.boolean(),
  suspendedKey: v.union([v.literal(0), v.literal(1)]),
  buriedUntil: v.optional(iso()),
  updatedAt: iso(),
})
const ReviewLogSchema = v.strictObject({
  id: v.string(),
  questionId: v.string(),
  deckId: v.string(),
  reviewedAt: iso(),
  rating: v.picklist(['again', 'hard', 'good', 'easy']),
  correct: v.boolean(),
  selectedAnswerIds: v.optional(v.array(v.string())),
  responseText: v.optional(v.string()),
  durationMs: v.optional(integer()),
  fsrsLog: FsrsLogSchema,
})
const BackupSchema = v.strictObject({
  format: v.literal('gift-fsrs-learning-backup'),
  version: v.literal(1),
  exportedAt: iso(),
  appVersion: v.string(),
  settings: SettingsSchema,
  decks: v.array(DeckSchema),
  questions: v.array(QuestionSchema),
  studyStates: v.array(StudyStateSchema),
  reviewLogs: v.array(ReviewLogSchema),
})

function validateRelations(backup: AppBackup): void {
  const deckIds = new Set(backup.decks.map((deck) => deck.id))
  const questionIds = new Set<string>()
  const sourceKeys = new Set<string>()
  const sourceOrders = new Set<string>()
  for (const question of backup.questions) {
    if (!deckIds.has(question.deckId)) throw new Error('Question references an unknown deck.')
    if (questionIds.has(question.id)) throw new Error('Duplicate question ID.')
    const composite = `${question.deckId}\u0000${question.sourceKey}`
    if (sourceKeys.has(composite)) throw new Error('Duplicate source key in a deck.')
    const orderComposite = `${question.deckId}\u0000${question.sourceOrder}`
    if (sourceOrders.has(orderComposite)) throw new Error('Duplicate source order in a deck.')
    if (
      question.payload.id !== question.id ||
      question.payload.deckId !== question.deckId ||
      question.payload.kind !== question.kind
    ) {
      throw new Error('Question record and payload do not agree.')
    }
    questionIds.add(question.id)
    sourceKeys.add(composite)
    sourceOrders.add(orderComposite)
  }
  const stateIds = new Set<string>()
  for (const state of backup.studyStates) {
    if (!questionIds.has(state.questionId) || !deckIds.has(state.deckId))
      throw new Error('Study state references unknown data.')
    if (stateIds.has(state.questionId)) throw new Error('Duplicate study state.')
    stateIds.add(state.questionId)
  }
  for (const log of backup.reviewLogs) {
    if (!questionIds.has(log.questionId) || !deckIds.has(log.deckId))
      throw new Error('Review log references unknown data.')
  }
}

function restoreQuestionOrder(questions: QuestionRecord[]): QuestionRecord[] {
  const byDeck = new Map<string, QuestionRecord[]>()
  for (const question of questions) {
    const deckQuestions = byDeck.get(question.deckId) ?? []
    deckQuestions.push(question)
    byDeck.set(question.deckId, deckQuestions)
  }
  return [...byDeck.values()].flatMap((deckQuestions) => {
    if (deckQuestions.every((question) => question.sourceOrder !== undefined)) return deckQuestions
    return [...deckQuestions]
      .sort(
        (left, right) =>
          (left.payload.sourceRange?.start.offset ?? Number.MAX_SAFE_INTEGER) -
          (right.payload.sourceRange?.start.offset ?? Number.MAX_SAFE_INTEGER),
      )
      .map((question, sourceOrder) => ({ ...question, sourceOrder }))
  })
}

export async function createBackup(): Promise<AppBackup> {
  const db = await database()
  return {
    format: 'gift-fsrs-learning-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    appVersion: '0.1.0',
    settings: await settingsRepository.get(),
    decks: await db.getAll('decks'),
    questions: await db.getAll('questions'),
    studyStates: await db.getAll('studyStates'),
    reviewLogs: await db.getAll('reviewLogs'),
  }
}

export async function restoreBackup(value: unknown): Promise<void> {
  const validated = v.parse(BackupSchema, value) as AppBackup
  const parsed: AppBackup = {
    ...validated,
    questions: restoreQuestionOrder(validated.questions),
  }
  validateRelations(parsed)
  const db = await database()
  const tx = db.transaction(
    ['decks', 'questions', 'studyStates', 'reviewLogs', 'settings', 'imports'],
    'readwrite',
  )
  await Promise.all([
    tx.objectStore('decks').clear(),
    tx.objectStore('questions').clear(),
    tx.objectStore('studyStates').clear(),
    tx.objectStore('reviewLogs').clear(),
    tx.objectStore('settings').clear(),
    tx.objectStore('imports').clear(),
  ])
  await tx.objectStore('settings').put(parsed.settings)
  await Promise.all(parsed.decks.map((item) => tx.objectStore('decks').put(item)))
  await Promise.all(parsed.questions.map((item) => tx.objectStore('questions').put(item)))
  await Promise.all(parsed.studyStates.map((item) => tx.objectStore('studyStates').put(item)))
  await Promise.all(parsed.reviewLogs.map((item) => tx.objectStore('reviewLogs').put(item)))
  await tx.done
}
