import { afterEach, describe, expect, it } from 'vitest'
import { previewGift } from '../src/application/importGift'
import { saveNewDeck, updateDeck } from '../src/application/decks'
import { createBackup, restoreBackup } from '../src/application/backup'
import {
  clearDatabase,
  database,
  deckRepository,
  questionRepository,
  stateRepository,
} from '../src/infrastructure/db/database'
import { createId } from '../src/utils/id'
import { deleteDB, openDB } from 'idb'
import { openFukushuDatabase } from '../src/infrastructure/db/database'

afterEach(async () => clearDatabase())

describe('IndexedDB repositories', () => {
  it('migrates legacy helper keys and defaults decks to quiz mode', async () => {
    const name = `migration-${createId()}`
    const legacy = await openDB(name, 1, {
      upgrade(db) {
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
      },
    })
    await legacy.put('questions', { id: 'q', deckId: 'd', sourceKey: 'q', enabled: true })
    await legacy.put('questions', {
      id: 'q-late',
      deckId: 'd',
      sourceKey: 'q-late',
      enabled: true,
      payload: { sourceRange: { start: { offset: 100 } } },
    })
    await legacy.put('questions', {
      id: 'q-early',
      deckId: 'd',
      sourceKey: 'q-early',
      enabled: true,
      payload: { sourceRange: { start: { offset: 10 } } },
    })
    await legacy.put('studyStates', { questionId: 'q', deckId: 'd', suspended: false })
    await legacy.put('decks', { id: 'd', name: 'legacy' })
    legacy.close()
    const migrated = await openFukushuDatabase(name)
    expect((await migrated.get('questions', 'q'))?.enabledKey).toBe(1)
    expect(
      (
        await migrated.getAllFromIndex(
          'questions',
          'by-deck-order',
          globalThis.IDBKeyRange.bound(['d', 0], ['d', Number.MAX_SAFE_INTEGER]),
        )
      ).map((question) => question.id),
    ).toEqual(['q-early', 'q-late', 'q'])
    expect((await migrated.get('studyStates', 'q'))?.suspendedKey).toBe(0)
    expect((await migrated.get('decks', 'd'))?.studyMode).toBe('quiz')
    migrated.close()
    await deleteDB(name)
  })
  it('creates all stores and transactionally imports a deck', async () => {
    const db = await database()
    expect([...db.objectStoreNames]).toEqual(
      expect.arrayContaining([
        'decks',
        'questions',
        'studyStates',
        'reviewLogs',
        'settings',
        'imports',
      ]),
    )
    const preview = await previewGift('Q {=yes ~no}', createId())
    const id = await saveNewDeck('test', preview)
    expect((await deckRepository.get(id))?.studyMode).toBe('quiz')
    expect(await questionRepository.byDeck(id)).toHaveLength(1)
    expect((await stateRepository.all())[0]?.card.reps).toBe(0)
  })

  it('preserves GIFT source order across imports and reordered updates', async () => {
    const deckId = await saveNewDeck(
      'ordered',
      await previewGift(
        '::one::First {TRUE}\n\n::two::Second {TRUE}\n\n::three::Third {TRUE}',
        createId(),
      ),
    )
    expect(
      (await questionRepository.byDeck(deckId)).map((question) => question.payload.name),
    ).toEqual(['one', 'two', 'three'])
    expect(
      (await questionRepository.byDeck(deckId)).map((question) => question.sourceOrder),
    ).toEqual([0, 1, 2])

    await updateDeck(
      deckId,
      await previewGift(
        '::three::Third {TRUE}\n\n::one::First {TRUE}\n\n::two::Second {TRUE}',
        deckId,
      ),
    )
    expect(
      (await questionRepository.byDeck(deckId)).map((question) => question.payload.name),
    ).toEqual(['three', 'one', 'two'])
  })

  it('round-trips a validated backup', async () => {
    const preview = await previewGift('Q {TRUE}', createId())
    await saveNewDeck('backup', preview)
    const backup = await createBackup()
    await clearDatabase()
    await restoreBackup(backup)
    expect((await deckRepository.all())[0]?.name).toBe('backup')
    expect(await questionRepository.byDeck(backup.decks[0]!.id)).toHaveLength(1)
  })

  it('restores version 1 backups created before study modes as quiz decks', async () => {
    await saveNewDeck('legacy backup', await previewGift('Q {TRUE}', createId()))
    const backup = await createBackup()
    const legacyBackup = structuredClone(backup) as unknown as {
      decks: Array<Record<string, unknown>>
      questions: Array<Record<string, unknown>>
    }
    delete legacyBackup.decks[0]!.studyMode
    delete legacyBackup.questions[0]!.sourceOrder
    await clearDatabase()
    await restoreBackup(legacyBackup)
    expect((await deckRepository.all())[0]?.studyMode).toBe('quiz')
    expect((await questionRepository.byDeck(backup.decks[0]!.id))[0]?.sourceOrder).toBe(0)
  })

  it('rejects an invalid backup before writing', async () => {
    await expect(restoreBackup({ format: 'unknown' })).rejects.toThrow()
    expect(await deckRepository.all()).toHaveLength(0)
  })

  it('rejects corrupt nested fields and broken references before clearing current data', async () => {
    const deckId = await saveNewDeck('safe', await previewGift('Q {TRUE}', createId()))
    const backup = await createBackup()
    const corrupt = structuredClone(backup) as unknown as {
      studyStates: Array<{ card: { reps: unknown } }>
    }
    corrupt.studyStates[0]!.card.reps = -1
    await expect(restoreBackup(corrupt)).rejects.toThrow()
    expect(await deckRepository.get(deckId)).toBeDefined()
    const orphan = structuredClone(backup)
    orphan.questions[0]!.deckId = 'missing'
    await expect(restoreBackup(orphan)).rejects.toThrow(/unknown deck/)
    expect(await deckRepository.get(deckId)).toBeDefined()
  })

  it('rolls back a card update when appending its review log fails', async () => {
    const deckId = await saveNewDeck('atomic', await previewGift('Q {TRUE}', createId()))
    const question = (await questionRepository.byDeck(deckId))[0]!
    const state = (await stateRepository.get(question.id))!
    const now = '2026-01-01T00:00:00.000Z'
    const log = {
      id: 'same-log',
      questionId: question.id,
      deckId,
      reviewedAt: now,
      rating: 'good' as const,
      correct: true,
      fsrsLog: {
        rating: 3,
        state: 0,
        due: now,
        stability: 0,
        difficulty: 0,
        elapsedDays: 0,
        lastElapsedDays: 0,
        scheduledDays: 0,
        review: now,
      },
    }
    await stateRepository.recordReview({ ...state, card: { ...state.card, reps: 1 } }, log)
    await expect(
      stateRepository.recordReview({ ...state, card: { ...state.card, reps: 99 } }, log),
    ).rejects.toThrow()
    expect((await stateRepository.get(question.id))?.card.reps).toBe(1)
  })

  it('preserves compatible cards and resets changed answers on update import', async () => {
    const id = createId()
    const deckId = await saveNewDeck(
      'update',
      await previewGift('::stable::Old question text {=yes ~no}', id),
    )
    const original = (await questionRepository.byDeck(deckId))[0]!
    const state = (await stateRepository.get(original.id))!
    await stateRepository.put({ ...state, card: { ...state.card, reps: 5 } })
    await updateDeck(deckId, await previewGift('::stable::Old question text! {=yes ~no}', deckId))
    expect((await stateRepository.get(original.id))?.card.reps).toBe(5)
    await updateDeck(deckId, await previewGift('::stable::Old question text! {=no ~yes}', deckId))
    expect((await stateRepository.get(original.id))?.card.reps).toBe(0)
  })
})
