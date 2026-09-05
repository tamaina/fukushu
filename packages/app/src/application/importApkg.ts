import {
  convertArchive,
  APKG_MAX_BYTES,
  type AnkiDiagnostic,
  type AnkiPackage,
  type AnkiReview,
  type ConversionOptions,
} from '@fukushu/anki-import'
import type { DecodedArchive } from '@fukushu/anki-import/archive'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import type { FlashcardQuestion } from '../domain/quiz/types'
import type { MediaRecord } from '../infrastructure/db/schema'
import { createId } from '../utils/id'

export type ApkgReview = AnkiReview
export interface ApkgDeckPreview {
  sourceDeckKey: string
  name: string
  questions: FlashcardQuestion[]
  reviewsBySourceKey: Record<string, ApkgReview[]>
  nativeCount: number
  isolatedCount: number
}
export interface ApkgPreview {
  sourceHash: string
  packageFormat: AnkiPackage['format']
  diagnostics: AnkiDiagnostic[]
  decks: ApkgDeckPreview[]
  media: MediaRecord[]
  archive: Blob
  stats: AnkiPackage['stats']
  simplifiedCards?: Record<
    string,
    {
      front: { format: 'plain' | 'markdown'; value: string }
      back: { format: 'plain' | 'markdown'; value: string }
    }
  >
}

/** App boundary: worker/assets, local IDs, persisted card shape and Blob storage. */
export async function previewApkg(
  file: File,
  deckIdByKey: Record<string, string> = {},
  options: ConversionOptions = {},
): Promise<ApkgPreview> {
  if (options.signal?.aborted) throw new DOMException('キャンセルしました', 'AbortError')
  if (file.size > APKG_MAX_BYTES) throw new Error('APKG_ARCHIVE_TOO_LARGE')
  const buffer =
    typeof file.arrayBuffer === 'function'
      ? await file.arrayBuffer()
      : await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as ArrayBuffer)
          reader.onerror = () => reject(reader.error)
          reader.readAsArrayBuffer(file)
        })
  const bytes = new Uint8Array(buffer)
  options.onProgress?.('アーカイブとSQLiteを解析しています')
  const decoded: DecodedArchive =
    typeof Worker === 'undefined'
      ? await (
          await import('@fukushu/anki-import/archive')
        ).decodeArchive(bytes, { wasmUrl: sqlWasmUrl.replace(/^\/@fs/, '') })
      : await new Promise((resolve, reject) => {
          const worker = new Worker(new URL('./apkg.worker.ts', import.meta.url), {
            type: 'module',
          })
          const finish = () => {
            worker.terminate()
            options.signal?.removeEventListener('abort', abort)
          }
          const abort = () => {
            finish()
            reject(new DOMException('キャンセルしました', 'AbortError'))
          }
          worker.onmessage = (event: MessageEvent<{ result?: DecodedArchive; error?: string }>) => {
            finish()
            if (event.data.result) resolve(event.data.result)
            else reject(new Error(event.data.error))
          }
          worker.onerror = (event) => {
            finish()
            reject(new Error(event.message))
          }
          if (options.signal?.aborted) {
            abort()
            return
          }
          options.signal?.addEventListener('abort', abort, { once: true })
          worker.postMessage(buffer)
        })
  const parsed = await convertArchive(decoded, options)
  const sourceHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return {
    sourceHash,
    packageFormat: parsed.format,
    archive: file,
    diagnostics: parsed.diagnostics,
    stats: parsed.stats,
    simplifiedCards: Object.fromEntries(
      parsed.decks.flatMap((d) =>
        d.cards.flatMap((c) => (c.simplified ? [[c.key, c.simplified]] : [])),
      ),
    ),
    media: parsed.media.map(({ data, ...media }) => ({
      ...media,
      blob: new Blob([data.slice().buffer], { type: media.mimeType }),
    })),
    decks: parsed.decks.map((deck) => ({
      sourceDeckKey: deck.id,
      name: deck.name,
      nativeCount: deck.cards.filter((c) => c.rendering.mode === 'native').length,
      isolatedCount: deck.cards.filter((c) => c.rendering.mode === 'template').length,
      reviewsBySourceKey: Object.fromEntries(deck.cards.map((c) => [c.key, c.reviews])),
      questions: deck.cards.map((card) => ({
        id: createId(),
        deckId: deckIdByKey[deck.id] ?? (deckIdByKey[deck.id] = createId()),
        sourceKey: card.key,
        kind: 'flashcard',
        prompt: { format: 'html', value: card.frontHtml },
        answer: { format: 'html', value: card.backHtml },
        categoryPath: [],
        ankiNoteType: card.noteType,
        ankiTags: card.tags,
        ankiSource: card.source,
        ankiTemplateMode: card.rendering.mode === 'native' ? 'native' : 'isolated',
        ...(card.rendering.mode === 'template' ? { ankiCss: card.rendering.css } : {}),
        ...(card.acceptedAnswer === undefined
          ? {}
          : { typeAnswer: true, acceptedAnswer: card.acceptedAnswer }),
      })),
    })),
  }
}
