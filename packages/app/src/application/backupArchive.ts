import * as v from 'valibot'
import { createSHA256 } from 'hash-wasm'
import { database } from '../infrastructure/db/database'
import { defaultSettings } from '../infrastructure/db/schema'
import { restoreBackupData, type AppBackup } from './backup'
import { hashBlob, checkBackupCancelled, BACKUP_CHUNK_BYTES, type BackupOptions } from './backupIO'

// Each record is uint32-LE JSON length, UTF-8 metadata, then optional raw Blob bytes.
// The final 64 ASCII bytes are SHA-256 of every preceding byte, including the magic.
export const BACKUP_MAGIC = 'FUKUSHU-BACKUP-1\n'
export const MAX_BACKUP_RECORD_BYTES = 64 * 1024 ** 2
const stores = [
  'settings',
  'decks',
  'questions',
  'studyStates',
  'reviewLogs',
  'importSources',
  'media',
  'imports',
] as const
const RecordSchema = v.strictObject({
  store: v.picklist(stores),
  value: v.record(v.string(), v.unknown()),
  blobSize: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(0))),
})

async function snapshotBackup(options: BackupOptions): Promise<Blob[]> {
  checkBackupCancelled(options)
  const db = await database()
  const tx = db.transaction([...stores])
  const abort = () => {
    try {
      tx.abort()
    } catch {
      /* already finished */
    }
  }
  options.signal?.addEventListener('abort', abort, { once: true })
  const parts: Blob[] = [new Blob([BACKUP_MAGIC])]
  let count = 0
  function appendRecord(store: (typeof stores)[number], raw: object) {
    const value = { ...raw } as Record<string, unknown>
    let blob: Blob | undefined
    if (store === 'media') {
      blob = value.blob as Blob
      delete value.blob
      value.blobBase64 = ''
    } else if (store === 'importSources') {
      blob = value.sourceArchive as Blob | undefined
      delete value.sourceArchive
    }
    const metadata = new Blob([
      JSON.stringify(
        { store, value, ...(blob ? { blobSize: blob.size } : {}) },
        (_key, item: unknown) =>
          item && typeof item === 'object' && !Array.isArray(item)
            ? Object.fromEntries(
                Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
              )
            : item,
      ),
    ])
    if (metadata.size > MAX_BACKUP_RECORD_BYTES) throw new Error('BACKUP_RECORD_TOO_LARGE')
    const length = new Uint8Array(4)
    new DataView(length.buffer).setUint32(0, metadata.size, true)
    parts.push(new Blob([length]), metadata)
    if (blob) parts.push(blob)
    options.onProgress?.({ phase: 'reading', completed: ++count, total: 0 })
  }
  try {
    // One readonly transaction gives a coherent snapshot across all stores/tabs.
    // Only cursor operations are awaited here; hashing happens after tx completion.
    for (const store of stores) {
      let cursor = await tx.objectStore(store).openCursor()
      if (store === 'settings' && !cursor) appendRecord(store, defaultSettings)
      while (cursor) {
        checkBackupCancelled(options)
        appendRecord(store, cursor.value)
        cursor = await cursor.continue()
      }
    }
    await tx.done
  } catch (error) {
    abort()
    await tx.done.catch(() => {})
    checkBackupCancelled(options)
    throw error
  } finally {
    options.signal?.removeEventListener('abort', abort)
  }
  return parts
}

/** Snapshot metadata/Blob handles once, then materialize only the requested chunk.
 * Metadata and handles still scale with record count; binary payloads are not copied.
 */
export async function createBackupStream(options: BackupOptions = {}): Promise<{
  stream: ReadableStream<Uint8Array>
  size: number
}> {
  const parts = await snapshotBackup(options)
  const size = parts.reduce((sum, part) => sum + part.size, 64)
  const hash = await createSHA256()
  let index = 0
  let offset = 0
  let completed = 0
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          checkBackupCancelled(options)
          const chunks: Blob[] = []
          let remaining = BACKUP_CHUNK_BYTES
          while (index < parts.length && remaining > 0) {
            const part = parts[index]!
            const end = Math.min(part.size, offset + remaining)
            if (end > offset) chunks.push(part.slice(offset, end))
            remaining -= end - offset
            offset = end
            if (offset === part.size) {
              parts[index] = new Blob([])
              index++
              offset = 0
            }
          }
          if (!chunks.length) {
            controller.enqueue(new globalThis.TextEncoder().encode(hash.digest()))
            controller.close()
            parts.length = 0
            return
          }
          // Batch small metadata records too, so thousands of records do not
          // require thousands of file reads and round trips to the SW.
          const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer())
          checkBackupCancelled(options)
          hash.update(bytes)
          completed += bytes.length
          options.onProgress?.({ phase: 'checking', completed, total: size - 64 })
          controller.enqueue(bytes)
        } catch (error) {
          parts.length = 0
          controller.error(error)
        }
      },
      cancel() {
        parts.length = 0
      },
    },
    { highWaterMark: 0 },
  )
  return { stream, size }
}

/** Blob compatibility helper for tests/callers; the settings UI uses the stream. */
export async function createBackupArchive(options: BackupOptions = {}): Promise<Blob> {
  const { stream } = await createBackupStream(options)
  return new Response(stream).blob()
}

export async function restoreBackupFile(file: Blob, options: BackupOptions = {}): Promise<void> {
  checkBackupCancelled(options)
  if ((await file.slice(0, BACKUP_MAGIC.length).text()) !== BACKUP_MAGIC) {
    // Legacy JSON remains readable; newly exported archives never take this path.
    if (!/^[\s\uFEFF]*\{/.test(await file.slice(0, 4096).text()))
      throw new Error('BACKUP_UNKNOWN_FORMAT')
    const value: unknown = JSON.parse(await file.text())
    checkBackupCancelled(options)
    await restoreBackupData(value, undefined, options)
    return
  }
  const end = file.size - 64
  if (end < BACKUP_MAGIC.length) throw new Error('BACKUP_TRUNCATED')
  const checksum = await file.slice(end).text()
  if (
    !/^[a-f0-9]{64}$/.test(checksum) ||
    (await hashBlob(file.slice(0, end), options)) !== checksum
  )
    throw new Error('BACKUP_CHECKSUM')
  const backup: AppBackup = {
    format: 'gift-fsrs-learning-backup',
    version: 3,
    exportedAt: new Date().toISOString(),
    appVersion: '0.1.0',
    settings: { ...defaultSettings },
    decks: [],
    questions: [],
    studyStates: [],
    reviewLogs: [],
    importSources: [],
    media: [],
    imports: [],
  }
  const attachments = { sources: new Map<string, Blob>(), media: new Map<string, Blob>() }
  const seen = new Set<string>()
  let offset = BACKUP_MAGIC.length
  while (offset < end) {
    checkBackupCancelled(options)
    if (offset + 4 > end) throw new Error('BACKUP_TRUNCATED')
    const length = new DataView(await file.slice(offset, offset + 4).arrayBuffer()).getUint32(
      0,
      true,
    )
    offset += 4
    if (!length || length > MAX_BACKUP_RECORD_BYTES || offset + length > end)
      throw new Error('BACKUP_RECORD_SIZE')
    const record = v.parse(
      RecordSchema,
      JSON.parse(await file.slice(offset, offset + length).text()),
    )
    offset += length
    if (
      record.value.sourceArchiveBase64 !== undefined ||
      (record.store === 'media' && record.value.blobBase64 !== '')
    )
      throw new Error('BACKUP_INLINE_BINARY')
    const key = record.value.id ?? record.value.questionId
    if (typeof key !== 'string' || seen.has(`${record.store}:${key}`))
      throw new Error('BACKUP_DUPLICATE_RECORD')
    seen.add(`${record.store}:${key}`)
    if (record.blobSize !== undefined) {
      if (!['media', 'importSources'].includes(record.store) || record.blobSize > end - offset)
        throw new Error('BACKUP_BLOB_SIZE')
      const blob = file.slice(
        offset,
        offset + record.blobSize,
        record.store === 'media' ? String(record.value.mimeType) : 'application/zip',
      )
      ;(record.store === 'media' ? attachments.media : attachments.sources).set(key, blob)
      offset += record.blobSize
    } else if (record.store === 'media') throw new Error('BACKUP_MISSING_MEDIA')
    if (record.store === 'settings')
      backup.settings = record.value as unknown as AppBackup['settings']
    else (backup[record.store] as unknown[]).push(record.value)
    options.onProgress?.({ phase: 'reading', completed: offset, total: end })
  }
  await restoreBackupData(backup, attachments, options)
}
