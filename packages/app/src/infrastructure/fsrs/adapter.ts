import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  type Card,
  type Grade,
  type ReviewLog,
} from 'ts-fsrs'
import type { StoredFsrsCard, StoredFsrsReviewLog } from '../db/schema'

export type AppRating = 'again' | 'hard' | 'good' | 'easy'
const ratingMap: Record<AppRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
}
export const ratingFromResult = (
  correct: boolean,
  preference: 'hard' | 'good' | 'easy' = 'good',
): AppRating => (correct ? preference : 'again')
export function serializeCard(card: Card): StoredFsrsCard {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    ...(card.last_review ? { lastReview: card.last_review.toISOString() } : {}),
  }
}
export function deserializeCard(card: StoredFsrsCard): Card {
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    ...(card.lastReview ? { last_review: new Date(card.lastReview) } : {}),
  } as Card
}
export function emptyStoredCard(now: Date): StoredFsrsCard {
  return serializeCard(createEmptyCard(now))
}
export function review(
  card: StoredFsrsCard,
  now: Date,
  rating: AppRating,
  desiredRetention: number,
): { card: StoredFsrsCard; log: StoredFsrsReviewLog } {
  const scheduler = fsrs(generatorParameters({ request_retention: desiredRetention }))
  const result = scheduler.next(deserializeCard(card), now, ratingMap[rating])
  return { card: serializeCard(result.card), log: serializeLog(result.log) }
}
function serializeLog(log: ReviewLog): StoredFsrsReviewLog {
  return {
    rating: log.rating,
    state: log.state,
    due: log.due.toISOString(),
    stability: log.stability,
    difficulty: log.difficulty,
    elapsedDays: log.elapsed_days,
    lastElapsedDays: log.last_elapsed_days,
    scheduledDays: log.scheduled_days,
    review: log.review.toISOString(),
  }
}
