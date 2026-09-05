<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { mediaRepository } from '../infrastructure/db/database'
import { safeAnkiCss, safeAnkiHtml, safeAnkiSvg } from '@fukushu/anki-import/safety'
import { renderCardMath } from '../utils/renderMath'
import { fitLeadingRuby } from '../utils/rubyInset'
import mathCss from 'katex/dist/katex.min.css?inline'
import type { MediaRecord } from '../infrastructure/db/schema'
const props = defineProps<{
  html: string
  css?: string | undefined
  media?: MediaRecord[] | undefined
  forceLight?: boolean | undefined
}>()
const frame = ref<HTMLIFrameElement>()
const srcdoc = ref('')
const height = ref(80)
let urls: string[] = []
let generation = 0
let observer: ResizeObserver | undefined
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
function syncTheme() {
  const doc = frame.value?.contentDocument
  if (!doc?.body) return
  const root = document.documentElement
  const dark =
    !props.forceLight &&
    (root.dataset.theme === 'dark' || (root.dataset.theme !== 'light' && systemTheme.matches))
  const colors = window.getComputedStyle(root)
  doc.body.classList.toggle('nightMode', dark)
  doc.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  doc.documentElement.style.setProperty(
    '--fukushu-card-bg',
    props.forceLight ? '#fff' : colors.getPropertyValue('--color-surface'),
  )
  doc.documentElement.style.setProperty(
    '--fukushu-card-text',
    props.forceLight ? '#1d211f' : colors.getPropertyValue('--color-text'),
  )
}
const themeObserver = new window.MutationObserver(syncTheme)
onMounted(() => {
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
  systemTheme.addEventListener('change', syncTheme)
  syncTheme()
})
watch(() => props.forceLight, syncTheme)
watch(
  () => [props.html, props.css, props.media],
  async () => {
    const current = ++generation
    let html = safeAnkiHtml(props.html)
    const next: string[] = []
    for (const id of new Set(
      [...html.matchAll(/fukushu-media:([a-f0-9]{64})/g)].map((m) => m[1]!),
    )) {
      const record = props.media?.find((m) => m.id === id) ?? (await mediaRepository.get(id))
      if (
        !record ||
        !/^(image\/(png|jpeg|gif|webp|svg\+xml)|audio\/(mpeg|ogg|wav|mp4))$/.test(record.mimeType)
      )
        continue
      const blob =
        record.mimeType === 'image/svg+xml'
          ? new Blob([safeAnkiSvg(await record.blob.text())], { type: record.mimeType })
          : record.blob
      const url = URL.createObjectURL(blob)
      next.push(url)
      html = html.replaceAll(`fukushu-media:${id}`, url)
    }
    if (current !== generation) {
      next.forEach(URL.revokeObjectURL)
      return
    }
    urls.forEach(URL.revokeObjectURL)
    urls = next
    const content = document.createElement('div')
    content.innerHTML = html
    renderCardMath(content)
    srcdoc.value = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src blob:; media-src blob:; font-src 'self'; base-uri 'none'; form-action 'none'"><style>${mathCss}html,body{margin:0;overflow-wrap:anywhere}body{padding:8px;box-sizing:border-box}:where(body){color:var(--fukushu-card-text);background:var(--fukushu-card-bg)}img{max-width:100%;height:auto}.cloze-blank{display:inline-block;border:1px solid;min-width:3em;text-align:center;line-height:inherit}.cloze-hint{font-size:.7em}${safeAnkiCss(props.css ?? '')}</style></head><body class="card">${content.innerHTML}</body></html>`
  },
  { immediate: true },
)
function loaded() {
  syncTheme()
  observer?.disconnect()
  const body = frame.value?.contentDocument?.body
  if (!body) return
  const resize = () => {
    fitLeadingRuby(body)
    height.value = Math.max(40, Math.ceil(body.getBoundingClientRect().height))
  }
  observer = new ResizeObserver(resize)
  observer.observe(body)
  resize()
  void body.ownerDocument.fonts.ready.then(() => {
    if (frame.value?.contentDocument?.body === body) resize()
  })
}
onBeforeUnmount(() => {
  generation++
  observer?.disconnect()
  themeObserver.disconnect()
  systemTheme.removeEventListener('change', syncTheme)
  urls.forEach(URL.revokeObjectURL)
})
</script>
<template>
  <iframe
    ref="frame"
    title="Ankiカード"
    sandbox="allow-same-origin"
    :srcdoc="srcdoc"
    :style="{ height: `${height}px`, width: '100%', border: '0' }"
    @load="loaded"
  />
</template>
