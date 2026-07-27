import { getStudyDayKey, type Clock } from '../domain/time'
import {
  deckRepository,
  questionRepository,
  reviewRepository,
  settingsRepository,
  stateRepository,
} from '../infrastructure/db/database'
import { review, type AppRating } from '../infrastructure/fsrs/adapter'
import type {
  DeckRecord,
  QuestionRecord,
  ReviewLogRecord,
  StudyStateRecord,
} from '../infrastructure/db/schema'
import { createId } from '../utils/id'

export interface StudyItem {
  question: QuestionRecord
  state: StudyStateRecord
  isNew: boolean
  deckName: DeckRecord['name']
  studyMode: DeckRecord['studyMode']
}
function shuffled<T>(values: readonly T[]): T[] {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[target]] = [result[target]!, result[index]!]
  }
  return result
}
export function prepareQuestion(question: QuestionRecord, shuffle: boolean): QuestionRecord {
  if (
    shuffle &&
    question.payload.shuffleChoices !== false &&
    question.payload.kind === 'matching'
  ) {
    const pairs = shuffled(question.payload.pairs)
    return {
      ...question,
      payload: {
        ...question.payload,
        pairs,
        matchingOptionOrder: shuffled(pairs.map((pair) => pair.id)),
      },
    }
  }
  if (
    !shuffle ||
    question.payload.shuffleChoices === false ||
    (question.payload.kind !== 'single-choice' && question.payload.kind !== 'multiple-choice')
  )
    return question
  const fixedChoice = question.payload.choices.some((choice) =>
    /^(?:上記(?:の)?すべて|以上(?:の)?すべて|該当なし|どれでもない|all of the above|none of the above)$/i.test(
      choice.content.value.trim(),
    ),
  )
  if (fixedChoice) return question
  const choices = shuffled(question.payload.choices)
  return { ...question, payload: { ...question.payload, choices } }
}
export async function buildStudyQueue(
  clock: Clock,
  deckId?: string,
  cram = false,
): Promise<StudyItem[]> {
  const now = clock.now()
  const settings = await settingsRepository.get()
  const decks = new Map((await deckRepository.all()).map((deck) => [deck.id, deck]))
  const states = (await stateRepository.all()).filter(
    (state) => !state.suspended && (!deckId || state.deckId === deckId),
  )
  const items: StudyItem[] = []
  for (const state of states) {
    const question = await questionRepository.get(state.questionId)
    if (!question?.enabled || question.kind === 'unsupported') continue
    const isNew = state.card.reps === 0
    if (!isNew && (cram || new Date(state.card.due) <= now)) {
      items.push({
        question: prepareQuestion(question, settings.shuffleChoices),
        state,
        isNew: false,
        deckName: decks.get(state.deckId)?.name ?? '',
        studyMode: decks.get(state.deckId)?.studyMode ?? 'quiz',
      })
    }
  }
  const studiedToday = (await reviewRepository.all())
    .filter((log) => getStudyDayKey(new Date(log.reviewedAt)) === getStudyDayKey(now))
    .map((log) => log.questionId)
  const availableFresh = states.filter(
    (state) => state.card.reps === 0 && (cram || !studiedToday.includes(state.questionId)),
  )
  const fresh = cram ? availableFresh : availableFresh.slice(0, settings.newQuestionsPerDay)
  for (const state of fresh) {
    const question = await questionRepository.get(state.questionId)
    if (question?.enabled && question.kind !== 'unsupported') {
      items.push({
        question: prepareQuestion(question, settings.shuffleChoices),
        state,
        isNew: true,
        deckName: decks.get(state.deckId)?.name ?? '',
        studyMode: decks.get(state.deckId)?.studyMode ?? 'quiz',
      })
    }
  }
  const reviews = items
    .filter((item) => !item.isNew)
    .sort((a, b) => a.state.card.due.localeCompare(b.state.card.due))
  const newItems = items.filter((item) => item.isNew)
  return cram || settings.maxReviewsPerDay === null
    ? [...reviews, ...newItems]
    : [...reviews.slice(0, settings.maxReviewsPerDay), ...newItems]
}
export async function recordReview(
  item: StudyItem,
  rating: AppRating,
  correct: boolean,
  answers: string[],
  durationMs: number,
  clock: Clock,
): Promise<void> {
  const settings = await settingsRepository.get()
  const now = clock.now()
  const scheduled = review(item.state.card, now, rating, settings.desiredRetention)
  const state = { ...item.state, card: scheduled.card, updatedAt: now.toISOString() }
  const log: ReviewLogRecord = {
    id: createId(),
    questionId: item.question.id,
    deckId: item.question.deckId,
    reviewedAt: now.toISOString(),
    rating,
    correct,
    durationMs,
    fsrsLog: scheduled.log,
    ...(item.question.kind === 'single-choice' ||
    item.question.kind === 'multiple-choice' ||
    item.question.kind === 'matching'
      ? { selectedAnswerIds: answers }
      : { responseText: answers[0] ?? '' }),
  }
  await stateRepository.recordReview(state, log)
}
