import { afterEach, expect, it, vi } from 'vitest'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import {
  createBackupArchive,
  createBackupStream,
  restoreBackupFile,
  BACKUP_MAGIC,
} from '../src/application/backupArchive'
import { BACKUP_CHUNK_BYTES, hashBlob } from '../src/application/backupIO'
import { createBackup } from '../src/application/backup'
import { clearDatabase, database, settingsRepository } from '../src/infrastructure/db/database'
import { previewApkg } from '../src/application/importApkg'
import { applyApkg, prepareApkg } from '../src/application/apkgStore'

vi.stubGlobal('Blob', NodeBlob)
vi.stubGlobal('File', NodeFile)
afterEach(async () => {
  vi.restoreAllMocks()
  await clearDatabase()
})
async function seed() {
  await settingsRepository.put(await settingsRepository.get())
  const preview = await previewApkg(
    new File([readFileSync('../anki-import/tests/fixtures/official-21b.apkg')], 'sample.apkg'),
  )
  await applyApkg(await prepareApkg(preview, 'sample.apkg'))
  return database()
}
const stores = [
  'decks',
  'questions',
  'studyStates',
  'reviewLogs',
  'settings',
  'imports',
  'importSources',
  'media',
] as const
async function snapshot() {
  const db = await database()
  return Object.fromEntries(
    await Promise.all(
      stores.map(async (store) => [
        store,
        await Promise.all(
          (await db.getAll(store)).map(async (item) => {
            const value = { ...item } as Record<string, unknown>
            for (const key of ['blob', 'sourceArchive'])
              if (value[key] instanceof Blob) {
                const blob = value[key] as Blob
                value[key] = { size: blob.size, hash: await hashBlob(blob) }
              }
            return value
          }),
        ),
      ]),
    ),
  )
}
it('round-trips all stores, raw media and original APKG after deleting the database', async () => {
  await seed()
  const before = await snapshot()
  const archive = await createBackupArchive()
  expect(await archive.slice(0, BACKUP_MAGIC.length).text()).toBe(BACKUP_MAGIC)
  await clearDatabase()
  await restoreBackupFile(archive)
  const after = await snapshot()
  expect(after).toEqual(before)
  expect(await hashBlob(await createBackupArchive())).toBe(await hashBlob(archive))
  const db = await database()
  for (const media of await db.getAll('media')) expect(await hashBlob(media.blob)).toBe(media.id)
})
it('keeps legacy JSON readable', async () => {
  await seed()
  const legacy = new Blob([JSON.stringify(await createBackup())])
  await clearDatabase()
  await restoreBackupFile(legacy)
  expect(await (await database()).count('reviewLogs')).toBe(36)
  expect(await (await database()).count('media')).toBe(2)
})
it('never materializes large binary blobs and preserves their bytes', async () => {
  const db = await seed()
  const data = new Uint8Array(BACKUP_CHUNK_BYTES * 6 + 37).fill(123)
  const id = createHash('sha256').update(data).digest('hex')
  const blob = new Blob([data], { type: 'audio/wav' })
  await db.put('media', { id, blob, size: blob.size, mimeType: blob.type })
  const source = (await db.getAll('importSources'))[0]!
  await db.put('importSources', { ...source, sourceArchive: blob })
  const arrayBuffer = Blob.prototype.arrayBuffer
  vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(function (this: Blob) {
    if (this.size > BACKUP_CHUNK_BYTES) throw new Error('Unbounded binary read')
    return arrayBuffer.call(this)
  })
  const archive = await createBackupArchive()
  expect(archive.size).toBeLessThan(blob.size * 2 + 100_000)
  await clearDatabase()
  await restoreBackupFile(archive)
  const restoredDb = await database()
  expect(await hashBlob((await restoredDb.get('media', id))!.blob)).toBe(id)
  expect(await hashBlob((await restoredDb.get('importSources', source.id))!.sourceArchive!)).toBe(
    id,
  )
})
it('rejects corruption, truncation and unknown formats without touching stored data', async () => {
  const db = await seed()
  const before = await snapshot()
  const archive = await createBackupArchive()
  for (const broken of [
    archive.slice(0, archive.size - 7),
    new Blob([archive.slice(0, 32), 'X', archive.slice(33)]),
    new Blob(['FUKUSHU-BACKUP-99\n']),
  ]) {
    await expect(restoreBackupFile(broken)).rejects.toThrow()
    expect(await snapshot()).toEqual(before)
  }
  expect(await db.count('reviewLogs')).toBe(36)
})
it('cancels export and restore without changing existing data', async () => {
  await seed()
  const before = await snapshot()
  const controller = new AbortController()
  await expect(
    createBackupArchive({ signal: controller.signal, onProgress: () => controller.abort() }),
  ).rejects.toThrow()
  expect(await snapshot()).toEqual(before)
  const archive = await createBackupArchive()
  const restore = new AbortController()
  await expect(
    restoreBackupFile(archive, {
      signal: restore.signal,
      onProgress: ({ phase }) => {
        if (phase === 'saving') restore.abort()
      },
    }),
  ).rejects.toThrow()
  expect(await snapshot()).toEqual(before)
})
it('rolls back a write failure after clearing the stores', async () => {
  await seed()
  const before = await snapshot()
  const archive = await createBackupArchive()
  const original = IDBObjectStore.prototype.put
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) {
    if (this.name === 'media')
      throw new DOMException('Injected storage exhaustion', 'QuotaExceededError')
    return original.call(this, value, key)
  })
  await expect(restoreBackupFile(archive)).rejects.toThrow('Injected storage exhaustion')
  expect(await snapshot()).toEqual(before)
})
it('cancels during writes and rolls back records already replaced', async () => {
  await seed()
  const before = await snapshot()
  const archive = await createBackupArchive()
  const controller = new AbortController()
  const original = IDBObjectStore.prototype.put
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) {
    const request = original.call(this, value, key)
    if (this.name === 'questions') controller.abort()
    return request
  })
  await expect(restoreBackupFile(archive, { signal: controller.signal })).rejects.toThrow()
  expect(await snapshot()).toEqual(before)
})
it('rejects invalid record lengths even when the container checksum is valid', async () => {
  await seed()
  const before = await snapshot()
  const length = new Uint8Array(4)
  new DataView(length.buffer).setUint32(0, 0xffffffff, true)
  const content = new Blob([BACKUP_MAGIC, length])
  await expect(restoreBackupFile(new Blob([content, await hashBlob(content)]))).rejects.toThrow(
    'BACKUP_RECORD_SIZE',
  )
  expect(await snapshot()).toEqual(before)
})
it('exports a consistent snapshot while another transaction updates settings', async () => {
  const db = await seed()
  const originalSettings = await settingsRepository.get()
  let change: Promise<string> | undefined
  const archive = await createBackupArchive({
    onProgress: ({ phase }) => {
      if (phase === 'reading' && !change)
        change = db.put('settings', { ...originalSettings, newQuestionsPerDay: 77 })
    },
  })
  await change
  expect((await settingsRepository.get()).newQuestionsPerDay).toBe(77)
  await restoreBackupFile(archive)
  expect(await settingsRepository.get()).toEqual(originalSettings)
})

it('reads binary only on stream demand and releases a cancelled snapshot', async () => {
  await seed()
  const read = vi.spyOn(Blob.prototype, 'arrayBuffer')
  const { stream, size } = await createBackupStream()
  expect(size).toBeGreaterThan(64)
  expect(read).not.toHaveBeenCalled()
  const reader = stream.getReader()
  const first = await reader.read()
  expect(new TextDecoder().decode(first.value?.slice(0, BACKUP_MAGIC.length))).toBe(BACKUP_MAGIC)
  expect(read).toHaveBeenCalledTimes(1)
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(read).toHaveBeenCalledTimes(1)
  await reader.cancel()
  expect((await reader.read()).done).toBe(true)
})
