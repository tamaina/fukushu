<script setup lang="ts">
import { useRegisterSW } from 'virtual:pwa-register/vue'
const { needRefresh, updateServiceWorker } = useRegisterSW()
</script>
<template>
  <aside v-if="needRefresh" class="update-prompt" role="status">
    <span>{{ $locale.sfc.updateAvailable }}</span>
    <button @click="updateServiceWorker(true)">{{ $locale.sfc.updateNow }}</button>
    <button class="secondary" @click="needRefresh = false">{{ $locale.sfc.later }}</button>
  </aside>
</template>
<locale locale="ja-JP" lang="yaml">
updateAvailable: 新しいバージョンを利用できます。
updateNow: 更新する
later: 後で
</locale>
<locale locale="en-US" lang="yaml">
updateAvailable: A new version is available.
updateNow: Update now
later: Later
</locale>
