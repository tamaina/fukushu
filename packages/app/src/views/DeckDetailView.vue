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
  if (!deck.value || !confirm(`「${deck.value.name}」と学習履歴を削除しますか？`)) return
  await deckRepository.remove(deckId)
  await router.push('/decks')
}
async function resetHistory(): Promise<void> {
  if (!confirm('この問題集の学習状態と履歴をリセットしますか？')) return
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
        <p class="eyebrow">問題集</p>
        <h1>{{ deck.name }}</h1>
        <p>{{ deck.questionCount }}問・{{ deck.enabledQuestionCount }}問が有効</p>
      </div>
      <div class="deck-detail-actions">
        <div class="actions deck-study-actions">
          <RouterLink class="button" :to="`/study?deck=${deck.id}`"
            ><Play aria-hidden="true" />この問題集を学習</RouterLink
          >
          <RouterLink class="button secondary" :to="`/study?deck=${deck.id}&cram=1`"
            ><Flame aria-hidden="true" />全問を詰め込み学習</RouterLink
          >
        </div>
        <div class="actions deck-file-actions">
          <button v-if="deck.sourceText" class="secondary" @click="exportGift">
            <Download aria-hidden="true" />GIFTを保存
          </button>
          <RouterLink class="button secondary" :to="`/import?deck=${deck.id}`"
            >GIFTで更新</RouterLink
          >
        </div>
      </div>
    </div>
    <section class="panel">
      <h2>学習モード</h2>
      <p>この問題集を学習するときの回答方法を選びます。</p>
      <fieldset class="mode-options">
        <legend class="visually-hidden">学習モード</legend>
        <label class="choice-card">
          <input v-model="deck.studyMode" type="radio" value="quiz" @change="changeStudyMode" />
          <span><strong>クイズ</strong><small>選択・入力した回答を自動採点します。</small></span>
        </label>
        <label class="choice-card">
          <input
            v-model="deck.studyMode"
            type="radio"
            value="flashcard"
            @change="changeStudyMode"
          />
          <span
            ><strong>単語帳</strong
            ><small>正答を自分で確認して、感じた難しさを選びます。</small></span
          >
        </label>
      </fieldset>
    </section>
    <section>
      <div class="section-heading">
        <h2>問題一覧</h2>
        <label v-if="categories.length"
          >カテゴリ<select v-model="category">
            <option value="">すべて</option>
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
              <small>{{ question.payload.categoryPath.join(' / ') || 'カテゴリなし' }}</small>
              <span class="badge">{{ question.kind }}</span>
            </div>
          </div>
          <div class="question-actions">
            <small>{{ answerCounts[question.id] ?? 0 }}回答</small>
            <button class="secondary compact" @click="toggle(question)">
              {{ question.enabled ? '停止する' : '再開する' }}
            </button>
          </div>
        </li>
      </ul>
    </section>
    <section class="danger-zone">
      <h2>学習履歴のリセット</h2>
      <p>問題は残し、この問題集のFSRS状態と回答履歴を未学習へ戻します。</p>
      <button class="secondary" @click="resetHistory">履歴をリセット</button>
    </section>
    <section class="danger-zone">
      <h2>問題集の削除</h2>
      <p>問題と、この問題集に紐づく学習履歴を削除します。</p>
      <button class="danger" @click="remove"><Trash2 aria-hidden="true" />削除する</button>
    </section>
  </div>
  <div v-else class="page"><p>問題集が見つかりません。</p></div>
</template>
