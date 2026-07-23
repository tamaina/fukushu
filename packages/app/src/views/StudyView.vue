<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Check, X } from '@lucide/vue'
import ContentRenderer from '../components/ContentRenderer.vue'
import { buildStudyQueue, recordReview, type StudyItem } from '../application/study'
import { gradeQuestion } from '../domain/quiz/grading'
import { systemClock } from '../domain/time'
import { ratingFromResult, review, type AppRating } from '../infrastructure/fsrs/adapter'
import {
  deckRepository,
  questionRepository,
  settingsRepository,
  stateRepository,
} from '../infrastructure/db/database'
import type { GradeResult, QuizChoice } from '../domain/quiz/types'
const route = useRoute()
const router = useRouter()
const queue = ref<StudyItem[]>([])
const index = ref(0)
const selected = ref<string[]>([])
const text = ref('')
const graded = ref<GradeResult>()
const feedbackVisible = ref(false)
const answerVisible = ref(false)
const started = ref(0)
const busy = ref(false)
const nextDue = ref('')
const item = computed(() => queue.value[index.value])
const question = computed(() => item.value?.question.payload)
const isFlashcard = computed(() => item.value?.studyMode === 'flashcard')
const backTarget = computed(() =>
  typeof route.query.deck === 'string' ? `/decks/${route.query.deck}` : '/',
)
const progress = computed(
  () => `${Math.min(index.value + 1, queue.value.length)} / ${queue.value.length}`,
)
const canAnswer = computed(() => {
  if (!question.value || question.value.kind === 'unsupported') return false
  if (question.value.kind === 'short-answer') return Boolean(text.value.trim())
  if (question.value.kind === 'numerical')
    return Boolean(text.value.trim()) && Number.isFinite(Number(text.value.trim()))
  return selected.value.length > 0
})
const correctShortAnswers = computed(() => {
  if (question.value?.kind !== 'short-answer') return []
  return question.value.answers
    .filter((answer) => answer.weight >= 100)
    .map((answer) => answer.value)
})
const correctChoices = computed(() => {
  if (question.value?.kind !== 'single-choice' && question.value?.kind !== 'multiple-choice')
    return []
  if (question.value.kind === 'single-choice') {
    const maximum = Math.max(...question.value.choices.map((choice) => choice.weight))
    return question.value.choices.filter((choice) => choice.weight === maximum)
  }
  return question.value.choices.filter((choice) => choice.weight > 0)
})
const numericalAnswers = computed(() => {
  if (question.value?.kind !== 'numerical') return []
  return question.value.answers
    .filter((answer) => answer.weight > 0)
    .map((answer) => {
      if (answer.type === 'exact') return String(answer.value)
      if (answer.type === 'tolerance') return `${answer.value} ± ${answer.tolerance}`
      return `${answer.min}〜${answer.max}`
    })
})
const sessionKey = 'fukushu-study-session-v1'
function toggle(id: string): void {
  if (!question.value || graded.value) return
  if (question.value.kind === 'single-choice') selected.value = [id]
  else
    selected.value = selected.value.includes(id)
      ? selected.value.filter((value) => value !== id)
      : [...selected.value, id]
}
function choiceCorrect(choice: QuizChoice): boolean {
  if (question.value?.kind === 'single-choice') {
    return choice.weight === Math.max(...question.value.choices.map((item) => item.weight))
  }
  return choice.weight > 0
}
function trueFalseCorrect(id: string): boolean {
  return question.value?.kind === 'true-false' && String(question.value.correctAnswer) === id
}
async function grade(): Promise<void> {
  if (!question.value) return
  const answer =
    question.value.kind === 'short-answer' || question.value.kind === 'numerical'
      ? [text.value]
      : selected.value
  graded.value = gradeQuestion(question.value, answer)
  const settings = await settingsRepository.get()
  feedbackVisible.value = settings.showImmediateFeedback
  nextDue.value = review(
    item.value!.state.card,
    systemClock.now(),
    ratingFromResult(graded.value.correct),
    settings.desiredRetention,
  ).card.due
}
function gradeOnEnter(event: {
  isComposing: boolean
  keyCode: number
  preventDefault: () => void
}): void {
  if (event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  if (canAnswer.value && !graded.value) void grade()
}
async function rate(rating: AppRating): Promise<void> {
  if (!item.value || (!isFlashcard.value && !graded.value)) return
  busy.value = true
  const answer =
    question.value?.kind === 'short-answer' || question.value?.kind === 'numerical'
      ? [text.value]
      : selected.value
  await recordReview(
    item.value,
    rating,
    isFlashcard.value ? rating !== 'again' : graded.value!.correct,
    isFlashcard.value ? [] : answer,
    Date.now() - started.value,
    systemClock,
  )
  index.value += 1
  selected.value = []
  text.value = ''
  graded.value = undefined
  feedbackVisible.value = false
  answerVisible.value = false
  nextDue.value = ''
  started.value = Date.now()
  busy.value = false
  const remaining = queue.value.slice(index.value)
  if (remaining.length) {
    sessionStorage.setItem(
      sessionKey,
      JSON.stringify({
        deckId: typeof route.query.deck === 'string' ? route.query.deck : null,
        cram: route.query.cram === '1',
        questionIds: remaining.map((entry) => entry.question.id),
      }),
    )
  } else sessionStorage.removeItem(sessionKey)
}
onMounted(async () => {
  const deckId = typeof route.query.deck === 'string' ? route.query.deck : undefined
  let cram = route.query.cram === '1'
  let restored: { deckId: string | null; cram?: boolean; questionIds: string[] } | undefined
  try {
    restored = JSON.parse(sessionStorage.getItem(sessionKey) ?? '') as typeof restored
  } catch {
    // Missing or invalid session data starts a fresh session.
  }
  if (
    restored &&
    restored.deckId === (deckId ?? null) &&
    Boolean(restored.cram) === cram &&
    Array.isArray(restored.questionIds)
  ) {
    for (const id of restored.questionIds) {
      const question = await questionRepository.get(id)
      const state = await stateRepository.get(id)
      const deck = question ? await deckRepository.get(question.deckId) : undefined
      if (question?.enabled && state && !state.suspended) {
        queue.value.push({
          question,
          state,
          isNew: state.card.reps === 0,
          studyMode: deck?.studyMode ?? 'quiz',
        })
      }
    }
  } else {
    queue.value = await buildStudyQueue(systemClock, deckId, cram)
    if (!queue.value.length && deckId && !cram) {
      cram = true
      await router.replace({ query: { ...route.query, cram: '1' } })
      queue.value = await buildStudyQueue(systemClock, deckId, true)
    }
    sessionStorage.setItem(
      sessionKey,
      JSON.stringify({
        deckId: deckId ?? null,
        cram,
        questionIds: queue.value.map((entry) => entry.question.id),
      }),
    )
  }
  index.value = 0
  started.value = Date.now()
})
</script>
<template>
  <div class="page study-page">
    <div v-if="item && question">
      <header class="study-header">
        <div>
          <span class="badge">{{ question.categoryPath.join(' / ') || 'カテゴリなし' }}</span
          ><span v-if="route.query.cram === '1'" class="badge">詰め込み学習</span
          ><span class="badge">{{ isFlashcard ? '単語帳' : 'クイズ' }}</span
          ><span>{{ progress }}・残り {{ queue.length - index - 1 }}問</span>
        </div>
        <button class="text-button" @click="router.push(backTarget)">中断する</button>
      </header>
      <article class="question-card">
        <h1 class="visually-hidden">問題</h1>
        <ContentRenderer :content="question.prompt" />
        <template v-if="!isFlashcard">
          <fieldset
            v-if="question.kind === 'single-choice' || question.kind === 'multiple-choice'"
            class="choices"
          >
            <legend class="visually-hidden">選択肢</legend>
            <label
              v-for="choice in question.choices"
              :key="choice.id"
              class="choice-card"
              :class="{
                selected: selected.includes(choice.id),
                correct: graded && feedbackVisible && choiceCorrect(choice),
                incorrect:
                  graded &&
                  feedbackVisible &&
                  selected.includes(choice.id) &&
                  !choiceCorrect(choice),
              }"
              ><input
                :type="question.kind === 'single-choice' ? 'radio' : 'checkbox'"
                :name="question.id"
                :checked="selected.includes(choice.id)"
                :disabled="!!graded"
                @change="toggle(choice.id)"
              /><ContentRenderer :content="choice.content" /><span class="answer-label-group"
                ><span
                  v-if="graded && feedbackVisible && choiceCorrect(choice)"
                  class="answer-label"
                  ><Check aria-hidden="true" />正答</span
                ><span
                  v-if="graded && feedbackVisible && selected.includes(choice.id)"
                  class="answer-label"
                  >選択済み</span
                ></span
              ></label
            >
          </fieldset>
          <fieldset v-else-if="question.kind === 'true-false'" class="choices">
            <legend class="visually-hidden">正しいか誤りか</legend>
            <label
              v-for="option in [
                { id: 'true', label: '正しい' },
                { id: 'false', label: '誤り' },
              ]"
              :key="option.id"
              class="choice-card"
              :class="{
                selected: selected.includes(option.id),
                correct: graded && feedbackVisible && trueFalseCorrect(option.id),
                incorrect:
                  graded &&
                  feedbackVisible &&
                  selected.includes(option.id) &&
                  !trueFalseCorrect(option.id),
              }"
              ><input
                type="radio"
                :name="question.id"
                :value="option.id"
                :checked="selected.includes(option.id)"
                :disabled="!!graded"
                @change="selected = [option.id]"
              />{{ option.label
              }}<span
                v-if="graded && feedbackVisible && trueFalseCorrect(option.id)"
                class="answer-label"
                ><Check aria-hidden="true" />正答</span
              ></label
            >
          </fieldset>
          <label v-else-if="question.kind === 'short-answer'"
            >解答<input
              v-model="text"
              :disabled="!!graded"
              autocomplete="off"
              @keydown.enter="gradeOnEnter" /></label
          ><label v-else-if="question.kind === 'numerical'"
            >数値で解答<input
              v-model="text"
              :disabled="!!graded"
              type="text"
              inputmode="decimal"
              @keydown.enter="gradeOnEnter"
          /></label>
          <div v-else class="message warning">
            この問題形式（{{ question.sourceKind }}）は、このバージョンでは出題できません。
          </div>
          <div v-if="!graded" class="actions">
            <button :disabled="!canAnswer" @click="grade">回答する</button>
          </div>
          <div v-else-if="!feedbackVisible" class="actions">
            <button @click="feedbackVisible = true">結果と解説を表示</button>
          </div>
        </template>
        <div v-else-if="!answerVisible" class="actions">
          <button @click="answerVisible = true">答えを見る</button>
        </div>
        <section
          v-if="isFlashcard && answerVisible"
          class="feedback flashcard-answer"
          aria-live="polite"
        >
          <h2>正答</h2>
          <div v-if="correctChoices.length" class="correct-answer-list">
            <div v-for="choice in correctChoices" :key="choice.id" class="message">
              <ContentRenderer :content="choice.content" />
            </div>
          </div>
          <p v-else-if="question.kind === 'true-false'">
            {{ question.correctAnswer ? '正しい' : '誤り' }}
          </p>
          <p v-else-if="question.kind === 'short-answer'">
            {{ correctShortAnswers.join(' / ') || '正答が登録されていません。' }}
          </p>
          <p v-else-if="question.kind === 'numerical'">
            {{ numericalAnswers.join(' / ') || '正答が登録されていません。' }}
          </p>
          <div v-if="question.explanation" class="message">
            <ContentRenderer :content="question.explanation" />
          </div>
          <div class="rating">
            <p>この問題はどのくらい難しかったですか？</p>
            <button :disabled="busy" class="secondary" @click="rate('again')">もう一度</button
            ><button :disabled="busy" class="secondary" @click="rate('hard')">難しかった</button
            ><button :disabled="busy" @click="rate('good')">わかった</button
            ><button :disabled="busy" class="secondary" @click="rate('easy')">簡単</button>
          </div>
        </section>
        <section v-else-if="graded && feedbackVisible" class="feedback" aria-live="polite">
          <h2 :class="graded.correct ? 'success-text' : 'danger-text'">
            <Check v-if="graded.correct" aria-hidden="true" /><X v-else aria-hidden="true" />{{
              graded.correct ? '正解' : '不正解'
            }}（{{ Math.round(graded.score) }}点）
          </h2>
          <div
            v-if="!graded.correct && question.kind === 'short-answer' && correctShortAnswers.length"
            class="message"
          >
            正しい答え:
            <span v-for="(answer, i) in correctShortAnswers" :key="answer">
              {{ i ? ' / ' : '' }}{{ answer }}
            </span>
          </div>
          <div v-for="(feedback, i) in graded.feedback" :key="i" class="message">
            <ContentRenderer :content="feedback" />
          </div>
          <div class="rating">
            <p>この問題をどう感じましたか？</p>
            <button :disabled="busy" class="secondary" @click="rate('again')">もう一度</button
            ><button :disabled="busy" class="secondary" @click="rate('hard')">難しかった</button
            ><button :disabled="busy || !graded.correct" @click="rate('good')">正解</button
            ><button :disabled="busy || !graded.correct" class="secondary" @click="rate('easy')">
              簡単
            </button>
          </div>
          <p class="next-due">
            次回予定（「正解」の場合）:
            <time :datetime="nextDue">{{ new Date(nextDue).toLocaleString() }}</time>
          </p>
        </section>
      </article>
    </div>
    <div v-else class="empty-state">
      <h1>{{ queue.length ? '今日の学習は完了です' : '出題できる問題はありません' }}</h1>
      <p>
        {{
          queue.length
            ? `${queue.length}問を学習しました。`
            : '期限になった復習問題、または新規問題がありません。'
        }}
      </p>
      <RouterLink v-if="typeof route.query.deck === 'string'" class="button" :to="backTarget"
        >問題集へ戻る</RouterLink
      >
      <RouterLink v-else class="button" to="/">ホームへ戻る</RouterLink>
    </div>
  </div>
</template>
