<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Plus } from '@lucide/vue'
import EmptyState from '../components/EmptyState.vue'
import { deckRepository, reviewRepository, stateRepository } from '../infrastructure/db/database'
import type { DeckRecord } from '../infrastructure/db/schema'
const decks = ref<DeckRecord[]>([])
const stats = ref<Record<string, { studied: number; due: number; next?: string; last?: string }>>(
  {},
)
async function load(): Promise<void> {
  decks.value = (await deckRepository.all()).filter(
    (deck) => !(deck.sourceType === 'anki-package' && deck.questionCount === 0),
  )
  const states = await stateRepository.all()
  const logs = await reviewRepository.all()
  const now = new Date()
  const summary: typeof stats.value = Object.fromEntries(
    decks.value.map((deck) => [deck.id, { studied: 0, due: 0 }]),
  )
  for (const state of states) {
    const stat = summary[state.deckId]
    if (!stat || state.suspended || state.card.reps === 0) continue
    stat.studied++
    if (new Date(state.card.due) <= now) stat.due++
    if (!stat.next || state.card.due < stat.next) stat.next = state.card.due
  }
  for (const log of logs) {
    const stat = summary[log.deckId]
    if (stat && (!stat.last || log.reviewedAt > stat.last)) stat.last = log.reviewedAt
  }
  stats.value = summary
}
onMounted(load)
</script>
<template>
  <div class="page">
    <div class="page-heading">
      <div>
        <h1>{{ $locale.sfc.decks }}</h1>
        <p>{{ $locale.sfc.decksIntro }}</p>
      </div>
      <RouterLink class="button" to="/import"
        ><Plus aria-hidden="true" :size="18" />{{ $locale.sfc.import }}</RouterLink
      >
    </div>
    <EmptyState v-if="!decks.length" :title="$locale.sfc.noDecks" :message="$locale.sfc.noDecksBody"
      ><RouterLink class="button" to="/import">{{
        $locale.sfc.firstImport
      }}</RouterLink></EmptyState
    >
    <ul v-else class="deck-list">
      <li v-for="deck in decks" :key="deck.id">
        <RouterLink :to="`/decks/${deck.id}`"
          ><div>
            <strong>{{ deck.name }}</strong
            ><span
              >{{ deck.enabledQuestionCount }} / {{ deck.questionCount }}
              {{ $locale.sfc.enabled }} ·
              {{ deck.studyMode === 'flashcard' ? $locale.sfc.flashcard : $locale.sfc.quiz }}
              ·
              {{ $locale.sfc.studied }}
              {{ stats[deck.id]?.studied ?? 0 }} · {{ $locale.sfc.due }}
              {{ stats[deck.id]?.due ?? 0 }}</span
            ><small v-if="stats[deck.id]?.next"
              >{{ $locale.sfc.next }} {{ new Date(stats[deck.id]!.next!).toLocaleString() }} ·
              {{ $locale.sfc.lastStudy }}
              {{
                stats[deck.id]?.last
                  ? new Date(stats[deck.id]!.last!).toLocaleString()
                  : $locale.sfc.none
              }}</small
            >
          </div>
          <time :datetime="deck.updatedAt">{{
            new Date(deck.updatedAt).toLocaleDateString()
          }}</time></RouterLink
        >
      </li>
    </ul>
  </div>
</template>
<locale locale="ja-JP" lang="yaml">
decks: 問題集
decksIntro: 端末内に保存した問題集です。
import: 読み込む
noDecks: 問題集はまだありません
noDecksBody: GIFTまたはAnki形式のファイルを読み込むと、ここに表示されます。
firstImport: 最初の問題集を読み込む
enabled: 問が有効
studied: 学習済み
due: 期限
next: 次回
lastStudy: 最終学習
none: なし
flashcard: 単語帳
quiz: クイズ
</locale>
<locale locale="en-US" lang="yaml">
decks: Decks
decksIntro: Decks saved on this device.
import: Import
noDecks: No decks yet
noDecksBody: Import a GIFT or Anki-format file to see it here.
firstImport: Import your first deck
enabled: enabled
studied: studied
due: due
next: Next
lastStudy: last studied
none: none
flashcard: Flashcards
quiz: Quiz
</locale>
