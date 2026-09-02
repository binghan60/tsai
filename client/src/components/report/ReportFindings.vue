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
      <div v-if="run.kind === 'primary'" class="overflow-hidden rounded-xl border border-report-border">
        <div class="hidden border-b border-report-border bg-report-surface-muted/80 px-4 py-2 text-xs font-semibold text-report-muted sm:grid sm:grid-cols-[1fr_2.8rem_3.8fr]">
          <span>項目名稱</span>
          <span class="border-l border-report-border pl-2">結果</span>
          <span class="border-l border-report-border pl-2">備註</span>
        </div>
        <div
          v-for="finding in run.items"
          :key="finding.key"
          class="grid break-inside-avoid grid-cols-[1fr_auto] gap-x-0 gap-y-2 border-b border-report-border px-4 py-3 text-sm last:border-0 sm:grid-cols-[1fr_2.8rem_3.8fr] sm:gap-y-0"
        >
          <span class="min-w-0 pr-2 font-medium text-report-foreground">{{ finding.label }}</span>
          <span
            v-if="finding.status === 'abnormal' || finding.status === 'normal'"
            class="min-w-0 pl-2 sm:border-l sm:border-report-canvas"
            :class="finding.status === 'abnormal' ? 'text-report-danger' : 'text-report-success'"
          >{{ finding.status === 'abnormal' ? '異常' : '正常' }}</span>
          <span v-else class="min-w-0 pl-2 sm:border-l sm:border-report-canvas"></span>
          <span class="col-span-2 min-w-0 whitespace-pre-wrap text-report-text sm:col-span-1 sm:border-l sm:border-report-canvas sm:pl-2">{{ finding.note || '' }}</span>
        </div>
      </div>
      <div v-else class="space-y-4">
        <ReportField v-for="item in run.items" :key="item.key" :item="item" />
      </div>
    </template>
  </section>
</template>
