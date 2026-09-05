import { afterEach, expect, it } from 'vitest'
import { previewGift } from '../src/application/importGift'
import { resetDeckHistory, saveNewDeck } from '../src/application/decks'
import { buildStudyQueue, recordReview } from '../src/application/study'
import {
  clearDatabase,
  deckRepository,
  reviewRepository,
  stateRepository,
} from '../src/infrastructure/db/database'
import { systemClock } from '../src/domain/time'

afterEach(clearDatabase)
it('resets only the target history and changes its session revision on every reset', async () => {
  const first = await saveNewDeck('first', await previewGift('A {TRUE}', 'first'))
  const second = await saveNewDeck('second', await previewGift('B {TRUE}', 'second'))
  for (const id of [first, second]) {
    const item = (await buildStudyQueue(systemClock, id))[0]!
    await recordReview(item, 'good', true, [], 100, systemClock)
  }
  await resetDeckHistory(first)
  expect((await stateRepository.all()).find((s) => s.deckId === first)?.card.reps).toBe(0)
  expect((await stateRepository.all()).find((s) => s.deckId === second)?.card.reps).toBe(1)
  expect((await reviewRepository.all()).map((log) => log.deckId)).toEqual([second])
  const revision = (await deckRepository.get(first))!.historyRevision
  expect(revision).toBeTruthy()
  await resetDeckHistory(first)
  expect((await deckRepository.get(first))!.historyRevision).not.toBe(revision)
})
