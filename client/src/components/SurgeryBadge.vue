<script setup>
import { computed } from 'vue';
import { Scissors } from '@lucide/vue';
import { Badge } from './ui/badge';

// 掛號的手術標記。櫃台看板、診療台佇列、看診工作區、時段格都用這一顆，
// 之前四個地方各寫一種（徽章、紅字、手刻膠囊、括號文字），同一件事看起來像四件事。
// 顏色走 surgery（紫）——手術是「另一種掛號」，不是警示；遲到徽章走 danger，兩者刻意不同色相。
const props = defineProps({
  name: { type: String, default: '' },
});

const label = computed(() => (props.name?.trim() ? `手術：${props.name.trim()}` : '手術'));
</script>

<template>
  <Badge variant="status" class="max-w-full bg-surgery-surface font-semibold text-surgery" :title="label">
    <Scissors stroke-width="1.75" aria-hidden="true" />
    <span class="truncate">{{ label }}</span>
  </Badge>
</template>
