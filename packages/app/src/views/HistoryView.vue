<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { questionRepository, reviewRepository } from '../infrastructure/db/database'
import { getStudyDayKey } from '../domain/time'
import type { ReviewLogRecord } from '../infrastructure/db/schema'
const logs = ref<ReviewLogRecord[]>([])
const questionNames = ref<Record<string, string>>({})
onMounted(async () => {
  logs.value = (await reviewRepository.all()).sort((a, b) =>
    b.reviewedAt.localeCompare(a.reviewedAt),
  )
  for (const id of new Set(logs.value.map((log) => log.questionId))) {
    const question = await questionRepository.get(id)
    if (question) {
      questionNames.value[id] = question.payload.name ?? question.payload.prompt.value.slice(0, 60)
    }
  }
})
const accuracy = computed(() =>
  logs.value.length
    ? Math.round((logs.value.filter((log) => log.correct).length / logs.value.length) * 100)
    : 0,
)
const ratings = computed(() =>
  Object.fromEntries(
    ['again', 'hard', 'good', 'easy'].map((rating) => [
      rating,
      logs.value.filter((log) => log.rating === rating).length,
    ]),
  ),
)
const daily = computed(() => {
  const map = new Map<string, { count: number; correct: number }>()
  for (const log of logs.value) {
    const key = getStudyDayKey(new Date(log.reviewedAt))
    const value = map.get(key) ?? { count: 0, correct: 0 }
    value.count += 1
    value.correct += Number(log.correct)
    map.set(key, value)
  }
  return [...map].sort(([a], [b]) => b.localeCompare(a))
})
</script>
<template>
  <div class="page">
    <div class="page-heading">
      <div>
        <h1>{{ $locale.sfc.historyTitle }}</h1>
        <p>{{ $locale.sfc.historyIntro }}</p>
      </div>
    </div>
    <div class="metric-grid">
      <div>
        <span>{{ $locale.sfc.totalReviews }}</span
        ><strong>{{ logs.length }}</strong>
      </div>
      <div>
        <span>{{ $locale.sfc.accuracy }}</span
        ><strong>{{ accuracy }}%</strong>
      </div>
    </div>
    <section>
      <h2>{{ $locale.sfc.ratingBreakdown }}</h2>
      <ul class="rating-summary">
        <li>
          {{ $locale.sfc.again }} <strong>{{ ratings.again }}</strong>
        </li>
        <li>
          {{ $locale.sfc.hard }} <strong>{{ ratings.hard }}</strong>
        </li>
        <li>
          {{ $locale.sfc.good }} <strong>{{ ratings.good }}</strong>
        </li>
        <li>
          {{ $locale.sfc.easy }} <strong>{{ ratings.easy }}</strong>
        </li>
      </ul>
    </section>
    <section>
      <h2>{{ $locale.sfc.daily }}</h2>
      <p v-if="!daily.length" class="muted">{{ $locale.sfc.historyEmpty }}</p>
      <table v-else>
        <thead>
          <tr>
            <th>{{ $locale.sfc.studyDate }}</th>
            <th>{{ $locale.sfc.reviews }}</th>
            <th>{{ $locale.sfc.accuracy }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="[day, value] in daily" :key="day">
            <td>{{ day }}</td>
            <td>{{ value.count }}</td>
            <td>{{ Math.round((value.correct / value.count) * 100) }}%</td>
          </tr>
        </tbody>
      </table>
    </section>
    <section>
      <h2>{{ $locale.sfc.recentAnswers }}</h2>
      <ul class="history-list">
        <li v-for="log in logs.slice(0, 100)" :key="log.id">
          <time :datetime="log.reviewedAt">{{ new Date(log.reviewedAt).toLocaleString() }}</time
          ><strong>{{ questionNames[log.questionId] ?? log.questionId }}</strong
          ><span :class="log.correct ? 'success-text' : 'danger-text'">{{
            log.correct ? $locale.sfc.good : $locale.sfc.incorrect
          }}</span
          ><span class="badge">{{ log.rating }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>
<locale locale="ja-JP" lang="yaml">
historyTitle: 学習履歴
historyIntro: 復習回数と正答率を確認できます。
totalReviews: 総復習数
accuracy: 正答率
ratingBreakdown: Rating内訳
again: もう一度
hard: 難しかった
good: 正解
easy: 簡単
daily: 日別
historyEmpty: 学習すると、ここに履歴が表示されます。
studyDate: 学習日
reviews: 復習数
recentAnswers: 最近の回答
incorrect: 不正解
</locale>
<locale locale="en-US" lang="yaml">
historyTitle: Study history
historyIntro: Review your total reviews and accuracy.
totalReviews: Total reviews
accuracy: Accuracy
ratingBreakdown: Rating breakdown
again: Again
hard: Hard
good: Good
easy: Easy
daily: By day
historyEmpty: Your history will appear here after studying.
studyDate: Study date
reviews: Reviews
recentAnswers: Recent answers
incorrect: Incorrect
</locale>
