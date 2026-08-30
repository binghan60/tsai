<script setup>
import { computed } from 'vue';
import { ExternalLink } from '@lucide/vue';
import { useRecordForm } from './context';
import { formatDate } from '../../lib/datetime';

// 填表時的對照資訊：這隻寵物「上次」量到這個項目時的值。
// 不限上次做的是哪一種健檢 —— 只要以前量過，這次表單上有同一個項目就顯示，
// 並附上那次的日期與健檢種類，讓醫師知道這個數字是什麼時候、什麼情境下量的。
// 沒有歷史紀錄（或這是結構預覽）時整個元件不渲染。
const props = defineProps({
  // 範本項目或作答列都可以；作答列沒有 type，用 type prop 補上。
  item: { type: Object, required: true },
  type: { type: String, default: '' },
  showLabel: { type: Boolean, default: true },
  compact: { type: Boolean, default: false },
});

const { previousFor } = useRecordForm();
// 只有真的量到數值（或填了結果描述）才值得顯示。上次只是打勾「正常」、沒有留下數字的項目
// 拿不出可以比較的東西就不顯示，避免每個項目下面都出現沒有資訊量的「正常」紀錄。
const entry = computed(() => {
  const found = previousFor?.(props.item, props.type || props.item.type) ?? null;
  return found && String(found.value ?? '').trim() ? found : null;
});

const valueText = computed(() => (entry.value ? String(entry.value.value).trim() : ''));
const unitText = computed(() => String(entry.value?.unit ?? '').trim());
const isAbnormal = computed(() => entry.value?.status === 'abnormal');

// 日期、健檢種類、備註各自是一種資訊，分開排版才有層次；
// 全部串成一行只會變成一條看不出重點的灰字。
const dateText = computed(() => (entry.value?.visitDate ? formatDate(entry.value.visitDate, '') : ''));
const examTypeText = computed(() => String(entry.value?.examType ?? '').trim());
const noteText = computed(() => String(entry.value?.note ?? '').trim());
const tooltip = computed(() => {
  if (!entry.value) return '';
  const parts = [dateText.value, examTypeText.value, noteText.value].filter(Boolean).join('・');
  return `上次紀錄・${parts}（開新分頁查看該份報告）`;
});
</script>

<template>
  <!-- 前次紀錄是本次輸入的比較資料，不另做巢狀卡片。桌機表格使用獨立欄位，
       窄版與量測欄位則收成輸入框下方的一行；連結一律開新分頁，保留未儲存草稿。 -->
  <router-link
    v-if="entry"
    :to="{ name: 'record-preview', params: { id: entry.recordId } }"
    target="_blank"
    rel="noopener"
    :title="tooltip"
    class="group min-w-0 text-xs transition-colors focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    :class="[
      compact ? 'mt-1.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5' : 'block',
      isAbnormal ? 'text-danger' : 'text-muted-foreground hover:text-primary',
    ]"
  >
    <template v-if="compact">
      <span v-if="showLabel" class="shrink-0 font-medium text-muted-foreground">前次</span>
      <strong class="min-w-0 truncate text-sm font-semibold tabular-nums" :class="isAbnormal ? 'text-danger' : 'text-foreground group-hover:text-primary'">{{ valueText }}</strong>
      <span v-if="unitText" class="shrink-0 text-muted-foreground">{{ unitText }}</span>
      <span v-if="dateText" class="shrink-0 tabular-nums text-muted-foreground">· {{ dateText }}</span>
      <span v-if="isAbnormal" class="shrink-0 font-medium text-danger">異常</span>
      <ExternalLink class="size-3 shrink-0 self-center text-muted-foreground/70" stroke-width="1.75" aria-hidden="true" />
    </template>

    <template v-else>
      <span v-if="showLabel" class="block font-medium text-muted-foreground">前次數值</span>
      <span class="mt-1 flex min-w-0 items-baseline gap-1.5">
        <strong class="truncate text-sm font-semibold tabular-nums" :class="isAbnormal ? 'text-danger' : 'text-foreground group-hover:text-primary'">{{ valueText }}</strong>
        <span v-if="unitText" class="shrink-0 text-muted-foreground">{{ unitText }}</span>
        <span v-if="isAbnormal" class="shrink-0 font-medium text-danger">異常</span>
      </span>
      <span v-if="dateText" class="mt-0.5 flex items-center gap-1 tabular-nums text-muted-foreground">
        {{ dateText }}
        <ExternalLink class="size-3 shrink-0 text-muted-foreground/70" stroke-width="1.75" aria-hidden="true" />
      </span>
    </template>
    <span class="sr-only">開新分頁查看這份報告</span>
  </router-link>
</template>
