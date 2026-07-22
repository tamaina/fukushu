<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowRight, Upload } from '@lucide/vue'
import EmptyState from '../components/EmptyState.vue'
import { buildStudyQueue } from '../application/study'
import { systemClock } from '../domain/time'
import { deckRepository, reviewRepository } from '../infrastructure/db/database'
import type { DeckRecord } from '../infrastructure/db/schema'
const decks = ref<DeckRecord[]>([])
const due = ref(0)
const fresh = ref(0)
const recent = ref(0)
onMounted(async () => {
  decks.value = await deckRepository.all()
  const queue = await buildStudyQueue(systemClock)
  due.value = queue.filter((item) => !item.isNew).length
  fresh.value = queue.filter((item) => item.isNew).length
  recent.value = (await reviewRepository.all()).filter(
    (log) => Date.now() - new Date(log.reviewedAt).getTime() < 7 * 86_400_000,
  ).length
})
const total = computed(() => due.value + fresh.value)
</script>
<template>
  <div class="page">
    <section class="hero">
      <p class="eyebrow">{{ $locale.sfc.today }}</p>
      <h1>
        {{ total ? $l.sfc.available({ count: total }) : $locale.sfc.nothingToday }}
      </h1>
      <p>
        {{ $l.sfc.schedule({ due, fresh }) }}
      </p>
      <RouterLink v-if="total" class="button large" to="/study"
        >{{ $locale.sfc.startStudy }}<ArrowRight aria-hidden="true" /></RouterLink
      ><RouterLink v-else class="button secondary" to="/import"
        ><Upload aria-hidden="true" />{{ $locale.sfc.importGift }}</RouterLink
      >
    </section>
    <section>
      <div class="section-heading">
        <h2>{{ $locale.sfc.decks }}</h2>
        <RouterLink to="/decks">{{ $locale.sfc.viewAll }}</RouterLink>
      </div>
      <EmptyState
        v-if="!decks.length"
        :title="$locale.sfc.importEmptyTitle"
        :message="$locale.sfc.importEmptyMessage"
        ><RouterLink class="button" to="/import">{{
          $locale.sfc.importGift
        }}</RouterLink></EmptyState
      >
      <ul v-else class="deck-list">
        <li v-for="deck in decks.slice(0, 5)" :key="deck.id">
          <RouterLink :to="`/decks/${deck.id}`"
            ><div>
              <strong>{{ deck.name }}</strong
              ><span>{{ $l.sfc.questionsCount({ count: deck.questionCount }) }}</span>
            </div>
            <ArrowRight aria-hidden="true"
          /></RouterLink>
        </li>
      </ul>
    </section>
    <section class="stats">
      <h2>{{ $locale.sfc.lastSevenDays }}</h2>
      <p>
        <strong>{{ recent }}</strong
        >{{ $locale.sfc.studiedTimes }}
      </p>
    </section>
  </div>
</template>
<locale locale="ja-JP" lang="yaml">
today: 今日の学習
available: '{count}問を学習できます'
nothingToday: 今日の予定はありません
schedule: '復習 {due}問・新規 {fresh}問'
startStudy: 学習を始める
importGift: GIFTを読み込む
decks: 問題集
viewAll: すべて見る
importEmptyTitle: GIFT問題集を読み込みましょう
importEmptyMessage: 問題集と学習履歴は、このブラウザのIndexedDBへ保存されます。
questionsCount: '{count}問'
lastSevenDays: 最近7日間
studiedTimes: 回 学習しました
</locale>
<locale locale="en-US" lang="yaml">
today: Today's study
available: '{count, plural, one {# question available} other {# questions available}}'
nothingToday: Nothing scheduled today
schedule: '{due, plural, one {# review} other {# reviews}} · {fresh, plural, one {# new question} other {# new questions}}'
startStudy: Start studying
importGift: Import GIFT
decks: Decks
viewAll: View all
importEmptyTitle: Import a GIFT deck
importEmptyMessage: Decks and study history are stored in this browser's IndexedDB.
questionsCount: '{count, plural, one {# question} other {# questions}}'
lastSevenDays: Last 7 days
studiedTimes: reviews completed
</locale>
