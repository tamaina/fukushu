<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Upload } from '@lucide/vue'
import DiagnosticList from '../components/DiagnosticList.vue'
import ContentRenderer from '../components/ContentRenderer.vue'
import { previewGift, type ImportPreview } from '../application/importGift'
import {
  previewAnkiText,
  type AnkiImportPreview,
  type AnkiImportSettings,
} from '../application/importAnki'
import {
  previewDeckUpdate,
  saveAnkiDecks,
  saveNewDeck,
  updateDeck,
  updateAnkiSource,
  type DeckUpdateDiff,
} from '../application/decks'
import { deckRepository } from '../infrastructure/db/database'
import { createId } from '../utils/id'
import { requestPersistentStorage } from '../utils/persistentStorage'
import { readAnkiArchive } from '../application/importAnkiArchive'

const router = useRouter()
const route = useRoute()
const updateDeckId = typeof route.query.deck === 'string' ? route.query.deck : undefined
const source = ref('')
const deckName = ref('')
const fileName = ref<string>()
const importFormat = ref<'gift' | 'anki-text'>('gift')
const ankiSettings = ref<Partial<AnkiImportSettings>>({})
// Parsed questions are plain structured-clone data; keep Vue from proxying them before IndexedDB.
const preview = shallowRef<ImportPreview>()
const ankiPreview = shallowRef<AnkiImportPreview>()
const updateDiff = ref<DeckUpdateDiff>()
const busy = ref(false)
const message = ref('')
const dragging = ref(false)
const canSave = computed(
  () =>
    (importFormat.value === 'gift'
      ? Boolean(preview.value?.questions.length)
      : Boolean(ankiPreview.value?.decks.some((deck) => deck.questions.length))) &&
    !(importFormat.value === 'gift' ? preview.value : ankiPreview.value)?.diagnostics.some(
      (item) => item.severity === 'error',
    ),
)
const activePreview = computed(() =>
  importFormat.value === 'gift' ? preview.value : ankiPreview.value,
)
const ankiCardPreview = computed(() => ankiPreview.value?.decks[0]?.questions[0])
async function analyze(requestPersistence = true): Promise<void> {
  if (!source.value.trim()) return
  if (requestPersistence) await requestPersistentStorage()
  busy.value = true
  message.value = ''
  try {
    if (importFormat.value === 'gift') {
      preview.value = await previewGift(source.value, updateDeckId ?? createId())
      ankiPreview.value = undefined
      updateDiff.value = updateDeckId
        ? await previewDeckUpdate(updateDeckId, preview.value)
        : undefined
    } else {
      let deckIds: Record<string, string> = {}
      if (updateDeckId) {
        const current = await deckRepository.get(updateDeckId)
        const siblings = current?.sourceId ? await deckRepository.bySource(current.sourceId) : []
        deckIds = Object.fromEntries(
          siblings.map((deck) => [deck.sourceDeckKey ?? deck.name, deck.id]),
        )
        if (!siblings.length && deckName.value) deckIds[deckName.value] = updateDeckId
      }
      ankiPreview.value = await previewAnkiText(source.value, deckIds, fileName.value, {
        ...ankiSettings.value,
        ...(deckName.value ? { defaultDeck: deckName.value } : {}),
      })
      ankiSettings.value = ankiPreview.value.settings
      preview.value = undefined
      updateDiff.value = undefined
    }
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
  if (!/\.(gift|txt|csv|tsv|zip)$/i.test(file.name)) {
    message.value = $locale.value.sfc.invalidFileType
    return
  }
  const persistenceRequest = requestPersistentStorage()
  try {
    const buffer = await file.arrayBuffer()
    if (/\.zip$/i.test(file.name)) {
      const archive = readAnkiArchive(buffer)
      source.value = archive.source
      fileName.value = file.name
      importFormat.value = 'anki-text'
      if (archive.missingMedia.length)
        message.value = $l.value.sfc.missingMedia({ count: archive.missingMedia.length })
    } else {
      source.value = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '')
      fileName.value = file.name
      importFormat.value = /\.(csv|tsv)$/i.test(file.name) ? 'anki-text' : 'gift'
    }
    deckName.value ||= file.name.replace(/\.(gift|txt|csv|tsv)$/i, '')
    await persistenceRequest
    await analyze(false)
  } catch {
    message.value = $locale.value.sfc.invalidEncoding
  }
}
function drop(event: DragEvent): void {
  dragging.value = false
  void readFile(event.dataTransfer?.files[0])
}
async function save(): Promise<void> {
  if (!activePreview.value || !canSave.value) return
  busy.value = true
  try {
    if (importFormat.value === 'anki-text' && ankiPreview.value) {
      if (updateDeckId) {
        const deck = await deckRepository.get(updateDeckId)
        if (!deck?.sourceId) throw new Error('更新元ファイルが見つかりません。')
        await updateAnkiSource(deck.sourceId, ankiPreview.value, fileName.value)
        await router.push(`/decks/${updateDeckId}`)
        return
      }
      const ids = await saveAnkiDecks(ankiPreview.value, fileName.value)
      await router.push(ids.length === 1 ? `/decks/${ids[0]}` : '/decks')
      return
    }
    if (!preview.value) return
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
  importFormat.value = deck.sourceType
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
          accept=".gift,.txt,.csv,.tsv,.zip,text/plain,text/csv,text/tab-separated-values,application/zip"
          @change="readFile(($event.target as HTMLInputElement).files?.[0])" /></label
      ><span>{{ $locale.sfc.fileRequirements }}</span>
    </div>
    <label
      >{{ $locale.sfc.format
      }}<select v-model="importFormat">
        <option value="gift">GIFT</option>
        <option value="anki-text">Anki CSV / TSV</option>
      </select></label
    ><label>{{ $locale.sfc.deckName }}<input v-model="deckName" maxlength="100" /></label
    ><label
      >{{ importFormat === 'gift' ? $locale.sfc.giftText : $locale.sfc.ankiText
      }}<textarea
        v-model="source"
        rows="14"
        spellcheck="false"
        :placeholder="
          importFormat === 'gift' ? $locale.sfc.giftPlaceholder : $locale.sfc.ankiPlaceholder
        "
      />
    </label>
    <div class="actions">
      <button :disabled="busy || !source.trim()" @click="analyze()">
        {{ busy ? $locale.sfc.analyzing : $locale.sfc.analyze }}
      </button>
    </div>
    <p v-if="message" class="message error" role="alert">{{ message }}</p>
    <DiagnosticList
      v-if="activePreview"
      :diagnostics="activePreview.diagnostics"
      :source="source"
    />
    <section v-if="ankiPreview" class="panel anki-import-panel">
      <h2>{{ $locale.sfc.columnMapping }}</h2>
      <div class="mapping-grid">
        <label
          >{{ $locale.sfc.frontColumn
          }}<select v-model.number="ankiSettings.frontColumn" @change="analyze(false)">
            <option
              v-for="(column, index) in ankiPreview.settings.columns"
              :key="index"
              :value="index"
            >
              {{ column }}
            </option>
          </select></label
        >
        <label
          >{{ $locale.sfc.backColumn
          }}<select v-model.number="ankiSettings.backColumn" @change="analyze(false)">
            <option
              v-for="(column, index) in ankiPreview.settings.columns"
              :key="index"
              :value="index"
            >
              {{ column }}
            </option>
          </select></label
        >
        <label
          >{{ $locale.sfc.explanationColumn
          }}<select v-model.number="ankiSettings.explanationColumn" @change="analyze(false)">
            <option :value="undefined">{{ $locale.sfc.none }}</option>
            <option
              v-for="(column, index) in ankiPreview.settings.columns"
              :key="index"
              :value="index"
            >
              {{ column }}
            </option>
          </select></label
        >
      </div>
      <p>
        {{
          $l.sfc.ankiSummary({
            notes: ankiPreview.rows.length,
            cards: Object.values(ankiPreview.counts).reduce((a, b) => a + b, 0),
            decks: ankiPreview.decks.length,
          })
        }}
      </p>
      <ul class="inline-list">
        <li v-for="deck in ankiPreview.decks" :key="deck.name">
          <span class="badge">{{ deck.name }}</span>
          {{ $l.sfc.questionCount({ count: deck.questions.length }) }}
        </li>
      </ul>
      <article v-if="ankiCardPreview" class="question-card">
        <p class="eyebrow">{{ $locale.sfc.cardPreview }}</p>
        <ContentRenderer :content="ankiCardPreview.prompt" />
        <template v-if="ankiCardPreview.kind === 'flashcard'">
          <hr />
          <ContentRenderer :content="ankiCardPreview.answer" />
          <div v-if="ankiCardPreview.explanation" class="message">
            <ContentRenderer :content="ankiCardPreview.explanation" />
          </div>
        </template>
      </article>
      <button :disabled="busy || !canSave" @click="save">
        {{ updateDeckId ? $locale.sfc.updateDeck : $locale.sfc.saveDeck }}
      </button>
      <p v-if="!canSave" class="muted">{{ $locale.sfc.fixErrors }}</p>
    </section>
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
updateTitle: ファイルから問題集を更新
importTitle: 問題集を読み込む
importIntro: GIFT、Anki CSV／TSV、またはメディア入りZIPを選択するか、テキストを貼り付けてください。
chooseFile: ファイルを選択
fileRequirements: .gift / .txt / .csv / .tsv / .zip、UTF-8、最大10MB
format: 形式
deckName: 問題集名
giftText: GIFTテキスト
giftPlaceholder: "::問題名::問題文 '{=正解 ~不正解}'"
ankiText: Anki CSV / TSV
ankiPlaceholder: "#separator:Tab\n#notetype:Basic\n問題\t解答"
columnMapping: 列の割り当て
frontColumn: 問題
backColumn: 解答
explanationColumn: 解説・コメント
none: なし
ankiSummary: '{notes}行から{cards}枚を{decks}問題集へ読み込みます。'
cardPreview: カード表示プレビュー
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
invalidFileType: .gift、.txt、.csv、.tsv、.zipファイルを選択してください。
missingMedia: '{count}件のメディアがZIP内に見つかりません。'
invalidEncoding: UTF-8として読み込めませんでした。
resetConfirm: '{count}問は正答・形式または問題文が大きく変わったため、学習状態をリセットします。続けますか？'
saveFailed: 保存できませんでした。
untitledDeck: 名称未設定の問題集
</locale>
<locale locale="en-US" lang="yaml">
updateTitle: Update deck from file
importTitle: Import deck
importIntro: Choose a GIFT, Anki CSV/TSV, or media ZIP file, or paste text.
chooseFile: Choose file
fileRequirements: .gift / .txt / .csv / .tsv / .zip, UTF-8, up to 10 MB
format: Format
deckName: Deck name
giftText: GIFT text
giftPlaceholder: "::Question name::Question text '{=Correct ~Incorrect}'"
ankiText: Anki CSV / TSV
ankiPlaceholder: "#separator:Tab\n#notetype:Basic\nQuestion\tAnswer"
columnMapping: Column mapping
frontColumn: Front
backColumn: Back
explanationColumn: Explanation / comments
none: None
ankiSummary: 'Import {cards} cards from {notes} rows into {decks} decks.'
cardPreview: Card rendering preview
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
invalidFileType: Choose a .gift, .txt, .csv, .tsv, or .zip file.
missingMedia: '{count, plural, one {# media file is missing from the ZIP.} other {# media files are missing from the ZIP.}}'
invalidEncoding: The file could not be decoded as UTF-8.
resetConfirm: '{count, plural, one {The study state for # question will be reset because its correct answer, format, or prompt changed significantly. Continue?} other {The study states for # questions will be reset because their correct answers, formats, or prompts changed significantly. Continue?}}'
saveFailed: The deck could not be saved.
untitledDeck: Untitled deck
</locale>
