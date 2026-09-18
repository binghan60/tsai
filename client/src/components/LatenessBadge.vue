<script setup>
import { computed } from 'vue';
import { Clock } from '@lucide/vue';
import { Badge } from './ui/badge';
import { latenessLabel } from '../lib/appointmentDisplay';

// 遲到標記，形狀與 SurgeryBadge 同一套，但色相刻意分開：遲到走 danger（紅，要人處理），
// 手術走 surgery（紫）——兩顆常並排出現，同色時只剩圖示能分辨。
// 還沒報到的逾時掛號傳即時算出的分鐘數，
// 已報到的傳 latenessMinutes（報到當下記下的遲到分鐘）。
const props = defineProps({
  minutes: { type: Number, default: 0 },
});

const label = computed(() => latenessLabel(props.minutes));
</script>

<template>
  <Badge v-if="label" variant="status" class="bg-danger-surface font-semibold text-danger tabular-nums">
    <Clock stroke-width="1.75" aria-hidden="true" />
    {{ label }}
  </Badge>
</template>
