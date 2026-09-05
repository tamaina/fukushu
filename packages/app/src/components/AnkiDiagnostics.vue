<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AnkiDiagnostic } from '@fukushu/anki-import'
const props = defineProps<{ diagnostics: AnkiDiagnostic[] }>()
const expanded = ref(new Set<string>())
function toggle(event: Event, key: string) {
  if ((event.target as unknown as { open: boolean }).open) expanded.value.add(key)
  else expanded.value.delete(key)
}
defineEmits<{ preview: [card: NonNullable<AnkiDiagnostic['card']>] }>()
const groups = computed(() => {
  const groups = new Map<
    string,
    {
      code: string
      message: string
      severity: string
      count: number
      cards: Map<string, NonNullable<AnkiDiagnostic['card']>>
    }
  >()
  for (const d of props.diagnostics) {
    const key = d.code + '\0' + d.message
    const group = groups.get(key) ?? {
      code: d.code,
      message: d.message,
      severity: d.severity,
      count: 0,
      cards: new Map(),
    }
    group.count++
    if (d.card) group.cards.set(d.card.deckId + '\0' + d.card.cardId, d.card)
    groups.set(key, group)
  }
  return [...groups.values()]
})
</script>
<template>
  <section v-if="diagnostics.length" class="anki-diagnostics" aria-label="診断">
    <h2>
      診断 <small>（{{ diagnostics.length }}件）</small>
    </h2>
    <details
      v-for="group in groups"
      :key="group.code + group.message"
      class="panel"
      :open="group.severity === 'error'"
      @toggle="toggle($event, group.code + group.message)"
    >
      <summary>
        <strong>{{
          group.severity === 'error' ? 'エラー' : group.severity === 'warning' ? '警告' : '情報'
        }}</strong>
        {{ group.message }}
        <span class="muted">{{
          group.cards.size ? `${group.cards.size}問` : `${group.count}件`
        }}</span>
      </summary>
      <ul v-if="group.cards.size && expanded.has(group.code + group.message)">
        <li v-for="card in group.cards.values()" :key="card.deckId + card.cardId">
          <span class="problem-summary"
            ><span class="badge">{{ card.deckName }}</span>
            {{ card.excerpt || `カード ${card.cardId}` }}</span
          >
          <a class="problem-link" href="#apkg-card-preview" @click.prevent="$emit('preview', card)"
            >この問題を確認</a
          >
        </li>
      </ul>
    </details>
  </section>
</template>
<style scoped>
.anki-diagnostics {
  display: grid;
  gap: 1rem;
}
h2 {
  margin: 0;
}
small {
  font-size: 0.7em;
  font-weight: normal;
}
summary {
  cursor: pointer;
  line-height: 1.6;
}
ul {
  margin: 0.5rem 0 0;
  padding: 0;
  list-style: none;
}
li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.3rem 0;
  font-size: 0.875rem;
  line-height: 1.5;
}
.problem-summary {
  overflow-wrap: anywhere;
}
.problem-link {
  white-space: nowrap;
  font-size: 0.8rem;
}
</style>
