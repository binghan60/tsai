<script setup>
import { computed } from 'vue';
import { parseRichText } from '../../../shared/richText.js';
import { BOLD_CLASS, tintClass } from '../lib/richTextStyle';

// 唯讀顯示帶格式標記的文字（粗體、四色）。標記由 shared/richText.js 拆成片段後以文字插值輸出，
// 不走 v-html——內容是使用者打的字，永遠不當成 HTML。
// 需要在片段裡再加工（例如待辦把 #寵物 換成可點標籤）時用預設 slot，slot 拿到 { text }。
const props = defineProps({
  text: { type: String, default: '' },
  tag: { type: String, default: 'div' },
});

const lines = computed(() => parseRichText(props.text));
const segmentClass = (segment) => [segment.bold ? BOLD_CLASS : '', tintClass(segment.color)].filter(Boolean).join(' ') || undefined;
</script>

<template>
  <component :is="tag" class="whitespace-pre-wrap wrap-break-word"><template v-for="(line, lineIndex) in lines" :key="lineIndex"><template v-if="lineIndex">{{ '\n' }}</template><span v-for="(segment, index) in line" :key="index" :class="segmentClass(segment)"><slot :text="segment.text">{{ segment.text }}</slot></span></template></component>
</template>
