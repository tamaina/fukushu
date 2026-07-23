import type { ImportPreview } from './importGift'
import { createId } from '../utils/id'
import { emptyStoredCard } from '../infrastructure/fsrs/adapter'
import {
  deckRepository,
  questionRepository,
  reviewRepository,
  stateRepository,
} from '../infrastructure/db/database'
import type {
  DeckRecord,
  ImportRecord,
  QuestionRecord,
  StudyStateRecord,
} from '../infrastructure/db/schema'

export async function saveNewDeck(
  name: string,
  preview: ImportPreview,
  fileName?: string,
): Promise<string> {
  if (preview.diagnostics.some((item) => item.severity === 'error'))
    throw new Error('GIFTにエラーがあるため保存できません。')
  const id = preview.questions[0]?.deckId ?? createId()
  const now = new Date().toISOString()
  const deck: DeckRecord = {
    id,
    name: name.trim() || '名称未設定の問題集',
    studyMode: 'quiz',
    sourceType: 'gift',
    ...(fileName ? { sourceFileName: fileName } : {}),
    sourceHash: preview.sourceHash,
    sourceText: preview.source,
    importedAt: now,
    updatedAt: now,
    questionCount: preview.questions.length,
    enabledQuestionCount: preview.questions.length,
  }
  const questions: QuestionRecord[] = preview.questions.map((payload) => ({
    id: payload.id,
    deckId: id,
    sourceKey: payload.sourceKey,
    kind: payload.kind,
    payload,
    enabled: true,
    enabledKey: 1,
    createdAt: now,
    updatedAt: now,
  }))
  const states: StudyStateRecord[] = questions.map((question) => ({
    questionId: question.id,
    deckId: id,
    card: emptyStoredCard(new Date(now)),
    suspended: false,
    suspendedKey: 0,
    updatedAt: now,
  }))
  const importRecord: ImportRecord = {
    id: createId(),
    deckId: id,
    importedAt: now,
    sourceHash: preview.sourceHash,
    added: questions.length,
    changed: 0,
    disabled: 0,
  }
  await deckRepository.saveImport(deck, questions, states, importRecord)
  return id
}

function answerSignature(question: QuestionRecord['payload']): string {
  if (question.kind === 'single-choice' || question.kind === 'multiple-choice') {
    return JSON.stringify(question.choices.map((choice) => [choice.content.value, choice.weight]))
  }
  if (question.kind === 'true-false') return String(question.correctAnswer)
  if (question.kind === 'short-answer') {
    return JSON.stringify(question.answers.map((answer) => [answer.value, answer.weight]))
  }
  if (question.kind === 'numerical') return JSON.stringify(question.answers)
  return question.sourceKind
}

function semanticSignature(question: QuestionRecord['payload']): string {
  return JSON.stringify({
    kind: question.kind,
    name: question.name,
    prompt: question.prompt,
    categoryPath: question.categoryPath,
    explanation: question.explanation,
    shuffleChoices: question.shuffleChoices,
    answers: answerSignature(question),
  })
}

function promptSimilarity(left: string, right: string): number {
  const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
  const grams = (value: string): Set<string> => {
    const normalized = normalize(value)
    if (normalized.length < 2) return new Set([normalized])
    return new Set(
      [...normalized.slice(0, -1)].map((character, index) => character + normalized[index + 1]),
    )
  }
  const a = grams(left)
  const b = grams(right)
  if (!a.size && !b.size) return 1
  let intersection = 0
  for (const value of a) if (b.has(value)) intersection += 1
  return intersection / (a.size + b.size - intersection)
}

export interface DeckUpdateDiff {
  added: number
  changed: number
  removed: number
  unchanged: number
  resetRequired: number
  resetSourceKeys: string[]
}

export async function previewDeckUpdate(
  deckId: string,
  preview: ImportPreview,
): Promise<DeckUpdateDiff> {
  const existing = await questionRepository.byDeck(deckId)
  const byKey = new Map(existing.map((question) => [question.sourceKey, question]))
  const incomingKeys = new Set(preview.questions.map((question) => question.sourceKey))
  const result: DeckUpdateDiff = {
    added: 0,
    changed: 0,
    removed: existing.filter(
      (question) => question.enabled && !incomingKeys.has(question.sourceKey),
    ).length,
    unchanged: 0,
    resetRequired: 0,
    resetSourceKeys: [],
  }
  for (const incoming of preview.questions) {
    const previous = byKey.get(incoming.sourceKey)
    if (!previous) {
      result.added += 1
      continue
    }
    if (semanticSignature(previous.payload) === semanticSignature(incoming)) {
      result.unchanged += 1
      continue
    }
    result.changed += 1
    const compatible =
      previous.kind === incoming.kind &&
      answerSignature(previous.payload) === answerSignature(incoming) &&
      promptSimilarity(previous.payload.prompt.value, incoming.prompt.value) >= 0.6
    if (!compatible) {
      result.resetRequired += 1
      result.resetSourceKeys.push(incoming.sourceKey)
    }
  }
  return result
}

/** Update-import keeps cards only when the stable source key, kind and answer structure agree. */
export async function updateDeck(deckId: string, preview: ImportPreview): Promise<void> {
  if (preview.diagnostics.some((item) => item.severity === 'error')) {
    throw new Error('GIFTにエラーがあるため更新できません。')
  }
  const deck = await deckRepository.get(deckId)
  if (!deck) throw new Error('更新する問題集が見つかりません。')
  const existing = await questionRepository.byDeck(deckId)
  const diff = await previewDeckUpdate(deckId, preview)
  const byKey = new Map(existing.map((question) => [question.sourceKey, question]))
  const now = new Date().toISOString()
  const questions: QuestionRecord[] = []
  const states: StudyStateRecord[] = []
  const retained = new Set<string>()
  for (const incoming of preview.questions) {
    const previous = byKey.get(incoming.sourceKey)
    if (!previous) {
      const payload = { ...incoming, deckId }
      questions.push({
        id: payload.id,
        deckId,
        sourceKey: payload.sourceKey,
        kind: payload.kind,
        payload,
        enabled: true,
        enabledKey: 1,
        createdAt: now,
        updatedAt: now,
      })
      states.push({
        questionId: payload.id,
        deckId,
        card: emptyStoredCard(new Date(now)),
        suspended: false,
        suspendedKey: 0,
        updatedAt: now,
      })
      continue
    }
    retained.add(previous.id)
    const payload = { ...incoming, id: previous.id, deckId }
    const compatible = !diff.resetSourceKeys.includes(payload.sourceKey)
    questions.push({
      ...previous,
      kind: payload.kind,
      payload,
      enabled: true,
      enabledKey: 1,
      updatedAt: now,
    })
    const oldState = await stateRepository.get(previous.id)
    states.push(
      compatible && oldState
        ? { ...oldState, suspended: false, suspendedKey: 0, updatedAt: now }
        : {
            questionId: previous.id,
            deckId,
            card: emptyStoredCard(new Date(now)),
            suspended: false,
            suspendedKey: 0,
            updatedAt: now,
          },
    )
  }
  const removed = existing.filter((question) => !retained.has(question.id))
  for (const question of removed) {
    questions.push({ ...question, enabled: false, enabledKey: 0, updatedAt: now })
    const state = await stateRepository.get(question.id)
    if (state) states.push({ ...state, suspended: true, suspendedKey: 1, updatedAt: now })
  }
  await deckRepository.saveImport(
    {
      ...deck,
      sourceHash: preview.sourceHash,
      sourceText: preview.source,
      updatedAt: now,
      questionCount: questions.length,
      enabledQuestionCount: questions.filter((question) => question.enabled).length,
    },
    questions,
    states,
    {
      id: createId(),
      deckId,
      importedAt: now,
      sourceHash: preview.sourceHash,
      added: diff.added,
      changed: diff.changed,
      disabled: diff.removed,
    },
  )
}

export async function setQuestionEnabled(id: string, enabled: boolean): Promise<void> {
  const question = await questionRepository.get(id)
  const state = await stateRepository.get(id)
  if (!question || !state) return
  await questionRepository.put({
    ...question,
    enabled,
    enabledKey: enabled ? 1 : 0,
    updatedAt: new Date().toISOString(),
  })
  await stateRepository.put({
    ...state,
    suspended: !enabled,
    suspendedKey: enabled ? 0 : 1,
    updatedAt: new Date().toISOString(),
  })
  const deck = await deckRepository.get(question.deckId)
  if (deck) {
    const questions = await questionRepository.byDeck(question.deckId)
    await deckRepository.put({
      ...deck,
      enabledQuestionCount: questions.filter((item) => (item.id === id ? enabled : item.enabled))
        .length,
      updatedAt: new Date().toISOString(),
    })
  }
}

export async function setDeckStudyMode(
  id: string,
  studyMode: DeckRecord['studyMode'],
): Promise<void> {
  const deck = await deckRepository.get(id)
  if (!deck || deck.studyMode === studyMode) return
  await deckRepository.put({
    ...deck,
    studyMode,
    updatedAt: new Date().toISOString(),
  })
}

export async function resetDeckHistory(deckId: string): Promise<void> {
  const now = new Date()
  for (const question of await questionRepository.byDeck(deckId)) {
    const state = await stateRepository.get(question.id)
    if (state) {
      const activeState = { ...state }
      delete activeState.buriedUntil
      await stateRepository.put({
        ...activeState,
        card: emptyStoredCard(now),
        updatedAt: now.toISOString(),
      })
    }
  }
  await reviewRepository.removeByDeck(deckId)
}
