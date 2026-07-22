import { describe, expect, it } from 'vitest'
import { emptyStoredCard, ratingFromResult, review } from '../src/infrastructure/fsrs/adapter'

describe('FSRS adapter', () => {
  const now = new Date('2026-01-01T12:00:00.000Z')
  it.each(['again', 'hard', 'good', 'easy'] as const)(
    'schedules %s and serializes dates',
    (rating) => {
      const result = review(emptyStoredCard(now), now, rating, 0.9)
      expect(Number.isNaN(Date.parse(result.card.due))).toBe(false)
      expect(result.card.reps).toBe(1)
      expect(result.log.review).toBe(now.toISOString())
    },
  )
  it('maps correctness without guessing Easy', () => {
    expect(ratingFromResult(false, 'easy')).toBe('again')
    expect(ratingFromResult(true)).toBe('good')
    expect(ratingFromResult(true, 'hard')).toBe('hard')
  })
})
