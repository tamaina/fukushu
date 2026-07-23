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
    message.value = $locale.value.sfc.fileTooLarge
    return
  }
  if (!/\.(gift|txt)$/i.test(file.name)) {
    message.value = $locale.value.sfc.invalidFileType
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
    message.value = $locale.value.sfc.invalidEncoding
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
        !confirm($l.value.sfc.resetConfirm({ count: updateDiff.value.resetRequired }))
      )
        return
      await updateDeck(updateDeckId, preview.value)
      await router.push(`/decks/${updateDeckId}`)
      return
    }
    const id = await saveNewDeck(
      deckName.value || $locale.value.sfc.untitledDeck,
      preview.value,
      fileName.value,
    )
    await router.push(`/decks/${id}`)
  } catch {
    message.value = $locale.value.sfc.saveFailed
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
        <h1>{{ updateDeckId ? $locale.sfc.updateTitle : $locale.sfc.importTitle }}</h1>
        <p>{{ $locale.sfc.importIntro }}</p>
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
        >{{ $locale.sfc.chooseFile
        }}<input
          class="visually-hidden"
          type="file"
          accept=".gift,.txt,text/plain"
          @change="readFile(($event.target as HTMLInputElement).files?.[0])" /></label
      ><span>{{ $locale.sfc.fileRequirements }}</span>
    </div>
    <label>{{ $locale.sfc.deckName }}<input v-model="deckName" maxlength="100" /></label
    ><label
      >{{ $locale.sfc.giftText
      }}<textarea
        v-model="source"
        rows="14"
        spellcheck="false"
        :placeholder="$locale.sfc.giftPlaceholder"
      />
    </label>
    <div class="actions">
      <button :disabled="busy || !source.trim()" @click="analyze">
        {{ busy ? $locale.sfc.analyzing : $locale.sfc.analyze }}
      </button>
    </div>
    <p v-if="message" class="message error" role="alert">{{ message }}</p>
    <DiagnosticList v-if="preview" :diagnostics="preview.diagnostics" :source="source" />
    <section v-if="preview" class="panel">
      <h2>{{ $locale.sfc.preview }}</h2>
      <p>
        {{ $l.sfc.importCount({ count: preview.questions.length }) }}
      </p>
      <ul class="inline-list">
        <li v-for="(count, kind) in preview.counts" :key="kind">
          <span class="badge">{{ kind }}</span> {{ $l.sfc.questionCount({ count }) }}
        </li>
      </ul>
      <div v-if="updateDiff" class="diff-summary" :aria-label="$locale.sfc.updateDiff">
        <span
          ><strong>{{ updateDiff.added }}</strong> {{ $locale.sfc.added }}</span
        >
        <span
          ><strong>{{ updateDiff.changed }}</strong> {{ $locale.sfc.changed }}</span
        >
        <span
          ><strong>{{ updateDiff.removed }}</strong> {{ $locale.sfc.removed }}</span
        >
        <span
          ><strong>{{ updateDiff.unchanged }}</strong> {{ $locale.sfc.unchanged }}</span
        >
        <p v-if="updateDiff.resetRequired" class="message warning">
          {{ $l.sfc.resetCount({ count: updateDiff.resetRequired }) }}
        </p>
      </div>
      <button :disabled="busy || !canSave" @click="save">
        {{ updateDeckId ? $locale.sfc.updateDeck : $locale.sfc.saveDeck }}
      </button>
      <p v-if="!canSave" class="muted">{{ $locale.sfc.fixErrors }}</p>
    </section>
  </div>
</template>
<locale locale="ja-JP" lang="yaml">
updateTitle: GIFTで問題集を更新
importTitle: GIFTを読み込む
importIntro: ファイルを選ぶか、GIFTテキストを貼り付けてください。
chooseFile: ファイルを選択
fileRequirements: .gift / .txt、UTF-8、最大10MB
deckName: 問題集名
giftText: GIFTテキスト
giftPlaceholder: "::問題名::問題文 '{=正解 ~不正解}'"
analyzing: 解析中…
analyze: 解析する
preview: プレビュー
importCount: '{count} 問を読み込みます。'
questionCount: '{count}問'
updateDiff: 更新差分
added: 追加
changed: 変更
removed: 削除・停止
unchanged: 変更なし
resetCount: '{count}問の学習状態がリセットされます。'
updateDeck: 問題集を更新
saveDeck: 問題集として保存
fixErrors: エラーを修正してから保存してください。
fileTooLarge: ファイルは10MB以下にしてください。
invalidFileType: .gift または .txt ファイルを選択してください。
invalidEncoding: UTF-8として読み込めませんでした。
resetConfirm: '{count}問は正答・形式または問題文が大きく変わったため、学習状態をリセットします。続けますか？'
saveFailed: 保存できませんでした。
untitledDeck: 名称未設定の問題集
</locale>
<locale locale="en-US" lang="yaml">
updateTitle: Update deck from GIFT
importTitle: Import GIFT
importIntro: Choose a file or paste GIFT text.
chooseFile: Choose file
fileRequirements: .gift / .txt, UTF-8, up to 10 MB
deckName: Deck name
giftText: GIFT text
giftPlaceholder: "::Question name::Question text '{=Correct ~Incorrect}'"
analyzing: Analyzing…
analyze: Analyze
preview: Preview
importCount: '{count, plural, one {Import # question.} other {Import # questions.}}'
questionCount: '{count, plural, one {# question} other {# questions}}'
updateDiff: Update changes
added: added
changed: changed
removed: removed or disabled
unchanged: unchanged
resetCount: '{count, plural, one {The study state for # question will be reset.} other {The study states for # questions will be reset.}}'
updateDeck: Update deck
saveDeck: Save as deck
fixErrors: Fix the errors before saving.
fileTooLarge: Choose a file no larger than 10 MB.
invalidFileType: Choose a .gift or .txt file.
invalidEncoding: The file could not be decoded as UTF-8.
resetConfirm: '{count, plural, one {The study state for # question will be reset because its correct answer, format, or prompt changed significantly. Continue?} other {The study states for # questions will be reset because their correct answers, formats, or prompts changed significantly. Continue?}}'
saveFailed: The deck could not be saved.
untitledDeck: Untitled deck
</locale>
