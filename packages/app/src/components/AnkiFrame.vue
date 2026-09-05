<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import { mediaRepository } from '../infrastructure/db/database'
import { safeAnkiCss, safeAnkiHtml, safeAnkiSvg } from '@fukushu/anki-import/safety'
import { renderCardMath } from '../utils/renderMath'
import mathCss from 'katex/dist/katex.min.css?inline'
import type { MediaRecord } from '../infrastructure/db/schema'
const props = defineProps<{
  html: string
  css?: string | undefined
  media?: MediaRecord[] | undefined
}>()
const frame = ref<HTMLIFrameElement>()
const srcdoc = ref('')
const height = ref(80)
let urls: string[] = []
let generation = 0
let observer: ResizeObserver | undefined
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
    srcdoc.value = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src blob:; media-src blob:; font-src 'self'; base-uri 'none'; form-action 'none'"><style>${mathCss}html,body{margin:0;overflow-wrap:anywhere}body{padding:8px;box-sizing:border-box}img{max-width:100%;height:auto}.cloze-blank{display:inline-block;border:1px solid;min-width:3em;text-align:center;line-height:inherit}.cloze-hint{font-size:.7em}${safeAnkiCss(props.css ?? '')}</style></head><body class="card">${content.innerHTML}</body></html>`
  },
  { immediate: true },
)
function loaded() {
  observer?.disconnect()
  const body = frame.value?.contentDocument?.body
  if (!body) return
  const resize = () => {
    height.value = Math.max(40, Math.ceil(body.getBoundingClientRect().height))
  }
  observer = new ResizeObserver(resize)
  observer.observe(body)
  resize()
}
onBeforeUnmount(() => {
  generation++
  observer?.disconnect()
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
