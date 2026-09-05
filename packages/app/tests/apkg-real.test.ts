import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { createBackup, restoreBackup } from '../src/application/backup'
import { emptyStoredCard, review } from '../src/infrastructure/fsrs/adapter'
vi.stubGlobal('Blob', NodeBlob)
vi.stubGlobal('File', NodeFile)
import { previewApkg } from '../src/application/importApkg'
import {
  prepareApkg,
  applyApkg,
  repairLegacyApkg,
  apkgCandidates,
} from '../src/application/apkgStore'
import { clearDatabase, database } from '../src/infrastructure/db/database'
afterEach(clearDatabase)
const fixture = (name: string) =>
  new File([readFileSync(`../anki-import/tests/fixtures/${name}.apkg`)], 'fixture.apkg')
describe('official Anki 25.09 packages', () => {
  it.each(['official-anki21', 'official-21b'])('reads %s', async (name) => {
    const p = await previewApkg(fixture(name))
    expect(p.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(p.stats.cardCount).toBe(9)
    expect(p.media.length).toBe(2)
    expect(
      p.decks.flatMap((d) => d.questions).some((q) => q.prompt.value.includes('fukushu-media:')),
    ).toBe(true)
    expect(p.decks.flatMap((d) => d.questions).find((q) => q.typeAnswer)?.answer.value).toContain(
      '東京',
    )
    const prepared = await prepareApkg(p, 'fixture.apkg', true)
    await applyApkg(prepared)
    expect(await (await database()).getAll('reviewLogs')).toHaveLength(36)
  })
})
it('reads the genuine legacy anki2 fixture from Anki upstream', async () => {
  const p = await previewApkg(fixture('official-anki2'))
  expect(p.packageFormat).toBe('anki2')
  expect(p.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  expect(p.stats.cardCount).toBe(1)
})

it('preserves removed-card history, manual suspension, moves and progress-off changes', async () => {
  const p = await previewApkg(fixture('official-21b'))
  const prepared = await prepareApkg(p, 'fixture.apkg', true)
  await applyApkg(prepared)
  const db = await database(),
    before = await db.getAll('studyStates'),
    logs = await db.getAll('reviewLogs')
  const next = structuredClone(p),
    deck = next.decks.find((d) => d.questions.length > 2)!,
    removed = deck.questions.pop()!,
    moving = deck.questions.shift()!
  next.decks.find((d) => d !== deck)!.questions.push(moving)
  deck.questions[0]!.answer.value = 'changed answer'
  const state = before.find(
    (s) =>
      s.questionId ===
      prepared.questions.find((q) => q.sourceKey === deck.questions[0]!.sourceKey)!.id,
  )!
  await db.put('studyStates', { ...state, suspended: true, suspendedKey: 1 })
  await applyApkg(await prepareApkg(next, 'fixture.apkg', false, prepared.source.id))
  expect(await db.getAll('reviewLogs')).toHaveLength(logs.length)
  for (const s of await db.getAll('studyStates'))
    expect(s.card).toEqual(before.find((b) => b.questionId === s.questionId)!.card)
  const removedId = prepared.questions.find((q) => q.sourceKey === removed.sourceKey)!.id
  expect((await db.get('questions', removedId))!.enabled).toBe(false)
  await applyApkg(await prepareApkg(next, 'fixture.apkg', true, prepared.source.id))
  expect(await db.getAllFromIndex('reviewLogs', 'by-question', removedId)).toHaveLength(4)
  expect((await db.get('studyStates', state.questionId))!.suspended).toBe(true)
})
it('isolates log IDs, detects stale data, and rolls back a write failure', async () => {
  const p = await previewApkg(fixture('official-21b'))
  await applyApkg(await prepareApkg(p, 'one.apkg'))
  await applyApkg(await prepareApkg(p, 'two.apkg'))
  const db = await database()
  expect(await db.getAll('reviewLogs')).toHaveLength(72)
  const stale = await prepareApkg(p, 'three.apkg')
  await db.put('settings', {
    ...(stale.snapshot[5][0] ?? (await import('../src/infrastructure/db/schema')).defaultSettings),
    newQuestionsPerDay: 11,
  })
  await expect(applyApkg(stale)).rejects.toThrow('APKG_STALE_PREVIEW')
  const broken = await prepareApkg(p, 'broken.apkg')
  broken.questions[1]!.sourceKey = broken.questions[0]!.sourceKey
  broken.questions[1]!.deckId = broken.questions[0]!.deckId
  await expect(applyApkg(broken)).rejects.toThrow()
  expect(await db.getAll('importSources')).toHaveLength(2)
})
it('replays deterministic ratings and round-trips media, source and history', async () => {
  const p = await previewApkg(fixture('official-21b'))
  const prepared = await prepareApkg(p, 'fixture.apkg')
  await applyApkg(prepared)
  const first = p.decks.flatMap((d) => d.questions)[0]!,
    reviews = p.decks.find((d) => d.reviewsBySourceKey[first.sourceKey])!.reviewsBySourceKey[
      first.sourceKey
    ]!
  let expected = emptyStoredCard(new Date(reviews[0]!.at))
  for (const [i, r] of reviews.entries())
    expected = review(
      expected,
      new Date(r.at),
      (['again', 'hard', 'good', 'easy'] as const)[i]!,
      0.9,
      false,
    ).card
  expect(
    prepared.states.find(
      (s) => s.questionId === prepared.questions.find((q) => q.sourceKey === first.sourceKey)!.id,
    )!.card,
  ).toEqual(expected)
  const backup = JSON.parse(JSON.stringify(await createBackup()))
  await restoreBackup(backup)
  const db = await database()
  expect(await db.getAll('reviewLogs')).toHaveLength(36)
  expect((await db.getAll('media'))[0]!.blob.size).toBeGreaterThan(0)
})

it('repairs legacy rendering without resetting history and identifies source candidates', async () => {
  const p = await previewApkg(fixture('official-21b'))
  const prepared = await prepareApkg(p, 'fixture.apkg')
  await applyApkg(prepared)
  const db = await database(),
    logs = await db.getAll('reviewLogs'),
    states = await db.getAll('studyStates')
  const legacy = { ...prepared.source }
  delete legacy.revision
  await db.put('importSources', legacy)
  const question = prepared.questions[0]!
  if (question.payload.kind === 'flashcard') delete question.payload.ankiSource
  question.payload.prompt.value = 'lost display'
  await db.put('questions', question)
  await repairLegacyApkg()
  expect((await db.get('questions', question.id))!.payload.prompt.value).not.toBe('lost display')
  expect(await db.getAll('reviewLogs')).toEqual(logs)
  expect((await db.getAll('studyStates')).map((s) => s.card)).toEqual(states.map((s) => s.card))
  const exact = await apkgCandidates(p, 'fixture.apkg')
  expect(exact).toHaveLength(1)
  expect(exact[0]!.exact).toBe(true)
  const changed = await apkgCandidates(
    await previewApkg(fixture('official-updated')),
    'changed.apkg',
  )
  expect(changed).toHaveLength(1)
  expect(changed[0]!.exact).toBe(false)
  expect(changed[0]!.matchingCards).toBeGreaterThan(0)
})

it('preserves identities when duplicate GUIDs appear, disappear, and return', async () => {
  const p = await previewApkg(fixture('official-21b'))
  const first = await prepareApkg(p, 'fixture.apkg')
  await applyApkg(first)
  const original = p.decks[0]!.questions[0]!,
    base = original.sourceKey
  const originalId = first.questions.find((q) => q.sourceKey === base)!.id
  const duplicate = structuredClone(original)
  duplicate.id = 'new-preview-id'
  duplicate.ankiSource!.noteId = '999999999999'
  duplicate.ankiSource!.cardId = '999999999998'
  duplicate.sourceKey = `${base}:note:${duplicate.ankiSource!.noteId}`
  const two = structuredClone(p)
  two.decks[0]!.questions[0]!.sourceKey = `${base}:note:${original.ankiSource!.noteId}`
  two.decks[0]!.questions.push(duplicate)
  await applyApkg(await prepareApkg(two, 'fixture.apkg', false, first.source.id))
  const db = await database()
  const added = (await db.getAll('questions')).find((q) => q.sourceKey === duplicate.sourceKey)!
  expect((await db.get('studyStates', originalId))!.card.reps).toBe(4)
  const onlyDuplicate = structuredClone(p)
  onlyDuplicate.decks[0]!.questions[0] = { ...duplicate, sourceKey: base }
  await applyApkg(await prepareApkg(onlyDuplicate, 'fixture.apkg', false, first.source.id))
  expect((await db.get('questions', added.id))!.enabled).toBe(true)
  expect((await db.get('questions', originalId))!.enabled).toBe(false)
  await applyApkg(await prepareApkg(p, 'fixture.apkg', false, first.source.id))
  expect((await db.get('questions', originalId))!.enabled).toBe(true)
  expect((await db.get('questions', added.id))!.enabled).toBe(false)
  expect((await db.get('studyStates', originalId))!.card.reps).toBe(4)
})
