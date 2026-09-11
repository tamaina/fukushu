import * as v from 'valibot'
import { safeAnkiCss, safeAnkiHtml, safeAnkiSvg } from '@fukushu/anki-import/safety'
import { hashBlob, type BackupOptions, checkBackupCancelled } from './backupIO'
import { database, settingsRepository } from '../infrastructure/db/database'
import type {
  DeckRecord,
  QuestionRecord,
  ReviewLogRecord,
  SettingsRecord,
  StudyStateRecord,
  ImportSourceRecord,
  MediaRecord,
  ImportRecord,
} from '../infrastructure/db/schema'

interface BackupImportSource extends Omit<ImportSourceRecord, 'sourceArchive'> {
  sourceArchiveBase64?: string
}
interface BackupMedia extends Omit<MediaRecord, 'blob'> {
  blobBase64: string
}

export interface AppBackup {
  format: 'gift-fsrs-learning-backup'
  version: 1 | 2 | 3
  exportedAt: string
  appVersion: string
  settings: SettingsRecord
  decks: DeckRecord[]
  questions: QuestionRecord[]
  studyStates: StudyStateRecord[]
  reviewLogs: ReviewLogRecord[]
  importSources?: BackupImportSource[]
  media?: BackupMedia[]
  imports?: ImportRecord[]
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
const MatchingPairSchema = v.strictObject({
  id: v.string(),
  left: ContentSchema,
  right: ContentSchema,
})
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
    kind: v.literal('matching'),
    pairs: v.array(MatchingPairSchema),
  }),
  v.strictObject({
    ...commonQuestion,
    kind: v.literal('essay'),
  }),
  v.strictObject({
    ...commonQuestion,
    kind: v.literal('description'),
  }),
  v.strictObject({
    ...commonQuestion,
    kind: v.literal('flashcard'),
    answer: ContentSchema,
    typeAnswer: v.optional(v.boolean()),
    acceptedAnswer: v.optional(v.string()),
    ankiNoteType: v.optional(v.string()),
    ankiTags: v.optional(v.array(v.string())),
    ankiCss: v.optional(v.string()),
    ankiForceLight: v.optional(v.boolean()),
    ankiTemplateMode: v.optional(v.picklist(['native', 'isolated'])),
    ankiSource: v.optional(
      v.strictObject({
        guid: v.optional(v.string()),
        noteId: v.string(),
        cardId: v.string(),
        notetypeId: v.string(),
        ordinal: integer(),
        qfmt: v.string(),
        afmt: v.string(),
        css: v.string(),
      }),
    ),
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
  historyRevision: v.optional(v.string()),
  sourceType: v.picklist(['gift', 'anki-text', 'anki-package']),
  sourceFileName: v.optional(v.string()),
  sourceHash: v.string(),
  sourceText: v.optional(v.string()),
  sourceId: v.optional(v.string()),
  sourceDeckKey: v.optional(v.string()),
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
    'matching',
    'essay',
    'description',
    'flashcard',
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
  sourceRemoved: v.optional(v.boolean()),
  manualSuspended: v.optional(v.boolean()),
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
  origin: v.optional(
    v.strictObject({ sourceId: v.string(), cardId: v.string(), revlogId: v.string() }),
  ),
})
const BackupSchema = v.strictObject({
  format: v.literal('gift-fsrs-learning-backup'),
  version: v.union([v.literal(1), v.literal(2), v.literal(3)]),
  exportedAt: iso(),
  appVersion: v.string(),
  settings: SettingsSchema,
  decks: v.array(DeckSchema),
  questions: v.array(QuestionSchema),
  studyStates: v.array(StudyStateSchema),
  reviewLogs: v.array(ReviewLogSchema),
  importSources: v.optional(
    v.array(
      v.strictObject({
        id: v.string(),
        sourceType: v.picklist(['gift', 'anki-text', 'anki-package']),
        sourceFileName: v.optional(v.string()),
        sourceHash: v.string(),
        sourceText: v.optional(v.string()),
        sourceArchiveBase64: v.optional(v.string()),
        packageFormat: v.optional(v.picklist(['anki2', 'anki21', '21b'])),
        importProgress: v.optional(v.boolean()),
        forceLight: v.optional(v.boolean()),
        revision: v.optional(integer()),
        needsReimport: v.optional(v.boolean()),
        importedAt: iso(),
        updatedAt: iso(),
      }),
    ),
  ),
  imports: v.optional(
    v.array(
      v.strictObject({
        id: v.string(),
        deckId: v.string(),
        importedAt: iso(),
        sourceHash: v.string(),
        added: integer(),
        changed: integer(),
        disabled: integer(),
      }),
    ),
  ),
  media: v.optional(
    v.array(
      v.strictObject({
        id: v.string(),
        mimeType: v.string(),
        size: integer(),
        blobBase64: v.string(),
      }),
    ),
  ),
})

const blobToBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(binary)
}
const base64ToBlob = (value: string, type = 'application/octet-stream'): Blob => {
  const binary = atob(value)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new Blob([bytes], { type })
}

function validateRelations(backup: AppBackup): void {
  const unique = <T>(items: T[], key: (item: T) => string) => {
    const ids = new Set(items.map(key))
    if (ids.size !== items.length) throw new Error('Duplicate backup record.')
    return ids
  }
  const deckIds = unique(backup.decks, (deck) => deck.id)
  unique(backup.reviewLogs, (log) => log.id)
  unique(backup.media ?? [], (media) => media.id)
  unique(backup.imports ?? [], (item) => item.id)
  if (backup.importSources) {
    const sources = unique(backup.importSources, (source) => source.id)
    for (const deck of backup.decks)
      if (deck.sourceId && !sources.has(deck.sourceId))
        throw new Error('Deck references an unknown source.')
  }
  for (const item of backup.imports ?? [])
    if (!deckIds.has(item.deckId)) throw new Error('Import references an unknown deck.')
  const questionDecks = new Map(backup.questions.map((question) => [question.id, question.deckId]))
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
    if (!questionIds.has(state.questionId) || questionDecks.get(state.questionId) !== state.deckId)
      throw new Error('Study state references unknown data.')
    if (stateIds.has(state.questionId)) throw new Error('Duplicate study state.')
    stateIds.add(state.questionId)
  }
  for (const log of backup.reviewLogs) {
    if (!questionIds.has(log.questionId) || questionDecks.get(log.questionId) !== log.deckId)
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
    version: 3,
    exportedAt: new Date().toISOString(),
    appVersion: '0.1.0',
    settings: await settingsRepository.get(),
    decks: await db.getAll('decks'),
    questions: await db.getAll('questions'),
    studyStates: await db.getAll('studyStates'),
    reviewLogs: await db.getAll('reviewLogs'),
    importSources: await Promise.all(
      (await db.getAll('importSources')).map(async ({ sourceArchive, ...source }) => ({
        ...source,
        ...(sourceArchive ? { sourceArchiveBase64: await blobToBase64(sourceArchive) } : {}),
      })),
    ),
    media: await Promise.all(
      (await db.getAll('media')).map(async ({ blob, ...item }) => ({
        ...item,
        blobBase64: await blobToBase64(blob),
      })),
    ),
  }
}

export async function restoreBackup(value: unknown): Promise<void> {
  return restoreBackupData(value)
}

/** Binary attachments are verified file slices, never Base64-expanded in memory. */
export async function restoreBackupData(
  value: unknown,
  attachments?: { sources: Map<string, Blob>; media: Map<string, Blob> },
  options: BackupOptions = {},
): Promise<void> {
  const validated = v.parse(BackupSchema, value) as AppBackup
  const parsed: AppBackup = {
    ...validated,
    questions: restoreQuestionOrder(validated.questions),
  }
  const backupSources: BackupImportSource[] =
    parsed.importSources ??
    parsed.decks.map((deck) => ({
      id: deck.sourceId ?? deck.id,
      sourceType: deck.sourceType,
      ...(deck.sourceFileName ? { sourceFileName: deck.sourceFileName } : {}),
      sourceHash: deck.sourceHash,
      sourceText: deck.sourceText ?? '',
      importedAt: deck.importedAt,
      updatedAt: deck.updatedAt,
    }))
  const restoredSources: ImportSourceRecord[] = backupSources.map(
    ({ sourceArchiveBase64, ...source }) => ({
      ...source,
      ...(attachments?.sources.has(source.id)
        ? { sourceArchive: attachments.sources.get(source.id)! }
        : sourceArchiveBase64
          ? { sourceArchive: base64ToBlob(sourceArchiveBase64, 'application/zip') }
          : {}),
    }),
  )
  parsed.decks = parsed.decks.map((deck) => ({
    ...deck,
    sourceId: deck.sourceId ?? deck.id,
    sourceDeckKey: deck.sourceDeckKey ?? deck.name.normalize('NFKC').trim(),
  }))
  validateRelations(parsed)
  const mediaIds = new Set((parsed.media ?? []).map((m) => m.id))
  const restoredMedia: MediaRecord[] = []
  for (const { blobBase64, ...item } of parsed.media ?? []) {
    checkBackupCancelled(options)
    const blob = attachments?.media.get(item.id) ?? base64ToBlob(blobBase64, item.mimeType)
    if (blob.size !== item.size || (await hashBlob(blob, options)) !== item.id)
      throw new Error('Invalid backup media hash or size')
    if (item.mimeType === 'image/svg+xml') safeAnkiSvg(await blob.text())
    restoredMedia.push({ ...item, blob })
  }
  for (const record of parsed.questions) {
    const q = record.payload
    if (q.kind !== 'flashcard' || !q.ankiTemplateMode) continue
    if (q.prompt.format === 'html') q.prompt.value = safeAnkiHtml(q.prompt.value)
    if (q.answer.format === 'html') q.answer.value = safeAnkiHtml(q.answer.value)
    if (q.ankiCss !== undefined) q.ankiCss = safeAnkiCss(q.ankiCss)
    for (const match of (q.prompt.value + q.answer.value).matchAll(/fukushu-media:([a-f0-9]{64})/g))
      if (!mediaIds.has(match[1]!)) throw new Error('Missing backup media')
  }
  checkBackupCancelled(options)
  options.onProgress?.({ phase: 'saving', completed: 0, total: 0 })
  const db = await database()
  const tx = db.transaction(
    [
      'decks',
      'questions',
      'studyStates',
      'reviewLogs',
      'settings',
      'imports',
      'importSources',
      'media',
    ],
    'readwrite',
  )
  const abort = () => {
    try {
      tx.abort()
    } catch {
      /* already finished */
    }
  }
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    checkBackupCancelled(options)
    await Promise.all([
      tx.objectStore('decks').clear(),
      tx.objectStore('questions').clear(),
      tx.objectStore('studyStates').clear(),
      tx.objectStore('reviewLogs').clear(),
      tx.objectStore('settings').clear(),
      tx.objectStore('imports').clear(),
      tx.objectStore('importSources').clear(),
      tx.objectStore('media').clear(),
    ])
    await tx.objectStore('settings').put(parsed.settings)
    for (const item of parsed.decks) await tx.objectStore('decks').put(item)
    for (const item of restoredSources) await tx.objectStore('importSources').put(item)
    for (const item of parsed.questions) await tx.objectStore('questions').put(item)
    for (const item of parsed.studyStates) await tx.objectStore('studyStates').put(item)
    for (const item of parsed.reviewLogs) await tx.objectStore('reviewLogs').put(item)
    for (const item of restoredMedia) await tx.objectStore('media').put(item)
    for (const item of parsed.imports ?? []) await tx.objectStore('imports').put(item)
    await tx.done
  } catch (error) {
    abort()
    await tx.done.catch(() => {})
    checkBackupCancelled(options)
    throw error
  } finally {
    options.signal?.removeEventListener('abort', abort)
  }
  if (parsed.version < 3) await (await import('./apkgStore')).repairLegacyApkg()
}
