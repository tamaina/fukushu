<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { Download, Upload, Trash2 } from '@lucide/vue'
import { clearDatabase, settingsRepository } from '../infrastructure/db/database'
import { createBackup, restoreBackup } from '../application/backup'
import { defaultSettings, type SettingsRecord } from '../infrastructure/db/schema'
const settings = ref<SettingsRecord>({ ...defaultSettings })
const saved = ref('')
const error = ref('')
let loaded = false
let loadedLocale: SettingsRecord['locale'] = 'ja'
onMounted(async () => {
  settings.value = await settingsRepository.get()
  loadedLocale = settings.value.locale
  await nextTick()
  loaded = true
  applyTheme()
})
watch(
  settings,
  async () => {
    if (!loaded) return
    await settingsRepository.put(settings.value)
    applyTheme()
    if (settings.value.locale !== loadedLocale) location.reload()
    saved.value = $locale.value.sfc.saved
    window.setTimeout(() => (saved.value = ''), 1500)
  },
  { deep: true },
)
function applyTheme(): void {
  document.documentElement.dataset.theme =
    settings.value.theme === 'system' ? '' : settings.value.theme
}
async function download(): Promise<void> {
  const value = await createBackup()
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `fukushu-backup-${value.exportedAt.slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
async function upload(file?: File): Promise<void> {
  if (!file) return
  error.value = ''
  try {
    await restoreBackup(JSON.parse(await file.text()) as unknown)
    location.reload()
  } catch {
    error.value = $locale.value.sfc.invalidBackup
  }
}
async function removeAll(): Promise<void> {
  if (!confirm($locale.value.sfc.deleteConfirm)) return
  await clearDatabase()
  location.href = '/'
}
</script>
<template>
  <div class="page">
    <div class="page-heading">
      <div>
        <h1>{{ $locale.sfc.settings }}</h1>
        <p>{{ $locale.sfc.settingsIntro }}</p>
      </div>
      <span aria-live="polite" class="muted">{{ saved }}</span>
    </div>
    <section class="settings-section">
      <h2>{{ $locale.sfc.study }}</h2>
      <label
        >{{ $locale.sfc.retention }}
        <output>{{ Math.round(settings.desiredRetention * 100) }}%</output
        ><input
          v-model.number="settings.desiredRetention"
          type="range"
          min="0.8"
          max="0.97"
          step="0.01"
        /><small>{{ $locale.sfc.retentionHint }}</small></label
      ><label
        >{{ $locale.sfc.newPerDay
        }}<input
          v-model.number="settings.newQuestionsPerDay"
          type="number"
          min="0"
          max="200" /></label
      ><label
        >{{ $locale.sfc.maxReviews
        }}<input
          :value="settings.maxReviewsPerDay ?? ''"
          type="number"
          min="1"
          max="1000"
          @input="
            settings.maxReviewsPerDay = ($event.target as HTMLInputElement).value
              ? Number(($event.target as HTMLInputElement).value)
              : null
          " /></label
      ><label
        >{{ $locale.sfc.checkpointInterval
        }}<input
          v-model.number="settings.checkpointInterval"
          type="number"
          min="0"
          max="1000"
        /><small>{{ $locale.sfc.checkpointIntervalHint }}</small></label
      ><label class="check-row"
        ><input v-model="settings.shuffleChoices" type="checkbox" />{{ $locale.sfc.shuffle }}</label
      ><label class="check-row"
        ><input v-model="settings.showImmediateFeedback" type="checkbox" />{{
          $locale.sfc.immediateFeedback
        }}</label
      >
    </section>
    <section class="settings-section">
      <h2>{{ $locale.sfc.appearance }}</h2>
      <label
        >{{ $locale.sfc.theme
        }}<select v-model="settings.theme">
          <option value="system">{{ $locale.sfc.systemTheme }}</option>
          <option value="light">{{ $locale.sfc.lightTheme }}</option>
          <option value="dark">{{ $locale.sfc.darkTheme }}</option>
        </select></label
      ><label
        >{{ $locale.sfc.language
        }}<select v-model="settings.locale">
          <option value="ja">{{ $locale.sfc.japanese }}</option>
          <option value="en">{{ $locale.sfc.english }}</option>
        </select></label
      >
    </section>
    <section class="settings-section">
      <h2>{{ $locale.sfc.backup }}</h2>
      <p>{{ $locale.sfc.backupIntro }}</p>
      <div class="actions">
        <button @click="download"><Download aria-hidden="true" />{{ $locale.sfc.saveJson }}</button
        ><label class="button secondary"
          ><Upload aria-hidden="true" />{{ $locale.sfc.restoreJson
          }}<input
            class="visually-hidden"
            type="file"
            accept="application/json,.json"
            @change="upload(($event.target as HTMLInputElement).files?.[0])"
        /></label>
      </div>
      <p v-if="error" class="message error" role="alert">{{ error }}</p>
    </section>
    <section class="danger-zone">
      <h2>{{ $locale.sfc.deleteAll }}</h2>
      <p>{{ $locale.sfc.deleteAllIntro }}</p>
      <button class="danger" @click="removeAll">
        <Trash2 aria-hidden="true" />{{ $locale.sfc.deleteAllButton }}
      </button>
    </section>
  </div>
</template>
<locale locale="ja-JP" lang="yaml">
settings: 設定
settingsIntro: 学習スケジュールと表示を調整します。
study: 学習
retention: 目標保持率
retentionHint: 高くすると忘れにくくなりますが、毎日の復習量が増えます。
newPerDay: 1日の新規問題数
maxReviews: 1日の最大復習数（空欄は無制限）
checkpointInterval: 途中結果を表示する回答数
checkpointIntervalHint: 0にすると途中結果を表示しません。
shuffle: 選択肢をシャッフルする
immediateFeedback: 回答直後に正誤と解説を表示する
appearance: 表示
theme: テーマ
systemTheme: 端末の設定
lightTheme: ライト
darkTheme: ダーク
language: 言語
japanese: 日本語
english: English
backup: バックアップ
backupIntro: 問題集と学習履歴をJSONへ保存し、別のブラウザで復元できます。
saveJson: JSONを保存
restoreJson: JSONから復元
deleteAll: 全データ削除
deleteAllIntro: ブラウザ内の問題集、学習履歴、設定をすべて削除します。
deleteAllButton: すべて削除
saved: 保存しました
invalidBackup: バックアップ形式が正しくないため復元できませんでした。
deleteConfirm: すべての問題集・学習履歴・設定を削除しますか？この操作は元に戻せません。
</locale>
<locale locale="en-US" lang="yaml">
settings: Settings
settingsIntro: Adjust the study schedule and display.
study: Study
retention: Desired retention
retentionHint: Higher retention helps you forget less, but increases daily reviews.
newPerDay: New questions per day
maxReviews: Maximum reviews per day (blank for unlimited)
checkpointInterval: Answers between progress reports
checkpointIntervalHint: Set to 0 to disable progress reports.
shuffle: Shuffle choices
immediateFeedback: Show correctness and explanation immediately
appearance: Appearance
theme: Theme
systemTheme: System
lightTheme: Light
darkTheme: Dark
language: Language
japanese: 日本語
english: English
backup: Backup
backupIntro: Save decks and study history as JSON and restore them in another browser.
saveJson: Save JSON
restoreJson: Restore JSON
deleteAll: Delete all data
deleteAllIntro: Delete every deck, study record, and setting in this browser.
deleteAllButton: Delete everything
saved: Saved
invalidBackup: The backup format is invalid and could not be restored.
deleteConfirm: Delete all decks, study history, and settings? This action cannot be undone.
</locale>
