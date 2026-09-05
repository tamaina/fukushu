<script setup lang="ts">
defineProps<{
  counts: {
    added: number
    changed: number
    moved: number
    stopped: number
    overwrite?: number
    emptyProgress?: number
  }
}>()
const labels = { added: '追加', changed: '変更', moved: '移動', stopped: '停止' } as const
</script>
<template>
  <div class="change-badges">
    <span
      v-for="(label, key) in labels"
      :key="key"
      class="badge"
      :class="{ active: counts[key] > 0, caution: key === 'stopped' && counts[key] > 0 }"
      >{{ label }} <strong>{{ counts[key].toLocaleString() }}</strong></span
    >
    <span v-if="counts.overwrite" class="badge caution"
      >履歴置換 <strong>{{ counts.overwrite.toLocaleString() }}</strong></span
    >
    <span v-if="counts.emptyProgress" class="badge"
      >履歴なし <strong>{{ counts.emptyProgress.toLocaleString() }}</strong></span
    >
  </div>
</template>
<style scoped>
.change-badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.badge {
  display: inline-flex;
  align-items: baseline;
  gap: 0.5em;
  padding: 4px 10px;
  white-space: nowrap;
}
strong {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}
.active {
  color: var(--color-accent);
  background: var(--color-accent-soft);
  border-color: var(--color-accent-soft);
}
.caution {
  color: var(--color-warning);
  border-color: currentColor;
  background: transparent;
}
</style>
