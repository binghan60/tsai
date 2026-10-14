<script setup>
import { Check } from '@lucide/vue';
import { Badge } from './ui/badge';

// 畫 lib/recordStatus.js 的 reportMark／deskMark：pill＝淡底膠囊（要有人動手），
// dot＝圓點＋文字，check＝勾＋文字，text＝只有字。後三種不填底，仍然有顏色。
defineProps({
  mark: { type: Object, default: null },
});
</script>

<template>
  <template v-if="mark">
    <Badge v-if="mark.style === 'pill'" variant="status" :class="mark.class">{{ mark.label }}</Badge>
    <span v-else class="inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap" :class="mark.class">
      <span v-if="mark.style === 'dot'" class="size-2 shrink-0 rounded-full" :class="mark.dotClass" aria-hidden="true" />
      <Check v-else-if="mark.style === 'check'" class="size-4 shrink-0" stroke-width="2.25" aria-hidden="true" />
      {{ mark.label }}
    </span>
  </template>
</template>
