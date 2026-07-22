<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Upload } from '@lucide/vue'
import DiagnosticList from '../components/DiagnosticList.vue'
import { previewGift, type ImportPreview } from '../application/importGift'
import {
  previewDeckUpdate,
  saveNewDeck,
  updateDeck,
  type DeckUpdateDiff,
} from '../application/decks'
import { deckRepository } from '../infrastructure/db/database'
import { createId } from '../utils/id'

const router = useRouter()
const route = useRoute()
const updateDeckId = typeof route.query.deck === 'string' ? route.query.deck : undefined
const source = ref('')
const deckName = ref('')
const fileName = ref<string>()
// Parsed questions are plain structured-clone data; keep Vue from proxying them before IndexedDB.
const preview = shallowRef<ImportPreview>()
const updateDiff = ref<DeckUpdateDiff>()
const busy = ref(false)
const message = ref('')
const dragging = ref(false)
const canSave = computed(
  () =>
    preview.value &&
    preview.value.questions.length > 0 &&
    !preview.value.diagnostics.some((item) => item.severity === 'error'),
)
async function analyze(): Promise<void> {
  if (!source.value.trim()) return
  busy.value = true
  message.value = ''
  try {
    preview.value = await previewGift(source.value, updateDeckId ?? createId())
    updateDiff.value = updateDeckId
      ? await previewDeckUpdate(updateDeckId, preview.value)
      : undefined
  } finally {
    busy.value = false
  }
}
async function readFile(file?: File): Promise<void> {
  if (!file) return
  if (file.size > 10 * 1024 * 1024) {
    message.value = 'ファイルは10MB以下にしてください。'
    return
  }
  if (!/\.(gift|txt)$/i.test(file.name)) {
    message.value = '.gift または .txt ファイルを選択してください。'
    return
  }
  try {
    source.value = new TextDecoder('utf-8', { fatal: true })
      .decode(await file.arrayBuffer())
      .replace(/^\uFEFF/, '')
    fileName.value = file.name
    deckName.value ||= file.name.replace(/\.(gift|txt)$/i, '')
    await analyze()
  } catch {
    message.value = 'UTF-8として読み込めませんでした。'
  }
}
function drop(event: DragEvent): void {
  dragging.value = false
  void readFile(event.dataTransfer?.files[0])
}
async function save(): Promise<void> {
  if (!preview.value || !canSave.value) return
  busy.value = true
  try {
    if (updateDeckId) {
      if (
        updateDiff.value?.resetRequired &&
        !confirm(
          `${updateDiff.value.resetRequired}問は正答・形式または問題文が大きく変わったため、学習状態をリセットします。続けますか？`,
        )
      )
        return
      await updateDeck(updateDeckId, preview.value)
      await router.push(`/decks/${updateDeckId}`)
      return
    }
    const id = await saveNewDeck(deckName.value, preview.value, fileName.value)
    await router.push(`/decks/${id}`)
  } catch (error) {
    message.value = error instanceof Error ? error.message : '保存できませんでした。'
  } finally {
    busy.value = false
  }
}
onMounted(async () => {
  if (!updateDeckId) return
  const deck = await deckRepository.get(updateDeckId)
  if (!deck) return
  deckName.value = deck.name
  source.value = deck.sourceText ?? ''
  fileName.value = deck.sourceFileName
  if (source.value) await analyze()
})
</script>
<template>
  <div class="page">
    <div class="page-heading">
      <div>
        <h1>{{ updateDeckId ? 'GIFTで問題集を更新' : 'GIFTを読み込む' }}</h1>
        <p>ファイルを選ぶか、GIFTテキストを貼り付けてください。</p>
      </div>
    </div>
    <div
      class="drop-zone"
      :class="{ dragging }"
      @dragover.prevent="dragging = true"
      @dragleave="dragging = false"
      @drop.prevent="drop"
    >
      <Upload aria-hidden="true" /><label class="button secondary"
        >ファイルを選択<input
          class="visually-hidden"
          type="file"
          accept=".gift,.txt,text/plain"
          @change="readFile(($event.target as HTMLInputElement).files?.[0])" /></label
      ><span>.gift / .txt、UTF-8、最大10MB</span>
    </div>
    <label>問題集名<input v-model="deckName" maxlength="100" /></label
    ><label
      >GIFTテキスト<textarea
        v-model="source"
        rows="14"
        spellcheck="false"
        placeholder="::問題名::問題文 {=正解 ~不正解}"
      />
    </label>
    <div class="actions">
      <button :disabled="busy || !source.trim()" @click="analyze">
        {{ busy ? '解析中…' : '解析する' }}
      </button>
    </div>
    <p v-if="message" class="message error" role="alert">{{ message }}</p>
    <DiagnosticList v-if="preview" :diagnostics="preview.diagnostics" :source="source" />
    <section v-if="preview" class="panel">
      <h2>プレビュー</h2>
      <p>
        <strong>{{ preview.questions.length }}</strong> 問を読み込みます。
      </p>
      <ul class="inline-list">
        <li v-for="(count, kind) in preview.counts" :key="kind">
          <span class="badge">{{ kind }}</span> {{ count }}問
        </li>
      </ul>
      <div v-if="updateDiff" class="diff-summary" aria-label="更新差分">
        <span
          ><strong>{{ updateDiff.added }}</strong> 追加</span
        >
        <span
          ><strong>{{ updateDiff.changed }}</strong> 変更</span
        >
        <span
          ><strong>{{ updateDiff.removed }}</strong> 削除・停止</span
        >
        <span
          ><strong>{{ updateDiff.unchanged }}</strong> 変更なし</span
        >
        <p v-if="updateDiff.resetRequired" class="message warning">
          {{ updateDiff.resetRequired }}問の学習状態がリセットされます。
        </p>
      </div>
      <button :disabled="busy || !canSave" @click="save">
        {{ updateDeckId ? '問題集を更新' : '問題集として保存' }}
      </button>
      <p v-if="!canSave" class="muted">エラーを修正してから保存してください。</p>
    </section>
  </div>
</template>
