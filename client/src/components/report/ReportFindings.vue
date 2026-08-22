<script setup>
import { computed } from 'vue';
import { hasContent } from './reportItem';
import ReportField from './ReportField.vue';
import { sectionRuns } from '../../lib/sectionRuns';

const props = defineProps({ section: { type: Object, required: true } });

// 未檢查的項目不列進報告，飼主只需要看到實際檢查過的結果；其他型別沒填的也不列。
// 判斷一律走 hasContent()，否則放進這個區塊的 lab 項目只要沒填數值就會被漏掉。
const visible = computed(() => (props.section.items ?? []).filter(hasContent));
// 依表單上的順序切段落，換過型別的欄位不會跑到報告最後面。
const runs = computed(() => sectionRuns(visible.value, (item) => item.type === 'finding'));
</script>

<template>
  <section v-if="visible.length" class="mt-8 space-y-4">
    <h2 class="text-sm font-semibold text-brand-700">{{ section.title }}</h2>
    <template v-for="run in runs" :key="run.key">
      <div v-if="run.kind === 'primary'" class="overflow-hidden rounded-xl border border-stone-200">
        <div
          v-for="finding in run.items"
          :key="finding.key"
          class="grid break-inside-avoid grid-cols-[1fr_auto] gap-x-0 gap-y-2 border-b border-stone-200 px-4 py-3 text-sm last:border-0 sm:grid-cols-[1fr_1fr_2fr] sm:gap-y-0"
        >
          <span class="min-w-0 pr-3 font-medium text-stone-800">{{ finding.label }}</span>
          <span class="min-w-0 pl-3 sm:border-l sm:border-stone-100" :class="finding.status === 'abnormal' ? 'text-red-700' : 'text-emerald-700'">{{ finding.status === 'abnormal' ? '異常' : '正常' }}</span>
          <span class="col-span-2 min-w-0 whitespace-pre-wrap text-stone-600 sm:col-span-1 sm:border-l sm:border-stone-100 sm:pl-3">{{ finding.note || '' }}</span>
        </div>
      </div>
      <div v-else class="space-y-4">
        <ReportField v-for="item in run.items" :key="item.key" :item="item" />
      </div>
    </template>
  </section>
</template>
