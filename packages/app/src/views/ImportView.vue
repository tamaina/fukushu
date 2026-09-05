<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, watch, ref, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Upload } from '@lucide/vue'
import ImportChangeBadges from '../components/ImportChangeBadges.vue'
import AnkiDiagnostics from '../components/AnkiDiagnostics.vue'
import { APKG_MAX_BYTES, type AnkiDiagnostic } from '@fukushu/anki-import'
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
import { deckRepository, importSourceRepository } from '../infrastructure/db/database'
import { createId } from '../utils/id'
import { requestPersistentStorage } from '../utils/persistentStorage'
import { readAnkiArchive } from '../application/importAnkiArchive'
import { previewApkg, type ApkgPreview } from '../application/importApkg'

import {
  apkgCandidates,
  prepareApkg,
  applyApkg,
  apkgDeckChanges,
  type PreparedApkg,
} from '../application/apkgStore'
const deckResults = computed(() =>
  !prepared.value
    ? []
    : apkgDeckChanges(prepared.value).map((change) => {
        const key = prepared.value!.decks.find((d) => d.id === change.id)?.sourceDeckKey
        return { ...change, preview: apkgPreview.value?.decks.find((d) => d.sourceDeckKey === key) }
      }),
)
const mediaSize = computed(() => {
  const bytes = apkgPreview.value?.stats.mediaBytes ?? 0
  return bytes >= 1024 ** 2
    ? (bytes / 1024 ** 2).toFixed(1) + ' MB'
    : bytes >= 1024
      ? (bytes / 1024).toFixed(1) + ' KB'
      : bytes + ' B'
})
const candidates = shallowRef<Awaited<ReturnType<typeof apkgCandidates>>>([])
const selectedSource = ref('')
const prepared = shallowRef<PreparedApkg>()
const deckIndex = ref(0)
const cardIndex = ref(0)
const apkgCard = computed(
  () => apkgPreview.value?.decks[deckIndex.value]?.questions[cardIndex.value],
)
let controller: AbortController | undefined
let analysisGeneration = 0
onBeforeUnmount(() => controller?.abort())
async function refreshApkg() {
  const generation = ++analysisGeneration
  prepared.value = undefined
  if (
    !apkgPreview.value ||
    !fileName.value ||
    apkgPreview.value.diagnostics.some((d) => d.severity === 'error')
  )
    return
  const result = await prepareApkg(
    apkgPreview.value,
    fileName.value,
    importProgress.value,
    selectedSource.value || undefined,
  )
  if (generation === analysisGeneration) prepared.value = result
}
const router = useRouter()
const route = useRoute()
const updateDeckId = typeof route.query.deck === 'string' ? route.query.deck : undefined
const source = ref('')
const deckName = ref('')
const fileName = ref<string>()
const importFormat = ref<'gift' | 'anki-text' | 'anki-package'>('gift')
const ankiSettings = ref<Partial<AnkiImportSettings>>({})
// Parsed questions are plain structured-clone data; keep Vue from proxying them before IndexedDB.
const preview = shallowRef<ImportPreview>()
const ankiPreview = shallowRef<AnkiImportPreview>()
const apkgPreview = shallowRef<ApkgPreview>()
const importProgress = ref(true)
watch([selectedSource, importProgress], () => {
  void refreshApkg().catch((error) => (message.value = String(error)))
})
const updateDiff = ref<DeckUpdateDiff>()
const busy = ref(false)
const message = ref('')
const dragging = ref(false)
const phase = ref<'input' | 'analyzing' | 'review'>('input')
const progressMessage = ref('')
const analysisFile = ref('')
let analysisRun = 0
const originalApkg = shallowRef<ApkgPreview>()
const simplifyCards = ref(true)
const simplifiableCount = computed(
  () => Object.keys(originalApkg.value?.simplifiedCards ?? {}).length,
)
watch([simplifyCards, originalApkg], () => {
  if (!originalApkg.value) return
  const original = originalApkg.value
  apkgPreview.value = !simplifyCards.value
    ? original
    : {
        ...original,
        decks: original.decks.map((deck) => {
          const questions = deck.questions.map((question) => {
            const simplified = original.simplifiedCards?.[question.sourceKey]
            if (!simplified) return question
            const converted = {
              ...question,
              prompt: simplified.front,
              answer: simplified.back,
              ankiTemplateMode: 'native' as const,
            }
            delete converted.ankiCss
            return converted
          })
          return {
            ...deck,
            questions,
            nativeCount: questions.filter((q) => q.ankiTemplateMode === 'native').length,
            isolatedCount: questions.filter((q) => q.ankiTemplateMode === 'isolated').length,
          }
        }),
      }
  void refreshApkg().catch((error) => (message.value = String(error)))
})
watch(phase, async () => {
  await nextTick()
  window.scrollTo({ top: 0 })
  document.querySelector<HTMLElement>('[data-import-heading]')?.focus()
})
async function beginAnalysis(name = '') {
  controller?.abort()
  controller = new AbortController()
  const run = ++analysisRun
  phase.value = 'analyzing'
  busy.value = true
  message.value = ''
  progressMessage.value = '読み込みを準備しています'
  analysisFile.value = name
  preview.value = undefined
  ankiPreview.value = undefined
  apkgPreview.value = undefined
  prepared.value = undefined
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  return run
}
function cancelAnalysis() {
  analysisRun++
  analysisGeneration++
  controller?.abort()
  busy.value = false
  phase.value = 'input'
  message.value = ''
  prepared.value = undefined
}
function finishAnalysis(run: number) {
  if (run !== analysisRun) return
  busy.value = false
  phase.value = activePreview.value ? 'review' : 'input'
}
async function showDiagnosticCard(card: NonNullable<AnkiDiagnostic['card']>) {
  const d = apkgPreview.value?.decks.findIndex((d) => d.sourceDeckKey === card.deckId) ?? -1
  const q =
    d < 0 ? -1 : apkgPreview.value!.decks[d]!.questions.findIndex((q) => q.sourceKey === card.key)
  if (d < 0 || q < 0) {
    message.value = 'この問題は読み込めなかったため、プレビューできません。'
    return
  }
  deckIndex.value = d
  cardIndex.value = q
  await nextTick()
  document.getElementById('apkg-card-preview')?.focus()
  document.getElementById('apkg-card-preview')?.scrollIntoView({ block: 'center' })
}
const canSave = computed(
  () =>
    (importFormat.value === 'gift'
      ? Boolean(preview.value?.questions.length)
      : importFormat.value === 'anki-package'
        ? Boolean(apkgPreview.value && (apkgPreview.value.decks.length || selectedSource.value))
        : Boolean(ankiPreview.value?.decks.some((deck) => deck.questions.length))) &&
    !(
      importFormat.value === 'gift'
        ? preview.value
        : importFormat.value === 'anki-package'
          ? apkgPreview.value
          : ankiPreview.value
    )?.diagnostics.some((item) => item.severity === 'error'),
)
const activePreview = computed(() =>
  importFormat.value === 'gift'
    ? preview.value
    : importFormat.value === 'anki-package'
      ? apkgPreview.value
      : ankiPreview.value,
)
const ankiCardPreview = computed(() => ankiPreview.value?.decks[0]?.questions[0])
async function analyze(requestPersistence = true, inheritedRun?: number): Promise<void> {
  if (importFormat.value === 'anki-package' || !source.value.trim()) return
  const run = inheritedRun ?? (await beginAnalysis(fileName.value ?? 'テキスト'))
  try {
    if (requestPersistence) await requestPersistentStorage()
    if (run !== analysisRun) return
    progressMessage.value = '問題を解析しています'
    if (importFormat.value === 'gift') {
      const result = await previewGift(source.value, updateDeckId ?? createId())
      if (run !== analysisRun) return
      preview.value = result
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
      const result = await previewAnkiText(source.value, deckIds, fileName.value, {
        ...ankiSettings.value,
        ...(deckName.value ? { defaultDeck: deckName.value } : {}),
      })
      if (run !== analysisRun) return
      ankiPreview.value = result
      ankiSettings.value = result.settings
      preview.value = undefined
      updateDiff.value = undefined
    }
  } catch (error) {
    if (run === analysisRun) message.value = error instanceof Error ? error.message : String(error)
  } finally {
    finishAnalysis(run)
  }
}
async function readFile(file?: File): Promise<void> {
  if (!file || busy.value) return
  if (file.size > (/\.apkg$/i.test(file.name) ? APKG_MAX_BYTES : 10 * 1024 ** 2)) {
    message.value = /\.apkg$/i.test(file.name)
      ? $locale.value.sfc.apkgTooLarge
      : $locale.value.sfc.fileTooLarge
    return
  }
  if (!/\.(gift|txt|csv|tsv|zip|apkg)$/i.test(file.name)) {
    message.value = $locale.value.sfc.invalidFileType
    return
  }
  const run = await beginAnalysis(file.name)
  try {
    if (run !== analysisRun) return
    await requestPersistentStorage()
    if (run !== analysisRun) return
    if (/\.apkg$/i.test(file.name)) {
      importFormat.value = 'anki-package'
      const deckIds: Record<string, string> = {}
      if (updateDeckId) {
        const current = await deckRepository.get(updateDeckId)
        for (const deck of current?.sourceId ? await deckRepository.bySource(current.sourceId) : [])
          if (deck.sourceDeckKey) deckIds[deck.sourceDeckKey] = deck.id
      }
      if (run !== analysisRun) return
      const result = await previewApkg(file, deckIds, {
        signal: controller!.signal,
        onProgress: (value) => {
          if (run === analysisRun)
            progressMessage.value = value.includes('SQLite') ? 'ファイルを読み込んでいます' : value
        },
      })
      if (run !== analysisRun) return
      const matches = await apkgCandidates(result, file.name)
      const exact = matches.filter((c) => c.exact)
      const sourceId = updateDeckId
        ? ((await deckRepository.get(updateDeckId))?.sourceId ?? '')
        : exact.length === 1
          ? exact[0]!.source.id
          : ''
      if (run !== analysisRun) return
      simplifyCards.value = true
      originalApkg.value = result
      apkgPreview.value = result
      candidates.value = matches
      selectedSource.value = sourceId
      deckIndex.value = 0
      cardIndex.value = 0
      source.value = '[' + file.name + ']'
      fileName.value = file.name
      await refreshApkg()
    } else {
      const buffer = await file.arrayBuffer()
      if (run !== analysisRun) return
      fileName.value = file.name
      if (/\.zip$/i.test(file.name)) {
        const archive = readAnkiArchive(buffer)
        source.value = archive.source
        importFormat.value = 'anki-text'
        if (archive.missingMedia.length)
          message.value = $l.value.sfc.missingMedia({ count: archive.missingMedia.length })
      } else {
        source.value = new TextDecoder('utf-8', { fatal: true })
          .decode(buffer)
          .replace(/^\uFEFF/, '')
        importFormat.value = /\.(csv|tsv)$/i.test(file.name) ? 'anki-text' : 'gift'
      }
      deckName.value ||= file.name.replace(/\.(gift|txt|csv|tsv)$/i, '')
      await analyze(false, run)
    }
  } catch (error) {
    if (run === analysisRun) message.value = error instanceof Error ? error.message : String(error)
  } finally {
    finishAnalysis(run)
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
    if (importFormat.value === 'anki-package' && apkgPreview.value && fileName.value) {
      if (!prepared.value) await refreshApkg()
      if (!prepared.value) return
      if (
        prepared.value.counts.overwrite &&
        !confirm(
          prepared.value.counts.overwrite +
            '枚のFukushu履歴をAnki履歴で置き換えます。続行しますか？',
        )
      )
        return
      try {
        const ids = await applyApkg(prepared.value)
        await router.push(
          updateDeckId
            ? '/decks/' + updateDeckId
            : ids.length === 1
              ? '/decks/' + ids[0]
              : '/decks',
        )
      } catch (error) {
        if (error instanceof Error && error.message === 'APKG_STALE_PREVIEW') {
          await refreshApkg()
          message.value =
            '学習データが変更されたため差分を更新しました。内容を確認して再度保存してください。'
          return
        }
        throw error
      }
      return
    }
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
  if (deck.sourceType === 'anki-package' && deck.sourceId) {
    const stored = await importSourceRepository.get(deck.sourceId)
    if (stored?.sourceArchive)
      await readFile(new File([stored.sourceArchive], stored.sourceFileName ?? 'collection.apkg'))
  } else if (source.value) await analyze()
})
</script>
<template>
  <div class="page">
    <section v-if="phase === 'analyzing'" class="import-progress" aria-busy="true">
      <h1 data-import-heading tabindex="-1">{{ $locale.sfc.analyzing }}</h1>
      <p>{{ analysisFile }}</p>
      <progress :aria-label="$locale.sfc.analyzing"></progress>
      <p role="status">{{ progressMessage }}</p>
      <button class="secondary" @click="cancelAnalysis">{{ $locale.sfc.cancelAnalysis }}</button>
    </section>
    <template v-else>
      <div class="page-heading">
        <div>
          <h1 data-import-heading tabindex="-1">
            {{ updateDeckId ? $locale.sfc.updateTitle : $locale.sfc.importTitle }}
          </h1>
          <p v-if="phase === 'input'">{{ $locale.sfc.importIntro }}</p>
        </div>
      </div>
      <template v-if="phase === 'input'">
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
              accept=".gift,.txt,.csv,.tsv,.zip,.apkg,text/plain,text/csv,text/tab-separated-values,application/zip"
              @change="readFile(($event.target as HTMLInputElement).files?.[0])" /></label
          ><span>{{ $locale.sfc.fileRequirements }}</span>
        </div>
        <label
          >{{ $locale.sfc.format
          }}<select v-model="importFormat">
            <option value="gift">GIFT</option>
            <option value="anki-text">Anki CSV / TSV</option>
            <option value="anki-package">Ankiパッケージ (.apkg)</option>
          </select></label
        ><label v-if="importFormat !== 'anki-package'"
          >{{ $locale.sfc.deckName }}<input v-model="deckName" maxlength="100" /></label
        ><label v-if="importFormat !== 'anki-package'"
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
          <button
            v-if="importFormat !== 'anki-package'"
            :disabled="busy || !source.trim()"
            @click="analyze()"
          >
            {{ $locale.sfc.analyze }}
          </button>
        </div>
      </template>
      <p v-if="message" class="message error" role="alert">{{ message }}</p>
      <template v-if="phase === 'review'">
        <div class="import-summary">
          <span>{{ fileName || $locale.sfc.pastedText }}</span
          ><button class="secondary" @click="phase = 'input'">{{ $locale.sfc.editInput }}</button>
        </div>
        <AnkiDiagnostics
          v-if="apkgPreview"
          :diagnostics="apkgPreview.diagnostics"
          @preview="showDiagnosticCard"
        />
        <DiagnosticList
          v-else-if="activePreview"
          :diagnostics="activePreview.diagnostics"
          :source="source"
        />
        <section v-if="apkgPreview" class="panel anki-import-panel apkg-result">
          <header class="result-heading">
            <h2>APKGプレビュー</h2>
            <span class="badge">APKG · {{ apkgPreview.packageFormat }}</span>
          </header>
          <div class="result-metadata">
            <span class="badge"
              >カード <strong>{{ apkgPreview.stats.cardCount.toLocaleString() }}</strong></span
            >
            <span class="badge"
              >問題集 <strong>{{ apkgPreview.stats.deckCount.toLocaleString() }}</strong></span
            >
            <span class="badge"
              >ノート <strong>{{ apkgPreview.stats.noteCount.toLocaleString() }}</strong></span
            >
            <span v-if="apkgPreview.stats.mediaBytes" class="badge"
              >メディア <strong>{{ mediaSize }}</strong></span
            >
            <span class="badge"
              >学習履歴 <strong>{{ apkgPreview.stats.reviewCount.toLocaleString() }}</strong></span
            >
          </div>
          <div v-if="prepared" class="import-section">
            <h3>更新内容</h3>
            <ImportChangeBadges :counts="prepared.counts" />
            <ul class="deck-results">
              <li v-for="change in deckResults" :key="change.id">
                <div class="deck-result-title">
                  <strong>{{ change.name }}</strong>
                  <span v-if="change.removed" class="badge">ソースから削除</span>
                  <span v-else-if="change.preview" class="muted"
                    >{{ change.preview.questions.length }}枚</span
                  >
                </div>
                <ImportChangeBadges :counts="change" />
                <small v-if="change.preview" class="muted"
                  >通常表示 {{ change.preview.nativeCount }}枚<span
                    v-if="change.preview.isolatedCount"
                  >
                    · Ankiテンプレート {{ change.preview.isolatedCount }}枚</span
                  ></small
                >
              </li>
            </ul>
          </div>
          <div class="import-section">
            <h3>取込設定</h3>
            <label v-if="!updateDeckId"
              >取込先
              <select v-model="selectedSource">
                <option value="">新しいソースとして取り込む</option>
                <option
                  v-for="candidate in candidates"
                  :key="candidate.source.id"
                  :value="candidate.source.id"
                >
                  {{ candidate.source.sourceFileName }}を更新（{{
                    candidate.matchingCards
                  }}枚一致・{{ candidate.matchingDecks }}deck一致{{
                    candidate.exact ? '・同一ファイル' : ''
                  }}）
                </option>
              </select>
            </label>
            <div class="import-options">
              <div v-if="simplifiableCount">
                <label class="inline-control"
                  ><input v-model="simplifyCards" type="checkbox" /><span
                    >シンプルなカードを通常表示に変換
                    <span class="badge">{{ simplifiableCount }}枚</span></span
                  ></label
                >
                <p class="option-help muted">
                  装飾を省略し、文字・強調・改行を残します。複雑なカードは元の表示を維持します。
                </p>
              </div>
              <label class="inline-control"
                ><input v-model="importProgress" type="checkbox" />Ankiの学習履歴を取り込む</label
              >
            </div>
          </div>
          <div class="import-section">
            <h3>カードプレビュー</h3>
            <div class="preview-controls">
              <label
                >プレビューするdeck<select v-model="deckIndex" @change="cardIndex = 0">
                  <option
                    v-for="(deck, index) in apkgPreview.decks"
                    :key="deck.sourceDeckKey"
                    :value="index"
                  >
                    {{ deck.name }}
                  </option>
                </select></label
              >
              <label
                >カード<select v-model="cardIndex" aria-label="カード">
                  <option
                    v-for="(card, index) in apkgPreview.decks[deckIndex]?.questions"
                    :key="card.id"
                    :value="index"
                  >
                    {{ index + 1 }}
                  </option>
                </select></label
              >
            </div>
            <div v-if="apkgCard" id="apkg-card-preview" tabindex="-1" class="card-preview">
              <p class="preview-side-label">問題</p>
              <ContentRenderer
                :content="apkgCard.prompt"
                :css="apkgCard.ankiCss"
                :media="apkgPreview.media"
              />
              <div class="preview-answer">
                <p class="preview-side-label">解答</p>
                <ContentRenderer
                  :content="apkgCard.answer"
                  :css="apkgCard.ankiCss"
                  :media="apkgPreview.media"
                />
              </div>
            </div>
          </div>
          <footer class="import-footer">
            <span class="muted"
              >{{ apkgPreview.stats.cardCount.toLocaleString() }}枚のカードを読み込みます</span
            >
            <button :disabled="busy || !canSave" @click="save">
              {{ updateDeckId ? $locale.sfc.updateDeck : $locale.sfc.saveDeck }}
            </button>
          </footer>
          <p v-if="!canSave" class="muted">{{ $locale.sfc.fixErrors }}</p>
        </section>
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
      </template>
    </template>
  </div>
</template>
<style scoped>
.import-progress {
  min-height: 65vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.25rem;
  text-align: center;
}
.import-progress h1,
.import-progress p {
  margin: 0;
}
.import-progress progress {
  width: min(24rem, 100%);
  accent-color: var(--color-accent);
}
[data-import-heading]:focus {
  outline: none;
}
.inline-control {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  font-weight: normal;
}
.inline-control input {
  width: auto;
  flex: none;
  margin-top: 0.3em;
  accent-color: var(--color-accent);
}
.import-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.5rem;
}
.apkg-result {
  gap: var(--space-4);
}
.result-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.result-heading h2 {
  margin: 0;
}
.result-metadata {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.result-metadata .badge {
  display: inline-flex;
  align-items: baseline;
  gap: 0.5em;
  padding: 4px 10px;
  white-space: nowrap;
}
.result-metadata strong {
  color: var(--color-text);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.import-section {
  border-top: 1px solid var(--color-border);
  padding-top: var(--space-5);
  display: grid;
  gap: var(--space-4);
  min-width: 0;
}
.import-section h3 {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-muted);
}
.deck-results {
  padding: 0;
  margin: 0;
  list-style: none;
}
.deck-results li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2) var(--space-4);
  padding: var(--space-3) 0;
}
.deck-results li + li {
  border-top: 1px solid var(--color-border);
}
.deck-result-title {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--space-2);
  overflow-wrap: anywhere;
}
.deck-result-title strong {
  font-size: 0.95rem;
}
.deck-results small {
  grid-column: 1/-1;
}
.import-options {
  display: grid;
  gap: var(--space-4);
}
.option-help {
  font-size: 0.8rem;
  margin: 0.4rem 0 0 1.6rem;
}
.preview-controls {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: var(--space-4);
}
.preview-controls label {
  min-width: 0;
}
.card-preview {
  padding: var(--space-5);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow-wrap: anywhere;
}
.preview-side-label {
  font-size: 0.75rem;
  color: var(--color-muted);
  margin: 0 0 var(--space-2);
}
.preview-answer {
  border-top: 1px solid var(--color-border);
  padding-top: var(--space-4);
  margin-top: var(--space-4);
}
.import-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-3);
  border-top: 1px solid var(--color-border);
  padding-top: var(--space-4);
}
.import-footer span {
  font-size: 0.8rem;
}
@media (max-width: 600px) {
  .deck-results li {
    grid-template-columns: minmax(0, 1fr);
  }
  .preview-controls {
    grid-template-columns: minmax(0, 1fr);
  }
  .import-footer button {
    width: 100%;
  }
}
</style>
<locale locale="ja-JP" lang="yaml">
updateTitle: ファイルから問題集を更新
importTitle: 問題集を読み込む
importIntro: GIFT、Anki CSV／TSV、.apkg、またはメディア入りZIPを選択するか、テキストを貼り付けてください。
chooseFile: ファイルを選択
fileRequirements: .gift / .txt / .csv / .tsv / .zip / .apkg（APKGは最大256MiB）
apkgTooLarge: APKGは256MiB以下にしてください。
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
cancelAnalysis: 解析をキャンセル
editInput: 入力・ファイルを変更
pastedText: 貼り付けたテキスト
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
invalidFileType: .gift、.txt、.csv、.tsv、.zip、.apkgファイルを選択してください。
missingMedia: '{count}件のメディアがZIP内に見つかりません。'
invalidEncoding: UTF-8として読み込めませんでした。
resetConfirm: '{count}問は正答・形式または問題文が大きく変わったため、学習状態をリセットします。続けますか？'
saveFailed: 保存できませんでした。
untitledDeck: 名称未設定の問題集
</locale>
<locale locale="en-US" lang="yaml">
updateTitle: Update deck from file
importTitle: Import deck
importIntro: Choose a GIFT, Anki CSV/TSV, .apkg, or media ZIP file, or paste text.
chooseFile: Choose file
fileRequirements: .gift / .txt / .csv / .tsv / .zip / .apkg (APKG up to 256 MiB)
apkgTooLarge: Choose an APKG no larger than 256 MiB.
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
cancelAnalysis: Cancel analysis
editInput: Change input or file
pastedText: Pasted text
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
invalidFileType: Choose a .gift, .txt, .csv, .tsv, .zip, or .apkg file.
missingMedia: '{count, plural, one {# media file is missing from the ZIP.} other {# media files are missing from the ZIP.}}'
invalidEncoding: The file could not be decoded as UTF-8.
resetConfirm: '{count, plural, one {The study state for # question will be reset because its correct answer, format, or prompt changed significantly. Continue?} other {The study states for # questions will be reset because their correct answers, formats, or prompts changed significantly. Continue?}}'
saveFailed: The deck could not be saved.
untitledDeck: Untitled deck
</locale>
