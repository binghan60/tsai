<script setup>
import { computed } from 'vue';
import { petReminders } from '../lib/petDisplay';

// 清單上的貓咪提醒小標籤（過敏、病史、備註），全文放在 title 裡滑過看。
const props = defineProps({ pet: { type: Object, default: null } });
const TONE = {
  allergy: 'bg-destructive-solid text-destructive-solid-foreground',
  history: 'text-danger shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--danger)_45%,transparent)]',
  notes: 'bg-warning-surface text-warning',
};
const tags = computed(() => petReminders(props.pet));
</script>

<template>
  <span v-if="tags.length" class="flex min-w-0 flex-wrap gap-1">
    <span v-for="tag in tags" :key="tag.key" v-tip="tag.title" class="inline-flex h-6 max-w-40 items-center truncate rounded-full px-2 text-2xs leading-none font-semibold" :class="TONE[tag.tone]">
      {{ tag.label }}<span class="sr-only">：{{ tag.title }}</span>
    </span>
  </span>
</template>
