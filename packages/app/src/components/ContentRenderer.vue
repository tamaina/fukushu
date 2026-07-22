<script setup lang="ts">
import { computed } from 'vue'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import type { QuizContent } from '../domain/quiz/types'
const props = defineProps<{ content: QuizContent }>()
const html = computed(() => {
  if (
    props.content.format === 'plain' ||
    props.content.format === 'auto' ||
    props.content.format === 'moodle'
  )
    return ''
  const raw =
    props.content.format === 'markdown'
      ? marked.parse(props.content.value, { async: false })
      : props.content.value
  return DOMPurify.sanitize(raw, {
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'svg', 'img'],
    FORBID_ATTR: ['style'],
  })
})
</script>
<template>
  <div v-if="html" class="rich-content" v-html="html" />
  <div v-else class="plain-content">{{ content.value }}</div>
</template>
