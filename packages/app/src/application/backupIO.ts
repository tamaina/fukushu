import { createSHA256 } from 'hash-wasm'

export interface BackupOptions {
  signal?: AbortSignal
  onProgress?: (progress: {
    phase: 'reading' | 'checking' | 'saving'
    completed: number
    total: number
  }) => void
}
export const BACKUP_CHUNK_BYTES = 4 * 1024 ** 2
export function checkBackupCancelled(options: BackupOptions): void {
  options.signal?.throwIfAborted()
}
/** Bound binary materialization regardless of the total archive/media size. */
export async function hashBlob(blob: Blob, options: BackupOptions = {}): Promise<string> {
  const hash = await createSHA256()
  let yielded = performance.now()
  for (let offset = 0; offset < blob.size; offset += BACKUP_CHUNK_BYTES) {
    checkBackupCancelled(options)
    const end = Math.min(blob.size, offset + BACKUP_CHUNK_BYTES)
    hash.update(new Uint8Array(await blob.slice(offset, end).arrayBuffer()))
    options.onProgress?.({ phase: 'checking', completed: end, total: blob.size })
    if (performance.now() - yielded >= 16) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      yielded = performance.now()
    }
  }
  checkBackupCancelled(options)
  return hash.digest()
}
