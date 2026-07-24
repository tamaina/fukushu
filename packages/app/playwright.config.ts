import { defineConfig } from '@playwright/test'
import process from 'node:process'

const port = Number(process.env.E2E_PORT ?? 4173)

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: `pnpm build && pnpm exec vite preview --mode e2e --host 127.0.0.1 --port ${port}`,
    port,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
