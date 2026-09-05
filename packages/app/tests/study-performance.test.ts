import { afterEach, expect, it, vi } from 'vitest'
import { previewGift } from '../src/application/importGift'
import { saveNewDeck } from '../src/application/decks'
import { buildStudyQueue } from '../src/application/study'
import {
  clearDatabase,
  questionRepository,
  settingsRepository,
} from '../src/infrastructure/db/database'
import { systemClock } from '../src/domain/time'

afterEach(async () => {
  vi.restoreAllMocks()
  await clearDatabase()
})
it('loads only the daily new-card allowance from a 1500-card deck', async () => {
  const deck = await saveNewDeck(
    'large',
    await previewGift(
      Array.from({ length: 1500 }, (_, i) => `::q${i}::Question ${i} {TRUE}`).join('\n\n'),
      'large',
    ),
  )
  await settingsRepository.put({ ...(await settingsRepository.get()), newQuestionsPerDay: 20 })
  const single = vi.spyOn(questionRepository, 'get')
  const bulk = vi.spyOn(questionRepository, 'getMany')
  const queue = await buildStudyQueue(systemClock, deck)
  expect(queue).toHaveLength(20)
  expect(single).not.toHaveBeenCalled()
  expect(bulk.mock.calls.flatMap(([ids]) => ids)).toHaveLength(20)
})
