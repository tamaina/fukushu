<script setup lang="ts">
defineProps<{
  diagnostics: Array<{
    code: string
    message: string
    severity: 'info' | 'warning' | 'error'
    range?: { start: { line: number; column: number } }
  }>
  source: string
}>()
const context = (source: string, line: number): string => source.split(/\r?\n/)[line - 1] ?? ''
</script>
<template>
  <section v-if="diagnostics.length" class="diagnostics" aria-live="polite">
    <h2>{{ $locale.sfc.diagnostics }}</h2>
    <ul>
      <li v-for="(item, i) in diagnostics" :key="`${item.code}-${i}`" :class="item.severity">
        <strong>{{
          item.severity === 'error'
            ? $locale.sfc.error
            : item.severity === 'warning'
              ? $locale.sfc.warning
              : $locale.sfc.info
        }}</strong>
        <span v-if="item.range"
          >{{ item.range.start.line }}{{ $locale.sfc.line }} {{ item.range.start.column
          }}{{ $locale.sfc.column }}: {{ item.message }}</span
        ><span v-else>{{ item.message }}</span
        ><code v-if="item.range">{{ context(source, item.range.start.line) }}</code>
      </li>
    </ul>
  </section>
</template>
<locale locale="ja-JP" lang="yaml">
diagnostics: 診断
error: エラー
warning: 警告
info: 情報
line: 行
column: 列
</locale>
<locale locale="en-US" lang="yaml">
diagnostics: Diagnostics
error: Error
warning: Warning
info: Info
line: ' line,'
column: ' column'
</locale>
