<script setup lang="ts">
import { BookOpen, History, Settings } from '@lucide/vue'
import ReloadPrompt from './components/ReloadPrompt.vue'
</script>
<template>
  <a class="skip-link" href="#main-content">{{ $locale.sfc.skip }}</a>
  <div class="site-shell">
    <header class="site-header">
      <RouterLink class="site-title" to="/">Fukushu</RouterLink>
      <nav :aria-label="$locale.sfc.mainNav">
        <RouterLink to="/decks"
          ><BookOpen aria-hidden="true" :size="18" />{{ $locale.sfc.decks }}</RouterLink
        >
        <RouterLink to="/history"
          ><History aria-hidden="true" :size="18" />{{ $locale.sfc.history }}</RouterLink
        >
        <RouterLink to="/settings"
          ><Settings aria-hidden="true" :size="18" />{{ $locale.sfc.settings }}</RouterLink
        >
      </nav>
    </header>
    <main id="main-content"><RouterView /></main>
    <footer>
      <RouterLink to="/about">{{ $locale.sfc.about }}</RouterLink
      ><span>{{ $locale.sfc.localOnly }}</span>
    </footer>
  </div>
  <ReloadPrompt />
</template>
<locale locale="ja-JP" lang="yaml">
skip: 本文へ移動
mainNav: メインナビゲーション
decks: 問題集
history: 履歴
settings: 設定
about: このアプリについて
localOnly: データは端末内だけに保存されます
</locale>
<locale locale="en-US" lang="yaml">
skip: Skip to content
mainNav: Main navigation
decks: Decks
history: History
settings: Settings
about: About this app
localOnly: Your data stays only on this device
</locale>
