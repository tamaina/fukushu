import { deleteDB, openDB, type IDBPDatabase } from 'idb'
import type {
  DeckRecord,
  FukushuDb,
  ImportRecord,
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
  return openDB<FukushuDb>(name, 3, {
    upgrade(db, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) {
        db.createObjectStore('decks', { keyPath: 'id' })
        const questions = db.createObjectStore('questions', { keyPath: 'id' })
        questions.createIndex('by-deck', 'deckId')
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
        const questions = transaction.objectStore('questions')
        void questions.openCursor().then(async function migrateQuestion(cursor): Promise<void> {
          if (!cursor) return
          const value = cursor.value
          if (value.enabledKey === undefined)
            await cursor.update({ ...value, enabledKey: value.enabled ? 1 : 0 })
          await cursor.continue().then(migrateQuestion)
        })
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
export const questionRepository = {
  byDeck: async (deckId: string): Promise<QuestionRecord[]> =>
    (await database()).getAllFromIndex('questions', 'by-deck', deckId),
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
  get: async (): Promise<SettingsRecord> =>
    (await (await database()).get('settings', 'global')) ?? { ...defaultSettings },
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
