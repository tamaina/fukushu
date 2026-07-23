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
    Array.isArray(restored.questionIds) &&
    restored.questionIds.length > 0
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
          deckName: deck?.name ?? '',
          studyMode: deck?.studyMode ?? 'quiz',
        })
      }
    }
  }
  if (!queue.value.length) {
    queue.value = await buildStudyQueue(systemClock, deckId, cram)
    if (!queue.value.length && deckId && !cram) {
      cram = true
      await router.replace({ query: { ...route.query, cram: '1' } })
      queue.value = await buildStudyQueue(systemClock, deckId, true)
    }
  }
  if (queue.value.length) {
    sessionStorage.setItem(
      sessionKey,
      JSON.stringify({
        deckId: deckId ?? null,
        cram,
        questionIds: queue.value.map((entry) => entry.question.id),
      }),
    )
  } else sessionStorage.removeItem(sessionKey)
  index.value = 0
  started.value = Date.now()
})
</script>
<template>
  <div class="page study-page">
    <div v-if="item && question">
      <header class="study-header">
        <span>{{ progress }} · {{ $l.sfc.remaining({ count: queue.length - index - 1 }) }}</span>
        <button class="text-button" @click="router.push(backTarget)">
          {{ $locale.sfc.stop }}
        </button>
      </header>
      <article class="question-card">
        <div class="question-card-meta">
          <span v-if="item.deckName" class="badge">{{ item.deckName }}</span>
          <span class="badge">{{
            question.categoryPath.join(' / ') || $locale.sfc.uncategorized
          }}</span>
          <span class="badge">{{ isFlashcard ? $locale.sfc.flashcard : $locale.sfc.quiz }}</span>
          <span v-if="route.query.cram === '1'" class="badge">{{ $locale.sfc.cram }}</span>
        </div>
        <h1 class="visually-hidden">{{ $locale.sfc.question }}</h1>
        <ContentRenderer :content="question.prompt" />
        <template v-if="!isFlashcard">
          <fieldset
            v-if="question.kind === 'single-choice' || question.kind === 'multiple-choice'"
            class="choices"
          >
            <legend class="visually-hidden">{{ $locale.sfc.choices }}</legend>
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
                  ><Check aria-hidden="true" />{{ $locale.sfc.correctAnswer }}</span
                ><span
                  v-if="graded && feedbackVisible && selected.includes(choice.id)"
                  class="answer-label"
                  >{{ $locale.sfc.selected }}</span
                ></span
              ></label
            >
          </fieldset>
          <fieldset v-else-if="question.kind === 'true-false'" class="choices">
            <legend class="visually-hidden">{{ $locale.sfc.trueOrFalse }}</legend>
            <label
              v-for="option in [
                { id: 'true', label: $locale.sfc.trueLabel },
                { id: 'false', label: $locale.sfc.falseLabel },
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
                ><Check aria-hidden="true" />{{ $locale.sfc.correctAnswer }}</span
              ></label
            >
          </fieldset>
          <label v-else-if="question.kind === 'short-answer'"
            >{{ $locale.sfc.answer
            }}<input
              v-model="text"
              :disabled="!!graded"
              autocomplete="off"
              @keydown.enter="gradeOnEnter" /></label
          ><label v-else-if="question.kind === 'numerical'"
            >{{ $locale.sfc.numericalAnswer
            }}<input
              v-model="text"
              :disabled="!!graded"
              type="text"
              inputmode="decimal"
              @keydown.enter="gradeOnEnter"
          /></label>
          <div v-else class="message warning">
            {{ $l.sfc.unsupported({ kind: question.sourceKind }) }}
          </div>
          <div v-if="!graded" class="actions">
            <button :disabled="!canAnswer" @click="grade">{{ $locale.sfc.submitAnswer }}</button>
          </div>
          <div v-else-if="!feedbackVisible" class="actions">
            <button @click="feedbackVisible = true">{{ $locale.sfc.showFeedback }}</button>
          </div>
        </template>
        <div v-else-if="!answerVisible" class="actions">
          <button @click="answerVisible = true">{{ $locale.sfc.revealAnswer }}</button>
        </div>
        <section
          v-if="isFlashcard && answerVisible"
          class="feedback flashcard-answer"
          aria-live="polite"
        >
          <h2>{{ $locale.sfc.correctAnswer }}</h2>
          <div v-if="correctChoices.length" class="correct-answer-list">
            <div v-for="choice in correctChoices" :key="choice.id" class="message">
              <ContentRenderer :content="choice.content" />
            </div>
          </div>
          <p v-else-if="question.kind === 'true-false'">
            {{ question.correctAnswer ? $locale.sfc.trueLabel : $locale.sfc.falseLabel }}
          </p>
          <p v-else-if="question.kind === 'short-answer'">
            {{ correctShortAnswers.join(' / ') || $locale.sfc.noCorrectAnswer }}
          </p>
          <p v-else-if="question.kind === 'numerical'">
            {{ numericalAnswers.join(' / ') || $locale.sfc.noCorrectAnswer }}
          </p>
          <div v-if="question.explanation" class="message">
            <ContentRenderer :content="question.explanation" />
          </div>
          <div class="rating">
            <p>{{ $locale.sfc.flashcardRatingPrompt }}</p>
            <button :disabled="busy" class="secondary" @click="rate('again')">
              {{ $locale.sfc.again }}</button
            ><button :disabled="busy" class="secondary" @click="rate('hard')">
              {{ $locale.sfc.hard }}</button
            ><button :disabled="busy" @click="rate('good')">{{ $locale.sfc.understood }}</button
            ><button :disabled="busy" class="secondary" @click="rate('easy')">
              {{ $locale.sfc.easy }}
            </button>
          </div>
        </section>
        <section v-else-if="graded && feedbackVisible" class="feedback" aria-live="polite">
          <h2 :class="graded.correct ? 'success-text' : 'danger-text'">
            <Check v-if="graded.correct" aria-hidden="true" /><X v-else aria-hidden="true" />{{
              graded.correct
                ? $l.sfc.correctResult({ score: Math.round(graded.score) })
                : $l.sfc.incorrectResult({ score: Math.round(graded.score) })
            }}
          </h2>
          <div
            v-if="!graded.correct && question.kind === 'short-answer' && correctShortAnswers.length"
            class="message"
          >
            {{ $locale.sfc.correctAnswers }}:
            <span v-for="(answer, i) in correctShortAnswers" :key="answer">
              {{ i ? ' / ' : '' }}{{ answer }}
            </span>
          </div>
          <div v-for="(feedback, i) in graded.feedback" :key="i" class="message">
            <ContentRenderer :content="feedback" />
          </div>
          <div class="rating">
            <p>{{ $locale.sfc.quizRatingPrompt }}</p>
            <button :disabled="busy" class="secondary" @click="rate('again')">
              {{ $locale.sfc.again }}</button
            ><button :disabled="busy" class="secondary" @click="rate('hard')">
              {{ $locale.sfc.hard }}</button
            ><button :disabled="busy || !graded.correct" @click="rate('good')">
              {{ $locale.sfc.correct }}</button
            ><button :disabled="busy || !graded.correct" class="secondary" @click="rate('easy')">
              {{ $locale.sfc.easy }}
            </button>
          </div>
          <p class="next-due">
            {{ $locale.sfc.nextDue }}:
            <time :datetime="nextDue">{{ new Date(nextDue).toLocaleString() }}</time>
          </p>
        </section>
      </article>
    </div>
    <div v-else class="empty-state">
      <h1>
        {{ queue.length ? $locale.sfc.completedTitle : $locale.sfc.noQuestionsTitle }}
      </h1>
      <p>
        {{
          queue.length ? $l.sfc.completedBody({ count: queue.length }) : $locale.sfc.noQuestionsBody
        }}
      </p>
      <RouterLink v-if="typeof route.query.deck === 'string'" class="button" :to="backTarget">{{
        $locale.sfc.backToDeck
      }}</RouterLink>
      <RouterLink v-else class="button" to="/">{{ $locale.sfc.backHome }}</RouterLink>
    </div>
  </div>
</template>
<locale locale="ja-JP" lang="yaml">
uncategorized: カテゴリなし
cram: 詰め込み学習
flashcard: 単語帳
quiz: クイズ
remaining: '残り {count}問'
stop: 中断する
question: 問題
choices: 選択肢
correctAnswer: 正答
selected: 選択済み
trueOrFalse: 正しいか誤りか
trueLabel: 正しい
falseLabel: 誤り
answer: 解答
numericalAnswer: 数値で解答
unsupported: 'この問題形式（{kind}）は、このバージョンでは出題できません。'
submitAnswer: 回答する
showFeedback: 結果と解説を表示
revealAnswer: 答えを見る
noCorrectAnswer: 正答が登録されていません。
flashcardRatingPrompt: この問題はどのくらい難しかったですか？
again: もう一度
hard: 難しかった
understood: わかった
easy: 簡単
correctResult: '正解（{score}点）'
incorrectResult: '不正解（{score}点）'
correctAnswers: 正しい答え
quizRatingPrompt: この問題をどう感じましたか？
correct: 正解
nextDue: 次回予定（「正解」の場合）
completedTitle: 今日の学習は完了です
noQuestionsTitle: 出題できる問題はありません
completedBody: '{count}問を学習しました。'
noQuestionsBody: 期限になった復習問題、または新規問題がありません。
backToDeck: 問題集へ戻る
backHome: ホームへ戻る
</locale>
<locale locale="en-US" lang="yaml">
uncategorized: Uncategorized
cram: Cramming
flashcard: Flashcards
quiz: Quiz
remaining: '{count, plural, one {# remaining} other {# remaining}}'
stop: Stop
question: Question
choices: Choices
correctAnswer: Correct answer
selected: Selected
trueOrFalse: True or false
trueLabel: 'True'
falseLabel: 'False'
answer: Answer
numericalAnswer: Numerical answer
unsupported: 'This question type ({kind}) cannot be studied in this version.'
submitAnswer: Submit answer
showFeedback: Show result and explanation
revealAnswer: Reveal answer
noCorrectAnswer: No correct answer is registered.
flashcardRatingPrompt: How difficult was this question?
again: Again
hard: Hard
understood: Understood
easy: Easy
correctResult: 'Correct ({score} points)'
incorrectResult: 'Incorrect ({score} points)'
correctAnswers: Correct answers
quizRatingPrompt: How did this question feel?
correct: Correct
nextDue: Next due if rated Correct
completedTitle: Today's study is complete
noQuestionsTitle: No questions available
completedBody: '{count, plural, one {You studied # question.} other {You studied # questions.}}'
noQuestionsBody: No reviews are due and no new questions are available.
backToDeck: Back to deck
backHome: Back home
</locale>
