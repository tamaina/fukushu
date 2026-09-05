import { simplifyHtml } from './simplify'
import type { DecodedArchive } from './archive'
import { safeAnkiCss, safeAnkiHtml, safeAnkiSvg } from './safety'
import { replaceLegacyLatex } from './latex'
import { renderTemplate, nativeTemplate } from './template'
import { Field, Type } from 'protobufjs/light'
import type {
  AnkiDiagnostic,
  AnkiCard,
  AnkiDeck,
  AnkiMedia,
  AnkiPackage,
  AnkiReview,
  ConversionOptions,
} from './types'
const MAX_MEDIA_FILE = 50 * 1024 * 1024

interface AnkiTemplateDefinition {
  name?: string
  ord: number
  qfmt?: string
  afmt?: string
}
interface AnkiFieldDefinition {
  name: string
}
interface AnkiModelDefinition {
  type?: number
  name?: string
  css?: string
  flds?: AnkiFieldDefinition[]
  tmpls?: AnkiTemplateDefinition[]
}
interface AnkiDeckDefinition {
  name?: string
}

const diagnostic = (
  code: string,
  message: string,
  severity: AnkiDiagnostic['severity'] = 'warning',
): AnkiDiagnostic => ({ code, message, severity })
const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  b.every((value, index) => a[index] === value)
const sha256Bytes = async (data: Uint8Array): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', data.slice().buffer))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
const json = <T>(value: unknown): T => {
  try {
    return JSON.parse(String(value)) as T
  } catch {
    throw new Error('APKG_INVALID_JSON')
  }
}
const mimeType = (name: string): string => {
  const extension = name.split('.').pop()?.toLowerCase()
  return (
    (
      {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        mp3: 'audio/mpeg',
        ogg: 'audio/ogg',
        wav: 'audio/wav',
        m4a: 'audio/mp4',
      } as Record<string, string>
    )[extension ?? ''] ?? 'application/octet-stream'
  )
}

const MediaEntry = new Type('MediaEntry')
  .add(new Field('name', 1, 'string'))
  .add(new Field('size', 2, 'uint32'))
  .add(new Field('sha1', 3, 'bytes'))
  .add(new Field('legacyZipFilename', 255, 'uint32'))
const MediaEntries = new Type('MediaEntries').add(new Field('entries', 1, 'MediaEntry', 'repeated'))
MediaEntries.add(MediaEntry)

function decodeMediaMap(
  raw: Uint8Array,
  latest: boolean,
): Array<{ archiveNames: string[]; name: string; size?: number; sha1?: Uint8Array }> {
  if (!latest) {
    const value = json<Record<string, string>>(new TextDecoder().decode(raw))
    return Object.entries(value).map(([archiveName, name]) => ({
      archiveNames: [archiveName],
      name,
    }))
  }
  const decoded = MediaEntries.decode(raw) as unknown as {
    entries?: Array<{ name: string; size: number; sha1?: Uint8Array; legacyZipFilename?: number }>
  }
  return (decoded.entries ?? []).map((entry, index) => {
    return {
      archiveNames: [
        Object.hasOwn(entry, 'legacyZipFilename') ? String(entry.legacyZipFilename) : String(index),
      ],
      name: entry.name,
      size: entry.size,
      ...(entry.sha1 ? { sha1: entry.sha1 } : {}),
    }
  })
}

function sanitizeHtml(
  value: string,
  media: Map<string, { id: string; url: string }>,
  diagnostics: AnkiDiagnostic[],
): string {
  value = value.replace(/\[sound:([^\]]+)\]/g, (_all, name: string) => {
    const ref = media.get(name)
    if (!ref) {
      diagnostics.push(diagnostic('APKG_MISSING_MEDIA', name))
      return '[音声なし]'
    }
    return '<audio controls preload="none" src="' + ref.url + '"></audio>'
  })
  const doc = new DOMParser().parseFromString(value, 'text/html')
  if (doc.querySelector('style,script,iframe,object,embed,link,[srcset],[onerror],[onclick]'))
    diagnostics.push(diagnostic('APKG_UNSAFE_HTML', '危険なHTML要素・属性を除去しました。'))
  for (const node of doc.querySelectorAll('[src]')) {
    const src = node.getAttribute('src')!
    if (src.startsWith('fukushu-media:')) continue
    const ref = media.get(src)
    if (ref) node.setAttribute('src', ref.url)
    else {
      node.removeAttribute('src')
      diagnostics.push(diagnostic('APKG_MISSING_MEDIA', src))
    }
  }
  return safeAnkiHtml(doc.body.innerHTML)
}

/** DOM-dependent template conversion; archive decoding can run independently in a worker. */
export async function convertArchive(
  decoded: DecodedArchive,
  options: ConversionOptions = {},
): Promise<AnkiPackage> {
  const { files, format: packageFormat, rows } = decoded
  const diagnostics: AnkiDiagnostic[] = []
  const col = rows.col?.[0]
  if (!col) throw new Error('APKG_INVALID_COLLECTION')
  const models = json<Record<string, AnkiModelDefinition>>(col.models)
  const deckDefinitions = json<Record<string, AnkiDeckDefinition>>(col.decks)
  const mediaMap = files.media ? decodeMediaMap(files.media, packageFormat === '21b') : []
  const media: AnkiMedia[] = []
  const mediaIds = new Set<string>()
  options.onProgress?.('メディアを検証し、カードを変換しています')
  const mediaUrls = new Map<string, { id: string; url: string }>()
  for (const entry of mediaMap) {
    if (options.signal?.aborted) throw new DOMException('キャンセルしました', 'AbortError')
    let data = entry.archiveNames.map((name) => files[name]).find(Boolean)
    if (!data) {
      diagnostics.push(diagnostic('APKG_MISSING_MEDIA', `メディアがありません: ${entry.name}`))
      continue
    }
    if (data.length > MAX_MEDIA_FILE) throw new Error('APKG_MEDIA_TOO_LARGE')
    if (entry.size !== undefined && entry.size !== data.length)
      throw new Error('APKG_MEDIA_SIZE_MISMATCH')
    if (entry.sha1) {
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', data.slice().buffer))
      if (hash.length !== entry.sha1.length || !bytesEqual(hash, entry.sha1))
        throw new Error('APKG_MEDIA_HASH_MISMATCH')
    }
    const mime = mimeType(entry.name)
    if (mime === 'application/octet-stream') {
      diagnostics.push(diagnostic('APKG_UNSUPPORTED_MEDIA', entry.name))
      continue
    }
    if (mime === 'image/svg+xml') {
      try {
        data = new TextEncoder().encode(
          safeAnkiSvg(new TextDecoder('utf-8', { fatal: true }).decode(data)),
        )
      } catch {
        diagnostics.push(diagnostic('APKG_UNSAFE_SVG', entry.name))
        continue
      }
    }
    const id = await sha256Bytes(data)
    if (!mediaIds.has(id))
      media.push({
        id,
        mimeType: mime,
        data,
        size: data.length,
      })
    mediaIds.add(id)
    mediaUrls.set(entry.name, { id, url: 'fukushu-media:' + id })
  }
  const notes = new Map((rows.notes ?? []).map((note) => [Number(note.id), note]))
  const cards = rows.cards ?? []
  const baseCounts = new Map<string, number>(),
    noteCounts = new Map<string, number>()
  for (const card of cards) {
    const key = `${notes.get(Number(card.nid))?.guid}:${card.ord}`
    baseCounts.set(key, (baseCounts.get(key) ?? 0) + 1)
    const noteKey = `${card.nid}:${card.ord}`
    noteCounts.set(noteKey, (noteCounts.get(noteKey) ?? 0) + 1)
  }
  const reviews = rows.revlog ?? []
  const reviewsByCard = new Map<number, AnkiReview[]>()
  let skippedReviewCount = 0
  for (const row of reviews) {
    const ease = Number(row.ease)
    const type = Number(row.type)
    if (
      ![1, 2, 3, 4].includes(ease) ||
      ![0, 1, 2, 3].includes(type) ||
      !Number.isSafeInteger(Number(row.id)) ||
      Number(row.id) <= 0 ||
      !Number.isFinite(new Date(Number(row.id)).getTime())
    ) {
      skippedReviewCount += 1
      continue
    }
    const cardId = Number(row.cid)
    reviewsByCard.set(cardId, [
      ...(reviewsByCard.get(cardId) ?? []),
      { id: String(row.id), cardId: String(row.cid), at: Number(row.id), ease, type },
    ])
  }
  if (skippedReviewCount)
    diagnostics.push(
      diagnostic(
        'APKG_SKIPPED_REVLOG',
        `評価を持たないrevlog ${skippedReviewCount}件をスキップしました。`,
      ),
    )
  const grouped = new Map<string, AnkiDeck>(
    Object.entries(deckDefinitions).map(([key, deck]) => [
      key,
      {
        id: key,
        name: deck.name ?? key,
        cards: [],
      },
    ]),
  )
  let yieldedAt = Date.now()
  const styles = new Map<string, { css: string; removed: boolean }>()
  let convertedCount = 0
  for (const card of cards) {
    if (Date.now() - yieldedAt >= 16) {
      options.onProgress?.(`カードを変換しています（${convertedCount} / ${cards.length}）`)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      yieldedAt = Date.now()
    }
    if (options.signal?.aborted) throw new DOMException('キャンセルしました', 'AbortError')
    convertedCount++
    const note = notes.get(Number(card.nid))
    const diagnosticStart = diagnostics.length
    try {
      const model = note ? models[String(note.mid)] : undefined
      if (!note || !model) {
        diagnostics.push(
          diagnostic(
            'APKG_MISSING_NOTETYPE',
            `カード ${card.id} のノートタイプがありません。`,
            'error',
          ),
        )
        continue
      }
      const template = model.tmpls?.find(
        (item) => Number(item.ord) === (model.type === 1 ? 0 : Number(card.ord)),
      )
      if (!template) {
        diagnostics.push(
          diagnostic(
            'APKG_MISSING_TEMPLATE',
            `カード ${card.id} のテンプレートがありません。`,
            'error',
          ),
        )
        continue
      }
      const fields = Object.fromEntries(
        (model.flds ?? []).map((field, index: number) => [
          field.name,
          String(note.flds).split('\x1f')[index] ?? '',
        ]),
      )
      const deckTitle = deckDefinitions[String(card.did)]?.name ?? String(card.did)
      const special = {
        Tags: String(note.tags ?? '').trim(),
        Type: model.name ?? '',
        Deck: deckTitle,
        Subdeck: deckTitle.split('::').at(-1) ?? '',
        Card: template.name ?? String(Number(card.ord) + 1),
        CardFlag: Number(card.flags ?? 0) & 7 ? `flag${Number(card.flags) & 7}` : '',
      }
      // User fields take precedence over built-in metadata, as in Anki.
      for (const [name, value] of Object.entries(special))
        if (!Object.hasOwn(fields, name)) fields[name] = value
      const clozeNumber = Number(card.ord)
      const front = renderTemplate(String(template.qfmt ?? ''), fields, '', clozeNumber)
      const frontForBack =
        front.acceptedAnswer === undefined
          ? front.html
          : renderTemplate(String(template.qfmt ?? ''), fields, '', clozeNumber, true).html
      const back = renderTemplate(
        String(template.afmt ?? ''),
        fields,
        frontForBack,
        clozeNumber,
        true,
      )
      for (const warning of [...front.warnings, ...back.warnings])
        diagnostics.push(diagnostic('APKG_UNSUPPORTED_TEMPLATE', warning, 'error'))
      const warnLatex = (message: string) =>
        diagnostics.push(diagnostic('APKG_MISSING_LATEX', message))
      const prompt = sanitizeHtml(
        await replaceLegacyLatex(front.html, mediaUrls, warnLatex),
        mediaUrls,
        diagnostics,
      )
      const answer = sanitizeHtml(
        await replaceLegacyLatex(back.html, mediaUrls, warnLatex),
        mediaUrls,
        diagnostics,
      )
      if (
        !prompt.replace(/<[^>]+>/g, '').trim() &&
        !/<(?:img|audio)\b/.test(prompt) &&
        front.acceptedAnswer === undefined
      ) {
        diagnostics.push(diagnostic('APKG_EMPTY_CARD', `空のカード ${card.id} を除外しました。`))
        continue
      }
      const did = String(card.did)
      if (!Object.hasOwn(deckDefinitions, did)) {
        diagnostics.push(diagnostic('APKG_MISSING_DECK', did, 'error'))
        continue
      }
      const deckName = deckDefinitions[did]?.name ?? `Deck ${did}`
      const deck: AnkiDeck = grouped.get(did) ?? {
        id: did,
        name: deckName,
        cards: [],
      }
      const baseKey = `${note.guid}:${Number(card.ord)}`
      const sourceKey =
        (baseCounts.get(baseKey) ?? 0) > 1
          ? `${baseKey}:note:${note.id}${(noteCounts.get(`${note.id}:${card.ord}`) ?? 0) > 1 ? `:card:${card.id}` : ''}`
          : baseKey
      const simple = nativeTemplate(
        template.qfmt ?? '',
        template.afmt ?? '',
        model.css ?? '',
        fields,
      )
      const rawCss = model.css ?? ''
      let style = styles.get(rawCss)
      if (!style) {
        let removed = false
        const css = safeAnkiCss(rawCss, () => {
          removed = true
        })
        style = { css, removed }
        styles.set(rawCss, style)
      }
      const { css, removed: cssRemoved } = style
      if (cssRemoved)
        diagnostics.push(diagnostic('APKG_UNSAFE_CSS', '未対応のCSS・外部参照を除去しました。'))
      const simplifiedFront = simple ? undefined : simplifyHtml(prompt, css)
      const simplifiedBack = simple ? undefined : simplifyHtml(answer, css)
      const question: AnkiCard = {
        ...(simplifiedFront && simplifiedBack
          ? { simplified: { front: simplifiedFront, back: simplifiedBack } }
          : {}),
        key: sourceKey,
        frontHtml: prompt,
        backHtml: answer,
        noteType: String(model.name ?? 'Anki'),
        tags: String(note.tags ?? '')
          .trim()
          .split(/\s+/)
          .filter(Boolean),
        rendering: simple ? { mode: 'native' } : { mode: 'template', css },
        source: {
          guid: String(note.guid),
          noteId: String(note.id),
          cardId: String(card.id),
          notetypeId: String(note.mid),
          ordinal: Number(card.ord),
          qfmt: template.qfmt ?? '',
          afmt: template.afmt ?? '',
          css: model.css ?? '',
        },
        ...(front.acceptedAnswer === undefined ? {} : { acceptedAnswer: front.acceptedAnswer }),
        reviews: reviewsByCard.get(Number(card.id)) ?? [],
      }
      deck.cards.push(question)
      grouped.set(did, deck)
    } finally {
      const raw = String(note?.flds ?? '').split('\x1f')[0] ?? ''
      const excerpt = (new DOMParser().parseFromString(raw, 'text/html').body.textContent ?? '')
        .replace(/\s+/g, ' ')
        .slice(0, 100)
      for (const item of diagnostics.slice(diagnosticStart))
        item.card = {
          deckId: String(card.did),
          deckName: deckDefinitions[String(card.did)]?.name ?? String(card.did),
          key: (() => {
            const key = String(note?.guid ?? '') + ':' + String(card.ord)
            return (baseCounts.get(key) ?? 0) > 1
              ? `${key}:note:${card.nid}${(noteCounts.get(`${card.nid}:${card.ord}`) ?? 0) > 1 ? `:card:${card.id}` : ''}`
              : key
          })(),
          cardId: String(card.id),
          excerpt,
        }
    }
  }
  const decks = [...grouped.values()].filter((deck) => deck.cards.length > 0)
  return {
    format: packageFormat,
    diagnostics,
    decks,
    media,
    stats: {
      deckCount: decks.length,
      noteCount: notes.size,
      cardCount: decks.reduce((sum, deck) => sum + deck.cards.length, 0),
      notetypeCount: Object.keys(models).length,
      mediaBytes: media.reduce((sum, item) => sum + item.size, 0),
      reviewCount: reviews.length - skippedReviewCount,
      skippedReviewCount,
    },
  }
}
