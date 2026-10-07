<script setup>
import { computed } from 'vue';
import { Scissors } from '@lucide/vue';
import { Badge } from './ui/badge';

// 掛號的手術標記。櫃台看板、診療台佇列、看診工作區、時段格都用這一顆，
// 之前四個地方各寫一種（徽章、紅字、手刻膠囊、括號文字），同一件事看起來像四件事。
// 顏色走 surgery（紫）——手術是「另一種掛號」，不是警示；遲到徽章走 danger，兩者刻意不同色相。
const props = defineProps({
  name: { type: String, default: '' },
  // 只寫「手術」，手術名稱放滑過提示（診療台精簡版一行放不下「手術：結紮」）。
  // 提示要掛在這裡面那段文字上：外面再包一層 v-tip 會被裡面那段的提示蓋掉，什麼都不出。
  short: { type: Boolean, default: false },
});

const label = computed(() => (props.name?.trim() ? `手術：${props.name.trim()}` : '手術'));
</script>

<template>
  <Badge variant="status" class="max-w-full bg-surgery-surface font-semibold text-surgery">
    <Scissors stroke-width="1.75" aria-hidden="true" />
    <span v-if="short" v-tip="name?.trim() ? label : undefined" :aria-label="label">手術</span>
    <span v-else v-tip.overflow="label" class="truncate">{{ label }}</span>
  </Badge>
</template>
