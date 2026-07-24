<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, Copy, Share2, X } from '@lucide/vue'
import QuestionPreviewPopover from './QuestionPreviewPopover.vue'
import type { AppRating } from '../infrastructure/fsrs/adapter'
import type { QuestionRecord } from '../infrastructure/db/schema'

export interface StudyResultItem {
  question: QuestionRecord
  rating: AppRating
  correct: boolean
}

const props = defineProps<{
  final: boolean
  interrupted: boolean
  items: StudyResultItem[]
  backLabel: string
  backTarget: string
}>()
const emit = defineEmits<{
  continue: []
  leave: []
}>()

const shareStatus = ref('')
const resultTextarea = ref<InstanceType<typeof globalThis.HTMLTextAreaElement>>()
const correctCount = computed(() => props.items.filter((item) => item.correct).length)
const incorrectCount = computed(() => props.items.length - correctCount.value)
const accuracy = computed(() =>
  props.items.length ? Math.round((correctCount.value / props.items.length) * 100) : 0,
)
const displayedItems = computed(() => [...props.items].reverse())
const shareText = computed(() => {
  const heading = props.final
    ? $locale.value.sfc.finalShareHeading
    : props.interrupted
      ? $locale.value.sfc.interruptedShareHeading
      : $locale.value.sfc.midwayShareHeading
  const summary = $l.value.sfc.shareSummary({
    correct: correctCount.value,
    incorrect: incorrectCount.value,
    total: props.items.length,
    accuracy: accuracy.value,
  })
  return `#Fukushu ${heading}\n${summary}\n\n${window.location.origin}`
})
const canShare = computed(
  () =>
    typeof globalThis.navigator !== 'undefined' && typeof globalThis.navigator.share === 'function',
)

function ratingLabel(rating: AppRating): string {
  return {
    again: $locale.value.sfc.again,
    hard: $locale.value.sfc.hard,
    good: $locale.value.sfc.good,
    easy: $locale.value.sfc.easy,
  }[rating]
}

async function copyResult(): Promise<void> {
  try {
    if (globalThis.navigator.clipboard)
      await globalThis.navigator.clipboard.writeText(shareText.value)
    else {
      resultTextarea.value?.select()
      document.execCommand('copy')
    }
    shareStatus.value = $locale.value.sfc.copied
  } catch {
    shareStatus.value = $locale.value.sfc.copyFailed
  }
}

async function shareResult(): Promise<void> {
  if (!canShare.value) return
  try {
    await globalThis.navigator.share({ text: shareText.value })
    shareStatus.value = $locale.value.sfc.shared
  } catch (error) {
    if (error instanceof globalThis.DOMException && error.name === 'AbortError') return
    shareStatus.value = $locale.value.sfc.shareFailed
  }
}
</script>

<template>
  <section class="study-results" aria-labelledby="study-results-title">
    <p class="eyebrow">
      {{
        final
          ? $locale.sfc.finalEyebrow
          : interrupted
            ? $locale.sfc.interruptedEyebrow
            : $locale.sfc.midwayEyebrow
      }}
    </p>
    <h1 id="study-results-title">
      {{ $l.sfc.correctCount({ count: correctCount }) }}
    </h1>
    <p class="result-summary">
      {{
        $l.sfc.resultSummary({
          incorrect: incorrectCount,
          total: items.length,
          accuracy,
        })
      }}
    </p>
    <div class="actions result-actions">
      <button v-if="!final" @click="emit('continue')">{{ $locale.sfc.continueStudy }}</button>
      <RouterLink v-else class="button" :to="backTarget" @click="emit('leave')">{{
        backLabel
      }}</RouterLink>
      <RouterLink v-if="interrupted" class="button secondary" :to="backTarget">{{
        backLabel
      }}</RouterLink>
    </div>

    <section class="result-share" aria-labelledby="result-share-heading">
      <h2 id="result-share-heading">{{ $locale.sfc.shareResults }}</h2>
      <label class="visually-hidden" for="study-result-share-text">{{
        $locale.sfc.shareTextLabel
      }}</label>
      <textarea
        id="study-result-share-text"
        ref="resultTextarea"
        :value="shareText"
        rows="4"
        readonly
      ></textarea>
      <div class="actions result-share-actions">
        <button class="secondary" @click="copyResult">
          <Copy aria-hidden="true" :size="18" />{{ $locale.sfc.copy }}
        </button>
        <button v-if="canShare" @click="shareResult">
          <Share2 aria-hidden="true" :size="18" />{{ $locale.sfc.share }}
        </button>
      </div>
      <p class="share-status" aria-live="polite">{{ shareStatus }}</p>
    </section>

    <section aria-labelledby="answer-history-heading">
      <h2 id="answer-history-heading">{{ $locale.sfc.answerHistory }}</h2>
      <div class="result-table-wrap">
        <table>
          <thead>
            <tr>
              <th>{{ $locale.sfc.question }}</th>
              <th>{{ $locale.sfc.result }}</th>
              <th>Rating</th>
              <th>{{ $locale.sfc.preview }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(result, resultIndex) in displayedItems"
              :key="`${result.question.id}-${resultIndex}`"
              :class="{ 'result-row-incorrect': !result.correct }"
            >
              <td class="result-question-title">
                <strong>{{
                  result.question.payload.name || result.question.payload.prompt.value.slice(0, 80)
                }}</strong>
              </td>
              <td>
                <span
                  class="result-badge"
                  :class="result.correct ? 'result-badge-correct' : 'result-badge-incorrect'"
                >
                  <Check v-if="result.correct" aria-hidden="true" :size="16" />
                  <X v-else aria-hidden="true" :size="16" />
                  {{ result.correct ? $locale.sfc.correct : $locale.sfc.incorrect }}
                </span>
              </td>
              <td>
                <span class="rating-pill active" :class="result.rating">{{
                  ratingLabel(result.rating)
                }}</span>
              </td>
              <td>
                <QuestionPreviewPopover :question="result.question.payload" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>

<locale locale="ja-JP" lang="yaml">
finalEyebrow: 学習結果
midwayEyebrow: 途中結果
interruptedEyebrow: 中断時点の結果
correctCount: '{count}問正解'
resultSummary: '誤答 {incorrect}問・回答 {total}問・正答率 {accuracy}%'
continueStudy: 学習を続ける
shareResults: 結果を共有
shareTextLabel: 共有用の結果テキスト
copy: コピー
share: 共有
copied: 結果をコピーしました。
copyFailed: コピーできませんでした。テキストを選択してコピーしてください。
shared: 共有しました。
shareFailed: 共有できませんでした。
answerHistory: 問題一覧
question: 問題
result: 結果
preview: プレビュー
correct: 正解
incorrect: 誤答
again: もう一度
hard: 難しかった
good: 正解
easy: 簡単
finalShareHeading: 学習結果
midwayShareHeading: 途中結果
interruptedShareHeading: 中断時点の結果
shareSummary: '結果: 正答{correct}問/誤答{incorrect}問/回答{total}問 (正答率{accuracy}%)'
</locale>

<locale locale="en-US" lang="yaml">
finalEyebrow: Study results
midwayEyebrow: Progress report
interruptedEyebrow: Results at interruption
correctCount: '{count, plural, one {# correct answer} other {# correct answers}}'
resultSummary: '{incorrect} incorrect · {total} answered · {accuracy}% accuracy'
continueStudy: Continue studying
shareResults: Share results
shareTextLabel: Result text to share
copy: Copy
share: Share
copied: Results copied.
copyFailed: Could not copy. Select and copy the text manually.
shared: Shared.
shareFailed: Could not share.
answerHistory: Questions
question: Question
result: Result
preview: Preview
correct: Correct
incorrect: Incorrect
again: Again
hard: Hard
good: Good
easy: Easy
finalShareHeading: Study results
midwayShareHeading: Progress report
interruptedShareHeading: Results at interruption
shareSummary: 'Result: {correct} correct/{incorrect} incorrect/{total} answered ({accuracy}% accuracy)'
</locale>
