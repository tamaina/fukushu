import { decodeArchive } from '@fukushu/anki-import/archive'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const result = await decodeArchive(new Uint8Array(event.data), { wasmUrl })
    const transfer = [...new Set(Object.values(result.files).map((file) => file.buffer))].filter(
      (buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer,
    )
    self.postMessage({ result }, { transfer })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
