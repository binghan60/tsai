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
});

const { previousFor } = useRecordForm();
// 只有真的量到數值（或填了結果描述）才值得顯示。上次只是打勾「正常」、沒有留下數字的項目
// 拿不出可以比較的東西，整張卡片跳過，免得每個項目下面都掛一張沒有資訊量的「正常」卡片。
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
  <!-- 整張卡片就是連往那份報告的連結。一律開新分頁 —— 填到一半的草稿不該因為
       「想看一下上次的報告」被迫離開頁面，跳出未儲存提醒。 -->
  <router-link
    v-if="entry"
    :to="{ name: 'record-preview', params: { id: entry.recordId } }"
    target="_blank"
    rel="noopener"
    :title="tooltip"
    class="group mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    :class="isAbnormal
      ? 'border-danger/35 bg-danger-surface/70 hover:border-danger/55 hover:bg-danger-surface'
      : 'border-border/80 bg-muted/30 hover:border-primary hover:bg-accent'"
  >
    <span v-if="showLabel" class="shrink-0 font-medium text-muted-foreground">上次</span>
    <span class="flex min-w-0 items-baseline gap-1">
      <span
        class="truncate text-sm font-semibold tabular-nums"
        :class="isAbnormal ? 'text-danger' : 'text-foreground '"
      >{{ valueText }}</span>
      <span v-if="unitText" class="shrink-0 text-xs text-muted-foreground">{{ unitText }}</span>
    </span>
    <span v-if="isAbnormal" class="shrink-0 rounded-full bg-danger-surface px-1.5 py-0.5 font-medium text-danger">異常</span>
    <span v-if="dateText" class="shrink-0 tabular-nums text-muted-foreground">{{ dateText }}</span>
    <span v-if="examTypeText" class="min-w-0 truncate text-muted-foreground">{{ examTypeText }}</span>
    <span v-if="noteText" class="min-w-0 truncate text-muted-foreground">· {{ noteText }}</span>
    <ExternalLink class="ml-auto size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" stroke-width="1.75" aria-hidden="true" />
    <span class="sr-only">開新分頁查看這份報告</span>
  </router-link>
</template>
