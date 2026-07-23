<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Download, Flame, Play, Trash2 } from '@lucide/vue'
import { deckRepository, questionRepository, reviewRepository } from '../infrastructure/db/database'
import { resetDeckHistory, setDeckStudyMode, setQuestionEnabled } from '../application/decks'
import type { DeckRecord, QuestionRecord } from '../infrastructure/db/schema'
const route = useRoute()
const router = useRouter()
const deck = ref<DeckRecord>()
const questions = ref<QuestionRecord[]>([])
const answerCounts = ref<Record<string, number>>({})
const category = ref('')
const deckId = String(route.params.deckId)
const categories = computed(() => [
  ...new Set(questions.value.map((q) => q.payload.categoryPath.join(' / ')).filter(Boolean)),
])
const visible = computed(() =>
  category.value
    ? questions.value.filter((q) => q.payload.categoryPath.join(' / ') === category.value)
    : questions.value,
)
async function load(): Promise<void> {
  deck.value = await deckRepository.get(deckId)
  questions.value = await questionRepository.byDeck(deckId)
  answerCounts.value = (await reviewRepository.all())
    .filter((log) => log.deckId === deckId)
    .reduce<Record<string, number>>((counts, log) => {
      counts[log.questionId] = (counts[log.questionId] ?? 0) + 1
      return counts
    }, {})
}
async function toggle(question: QuestionRecord): Promise<void> {
  await setQuestionEnabled(question.id, !question.enabled)
  await load()
}
async function changeStudyMode(): Promise<void> {
  if (!deck.value) return
  await setDeckStudyMode(deck.value.id, deck.value.studyMode)
}
async function remove(): Promise<void> {
  if (!deck.value || !confirm($l.value.sfc.removeConfirm({ name: deck.value.name }))) return
  await deckRepository.remove(deckId)
  await router.push('/decks')
}
async function resetHistory(): Promise<void> {
  if (!confirm($locale.value.sfc.resetConfirm)) return
  await resetDeckHistory(deckId)
}
function exportGift(): void {
  if (!deck.value?.sourceText) return
  const url = URL.createObjectURL(
    new Blob([deck.value.sourceText], { type: 'text/plain;charset=utf-8' }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = deck.value.sourceFileName ?? `${deck.value.name}.gift`
  anchor.click()
  URL.revokeObjectURL(url)
}
onMounted(load)
</script>
<template>
  <div v-if="deck" class="page">
    <div class="page-heading deck-detail-heading">
      <div>
        <p class="eyebrow">{{ $locale.sfc.deck }}</p>
        <h1>{{ deck.name }}</h1>
        <p>
          {{
            $l.sfc.deckSummary({
              total: deck.questionCount,
              enabled: deck.enabledQuestionCount,
            })
          }}
        </p>
      </div>
      <div class="deck-detail-actions">
        <div class="actions deck-study-actions">
          <RouterLink class="button" :to="`/study?deck=${deck.id}`"
            ><Play aria-hidden="true" />{{ $locale.sfc.studyDeck }}</RouterLink
          >
          <RouterLink class="button secondary" :to="`/study?deck=${deck.id}&cram=1`"
            ><Flame aria-hidden="true" />{{ $locale.sfc.cramAll }}</RouterLink
          >
        </div>
        <div class="actions deck-file-actions">
          <button v-if="deck.sourceText" class="secondary" @click="exportGift">
            <Download aria-hidden="true" />{{ $locale.sfc.saveGift }}
          </button>
          <RouterLink class="button secondary" :to="`/import?deck=${deck.id}`">{{
            $locale.sfc.updateGift
          }}</RouterLink>
        </div>
      </div>
    </div>
    <section class="panel">
      <h2>{{ $locale.sfc.studyMode }}</h2>
      <p>{{ $locale.sfc.studyModeIntro }}</p>
      <fieldset class="mode-options">
        <legend class="visually-hidden">{{ $locale.sfc.studyMode }}</legend>
        <label class="choice-card">
          <input v-model="deck.studyMode" type="radio" value="quiz" @change="changeStudyMode" />
          <span
            ><strong>{{ $locale.sfc.quiz }}</strong
            ><small>{{ $locale.sfc.quizDescription }}</small></span
          >
        </label>
        <label class="choice-card">
          <input
            v-model="deck.studyMode"
            type="radio"
            value="flashcard"
            @change="changeStudyMode"
          />
          <span
            ><strong>{{ $locale.sfc.flashcard }}</strong
            ><small>{{ $locale.sfc.flashcardDescription }}</small></span
          >
        </label>
      </fieldset>
    </section>
    <section>
      <div class="section-heading">
        <h2>{{ $locale.sfc.questions }}</h2>
        <label v-if="categories.length"
          >{{ $locale.sfc.category
          }}<select v-model="category">
            <option value="">{{ $locale.sfc.all }}</option>
            <option v-for="item in categories" :key="item">{{ item }}</option>
          </select></label
        >
      </div>
      <ul class="question-list">
        <li v-for="question in visible" :key="question.id">
          <div>
            <strong>{{
              question.payload.name || question.payload.prompt.value.slice(0, 80)
            }}</strong>
            <div class="question-meta">
              <small>{{
                question.payload.categoryPath.join(' / ') || $locale.sfc.uncategorized
              }}</small>
              <span class="badge">{{ question.kind }}</span>
            </div>
          </div>
          <div class="question-actions">
            <small>{{ $l.sfc.answers({ count: answerCounts[question.id] ?? 0 }) }}</small>
            <button class="secondary compact" @click="toggle(question)">
              {{ question.enabled ? $locale.sfc.disable : $locale.sfc.enable }}
            </button>
          </div>
        </li>
      </ul>
    </section>
    <section class="danger-zone">
      <h2>{{ $locale.sfc.resetHistory }}</h2>
      <p>{{ $locale.sfc.resetHistoryIntro }}</p>
      <button class="secondary" @click="resetHistory">{{ $locale.sfc.resetButton }}</button>
    </section>
    <section class="danger-zone">
      <h2>{{ $locale.sfc.deleteDeck }}</h2>
      <p>{{ $locale.sfc.deleteDeckIntro }}</p>
      <button class="danger" @click="remove">
        <Trash2 aria-hidden="true" />{{ $locale.sfc.deleteButton }}
      </button>
    </section>
  </div>
  <div v-else class="page">
    <p>{{ $locale.sfc.notFound }}</p>
  </div>
</template>
<locale locale="ja-JP" lang="yaml">
deck: 問題集
deckSummary: '{total}問・{enabled}問が有効'
studyDeck: この問題集を学習
cramAll: 全問を詰め込み学習
saveGift: GIFTを保存
updateGift: GIFTで更新
studyMode: 学習モード
studyModeIntro: この問題集を学習するときの回答方法を選びます。
quiz: クイズ
quizDescription: 選択・入力した回答を自動採点します。
flashcard: 単語帳
flashcardDescription: 正答を自分で確認して、感じた難しさを選びます。
questions: 問題一覧
category: カテゴリ
all: すべて
uncategorized: カテゴリなし
answers: '{count}回答'
disable: 停止する
enable: 再開する
resetHistory: 学習履歴のリセット
resetHistoryIntro: 問題は残し、この問題集のFSRS状態と回答履歴を未学習へ戻します。
resetButton: 履歴をリセット
resetConfirm: この問題集の学習状態と履歴をリセットしますか？
deleteDeck: 問題集の削除
deleteDeckIntro: 問題と、この問題集に紐づく学習履歴を削除します。
deleteButton: 削除する
removeConfirm: '「{name}」と学習履歴を削除しますか？'
notFound: 問題集が見つかりません。
</locale>
<locale locale="en-US" lang="yaml">
deck: Deck
deckSummary: '{total} questions · {enabled} enabled'
studyDeck: Study this deck
cramAll: Cram all questions
saveGift: Save GIFT
updateGift: Update from GIFT
studyMode: Study mode
studyModeIntro: Choose how to answer questions in this deck.
quiz: Quiz
quizDescription: Select or enter answers and grade them automatically.
flashcard: Flashcards
flashcardDescription: Reveal each correct answer and rate its difficulty yourself.
questions: Questions
category: Category
all: All
uncategorized: Uncategorized
answers: '{count, plural, one {# answer} other {# answers}}'
disable: Disable
enable: Enable
resetHistory: Reset study history
resetHistoryIntro: Keep the questions but return their FSRS state and answer history to unstudied.
resetButton: Reset history
resetConfirm: Reset the study state and history for this deck?
deleteDeck: Delete deck
deleteDeckIntro: Delete the questions and all study history linked to this deck.
deleteButton: Delete
removeConfirm: 'Delete "{name}" and its study history?'
notFound: Deck not found.
</locale>
