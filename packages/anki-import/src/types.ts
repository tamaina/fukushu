/** Anki package diagnostics are not text-source diagnostics: no fictitious line numbers. */
export interface AnkiDiagnostic {
  code: string
  message: string
  severity: 'error' | 'warning' | 'info'
  card?: { deckId: string; deckName: string; key: string; cardId: string; excerpt: string }
}
export interface AnkiReview {
  id: string
  cardId: string
  at: number
  ease: number
  type: number
}
export interface AnkiCardSource {
  guid?: string
  noteId: string
  cardId: string
  notetypeId: string
  ordinal: number
  qfmt: string
  afmt: string
  css: string
}
export interface AnkiCard {
  key: string
  frontHtml: string
  backHtml: string
  noteType: string
  tags: string[]
  rendering: { mode: 'native' } | { mode: 'template'; css: string }
  source: AnkiCardSource
  acceptedAnswer?: string
  reviews: AnkiReview[]
  simplified?: { front: SimplifiedContent; back: SimplifiedContent }
}
export interface SimplifiedContent {
  format: 'plain' | 'markdown'
  value: string
}
export interface AnkiDeck {
  id: string
  name: string
  cards: AnkiCard[]
}
export interface AnkiMedia {
  id: string
  mimeType: string
  data: Uint8Array
  size: number
}
export interface AnkiPackage {
  format: 'anki2' | 'anki21' | '21b'
  decks: AnkiDeck[]
  media: AnkiMedia[]
  diagnostics: AnkiDiagnostic[]
  stats: {
    deckCount: number
    noteCount: number
    cardCount: number
    notetypeCount: number
    mediaBytes: number
    reviewCount: number
    skippedReviewCount: number
  }
}
export interface ConversionOptions {
  signal?: AbortSignal
  onProgress?: (message: string) => void
}
