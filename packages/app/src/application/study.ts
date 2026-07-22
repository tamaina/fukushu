import { getStudyDayKey, type Clock } from '../domain/time'
import {
  questionRepository,
  reviewRepository,
  settingsRepository,
  stateRepository,
} from '../infrastructure/db/database'
import { review, type AppRating } from '../infrastructure/fsrs/adapter'
import type { QuestionRecord, ReviewLogRecord, StudyStateRecord } from '../infrastructure/db/schema'
import { createId } from '../utils/id'

export interface StudyItem {
  question: QuestionRecord
  state: StudyStateRecord
  isNew: boolean
}
export function prepareQuestion(question: QuestionRecord, shuffle: boolean): QuestionRecord {
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
  const choices = [...question.payload.choices]
  for (let index = choices.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    ;[choices[index], choices[target]] = [choices[target]!, choices[index]!]
  }
  return { ...question, payload: { ...question.payload, choices } }
}
export async function buildStudyQueue(
  clock: Clock,
  deckId?: string,
  cram = false,
): Promise<StudyItem[]> {
  const now = clock.now()
  const settings = await settingsRepository.get()
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
    ...(item.question.kind === 'single-choice' || item.question.kind === 'multiple-choice'
      ? { selectedAnswerIds: answers }
      : { responseText: answers[0] ?? '' }),
  }
  await stateRepository.recordReview(state, log)
}
