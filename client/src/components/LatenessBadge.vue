<script setup>
import { computed } from 'vue';
import { Clock } from '@lucide/vue';
import { Badge } from './ui/badge';
import { latenessLabel } from '../lib/appointmentDisplay';

// 遲到標記，形狀與 SurgeryBadge 同一套，但色相刻意分開：手術走 danger（要備器材、禁食），
// 遲到走 warning（時間上要留意）——兩顆常並排出現，同色時只剩圖示能分辨。
// 還沒報到的逾時掛號傳即時算出的分鐘數，
// 已報到的傳 latenessMinutes（報到當下記下的遲到分鐘）。
const props = defineProps({
  minutes: { type: Number, default: 0 },
});

const label = computed(() => latenessLabel(props.minutes));
</script>

<template>
  <Badge v-if="label" variant="status" class="bg-warning-surface font-semibold text-warning tabular-nums">
    <Clock stroke-width="1.75" aria-hidden="true" />
    {{ label }}
  </Badge>
</template>
