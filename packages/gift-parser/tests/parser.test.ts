import { describe, expect, it } from 'vitest'
import { parseGift, stringifyGift, validateGift } from '../src'

describe('parseGift', () => {
  it('parses common GIFT blocks with ranges', () => {
    const source =
      '\uFEFF// 日本語\r\n$CATEGORY: 科学/地理\r\n\r\n::首都::日本の首都は? {=東京#正解 ~大阪#違います}\r\n\r\n真偽 {TRUE#その通り#違います}\r\n\r\n数値 {#=3.14:0.01}\r\n'
    const result = parseGift(source)
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0)
    expect(result.document.children.map((item) => item.type)).toEqual([
      'comment',
      'category',
      'question',
      'question',
      'question',
    ])
    const choice = result.document.children[2]
    expect(
      choice?.type === 'question' &&
        choice.kind === 'multiple-choice' &&
        choice.answers[0]?.content.value,
    ).toBe('東京')
    expect(choice?.range.start.line).toBe(4)
  })

  it.each([
    ['single short answer', '色は {=青}', 'short-answer'],
    ['short answer', '色は {=青=ブルー}', 'short-answer'],
    ['matching', '組合せ {=a -> A =b -> B}', 'matching'],
    ['essay', '説明せよ {}', 'essay'],
    ['description', 'これは説明です', 'description'],
    ['markdown', '[markdown] **太字** {=はい ~いいえ}', 'multiple-choice'],
  ])('parses %s', (_label, source, kind) => {
    const question = parseGift(source).document.children[0]
    expect(question?.type === 'question' && question.kind).toBe(kind)
  })

  it('reports malformed input instead of throwing', () => {
    const result = parseGift('壊れた {~%abc%a')
    expect(result.diagnostics.some((item) => item.code === 'GIFT_UNTERMINATED_ANSWER_BLOCK')).toBe(
      true,
    )
  })

  it('normalizes true/false spellings', () => {
    for (const [source, expected] of [
      ['Q {T}', true],
      ['Q {TRUE}', true],
      ['Q {F}', false],
      ['Q {FALSE}', false],
    ] as const) {
      const question = parseGift(source).document.children[0]
      expect(
        question?.type === 'question' && question.kind === 'true-false' && question.correctAnswer,
      ).toBe(expected)
    }
  })

  it('keeps partial and negative choice weights', () => {
    const question = parseGift('Q {~%50%A ~%-50%B =C}').document.children[0]
    expect(
      question?.type === 'question' &&
        question.kind === 'multiple-choice' &&
        question.answers.map((answer) => answer.weight),
    ).toEqual([50, -50, 100])
  })

  it('parses numerical exact, tolerance, range and feedback', () => {
    const document = parseGift('E {#=42#exact}\n\nT {#=3.14:0.01}\n\nR {#=1..2}').document
    const types = document.children.map((block) =>
      block.type === 'question' && block.kind === 'numerical' ? block.answers[0]?.type : undefined,
    )
    expect(types).toEqual(['numerical-exact', 'numerical-tolerance', 'numerical-range'])
  })

  it('unescapes escaped delimiters without ending blocks', () => {
    const question = parseGift('Escaped \\{brace\\} {=a\\~b ~c\\#d}').document.children[0]
    expect(question?.type === 'question' && question.prompt.value).toBe('Escaped {brace}')
    expect(
      question?.type === 'question' &&
        question.kind === 'multiple-choice' &&
        question.answers.map((answer) => answer.content.value),
    ).toEqual(['a~b', 'c#d'])
  })

  it('unescapes comparison operators in choices', () => {
    const question = parseGift(
      '::Q11_特殊文字::次のうち、比較演算子「小なり」はどれですか？ {=\\< ~\\> ~\\= ~\\~}',
    ).document.children[0]
    expect(
      question?.type === 'question' &&
        question.kind === 'multiple-choice' &&
        question.answers.map((answer) => answer.content.value),
    ).toEqual(['<', '>', '=', '~'])
  })

  it('diagnoses invalid weights and numerical ranges', () => {
    expect(
      parseGift('Q {~%abc%A =B}').diagnostics.some((item) => item.code === 'GIFT_INVALID_WEIGHT'),
    ).toBe(true)
    expect(
      parseGift('Q {#=5..1}').diagnostics.some(
        (item) => item.code === 'GIFT_NUMERICAL_INVALID_RANGE',
      ),
    ).toBe(true)
  })

  it('round trips semantic question kinds', () => {
    const first = parseGift(
      '$CATEGORY: A//B/C\n\nQ\\nline {~%-50%no =yes#ok####General}\n\nN {#=1..2}',
    )
    const second = parseGift(stringifyGift(first.document))
    expect(
      second.document.children.map((item) => (item.type === 'question' ? item.kind : item.type)),
    ).toEqual(
      first.document.children.map((item) => (item.type === 'question' ? item.kind : item.type)),
    )
    const question = second.document.children[1]
    expect(question?.type === 'question' && question.prompt.value).toBe('Q\nline')
    expect(question?.type === 'question' && question.generalFeedback?.value).toBe('General')
    expect(
      second.document.children[0]?.type === 'category' && second.document.children[0].path,
    ).toEqual(['A/B', 'C'])
  })

  it('maps true/false feedback by correctness as defined by GIFT', () => {
    const trueQuestion = parseGift('Q {TRUE#wrong#correct}').document.children[0]
    const falseQuestion = parseGift('Q {FALSE#wrong#correct}').document.children[0]
    expect(
      trueQuestion?.type === 'question' &&
        trueQuestion.kind === 'true-false' && [
          trueQuestion.trueFeedback?.value,
          trueQuestion.falseFeedback?.value,
        ],
    ).toEqual(['correct', 'wrong'])
    expect(
      falseQuestion?.type === 'question' &&
        falseQuestion.kind === 'true-false' && [
          falseQuestion.trueFeedback?.value,
          falseQuestion.falseFeedback?.value,
        ],
    ).toEqual(['wrong', 'correct'])
  })

  it('requires at least three matching pairs', () => {
    const parsed = parseGift('Q {=a -> A =b -> B}')
    expect(
      validateGift(parsed.document).some((item) => item.code === 'GIFT_MATCHING_TOO_FEW_PAIRS'),
    ).toBe(true)
  })

  it('validates limits', () => {
    const parsed = parseGift('very long prompt {}')
    expect(validateGift(parsed.document, { maxPromptLength: 3 })[0]?.code).toBe(
      'GIFT_PROMPT_TOO_LONG',
    )
  })

  it('parses the supported 20,000-question limit without quadratic range work', () => {
    const source = Array.from(
      { length: 20_000 },
      (_, index) => `::q${index}::Question ${index} {=yes ~no}`,
    ).join('\n\n')
    const started = Date.now()
    const parsed = parseGift(source)
    expect(parsed.document.children).toHaveLength(20_000)
    expect(parsed.diagnostics).toHaveLength(0)
    expect(Date.now() - started).toBeLessThan(5_000)
  })
})
