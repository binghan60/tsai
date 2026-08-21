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
    class="group mt-2 block min-w-0 rounded-xl border px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    :class="isAbnormal
      ? 'border-red-200 bg-red-50/70 hover:border-red-300 hover:bg-red-50 dark:border-red-900/60 dark:bg-red-950/25 dark:hover:border-red-800 dark:hover:bg-red-950/40'
      : 'border-border bg-field/70 hover:border-belle-500 hover:bg-belle-50   dark:hover:border-brand-500/50 dark:hover:bg-brand-500/5'"
  >
    <!-- 先交代這是哪一次健檢，再給數值：不知道是什麼時候量的，數字本身沒有意義。 -->
    <span class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span v-if="dateText" class="shrink-0 tabular-nums">{{ dateText }}</span>
      <span
        v-if="examTypeText"
        class="min-w-0 truncate rounded-full bg-muted/60 px-1.5 py-0.5 font-medium text-muted-foreground"
      >{{ examTypeText }}</span>
      <ExternalLink
        class="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-belle-600 dark:text-muted-foreground dark:group-hover:text-brand-400"
        stroke-width="1.75"
      />
    </span>
    <!-- 數值是這張卡片的主角：字級比說明大一階，數字等寬才不會在多列之間跳動。 -->
    <span class="mt-1 flex min-w-0 items-baseline gap-1.5">
      <span
        class="truncate text-sm font-semibold tabular-nums"
        :class="isAbnormal ? 'text-red-600 dark:text-red-400' : 'text-foreground '"
      >{{ valueText }}</span>
      <span v-if="unitText" class="shrink-0 text-xs text-muted-foreground">{{ unitText }}</span>
      <span
        v-if="isAbnormal"
        class="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950/60 dark:text-red-300"
      >異常</span>
    </span>
    <span v-if="noteText" class="mt-1 block truncate text-xs text-muted-foreground">{{ noteText }}</span>
    <span class="sr-only">開新分頁查看這份報告</span>
  </router-link>
</template>
