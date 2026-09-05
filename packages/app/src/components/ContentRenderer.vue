<script setup lang="ts">
import { computed } from 'vue'
import DOMPurify from 'dompurify'
import { renderCardMath } from '../utils/renderMath'
import 'katex/dist/katex.min.css'
import { marked } from 'marked'
import type { QuizContent } from '../domain/quiz/types'
import AnkiFrame from './AnkiFrame.vue'
import type { MediaRecord } from '../infrastructure/db/schema'
const props = defineProps<{
  content: QuizContent
  css?: string | undefined
  media?: MediaRecord[] | undefined
}>()
const html = computed(() => {
  const rich =
    props.content.format === 'markdown'
      ? marked.parse(props.content.value, { async: false })
      : props.content.format === 'html'
        ? props.content.value
        : undefined
  const element = document.createElement('div')
  if (rich === undefined) element.textContent = props.content.value
  else
    element.innerHTML = DOMPurify.sanitize(rich, {
      ADD_TAGS: ['audio'],
      ADD_ATTR: ['controls', 'preload'],
      FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'svg'],
      FORBID_ATTR: ['style'],
    })
  for (const media of element.querySelectorAll('img, audio')) {
    if (!(media.getAttribute('src') ?? '').startsWith('data:')) {
      const replacement = document.createElement('span')
      replacement.className = 'missing-media'
      replacement.textContent = media.getAttribute('src') || '[missing media]'
      media.replaceWith(replacement)
    }
  }
  renderCardMath(element)
  return element.innerHTML
})
</script>
<template>
  <AnkiFrame
    v-if="css !== undefined || content.value.includes('fukushu-media:')"
    :html="content.value"
    :css="css"
    :media="media"
  />
  <div v-else>
    <div
      :class="[
        content.format === 'html' || content.format === 'markdown'
          ? 'rich-content'
          : 'plain-content',
        { 'markdown-content': content.format === 'markdown' },
      ]"
      v-html="html"
    />
  </div>
</template>
