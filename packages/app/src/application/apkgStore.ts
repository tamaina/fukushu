import { database } from '../infrastructure/db/database'
import {
  defaultSettings,
  type DeckRecord,
  type ImportSourceRecord,
  type QuestionRecord,
  type StudyStateRecord,
  type ReviewLogRecord,
} from '../infrastructure/db/schema'
import { emptyStoredCard, review, type AppRating } from '../infrastructure/fsrs/adapter'
import type { ApkgPreview } from './importApkg'
import { createId } from '../utils/id'

const stores = [
  'decks',
  'importSources',
  'questions',
  'studyStates',
  'reviewLogs',
  'settings',
  'imports',
  'media',
] as const
export async function repairLegacyApkg(): Promise<void> {
  const db = await database()
  for (const source of await db.getAll('importSources')) {
    if (source.sourceType !== 'anki-package' || (source.revision ?? 0) > 0) continue
    try {
      if (!source.sourceArchive) throw new Error('Missing original archive')
      const { previewApkg } = await import('./importApkg')
      const preview = await previewApkg(
        new File([source.sourceArchive], source.sourceFileName ?? 'legacy.apkg'),
      )
      const prepared = await prepareApkg(
        preview,
        source.sourceFileName ?? 'legacy.apkg',
        false,
        source.id,
      )
      prepared.source.importProgress = source.importProgress ?? true
      await applyApkg(prepared)
    } catch (error) {
      if (error instanceof Error && error.message === 'APKG_STALE_PREVIEW') continue
      await db.put('importSources', { ...source, revision: 1, needsReimport: true })
    }
  }
}
async function snapshot() {
  const tx = (await database()).transaction([...stores])
  const result = await Promise.all([
    tx.objectStore('decks').getAll(),
    tx.objectStore('importSources').getAll(),
    tx.objectStore('questions').getAll(),
    tx.objectStore('studyStates').getAll(),
    tx.objectStore('reviewLogs').getAll(),
    tx.objectStore('settings').getAll(),
  ])
  await tx.done
  return result
}
type Snapshot = Awaited<ReturnType<typeof snapshot>>
export async function apkgCandidates(preview: ApkgPreview, fileName: string) {
  const [decks, sources, questions] = await snapshot()
  const keys = new Set(preview.decks.flatMap((d) => d.questions.map((q) => q.sourceKey)))
  const deckKeys = new Set(preview.decks.map((d) => d.sourceDeckKey))
  return sources
    .filter((s) => s.sourceType === 'anki-package')
    .map((source) => {
      const ids = new Set(decks.filter((d) => d.sourceId === source.id).map((d) => d.id))
      const matchingCards = questions.filter(
        (q) => ids.has(q.deckId) && keys.has(q.sourceKey),
      ).length
      const matchingDecks = decks.filter(
        (d) => ids.has(d.id) && deckKeys.has(d.sourceDeckKey ?? ''),
      ).length
      return {
        source,
        matchingCards,
        matchingDecks,
        exact: source.sourceHash === preview.sourceHash,
      }
    })
    .filter(
      (c) => c.exact || c.matchingCards || c.matchingDecks || c.source.sourceFileName === fileName,
    )
}
export interface PreparedApkg {
  snapshot: Snapshot
  source: ImportSourceRecord
  decks: DeckRecord[]
  questions: QuestionRecord[]
  states: StudyStateRecord[]
  logs: ReviewLogRecord[]
  replaceIds: string[]
  preview: ApkgPreview
  counts: {
    added: number
    changed: number
    moved: number
    stopped: number
    overwrite: number
    emptyProgress: number
  }
}
export function apkgDeckChanges(prepared: PreparedApkg) {
  const previous = new Map(prepared.snapshot[2].map((q) => [q.id, q]))
  return prepared.decks.map((deck) => {
    const questions = prepared.questions.filter((q) => q.deckId === deck.id)
    return {
      name: deck.name,
      id: deck.id,
      added: questions.filter((q) => !previous.has(q.id)).length,
      changed: questions.filter((q) => {
        const old = previous.get(q.id)
        return (
          old &&
          q.enabled &&
          JSON.stringify({ ...old.payload, id: '', deckId: '' }) !==
            JSON.stringify({ ...q.payload, id: '', deckId: '' })
        )
      }).length,
      moved: questions.filter((q) => previous.has(q.id) && previous.get(q.id)!.deckId !== q.deckId)
        .length,
      stopped: questions.filter((q) => previous.get(q.id)?.enabled && !q.enabled).length,
      removed: !prepared.preview.decks.some((d) => d.sourceDeckKey === deck.sourceDeckKey),
    }
  })
}
export async function prepareApkg(
  preview: ApkgPreview,
  fileName: string,
  progress = true,
  sourceId?: string,
): Promise<PreparedApkg> {
  if (preview.diagnostics.some((d) => d.severity === 'error'))
    throw new Error('APKGにエラーがあります。')
  const snap = await snapshot(),
    [allDecks, sources, allQuestions, allStates, allLogs, settings] = snap
  const oldSource = sources.find((s) => s.id === sourceId)
  if (sourceId && !oldSource) throw new Error('更新元が見つかりません。')
  const id = sourceId ?? createId(),
    now = new Date().toISOString()
  const source: ImportSourceRecord = {
    id,
    sourceType: 'anki-package',
    sourceFileName: fileName,
    sourceHash: preview.sourceHash,
    sourceArchive: preview.archive,
    packageFormat: preview.packageFormat,
    importProgress: progress,
    revision: (oldSource?.revision ?? 0) + 1,
    importedAt: oldSource?.importedAt ?? now,
    updatedAt: now,
  }
  const siblings = allDecks.filter((d) => d.sourceId === id),
    deckIds = new Set(siblings.map((d) => d.id))
  const existing = allQuestions.filter((q) => deckIds.has(q.deckId)),
    byKey = new Map(existing.map((q) => [q.sourceKey, q]))
  if (byKey.size !== existing.length) throw new Error('既存ソースのカードキーが重複しています。')
  const result: PreparedApkg = {
    snapshot: snap,
    source,
    decks: [],
    questions: [],
    states: [],
    logs: [],
    replaceIds: [],
    preview,
    counts: { added: 0, changed: 0, moved: 0, stopped: 0, overwrite: 0, emptyProgress: 0 },
  }
  const touched = new Set<string>(),
    incomingKeys = new Set<string>()
  for (const incoming of preview.decks) {
    const oldDeck = siblings.find((d) => d.sourceDeckKey === incoming.sourceDeckKey),
      deckId = oldDeck?.id ?? createId()
    const deck: DeckRecord = {
      ...oldDeck,
      id: deckId,
      name: incoming.name,
      studyMode: oldDeck?.studyMode ?? 'flashcard',
      sourceType: 'anki-package',
      sourceId: id,
      sourceDeckKey: incoming.sourceDeckKey,
      sourceFileName: fileName,
      sourceHash: preview.sourceHash,
      importedAt: oldDeck?.importedAt ?? now,
      updatedAt: now,
      questionCount: 0,
      enabledQuestionCount: 0,
    }
    result.decks.push(deck)
    for (const [order, payload] of incoming.questions.entries()) {
      if (incomingKeys.has(payload.sourceKey)) throw new Error('取込カードキーが重複しています。')
      incomingKeys.add(payload.sourceKey)
      const incomingMeta = payload.ankiSource
      const base =
        incomingMeta?.guid === undefined
          ? payload.sourceKey
          : String(incomingMeta.guid) + ':' + incomingMeta.ordinal
      const history = existing.filter(
        (q) =>
          q.sourceKey === base ||
          q.sourceKey.startsWith(base + ':note:') ||
          (q.payload.kind === 'flashcard' &&
            q.payload.ankiSource?.guid === incomingMeta?.guid &&
            q.payload.ankiSource?.ordinal === incomingMeta?.ordinal &&
            incomingMeta?.guid !== undefined),
      )
      const origin = history.find(
        (q) =>
          !touched.has(q.id) &&
          q.payload.kind === 'flashcard' &&
          q.payload.ankiSource?.noteId === incomingMeta?.noteId &&
          incomingMeta?.noteId !== undefined,
      )
      const old = origin ?? (history.length <= 1 ? byKey.get(payload.sourceKey) : undefined),
        questionId = old?.id ?? createId(),
        state = allStates.find((s) => s.questionId === questionId)
      touched.add(questionId)
      const manualSuspended = state?.sourceRemoved
        ? (state.manualSuspended ?? false)
        : (state?.suspended ?? false)
      const enabled = state?.sourceRemoved ? !manualSuspended : (old?.enabled ?? true)
      result.questions.push({
        id: questionId,
        deckId,
        sourceKey: payload.sourceKey,
        sourceOrder: order,
        kind: payload.kind,
        payload: { ...payload, id: questionId, deckId },
        enabled,
        enabledKey: enabled ? 1 : 0,
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
      })
      const nextState: StudyStateRecord = {
        ...state,
        questionId,
        deckId,
        card: state?.card ?? emptyStoredCard(new Date(now)),
        suspended: manualSuspended,
        manualSuspended,
        suspendedKey: manualSuspended ? 1 : 0,
        sourceRemoved: false,
        updatedAt: now,
      }
      if (!old) result.counts.added++
      else {
        if (
          JSON.stringify({ ...old.payload, id: '', deckId: '' }) !==
          JSON.stringify({ ...payload, id: '', deckId: '' })
        )
          result.counts.changed++
        if (old.deckId !== deckId) result.counts.moved++
      }
      const previousLogs = allLogs.filter((l) => l.questionId === questionId)
      if (progress) {
        if (previousLogs.some((l) => !l.origin && !l.id.startsWith('anki:')))
          result.counts.overwrite++
        result.replaceIds.push(questionId)
        const reviews = [...(incoming.reviewsBySourceKey[payload.sourceKey] ?? [])].sort(
          (a, b) => a.at - b.at,
        )
        if (!reviews.length) result.counts.emptyProgress++
        let card = emptyStoredCard(new Date(reviews[0]?.at ?? now))
        for (const log of reviews) {
          const rating = (
            { 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' } as Record<number, AppRating>
          )[log.ease]
          if (!rating || ![0, 1, 2, 3].includes(log.type)) continue
          const at = new Date(log.at),
            replayed = review(
              card,
              at,
              rating,
              settings[0]?.desiredRetention ?? defaultSettings.desiredRetention,
              false,
            )
          card = replayed.card
          result.logs.push({
            id: `anki:${id}:${log.cardId}:${log.id}`,
            questionId,
            deckId,
            reviewedAt: at.toISOString(),
            rating,
            correct: rating !== 'again',
            fsrsLog: replayed.log,
            origin: { sourceId: id, cardId: log.cardId, revlogId: log.id },
          })
        }
        nextState.card = card
      } else if (old && old.deckId !== deckId)
        result.logs.push(...previousLogs.map((l) => ({ ...l, deckId })))
      result.states.push(nextState)
    }
  }
  for (const old of existing.filter((q) => !touched.has(q.id))) {
    const retiredKey = incomingKeys.has(old.sourceKey)
      ? old.sourceKey + ':retired:' + old.id
      : old.sourceKey
    result.questions.push({
      ...old,
      sourceKey: retiredKey,
      payload: { ...old.payload, sourceKey: retiredKey },
      enabled: false,
      enabledKey: 0,
      updatedAt: now,
    })
    const state = allStates.find((s) => s.questionId === old.id)
    if (state)
      result.states.push({
        ...state,
        sourceRemoved: true,
        manualSuspended: state.sourceRemoved ? (state.manualSuspended ?? false) : state.suspended,
        suspended: true,
        suspendedKey: 1,
        updatedAt: now,
      })
    if (old.enabled) result.counts.stopped++
    if (!result.decks.some((d) => d.id === old.deckId))
      result.decks.push({ ...siblings.find((d) => d.id === old.deckId)!, updatedAt: now })
  }
  for (const old of siblings)
    if (!result.decks.some((d) => d.id === old.id)) result.decks.push({ ...old, updatedAt: now })
  for (const deck of result.decks) {
    const qs = result.questions.filter((q) => q.deckId === deck.id)
    qs.forEach((q, i) => (q.sourceOrder = i))
    deck.questionCount = qs.length
    deck.enabledQuestionCount = qs.filter((q) => q.enabled).length
  }
  return result
}
export async function applyApkg(prepared: PreparedApkg): Promise<string[]> {
  const db = await database(),
    tx = db.transaction([...stores], 'readwrite')
  try {
    const current = await Promise.all([
      tx.objectStore('decks').getAll(),
      tx.objectStore('importSources').getAll(),
      tx.objectStore('questions').getAll(),
      tx.objectStore('studyStates').getAll(),
      tx.objectStore('reviewLogs').getAll(),
      tx.objectStore('settings').getAll(),
    ])
    if (JSON.stringify(current) !== JSON.stringify(prepared.snapshot))
      throw new Error('APKG_STALE_PREVIEW')
    for (const log of current[4])
      if (prepared.replaceIds.includes(log.questionId))
        await tx.objectStore('reviewLogs').delete(log.id)
    await tx.objectStore('importSources').put(prepared.source)
    for (const d of prepared.decks) await tx.objectStore('decks').put(d)
    // Remove old composite index entries before moving cards between decks.
    for (const q of prepared.questions) await tx.objectStore('questions').delete(q.id)
    for (const q of prepared.questions) await tx.objectStore('questions').put(q)
    for (const s of prepared.states) await tx.objectStore('studyStates').put(s)
    for (const l of prepared.logs) await tx.objectStore('reviewLogs').put(l)
    for (const m of prepared.preview.media) await tx.objectStore('media').put(m)
    for (const d of prepared.decks)
      await tx.objectStore('imports').put({
        id: createId(),
        deckId: d.id,
        importedAt: prepared.source.updatedAt,
        sourceHash: prepared.source.sourceHash,
        added: prepared.counts.added,
        changed: prepared.counts.changed,
        disabled: prepared.counts.stopped,
      })
    await tx.done
    return prepared.decks.map((d) => d.id)
  } catch (error) {
    try {
      tx.abort()
    } catch {
      /* already aborted */
    }
    await tx.done.catch(() => {})
    throw error
  }
}
