import { createApp } from 'vue'
import { createInternationalization } from 'virtual:vite-vue-internationalization'
import App from './App.vue'
import { router } from './router'
import './styles/tokens.css'
import './styles/base.css'
import { settingsRepository } from './infrastructure/db/database'

const preferences = await settingsRepository.get()
document.documentElement.dataset.theme = preferences.theme === 'system' ? '' : preferences.theme
document.documentElement.lang = preferences.locale
const locale = preferences.locale === 'en' ? 'en-US' : 'ja-JP'
const app = createApp(App)
const internationalization = createInternationalization({ initialLocale: locale })
app.use(internationalization)
await internationalization.ready
app.use(router).mount('#app')
