<script setup lang="ts">
import { computed } from 'vue'
import DOMPurify from 'dompurify'
import renderMathInElement from 'katex/contrib/auto-render'
import 'katex/dist/katex.min.css'
import { marked } from 'marked'
import type { QuizContent } from '../domain/quiz/types'
const props = defineProps<{ content: QuizContent }>()
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
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'svg'],
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
  renderMathInElement(element, {
    delimiters: [
      { left: '\\[', right: '\\]', display: true },
      { left: '$$', right: '$$', display: true },
      { left: '\\(', right: '\\)', display: false },
    ],
    throwOnError: false,
    strict: false,
  })
  return element.innerHTML
})
</script>
<template>
  <div
    :class="
      content.format === 'html' || content.format === 'markdown' ? 'rich-content' : 'plain-content'
    "
    v-html="html"
  />
</template>
