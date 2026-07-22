import type { SourcePosition, SourceRange } from './types'

export function positionAt(source: string, offset: number): SourcePosition {
  const safe = Math.max(0, Math.min(offset, source.length))
  let starts = lineStartsCache.get(source)
  if (!starts) {
    starts = [0]
    for (let index = 0; index < source.length; index += 1)
      if (source[index] === '\n') starts.push(index + 1)
    lineStartsCache.set(source, starts)
    if (lineStartsCache.size > 4) lineStartsCache.delete(lineStartsCache.keys().next().value!)
  }
  let low = 0
  let high = starts.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (starts[middle]! <= safe) low = middle + 1
    else high = middle
  }
  const lineIndex = Math.max(0, low - 1)
  return { offset: safe, line: lineIndex + 1, column: safe - starts[lineIndex]! + 1 }
}

const lineStartsCache = new Map<string, number[]>()

export const rangeAt = (source: string, start: number, end: number): SourceRange => ({
  start: positionAt(source, start),
  end: positionAt(source, end),
})
