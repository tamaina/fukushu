import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { vueInternationalization } from 'vite-vue-internationalization'
import { cloudflare } from '@cloudflare/vite-plugin'

export default defineConfig(({ mode }) => ({
  plugins: [
    ...(mode === 'e2e' ? [] : cloudflare()),
    vueInternationalization(),
    vue(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'Fukushu',
        short_name: 'Fukushu',
        description: '端末内で完結するGIFT＋FSRS学習アプリ',
        theme_color: '#176b4d',
        background_color: '#f7f7f5',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: { navigateFallback: '/index.html' },
    }),
  ],
  test: { environment: 'jsdom', setupFiles: ['./tests/setup.ts'], include: ['tests/**/*.test.ts'] },
}))
