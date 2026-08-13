import type { GiftDiagnostic, SourceRange } from '@fukushu/gift-parser'
import type { FlashcardQuestion, QuizContent, QuizQuestion } from '../domain/quiz/types'
import { createId, sha256 } from '../utils/id'

export type AnkiSeparator = ',' | ';' | '\t' | '|' | ':' | ' '

export interface AnkiImportSettings {
  separator: AnkiSeparator
  html: boolean
  columns: string[]
  frontColumn: number
  backColumn: number
  explanationColumn?: number | undefined
  deckColumn?: number | undefined
  noteTypeColumn?: number | undefined
  tagsColumn?: number | undefined
  guidColumn?: number | undefined
  defaultDeck: string
  defaultNoteType: string
}

export interface AnkiImportPreview {
  source: string
  sourceHash: string
  settings: AnkiImportSettings
  diagnostics: GiftDiagnostic[]
  rows: string[][]
  decks: Array<{ name: string; questions: QuizQuestion[] }>
  counts: Record<string, number>
}

const position = (offset: number, line: number, column: number) => ({ offset, line, column })
const range = (line: number): SourceRange => ({
  start: position(0, line, 1),
  end: position(0, line, 1),
})
const diagnostic = (
  code: string,
  message: string,
  line: number,
  severity: GiftDiagnostic['severity'] = 'error',
): GiftDiagnostic => ({ code, message, severity, range: range(line) })

function separatorValue(value: string): AnkiSeparator | undefined {
  const values: Record<string, AnkiSeparator> = {
    comma: ',',
    semicolon: ';',
    tab: '\t',
    pipe: '|',
    colon: ':',
    space: ' ',
    ',': ',',
    ';': ';',
    '\\t': '\t',
    '|': '|',
    ':': ':',
  }
  return values[value.trim().toLowerCase()]
}

function guessSeparator(source: string, fileName?: string): AnkiSeparator {
  if (/\.tsv$/i.test(fileName ?? '')) return '\t'
  const line = source.split(/\r?\n/).find((item) => item && !item.startsWith('#')) ?? ''
  const candidates: AnkiSeparator[] = ['\t', ',', ';', '|', ':']
  return candidates.sort((a, b) => line.split(b).length - line.split(a).length)[0] ?? '\t'
}

/** RFC-4180 style rows, also used for Anki's tab/semicolon text files. */
export function parseDelimited(
  source: string,
  separator: AnkiSeparator,
): {
  rows: string[][]
  lineNumbers: number[]
  diagnostics: GiftDiagnostic[]
} {
  const rows: string[][] = []
  const lineNumbers: number[] = []
  const diagnostics: GiftDiagnostic[] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let line = 1
  let rowLine = 1
  for (let index = 0; index <= source.length; index += 1) {
    const character = source[index]
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') quoted = false
      else if (character === undefined) {
        diagnostics.push(
          diagnostic('ANKI_UNTERMINATED_QUOTE', 'Quoted field is not closed.', rowLine),
        )
        break
      } else {
        field += character
        if (character === '\n') line += 1
      }
      continue
    }
    if (character === '"' && field.length === 0) quoted = true
    else if (character === separator) {
      row.push(field)
      field = ''
    } else if (character === '\n' || character === undefined) {
      if (field.endsWith('\r')) field = field.slice(0, -1)
      row.push(field)
      rows.push(row)
      lineNumbers.push(rowLine)
      row = []
      field = ''
      line += character === '\n' ? 1 : 0
      rowLine = line
    } else field += character
  }
  return { rows, lineNumbers, diagnostics }
}

function parseHeaders(source: string, fileName?: string) {
  const headers = new Map<string, string>()
  const body: string[] = []
  let atTop = true
  for (const line of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = atTop ? /^#([^:]+):(.*)$/.exec(line) : undefined
    if (match) headers.set(match[1]!.trim().toLowerCase(), match[2]!.trim())
    else if (atTop && line.startsWith('#')) continue
    else {
      atTop = false
      body.push(line)
    }
  }
  return {
    headers,
    body: body.join('\n'),
    separator: separatorValue(headers.get('separator') ?? '') ?? guessSeparator(source, fileName),
  }
}

const content = (value: string, html: boolean): QuizContent => ({
  format: html ? 'html' : 'plain',
  value,
})
const plainText = (value: string): string => {
  const element = document.createElement('div')
  element.innerHTML = value
  return element.textContent ?? ''
}
const normalizedNoteType = (value: string): string => value.normalize('NFKC').trim().toLowerCase()
const clozeLabels = [...'アイウエオカキクケコサシスセソタチツテトナニヌネノ']
const escapeHtml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

function clozeCards(
  text: string,
  common: Omit<FlashcardQuestion, 'kind' | 'prompt' | 'answer' | 'sourceKey'>,
  key: string,
  html: boolean,
): FlashcardQuestion[] {
  const expression = /\{\{c(\d+)::([\s\S]*?)(?:::(.*?))?\}\}/gi
  const numbers = [...text.matchAll(expression)].map((match) => Number(match[1]))
  return [...new Set(numbers)]
    .sort((a, b) => a - b)
    .map((number) => {
      let blankIndex = 0
      const source = html ? text : escapeHtml(text)
      const front = source.replace(
        expression,
        (_all, rawNumber: string, answer: string, hint?: string) => {
          if (Number(rawNumber) !== number) return answer
          const label = clozeLabels[blankIndex] ?? String(blankIndex + 1)
          blankIndex += 1
          return `<span class="cloze-blank"><span class="cloze-label">${label}</span>${hint ? `<span class="cloze-hint">${hint}</span>` : ''}</span>`
        },
      )
      const back = source.replace(expression, (_all, rawNumber: string, answer: string) =>
        Number(rawNumber) === number ? `<mark>${answer}</mark>` : answer,
      )
      return {
        ...common,
        id: createId(),
        kind: 'flashcard',
        sourceKey: `${key}:cloze:${number}`,
        prompt: content(front, true),
        answer: content(back, true),
      }
    })
}

export async function previewAnkiText(
  source: string,
  deckIdByName: Record<string, string> = {},
  fileName?: string,
  overrides: Partial<AnkiImportSettings> = {},
): Promise<AnkiImportPreview> {
  const parsedHeaders = parseHeaders(source, fileName)
  const parsed = parseDelimited(parsedHeaders.body, parsedHeaders.separator)
  const headers = parsedHeaders.headers
  const firstWidth = parsed.rows.find((row) => row.some(Boolean))?.length ?? 0
  const columns =
    (headers.get('columns')
      ? parseDelimited(headers.get('columns')!, parsedHeaders.separator).rows[0]
      : undefined) ?? Array.from({ length: firstWidth }, (_, index) => `Field ${index + 1}`)
  const special = (name: string): number | undefined => {
    const value = Number(headers.get(`${name} column`))
    return Number.isInteger(value) && value > 0 ? value - 1 : undefined
  }
  const specialColumns = new Set(
    ['deck', 'notetype', 'tags', 'guid'].flatMap((name) => {
      const value = special(name)
      return value === undefined ? [] : [value]
    }),
  )
  const regular = columns.map((_, index) => index).filter((index) => !specialColumns.has(index))
  const settings: AnkiImportSettings = {
    separator: parsedHeaders.separator,
    html: headers.get('html')?.toLowerCase() !== 'false',
    columns,
    frontColumn: regular[0] ?? 0,
    backColumn: regular[1] ?? regular[0] ?? 0,
    ...(special('deck') === undefined ? {} : { deckColumn: special('deck') }),
    ...(special('notetype') === undefined ? {} : { noteTypeColumn: special('notetype') }),
    ...(special('tags') === undefined ? {} : { tagsColumn: special('tags') }),
    ...(special('guid') === undefined ? {} : { guidColumn: special('guid') }),
    defaultDeck: headers.get('deck') || fileName?.replace(/\.(csv|tsv|txt)$/i, '') || 'Anki',
    defaultNoteType: headers.get('notetype') || 'Basic',
    ...overrides,
  }
  const diagnostics = [...parsed.diagnostics]
  const grouped = new Map<string, QuizQuestion[]>()
  for (const [rowIndex, row] of parsed.rows.entries()) {
    if (row.length === 1 && !row[0]) continue
    const line = parsed.lineNumbers[rowIndex] ?? rowIndex + 1
    const front = row[settings.frontColumn] ?? ''
    const back = row[settings.backColumn] ?? ''
    if (!front.trim()) {
      diagnostics.push(diagnostic('ANKI_EMPTY_FRONT', 'The front field is empty.', line))
      continue
    }
    const deckName = row[settings.deckColumn ?? -1]?.trim() || settings.defaultDeck
    const noteType = row[settings.noteTypeColumn ?? -1]?.trim() || settings.defaultNoteType
    const guid = row[settings.guidColumn ?? -1]?.trim()
    const baseKey = guid || (await sha256(`${noteType}\0${front}`))
    const deckId = deckIdByName[deckName] ?? (deckIdByName[deckName] = createId())
    const explanationValue =
      settings.explanationColumn === undefined ? '' : (row[settings.explanationColumn] ?? '')
    const common = {
      id: createId(),
      deckId,
      categoryPath: [] as string[],
      ...(explanationValue ? { explanation: content(explanationValue, settings.html) } : {}),
      ankiNoteType: noteType,
      ...(settings.tagsColumn === undefined
        ? {}
        : { ankiTags: (row[settings.tagsColumn] ?? '').split(/\s+/).filter(Boolean) }),
    }
    const normalized = normalizedNoteType(noteType)
    let questions: FlashcardQuestion[]
    if (normalized === 'cloze' || /\{\{c\d+::/.test(front)) {
      questions = clozeCards(front, common, baseKey, settings.html)
      if (!questions.length)
        diagnostics.push(
          diagnostic('ANKI_CLOZE_MISSING', 'Cloze note has no valid deletion.', line),
        )
    } else {
      const forward: FlashcardQuestion = {
        ...common,
        kind: 'flashcard',
        sourceKey: `${baseKey}:forward`,
        prompt: content(front, settings.html),
        answer: content(back, settings.html),
        ...(normalized.includes('type in the answer')
          ? { typeAnswer: true, acceptedAnswer: plainText(back).trim() }
          : {}),
      }
      questions = [forward]
      if (normalized.includes('and reversed card')) {
        const reverseBase = { ...forward }
        delete reverseBase.acceptedAnswer
        questions.push({
          ...reverseBase,
          id: createId(),
          sourceKey: `${baseKey}:reverse`,
          prompt: content(back, settings.html),
          answer: content(front, settings.html),
          typeAnswer: false,
        })
      }
      if (normalized.includes('optional reversed card') && (row[regular[2] ?? -1] ?? '').trim())
        questions.push({
          ...forward,
          id: createId(),
          sourceKey: `${baseKey}:reverse`,
          prompt: content(back, settings.html),
          answer: content(front, settings.html),
        })
    }
    grouped.set(deckName, [...(grouped.get(deckName) ?? []), ...questions])
  }
  const decks = [...grouped].map(([name, questions]) => ({ name, questions }))
  const counts = Object.fromEntries(decks.map((deck) => [deck.name, deck.questions.length]))
  return {
    source,
    sourceHash: await sha256(source),
    settings,
    diagnostics,
    rows: parsed.rows,
    decks,
    counts,
  }
}
