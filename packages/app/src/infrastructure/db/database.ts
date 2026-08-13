import { deleteDB, openDB, type IDBPDatabase } from 'idb'
import type {
  DeckRecord,
  FukushuDb,
  ImportRecord,
  ImportSourceRecord,
  QuestionRecord,
  ReviewLogRecord,
  SettingsRecord,
  StudyStateRecord,
} from './schema'
import { defaultSettings } from './schema'

const DB_NAME = 'gift-fsrs-learning'
let current: Promise<IDBPDatabase<FukushuDb>> | undefined
// Vue may pass reactive proxies through application services; IndexedDB cannot clone proxies.
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
export function openFukushuDatabase(name = DB_NAME): Promise<IDBPDatabase<FukushuDb>> {
  return openDB<FukushuDb>(name, 5, {
    upgrade(db, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) {
        const decks = db.createObjectStore('decks', { keyPath: 'id' })
        decks.createIndex('by-source', 'sourceId')
        db.createObjectStore('importSources', { keyPath: 'id' })
        const questions = db.createObjectStore('questions', { keyPath: 'id' })
        questions.createIndex('by-deck', 'deckId')
        questions.createIndex('by-deck-order', ['deckId', 'sourceOrder'])
        questions.createIndex('by-deck-source', ['deckId', 'sourceKey'], { unique: true })
        questions.createIndex('by-deck-enabled', ['deckId', 'enabledKey'])
        const states = db.createObjectStore('studyStates', { keyPath: 'questionId' })
        states.createIndex('by-due', 'card.due')
        states.createIndex('by-deck-due', ['deckId', 'card.due'])
        states.createIndex('by-deck-suspended', ['deckId', 'suspendedKey'])
        const logs = db.createObjectStore('reviewLogs', { keyPath: 'id' })
        logs.createIndex('by-question', 'questionId')
        logs.createIndex('by-deck-reviewed-at', ['deckId', 'reviewedAt'])
        logs.createIndex('by-reviewed-at', 'reviewedAt')
        db.createObjectStore('settings', { keyPath: 'id' })
        const imports = db.createObjectStore('imports', { keyPath: 'id' })
        imports.createIndex('by-deck', 'deckId')
      }
      if (oldVersion > 0 && oldVersion < 2) {
        const states = transaction.objectStore('studyStates')
        void states.openCursor().then(async function migrateState(cursor): Promise<void> {
          if (!cursor) return
          const value = cursor.value
          if (value.suspendedKey === undefined)
            await cursor.update({ ...value, suspendedKey: value.suspended ? 1 : 0 })
          await cursor.continue().then(migrateState)
        })
      }
      if (oldVersion > 0 && oldVersion < 3) {
        const decks = transaction.objectStore('decks')
        void decks.openCursor().then(async function migrateDeck(cursor): Promise<void> {
          if (!cursor) return
          const value = cursor.value
          if (value.studyMode === undefined) await cursor.update({ ...value, studyMode: 'quiz' })
          await cursor.continue().then(migrateDeck)
        })
      }
      if (oldVersion > 0 && oldVersion < 4) {
        const questions = transaction.objectStore('questions')
        questions.createIndex('by-deck-order', ['deckId', 'sourceOrder'])
        void questions.openCursor().then(async function migrateQuestion(cursor): Promise<void> {
          if (!cursor) return
          const value = cursor.value
          await cursor.update({
            ...value,
            ...(value.enabledKey === undefined ? { enabledKey: value.enabled ? 1 : 0 } : {}),
            ...(value.sourceOrder === undefined
              ? {
                  sourceOrder: value.payload?.sourceRange?.start.offset ?? Number.MAX_SAFE_INTEGER,
                }
              : {}),
          })
          await cursor.continue().then(migrateQuestion)
        })
      }
      if (oldVersion > 0 && oldVersion < 5) {
        db.createObjectStore('importSources', { keyPath: 'id' })
        const decks = transaction.objectStore('decks')
        decks.createIndex('by-source', 'sourceId')
        const sources = transaction.objectStore('importSources')
        void decks.openCursor().then(async function migrateSource(cursor): Promise<void> {
          if (!cursor) return
          const value = cursor.value
          const sourceId = globalThis.crypto.randomUUID()
          await sources.put({
            id: sourceId,
            sourceType: value.sourceType ?? 'gift',
            ...(value.sourceFileName ? { sourceFileName: value.sourceFileName } : {}),
            sourceHash: value.sourceHash ?? '',
            sourceText: value.sourceText ?? '',
            importedAt: value.importedAt,
            updatedAt: value.updatedAt,
          })
          await cursor.update({
            ...value,
            studyMode: value.studyMode ?? 'quiz',
            sourceType: value.sourceType ?? 'gift',
            sourceHash: value.sourceHash ?? '',
            sourceId,
            sourceDeckKey: value.name.normalize('NFKC').trim(),
          })
          await cursor.continue().then(migrateSource)
        })
      }
    },
  })
}
export function database(): Promise<IDBPDatabase<FukushuDb>> {
  current ??= openFukushuDatabase()
  return current
}
export const deckRepository = {
  all: async (): Promise<DeckRecord[]> => (await database()).getAll('decks'),
  get: async (id: string): Promise<DeckRecord | undefined> => (await database()).get('decks', id),
  bySource: async (sourceId: string): Promise<DeckRecord[]> =>
    (await database()).getAllFromIndex('decks', 'by-source', sourceId),
  put: async (value: DeckRecord): Promise<void> => {
    await (await database()).put('decks', plain(value))
  },
  saveImport: async (
    deck: DeckRecord,
    questions: QuestionRecord[],
    states: StudyStateRecord[],
    importRecord: ImportRecord,
  ): Promise<void> => {
    const db = await database()
    const tx = db.transaction(['decks', 'questions', 'studyStates', 'imports'], 'readwrite')
    await tx.objectStore('decks').put(plain(deck))
    await Promise.all(questions.map((value) => tx.objectStore('questions').put(plain(value))))
    await Promise.all(states.map((value) => tx.objectStore('studyStates').put(plain(value))))
    await tx.objectStore('imports').put(plain(importRecord))
    await tx.done
  },
  saveImports: async (
    entries: Array<{
      deck: DeckRecord
      questions: QuestionRecord[]
      states: StudyStateRecord[]
      importRecord: ImportRecord
    }>,
    source?: ImportSourceRecord,
  ): Promise<void> => {
    const db = await database()
    const tx = db.transaction(
      ['decks', 'questions', 'studyStates', 'imports', 'importSources'],
      'readwrite',
    )
    if (source) await tx.objectStore('importSources').put(plain(source))
    for (const entry of entries) {
      await tx.objectStore('decks').put(plain(entry.deck))
      for (const question of entry.questions) await tx.objectStore('questions').put(plain(question))
      for (const state of entry.states) await tx.objectStore('studyStates').put(plain(state))
      await tx.objectStore('imports').put(plain(entry.importRecord))
    }
    await tx.done
  },
  remove: async (id: string): Promise<void> => {
    const db = await database()
    const tx = db.transaction(
      ['decks', 'questions', 'studyStates', 'reviewLogs', 'imports'],
      'readwrite',
    )
    const questionIds = await tx.objectStore('questions').index('by-deck').getAllKeys(id)
    await Promise.all(questionIds.map((key) => tx.objectStore('questions').delete(key)))
    await Promise.all(questionIds.map((key) => tx.objectStore('studyStates').delete(key)))
    for (const log of await tx.objectStore('reviewLogs').getAll())
      if (log.deckId === id) await tx.objectStore('reviewLogs').delete(log.id)
    for (const value of await tx.objectStore('imports').index('by-deck').getAllKeys(id))
      await tx.objectStore('imports').delete(value)
    await tx.objectStore('decks').delete(id)
    await tx.done
  },
}
export const importSourceRepository = {
  get: async (id: string): Promise<ImportSourceRecord | undefined> =>
    (await database()).get('importSources', id),
  put: async (value: ImportSourceRecord): Promise<void> => {
    await (await database()).put('importSources', plain(value))
  },
}
export const questionRepository = {
  byDeck: async (deckId: string): Promise<QuestionRecord[]> => {
    const range = globalThis.IDBKeyRange.bound([deckId, 0], [deckId, Number.MAX_SAFE_INTEGER])
    return (await database()).getAllFromIndex('questions', 'by-deck-order', range)
  },
  get: async (id: string): Promise<QuestionRecord | undefined> =>
    (await database()).get('questions', id),
  put: async (value: QuestionRecord): Promise<void> => {
    await (await database()).put('questions', plain(value))
  },
}
export const stateRepository = {
  all: async (): Promise<StudyStateRecord[]> => (await database()).getAll('studyStates'),
  get: async (id: string): Promise<StudyStateRecord | undefined> =>
    (await database()).get('studyStates', id),
  put: async (value: StudyStateRecord): Promise<void> => {
    await (await database()).put('studyStates', plain(value))
  },
  recordReview: async (state: StudyStateRecord, log: ReviewLogRecord): Promise<void> => {
    const db = await database()
    const tx = db.transaction(['studyStates', 'reviewLogs'], 'readwrite')
    await Promise.all([
      tx.objectStore('studyStates').put(plain(state)),
      tx.objectStore('reviewLogs').add(plain(log)),
      tx.done,
    ])
  },
}
export const reviewRepository = {
  all: async (): Promise<ReviewLogRecord[]> => (await database()).getAll('reviewLogs'),
  add: async (value: ReviewLogRecord): Promise<void> => {
    await (await database()).add('reviewLogs', plain(value))
  },
  byQuestion: async (id: string): Promise<ReviewLogRecord[]> =>
    (await database()).getAllFromIndex('reviewLogs', 'by-question', id),
  removeByDeck: async (deckId: string): Promise<void> => {
    const db = await database()
    const tx = db.transaction('reviewLogs', 'readwrite')
    for (const log of await tx.store.getAll()) {
      if (log.deckId === deckId) await tx.store.delete(log.id)
    }
    await tx.done
  },
}
export const settingsRepository = {
  get: async (): Promise<SettingsRecord> => ({
    ...defaultSettings,
    ...((await (await database()).get('settings', 'global')) ?? {}),
  }),
  put: async (value: SettingsRecord): Promise<void> => {
    await (await database()).put('settings', plain(value))
  },
}
export async function clearDatabase(): Promise<void> {
  const db = await database()
  db.close()
  current = undefined
  await deleteDB(DB_NAME)
}
