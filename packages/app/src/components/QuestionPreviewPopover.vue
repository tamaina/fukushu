<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, Eye, X } from '@lucide/vue'
import type { QuizQuestion } from '../domain/quiz/types'
import ContentRenderer from './ContentRenderer.vue'

const props = defineProps<{ question: QuizQuestion }>()

const popoverId = computed(() => `question-preview-${props.question.id}`)
const previewDialog = ref<{ showModal: () => void; close: () => void }>()
const correctChoices = computed(() => {
  if (props.question.kind !== 'single-choice' && props.question.kind !== 'multiple-choice')
    return []
  if (props.question.kind === 'single-choice') {
    const maximum = Math.max(...props.question.choices.map((choice) => choice.weight))
    return props.question.choices.filter((choice) => choice.weight === maximum)
  }
  return props.question.choices.filter((choice) => choice.weight > 0)
})
const shortAnswers = computed(() =>
  props.question.kind === 'short-answer'
    ? props.question.answers.filter((answer) => answer.weight > 0).map((answer) => answer.value)
    : [],
)
const numericalAnswers = computed(() => {
  if (props.question.kind !== 'numerical') return []
  return props.question.answers
    .filter((answer) => answer.weight > 0)
    .map((answer) => {
      if (answer.type === 'exact') return String(answer.value)
      if (answer.type === 'tolerance') return `${answer.value} ± ${answer.tolerance}`
      return `${answer.min}〜${answer.max}`
    })
})
function openPreview(): void {
  previewDialog.value?.showModal()
}
function closePreview(): void {
  previewDialog.value?.close()
}
</script>

<template>
  <button
    class="secondary compact preview-trigger"
    :aria-label="$l.sfc.previewQuestion({ name: question.name || question.prompt.value })"
    @click="openPreview"
  >
    <Eye aria-hidden="true" />{{ $locale.sfc.preview }}
  </button>
  <dialog
    :id="popoverId"
    ref="previewDialog"
    class="question-preview-popover"
    :aria-labelledby="`${popoverId}-title`"
    @click.self.stop="closePreview"
  >
    <div class="question-preview-heading">
      <div>
        <span class="badge">{{ question.kind }}</span>
        <h2 :id="`${popoverId}-title`">{{ question.name || $locale.sfc.untitled }}</h2>
      </div>
      <button class="icon-button secondary" :aria-label="$locale.sfc.close" @click="closePreview">
        <X aria-hidden="true" />
      </button>
    </div>

    <ContentRenderer :content="question.prompt" />

    <fieldset
      v-if="question.kind === 'single-choice' || question.kind === 'multiple-choice'"
      class="choices preview-choices"
    >
      <legend class="visually-hidden">{{ $locale.sfc.choices }}</legend>
      <label
        v-for="choice in question.choices"
        :key="choice.id"
        class="choice-card"
        :class="{
          selected: correctChoices.some((item) => item.id === choice.id),
          correct: correctChoices.some((item) => item.id === choice.id),
        }"
      >
        <input
          :type="question.kind === 'single-choice' ? 'radio' : 'checkbox'"
          :name="`${question.id}-preview`"
          :checked="correctChoices.some((item) => item.id === choice.id)"
          disabled
        /><ContentRenderer :content="choice.content" />
        <span v-if="correctChoices.some((item) => item.id === choice.id)" class="answer-label">
          <Check aria-hidden="true" />{{ $locale.sfc.correctAnswer }}
        </span>
      </label>
    </fieldset>
    <fieldset v-else-if="question.kind === 'true-false'" class="choices preview-choices">
      <legend class="visually-hidden">{{ $locale.sfc.choices }}</legend>
      <label
        v-for="option in [
          { value: true, label: $locale.sfc.trueLabel },
          { value: false, label: $locale.sfc.falseLabel },
        ]"
        :key="String(option.value)"
        class="choice-card"
        :class="{
          selected: question.correctAnswer === option.value,
          correct: question.correctAnswer === option.value,
        }"
      >
        <input
          type="radio"
          :name="`${question.id}-preview`"
          :checked="question.correctAnswer === option.value"
          disabled
        />{{ option.label }}
        <span v-if="question.correctAnswer === option.value" class="answer-label">
          <Check aria-hidden="true" />{{ $locale.sfc.correctAnswer }}
        </span>
      </label>
    </fieldset>
    <p v-else-if="question.kind === 'short-answer'" class="preview-correct-answer">
      <strong>{{ $locale.sfc.correctAnswer }}</strong> {{ shortAnswers.join(' / ') }}
    </p>
    <p v-else-if="question.kind === 'numerical'" class="preview-correct-answer">
      <strong>{{ $locale.sfc.correctAnswer }}</strong> {{ numericalAnswers.join(' / ') }}
    </p>
    <p v-else class="muted">{{ $locale.sfc.unsupported }}</p>

    <div v-if="question.explanation" class="preview-explanation">
      <h3>{{ $locale.sfc.explanation }}</h3>
      <ContentRenderer :content="question.explanation" />
    </div>
  </dialog>
</template>

<locale locale="ja-JP" lang="yaml">
preview: プレビュー
previewQuestion: '「{name}」をプレビュー'
untitled: 無題の問題
close: 閉じる
correctAnswer: 正答
choices: 選択肢
trueLabel: 正しい
falseLabel: 誤り
unsupported: この問題形式はプレビューに対応していません。
explanation: 解説
</locale>

<locale locale="en-US" lang="yaml">
preview: Preview
previewQuestion: 'Preview "{name}"'
untitled: Untitled question
close: Close
correctAnswer: Correct answer
choices: Choices
trueLabel: 'True'
falseLabel: 'False'
unsupported: This question type cannot be previewed.
explanation: Explanation
</locale>
