<script setup>
import { computed } from 'vue';
import { CalendarX, Clock } from '@lucide/vue';
import { attendanceBadges } from '../lib/attendance';

// 貓咪詳情頁名字旁的出席徽章：「遲到 3 次｜最近 9/28」「未到 1 次｜最近 8/15」。
// 次數是 0 的不畫。點下去由頁面切到「出席紀錄」頁籤看逐筆明細，所以是按鈕。
// 顏色跟 LatenessBadge 同一組（danger），兩顆靠圖示分辨。
const props = defineProps({
  // { lateCount, lastLateDate, noShowCount, lastNoShowDate }
  counts: { type: Object, default: null },
  // 讀屏用：這組數字是誰的（「豆豆」「飼主王小明名下」）。
  subject: { type: String, default: '' },
});
const emit = defineEmits(['select']);

const badges = computed(() => attendanceBadges(props.counts));
const ICONS = { late: Clock, no_show: CalendarX };
</script>

<template>
  <button
    v-for="badge in badges"
    :key="badge.kind"
    type="button"
    class="inline-flex h-7 items-center gap-2 rounded-full bg-danger-surface px-2.5 text-sm whitespace-nowrap text-danger transition-colors hover:bg-danger/15 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus-ring"
    :aria-label="`${subject}${badge.label} ${badge.count} 次，查看出席紀錄`"
    v-tip="'查看出席紀錄'"
    @click="emit('select')"
  >
    <component :is="ICONS[badge.kind]" class="size-4 shrink-0" stroke-width="1.75" aria-hidden="true" />
    <span class="font-semibold">{{ badge.label }} <span class="num">{{ badge.count }}</span> 次</span>
    <template v-if="badge.last">
      <span class="h-3.5 w-px bg-current opacity-35" aria-hidden="true" />
      <span>最近 <span class="num">{{ badge.last }}</span></span>
    </template>
  </button>
</template>
