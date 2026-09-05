import { decodeArchive } from '@fukushu/anki-import/archive'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    self.postMessage({ result: await decodeArchive(new Uint8Array(event.data), { wasmUrl }) })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
