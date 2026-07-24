import { rangeAt } from './range'
import type {
  GiftBlock,
  GiftContent,
  GiftDiagnostic,
  GiftDocument,
  GiftNumericalAnswer,
  GiftQuestion,
  GiftTextFormat,
  ParseGiftOptions,
  ParseGiftResult,
} from './types'

const unescapeGift = (value: string): string =>
  value.replace(/\\n/g, '\n').replace(/\\([~=#{}:\\<>])/g, '$1')

class GiftCursor {
  constructor(
    readonly source: string,
    public position = 0,
    readonly end = source.length,
  ) {}

  get eof(): boolean {
    return this.position >= this.end
  }

  peek(offset = 0): string | undefined {
    const at = this.position + offset
    return at < this.end ? this.source[at] : undefined
  }

  startsWith(value: string): boolean {
    return this.position + value.length <= this.end && this.source.startsWith(value, this.position)
  }

  startsWithIgnoringCase(value: string): boolean {
    return (
      this.position + value.length <= this.end &&
      this.source.slice(this.position, this.position + value.length).toLowerCase() ===
        value.toLowerCase()
    )
  }

  advance(count = 1): void {
    this.position = Math.min(this.position + count, this.end)
  }

  consumeIf(value: string): boolean {
    if (!this.startsWith(value)) return false
    this.advance(value.length)
    return true
  }

  readLine(): { start: number; end: number } {
    const start = this.position
    while (!this.eof) {
      const character = this.peek()
      this.advance()
      if (character === '\n') break
    }
    return { start, end: this.position }
  }

  findUnescaped(delimiters: readonly string[]): string | undefined {
    while (!this.eof) {
      if (this.peek() === '\\') {
        this.advance(Math.min(2, this.end - this.position))
        continue
      }
      const delimiter = delimiters.find((candidate) => this.startsWith(candidate))
      if (delimiter) return delimiter
      this.advance()
    }
    return undefined
  }
}

const isWhitespace = (character: string | undefined): boolean =>
  character !== undefined && character.trim() === ''

const trimSpan = (source: string, start: number, end: number): { start: number; end: number } => {
  while (start < end && isWhitespace(source[start])) start += 1
  while (end > start && isWhitespace(source[end - 1])) end -= 1
  return { start, end }
}

const content = (
  source: string,
  start: number,
  end: number,
  format: GiftTextFormat,
): GiftContent => ({
  type: 'content',
  format,
  value: unescapeGift(source.slice(start, end).trim()),
  range: rangeAt(source, start, end),
})

interface AnswerEntry {
  marker: '=' | '~'
  start: number
  valueStart: number
  valueEnd: number
  end: number
}

const readAnswerEntries = (
  source: string,
  start: number,
  end: number,
  implicitMarker: '=' | '~' = '~',
): AnswerEntry[] => {
  const cursor = new GiftCursor(source, start, end)
  const entries: AnswerEntry[] = []
  while (!cursor.eof) {
    const explicitMarker = cursor.peek() === '=' || cursor.peek() === '~'
    const entryStart = cursor.position
    const marker = explicitMarker ? (cursor.peek() as '=' | '~') : implicitMarker
    if (explicitMarker) cursor.advance()
    const valueStart = cursor.position
    cursor.findUnescaped(['=', '~'])
    const valueEnd = cursor.position
    if (source.slice(valueStart, valueEnd).trim()) {
      entries.push({ marker, start: entryStart, valueStart, valueEnd, end: valueEnd })
    }
  }
  return entries
}

const parseWeight = (
  source: string,
  entry: AnswerEntry,
): { weight: number; contentStart: number; invalid: boolean } => {
  const fallback = entry.marker === '=' ? 100 : 0
  const cursor = new GiftCursor(source, entry.valueStart, entry.valueEnd)
  if (!cursor.consumeIf('%')) {
    return { weight: fallback, contentStart: entry.valueStart, invalid: false }
  }
  const weightStart = cursor.position
  const delimiter = cursor.findUnescaped(['%'])
  if (!delimiter) {
    return { weight: fallback, contentStart: entry.valueStart, invalid: false }
  }
  const weight = Number(source.slice(weightStart, cursor.position))
  cursor.advance()
  return {
    weight,
    contentStart: cursor.position,
    invalid: !Number.isFinite(weight) || weight < -100 || weight > 100,
  }
}

const splitFeedback = (
  source: string,
  start: number,
  end: number,
): { valueEnd: number; feedbackStart?: number } => {
  const cursor = new GiftCursor(source, start, end)
  if (!cursor.findUnescaped(['#'])) return { valueEnd: end }
  const valueEnd = cursor.position
  cursor.advance()
  return { valueEnd, feedbackStart: cursor.position }
}

const findUnescaped = (
  source: string,
  start: number,
  end: number,
  delimiter: string,
): number | undefined => {
  const cursor = new GiftCursor(source, start, end)
  return cursor.findUnescaped([delimiter]) ? cursor.position : undefined
}

function parseNumericalAnswers(
  source: string,
  start: number,
  end: number,
  format: GiftTextFormat,
  diagnostics: GiftDiagnostic[],
): GiftNumericalAnswer[] {
  return readAnswerEntries(source, start, end, '=').flatMap<GiftNumericalAnswer>((entry) => {
    // Numerical separators do not change the default score in GIFT.
    const weightedEntry = { ...entry, marker: '=' as const }
    const parsed = parseWeight(source, weightedEntry)
    const parts = splitFeedback(source, parsed.contentStart, entry.valueEnd)
    const numberSpan = trimSpan(source, parsed.contentStart, parts.valueEnd)
    const text = source.slice(numberSpan.start, numberSpan.end)
    const tolerance = text.match(/^(-?\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/)
    const numericalRange = text.match(/^(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)$/)
    const nodeRange = rangeAt(source, entry.start, entry.end)
    const feedback =
      parts.feedbackStart === undefined
        ? {}
        : { feedback: content(source, parts.feedbackStart, entry.valueEnd, format) }
    if (numericalRange) {
      const min = Number(numericalRange[1])
      const max = Number(numericalRange[2])
      if (min > max) {
        diagnostics.push({
          severity: 'error',
          code: 'GIFT_NUMERICAL_INVALID_RANGE',
          message: 'The minimum of a numerical range cannot exceed its maximum.',
          range: nodeRange,
        })
      }
      return [
        { type: 'numerical-range', min, max, weight: parsed.weight, range: nodeRange, ...feedback },
      ]
    }
    if (tolerance) {
      return [
        {
          type: 'numerical-tolerance',
          value: Number(tolerance[1]),
          tolerance: Number(tolerance[2]),
          weight: parsed.weight,
          range: nodeRange,
          ...feedback,
        },
      ]
    }
    const value = Number(text)
    if (!Number.isFinite(value)) {
      diagnostics.push({
        severity: 'error',
        code: 'GIFT_NUMERICAL_INVALID_NUMBER',
        message: 'The numerical answer is invalid.',
        range: nodeRange,
      })
      return []
    }
    return [
      { type: 'numerical-exact', value, weight: parsed.weight, range: nodeRange, ...feedback },
    ]
  })
}

function parseQuestion(
  source: string,
  start: number,
  end: number,
  diagnostics: GiftDiagnostic[],
): GiftQuestion | undefined {
  const cursor = new GiftCursor(source, start, end)
  let name: string | undefined
  if (cursor.consumeIf('::')) {
    const nameStart = cursor.position
    if (!cursor.findUnescaped(['::'])) {
      diagnostics.push({
        severity: 'error',
        code: 'GIFT_UNTERMINATED_NAME',
        message: 'The question name is missing its closing :: delimiter.',
        range: rangeAt(source, start, end),
      })
      return undefined
    }
    name = unescapeGift(source.slice(nameStart, cursor.position))
    cursor.advance(2)
  }

  let format: GiftTextFormat = 'plain'
  const formats: GiftTextFormat[] = ['html', 'markdown', 'moodle', 'plain', 'auto']
  if (cursor.peek() === '[') {
    const matched = formats.find((candidate) => {
      const probe = new GiftCursor(source, cursor.position, end)
      return probe.startsWithIgnoringCase(`[${candidate}]`)
    })
    if (matched) {
      format = matched
      cursor.advance(matched.length + 2)
    }
  }

  const promptStart = cursor.position
  if (!cursor.findUnescaped(['{'])) {
    const promptSpan = trimSpan(source, promptStart, end)
    if (promptSpan.start === promptSpan.end) return undefined
    const base = {
      type: 'question' as const,
      kind: 'description' as const,
      prompt: content(source, promptSpan.start, promptSpan.end, format),
      format,
      range: rangeAt(source, start, end),
    }
    return name === undefined ? base : { ...base, name }
  }

  const open = cursor.position
  cursor.advance()
  const answerBlockStart = cursor.position
  if (!cursor.findUnescaped(['}'])) {
    diagnostics.push({
      severity: 'error',
      code: 'GIFT_UNTERMINATED_ANSWER_BLOCK',
      message: 'The answer block is missing its closing } delimiter.',
      range: rangeAt(source, open, end),
    })
    return undefined
  }
  const close = cursor.position
  const answerBlockSpan = trimSpan(source, answerBlockStart, close)
  const generalFeedbackAt = findUnescaped(
    source,
    answerBlockSpan.start,
    answerBlockSpan.end,
    '####',
  )
  const answerSpan = trimSpan(
    source,
    answerBlockSpan.start,
    generalFeedbackAt ?? answerBlockSpan.end,
  )
  const base = {
    type: 'question' as const,
    prompt: content(source, promptStart, open, format),
    format,
    range: rangeAt(source, start, close + 1),
    ...(name === undefined ? {} : { name }),
    ...(generalFeedbackAt === undefined
      ? {}
      : { generalFeedback: content(source, generalFeedbackAt + 4, answerBlockSpan.end, format) }),
  }

  if (answerSpan.start === answerSpan.end) return { ...base, kind: 'essay' }

  const trueFalseCursor = new GiftCursor(source, answerSpan.start, answerSpan.end)
  trueFalseCursor.findUnescaped(['#'])
  const trueFalseToken = source
    .slice(answerSpan.start, trueFalseCursor.position)
    .trim()
    .toUpperCase()
  if (['T', 'TRUE', 'F', 'FALSE'].includes(trueFalseToken)) {
    const correctAnswer = trueFalseToken.startsWith('T')
    const feedback: Array<{ start: number; end: number }> = []
    while (!trueFalseCursor.eof) {
      trueFalseCursor.advance()
      const feedbackStart = trueFalseCursor.position
      trueFalseCursor.findUnescaped(['#'])
      feedback.push({ start: feedbackStart, end: trueFalseCursor.position })
    }
    const wrongFeedback = feedback[0]
    const correctFeedback = feedback[1]
    const trueFeedback = correctAnswer ? correctFeedback : wrongFeedback
    const falseFeedback = correctAnswer ? wrongFeedback : correctFeedback
    return {
      ...base,
      kind: 'true-false',
      correctAnswer,
      ...(trueFeedback === undefined
        ? {}
        : { trueFeedback: content(source, trueFeedback.start, trueFeedback.end, format) }),
      ...(falseFeedback === undefined
        ? {}
        : { falseFeedback: content(source, falseFeedback.start, falseFeedback.end, format) }),
    }
  }

  if (source[answerSpan.start] === '#') {
    return {
      ...base,
      kind: 'numerical',
      answers: parseNumericalAnswers(
        source,
        answerSpan.start + 1,
        answerSpan.end,
        format,
        diagnostics,
      ),
    }
  }

  const entries = readAnswerEntries(source, answerSpan.start, answerSpan.end)
  const matching =
    entries.length > 0 &&
    entries.every(
      (entry) => findUnescaped(source, entry.valueStart, entry.valueEnd, '->') !== undefined,
    )
  if (matching) {
    const pairs = entries.map((entry) => {
      const arrow = findUnescaped(source, entry.valueStart, entry.valueEnd, '->')!
      return {
        type: 'matching-pair' as const,
        left: content(source, entry.valueStart, arrow, format),
        right: content(source, arrow + 2, entry.valueEnd, format),
        range: rangeAt(source, entry.start, entry.end),
      }
    })
    return { ...base, kind: 'matching', pairs }
  }

  const parsed = entries.map((entry) => {
    const weight = parseWeight(source, entry)
    if (weight.invalid) {
      diagnostics.push({
        severity: 'error',
        code: 'GIFT_INVALID_WEIGHT',
        message: 'The answer weight must be a number from -100 to 100.',
        range: rangeAt(source, entry.start, entry.end),
      })
    }
    const parts = splitFeedback(source, weight.contentStart, entry.valueEnd)
    return { entry, weight, parts }
  })
  const hasTilde = entries.some((entry) => entry.marker === '~')
  if (!hasTilde) {
    return {
      ...base,
      kind: 'short-answer',
      answers: parsed.map(({ entry, weight, parts }) => ({
        type: 'short-answer-option',
        value: unescapeGift(source.slice(weight.contentStart, parts.valueEnd).trim()),
        weight: weight.weight,
        range: rangeAt(source, entry.start, entry.end),
        ...(parts.feedbackStart === undefined
          ? {}
          : { feedback: content(source, parts.feedbackStart, entry.valueEnd, format) }),
      })),
    }
  }

  const answers = parsed.map(({ entry, weight, parts }) => ({
    type: 'choice-answer' as const,
    content: content(source, weight.contentStart, parts.valueEnd, format),
    weight: weight.weight,
    range: rangeAt(source, entry.start, entry.end),
    ...(parts.feedbackStart === undefined
      ? {}
      : { feedback: content(source, parts.feedbackStart, entry.valueEnd, format) }),
  }))
  const positive = answers.filter((item) => item.weight > 0)
  if (!positive.length) {
    diagnostics.push({
      severity: 'warning',
      code: 'GIFT_MULTIPLE_CHOICE_NO_POSITIVE_ANSWER',
      message: 'No choice has a positive weight.',
      range: base.range,
    })
  }
  if (answers.filter((item) => item.weight === 100).length > 1) {
    diagnostics.push({
      severity: 'warning',
      code: 'GIFT_MULTIPLE_CHOICE_MULTIPLE_FULL_SCORES',
      message: 'Multiple choices receive full credit.',
      range: base.range,
    })
  }
  return {
    ...base,
    kind: 'multiple-choice',
    mode: positive.length > 1 ? 'multiple' : 'single',
    answers,
  }
}

const categoryValueStart = (source: string, start: number, end: number): number | undefined => {
  const cursor = new GiftCursor(source, start, end)
  if (!cursor.startsWithIgnoringCase('$CATEGORY')) return undefined
  cursor.advance('$CATEGORY'.length)
  while (isWhitespace(cursor.peek())) cursor.advance()
  if (!cursor.consumeIf(':')) return undefined
  while (isWhitespace(cursor.peek())) cursor.advance()
  return cursor.position
}

const parseCategoryPath = (source: string, start: number, end: number): string[] => {
  const cursor = new GiftCursor(source, start, end)
  const parts: string[] = []
  let partStart = start
  let value = ''
  while (!cursor.eof) {
    if (cursor.consumeIf('//')) {
      value += `${source.slice(partStart, cursor.position - 2)}/`
      partStart = cursor.position
      continue
    }
    if (cursor.consumeIf('/')) {
      value += source.slice(partStart, cursor.position - 1)
      const part = unescapeGift(value.trim())
      if (part) parts.push(part)
      value = ''
      partStart = cursor.position
      continue
    }
    cursor.advance()
  }
  value += source.slice(partStart, end)
  const part = unescapeGift(value.trim())
  if (part) parts.push(part)
  return parts
}

const braceDepthAfter = (source: string, start: number, end: number, initial: number): number => {
  const cursor = new GiftCursor(source, start, end)
  let depth = initial
  while (!cursor.eof) {
    if (cursor.peek() === '\\') {
      cursor.advance(Math.min(2, end - cursor.position))
      continue
    }
    if (cursor.peek() === '{') depth += 1
    else if (cursor.peek() === '}') depth = Math.max(0, depth - 1)
    cursor.advance()
  }
  return depth
}

export function parseGift(sourceInput: string, options: ParseGiftOptions = {}): ParseGiftResult {
  const source = sourceInput.startsWith('\uFEFF') ? sourceInput.slice(1) : sourceInput
  const diagnostics: GiftDiagnostic[] = []
  const children: GiftBlock[] = []
  const cursor = new GiftCursor(source)
  let blockStart: number | undefined
  let blockEnd = 0
  let depth = 0

  const flush = (): void => {
    if (blockStart === undefined) return
    const span = trimSpan(source, blockStart, blockEnd)
    if (span.start < span.end) {
      const question = parseQuestion(source, span.start, span.end, diagnostics)
      if (question) children.push(question)
    }
    blockStart = undefined
    depth = 0
  }

  while (!cursor.eof) {
    const line = cursor.readLine()
    const trimmed = trimSpan(source, line.start, line.end)
    if (
      blockStart === undefined &&
      trimmed.start < trimmed.end &&
      source.startsWith('//', trimmed.start)
    ) {
      if (options.preserveComments !== false) {
        let valueEnd = line.end
        while (
          valueEnd > trimmed.start &&
          (source[valueEnd - 1] === '\r' || source[valueEnd - 1] === '\n')
        ) {
          valueEnd -= 1
        }
        children.push({
          type: 'comment',
          value: source.slice(trimmed.start + 2, valueEnd),
          range: rangeAt(source, trimmed.start, valueEnd),
        })
      }
      continue
    }
    const pathStart =
      blockStart === undefined ? categoryValueStart(source, trimmed.start, trimmed.end) : undefined
    if (pathStart !== undefined) {
      children.push({
        type: 'category',
        path: parseCategoryPath(source, pathStart, trimmed.end),
        range: rangeAt(source, trimmed.start, trimmed.end),
      })
      continue
    }
    if (blockStart === undefined && trimmed.start === trimmed.end) continue
    if (blockStart === undefined) blockStart = line.start
    blockEnd = line.end
    depth = braceDepthAfter(source, line.start, line.end, depth)
    if (depth === 0 && trimmed.start === trimmed.end) flush()
  }
  flush()

  const document: GiftDocument = {
    type: 'document',
    version: 1,
    children,
    range: rangeAt(source, 0, source.length),
  }
  return { document, diagnostics }
}
