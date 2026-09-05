import { convertArchive } from './convert'
import type { AnkiPackage, ConversionOptions } from './types'

/** Convenience API for DOM environments. Hosts supply the SQLite WASM asset location. */
export async function parseApkg(
  data: Uint8Array,
  options: ConversionOptions & { wasmUrl: string },
): Promise<AnkiPackage> {
  if (options.signal?.aborted) throw new DOMException('キャンセルしました', 'AbortError')
  options.onProgress?.('アーカイブとSQLiteを解析しています')
  const { decodeArchive } = await import('./archive')
  return convertArchive(await decodeArchive(data, options), options)
}
