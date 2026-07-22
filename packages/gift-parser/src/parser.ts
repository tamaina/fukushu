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
const escapeAwareIndex = (text: string, needle: string, from = 0): number => {
  for (let i = from; i <= text.length - needle.length; i += 1) {
    if (text.startsWith(needle, i)) {
      let slashes = 0
      for (let j = i - 1; j >= 0 && text[j] === '\\'; j -= 1) slashes += 1
      if (slashes % 2 === 0) return i
    }
  }
  return -1
}
const splitUnescaped = (
  text: string,
  delimiter: string,
): Array<{ value: string; offset: number }> => {
  const result: Array<{ value: string; offset: number }> = []
  let start = 0
  while (start <= text.length) {
    const found = escapeAwareIndex(text, delimiter, start)
    if (found < 0) {
      result.push({ value: text.slice(start), offset: start })
      break
    }
    result.push({ value: text.slice(start, found), offset: start })
    start = found + delimiter.length
  }
  return result
}
const content = (
  source: string,
  value: string,
  start: number,
  format: GiftTextFormat,
): GiftContent => ({
  type: 'content',
  format,
  value: unescapeGift(value.trim()),
  range: rangeAt(source, start, start + value.length),
})
const parseWeight = (raw: string): { weight: number; rest: string; invalid: boolean } => {
  const marker = raw[0]
  const body = raw.slice(1)
  const match = body.match(/^%([^%]+)%/)
  if (!match) return { weight: marker === '=' ? 100 : 0, rest: body, invalid: false }
  const weight = Number(match[1])
  return {
    weight,
    rest: body.slice(match[0].length),
    invalid: !Number.isFinite(weight) || weight < -100 || weight > 100,
  }
}
const feedbackParts = (raw: string): [string, string | undefined] => {
  const at = escapeAwareIndex(raw, '#')
  return at < 0 ? [raw, undefined] : [raw.slice(0, at), raw.slice(at + 1)]
}

function parseQuestion(
  source: string,
  raw: string,
  start: number,
  diagnostics: GiftDiagnostic[],
): GiftQuestion | undefined {
  let cursor = 0
  let name: string | undefined
  if (raw.startsWith('::')) {
    const end = escapeAwareIndex(raw, '::', 2)
    if (end < 0) {
      diagnostics.push({
        severity: 'error',
        code: 'GIFT_UNTERMINATED_NAME',
        message: '問題名の終端 :: がありません。',
        range: rangeAt(source, start, start + raw.length),
      })
      return undefined
    }
    name = unescapeGift(raw.slice(2, end))
    cursor = end + 2
  }
  let format: GiftTextFormat = 'plain'
  const formatMatch = raw.slice(cursor).match(/^\[(html|markdown|moodle|plain|auto)\]/i)
  if (formatMatch?.[1]) {
    format = formatMatch[1].toLowerCase() as GiftTextFormat
    cursor += formatMatch[0].length
  }
  const open = escapeAwareIndex(raw, '{', cursor)
  if (open < 0) {
    const value = raw.slice(cursor).trim()
    if (!value) return undefined
    const base = {
      type: 'question' as const,
      kind: 'description' as const,
      prompt: content(source, value, start + cursor, format),
      format,
      range: rangeAt(source, start, start + raw.length),
    }
    return name === undefined ? base : { ...base, name }
  }
  const close = escapeAwareIndex(raw, '}', open + 1)
  if (close < 0) {
    diagnostics.push({
      severity: 'error',
      code: 'GIFT_UNTERMINATED_ANSWER_BLOCK',
      message: '解答ブロックを閉じる } がありません。',
      range: rangeAt(source, start + open, start + raw.length),
    })
    return undefined
  }
  const prompt = content(source, raw.slice(cursor, open), start + cursor, format)
  const answerWithFeedback = raw.slice(open + 1, close).trim()
  const generalFeedbackAt = escapeAwareIndex(answerWithFeedback, '####')
  const answer = (
    generalFeedbackAt < 0 ? answerWithFeedback : answerWithFeedback.slice(0, generalFeedbackAt)
  ).trim()
  const generalFeedback =
    generalFeedbackAt < 0
      ? undefined
      : content(
          source,
          answerWithFeedback.slice(generalFeedbackAt + 4),
          start + open + 1 + generalFeedbackAt + 4,
          format,
        )
  const base = {
    type: 'question' as const,
    prompt,
    format,
    range: rangeAt(source, start, start + close + 1),
    ...(name === undefined ? {} : { name }),
    ...(generalFeedback === undefined ? {} : { generalFeedback }),
  }
  if (!answer) return { ...base, kind: 'essay' }
  const tf = answer.match(/^(T|TRUE|F|FALSE)(?:#([^#]*))?(?:#(.*))?$/i)
  if (tf) {
    const correctAnswer = tf[1]!.toUpperCase().startsWith('T')
    const wrongFeedback = tf[2]
    const correctFeedback = tf[3]
    return {
      ...base,
      kind: 'true-false',
      correctAnswer,
      ...((correctAnswer ? correctFeedback : wrongFeedback) === undefined
        ? {}
        : {
            trueFeedback: content(
              source,
              (correctAnswer ? correctFeedback : wrongFeedback)!,
              start + open + 1,
              format,
            ),
          }),
      ...((correctAnswer ? wrongFeedback : correctFeedback) === undefined
        ? {}
        : {
            falseFeedback: content(
              source,
              (correctAnswer ? wrongFeedback : correctFeedback)!,
              start + open + 1,
              format,
            ),
          }),
    }
  }
  if (answer.startsWith('#')) {
    const entries = splitUnescaped(answer.slice(1), '=')
      .flatMap((part) =>
        splitUnescaped(part.value, '~').map((nested) => ({
          value: nested.value,
          offset: part.offset + nested.offset + 1,
        })),
      )
      .filter((item) => item.value.trim())
    const answers = entries.flatMap<GiftNumericalAnswer>((entry) => {
      const parsed = parseWeight(`=${entry.value}`)
      const [numberPart, fb] = feedbackParts(parsed.rest)
      const text = numberPart.trim()
      const tolerance = text.match(/^(-?\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/)
      const range = text.match(/^(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)$/)
      const nodeRange = rangeAt(
        source,
        start + open + 1 + entry.offset,
        start + open + 2 + entry.offset + entry.value.length,
      )
      if (range) {
        const min = Number(range[1])
        const max = Number(range[2])
        if (min > max)
          diagnostics.push({
            severity: 'error',
            code: 'GIFT_NUMERICAL_INVALID_RANGE',
            message: '数値範囲の最小値が最大値を超えています。',
            range: nodeRange,
          })
        return [
          {
            type: 'numerical-range' as const,
            min,
            max,
            weight: parsed.weight,
            range: nodeRange,
            ...(fb === undefined
              ? {}
              : { feedback: content(source, fb, start + open + 1, format) }),
          },
        ]
      }
      if (tolerance)
        return [
          {
            type: 'numerical-tolerance' as const,
            value: Number(tolerance[1]),
            tolerance: Number(tolerance[2]),
            weight: parsed.weight,
            range: nodeRange,
            ...(fb === undefined
              ? {}
              : { feedback: content(source, fb, start + open + 1, format) }),
          },
        ]
      const value = Number(text)
      if (!Number.isFinite(value)) {
        diagnostics.push({
          severity: 'error',
          code: 'GIFT_NUMERICAL_INVALID_NUMBER',
          message: '数値解答が不正です。',
          range: nodeRange,
        })
        return []
      }
      return [
        {
          type: 'numerical-exact' as const,
          value,
          weight: parsed.weight,
          range: nodeRange,
          ...(fb === undefined ? {} : { feedback: content(source, fb, start + open + 1, format) }),
        },
      ]
    })
    return { ...base, kind: 'numerical', answers }
  }
  const entries = splitUnescaped(answer, '~')
    .flatMap((part) =>
      splitUnescaped(part.value, '=').map((nested, i) => ({
        raw: `${i === 0 && part.value.startsWith('=') ? '=' : nested.offset === 0 && part.offset === 0 && answer.startsWith('=') ? '=' : nested.offset > 0 || part.value.startsWith('=') ? '=' : '~'}${nested.value}`,
        offset: part.offset + nested.offset,
      })),
    )
    .filter((entry) => entry.raw.slice(1).trim())
  const matching =
    entries.length > 0 && entries.every((entry) => escapeAwareIndex(entry.raw, '->') >= 0)
  if (matching) {
    const pairs = entries.map((entry) => {
      const arrow = escapeAwareIndex(entry.raw, '->')
      const left = entry.raw.slice(1, arrow)
      const right = entry.raw.slice(arrow + 2)
      return {
        type: 'matching-pair' as const,
        left: content(source, left, start + open + 2 + entry.offset, format),
        right: content(source, right, start + open + 2 + entry.offset + arrow + 2, format),
        range: rangeAt(
          source,
          start + open + 1 + entry.offset,
          start + open + 2 + entry.offset + entry.raw.length,
        ),
      }
    })
    return { ...base, kind: 'matching', pairs }
  }
  const hasTilde = entries.some((entry) => entry.raw.startsWith('~'))
  const parsed = entries.map((entry) => {
    const weight = parseWeight(entry.raw)
    if (weight.invalid)
      diagnostics.push({
        severity: 'error',
        code: 'GIFT_INVALID_WEIGHT',
        message: '配点は-100から100の数値で指定してください。',
        range: rangeAt(
          source,
          start + open + 1 + entry.offset,
          start + open + 2 + entry.offset + entry.raw.length,
        ),
      })
    const [answerText, fb] = feedbackParts(weight.rest)
    return { entry, weight, answerText, fb }
  })
  if (!hasTilde)
    return {
      ...base,
      kind: 'short-answer',
      answers: parsed.map(({ entry, weight, answerText, fb }) => ({
        type: 'short-answer-option',
        value: unescapeGift(answerText.trim()),
        weight: weight.weight,
        range: rangeAt(
          source,
          start + open + 1 + entry.offset,
          start + open + 2 + entry.offset + entry.raw.length,
        ),
        ...(fb === undefined ? {} : { feedback: content(source, fb, start + open + 1, format) }),
      })),
    }
  const answers = parsed.map(({ entry, weight, answerText, fb }) => ({
    type: 'choice-answer' as const,
    content: content(source, answerText, start + open + 2 + entry.offset, format),
    weight: weight.weight,
    range: rangeAt(
      source,
      start + open + 1 + entry.offset,
      start + open + 2 + entry.offset + entry.raw.length,
    ),
    ...(fb === undefined ? {} : { feedback: content(source, fb, start + open + 1, format) }),
  }))
  const positive = answers.filter((item) => item.weight > 0)
  if (!positive.length)
    diagnostics.push({
      severity: 'warning',
      code: 'GIFT_MULTIPLE_CHOICE_NO_POSITIVE_ANSWER',
      message: '正の配点を持つ選択肢がありません。',
      range: base.range,
    })
  if (answers.filter((item) => item.weight === 100).length > 1)
    diagnostics.push({
      severity: 'warning',
      code: 'GIFT_MULTIPLE_CHOICE_MULTIPLE_FULL_SCORES',
      message: '満点の選択肢が複数あります。',
      range: base.range,
    })
  return {
    ...base,
    kind: 'multiple-choice',
    mode: positive.length > 1 ? 'multiple' : 'single',
    answers,
  }
}

export function parseGift(sourceInput: string, options: ParseGiftOptions = {}): ParseGiftResult {
  const source = sourceInput.replace(/^\uFEFF/, '')
  const diagnostics: GiftDiagnostic[] = []
  const children: GiftBlock[] = []
  const lines = source.split(/(?<=\n)/)
  let offset = 0
  let buffer = ''
  let bufferStart = 0
  let depth = 0
  const flush = (): void => {
    const raw = buffer.trim()
    if (raw) {
      const leading = buffer.indexOf(raw)
      const question = parseQuestion(source, raw, bufferStart + leading, diagnostics)
      if (question) children.push(question)
    }
    buffer = ''
    depth = 0
  }
  for (const line of lines) {
    const trimmed = line.trim()
    if (!buffer && trimmed.startsWith('//')) {
      if (options.preserveComments !== false) {
        const at = offset + line.indexOf('//')
        children.push({
          type: 'comment',
          value: line.slice(line.indexOf('//') + 2).replace(/[\r\n]+$/, ''),
          range: rangeAt(source, at, offset + line.replace(/[\r\n]+$/, '').length),
        })
      }
      offset += line.length
      continue
    }
    if (!buffer && /^\$CATEGORY\s*:/i.test(trimmed)) {
      const at = offset + line.indexOf('$')
      const pathText = trimmed.replace(/^\$CATEGORY\s*:\s*/i, '')
      children.push({
        type: 'category',
        path: pathText
          .split(/(?<!\/)\/(?!\/)/)
          .map((part) => part.replaceAll('//', '/'))
          .map((part) => unescapeGift(part.trim()))
          .filter(Boolean),
        range: rangeAt(source, at, offset + line.replace(/[\r\n]+$/, '').length),
      })
      offset += line.length
      continue
    }
    if (!buffer && !trimmed) {
      offset += line.length
      continue
    }
    if (!buffer) bufferStart = offset
    buffer += line
    for (let i = 0; i < line.length; i += 1) {
      if (line[i] === '\\') {
        i += 1
        continue
      }
      if (line[i] === '{') depth += 1
      else if (line[i] === '}') depth = Math.max(0, depth - 1)
    }
    if (depth === 0 && /(?:\r?\n\s*){2}$/.test(buffer)) flush()
    offset += line.length
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
