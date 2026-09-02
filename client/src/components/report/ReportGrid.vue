<script setup>
import { computed } from 'vue';
import { hasContent, measurementLabel, previousDateLabel, previousMeasurementLabel } from './reportItem';
import { spanClass } from '../../lib/fieldSpan';
import ReportField from './ReportField.vue';
import { familyOf } from '../../lib/fieldFamily';

const props = defineProps({ section: { type: Object, required: true } });

// 只呈現實際量測到的項目，沒填的不佔版面。
const measured = computed(() =>
  (props.section.items ?? [])
    .filter((item) => familyOf(item) === 'measurement')
    .map((item) => ({ ...item, display: measurementLabel(item) }))
    .filter((item) => item.display)
);
// 這個區塊裡的其他型別（文字、理學檢查…）不是數值卡片，接在卡片下方。
// 同樣只留有內容的，沒填的欄位不該在報告上留下一個空白標題。
const others = computed(() => (props.section.items ?? []).filter((item) => familyOf(item) !== 'measurement' && hasContent(item)));
</script>

<template>
  <section v-if="measured.length || others.length" class="mt-8 break-inside-avoid">
    <h2 class="mb-3 text-sm font-semibold text-brand-700">{{ section.title }}</h2>
    <div v-if="measured.length" class="overflow-x-auto rounded-xl border border-report-border">
      <div class="grid min-w-[300px] grid-cols-[1fr_2fr_2fr] border-b border-report-border bg-report-surface-muted/80 px-3 py-1.5 text-xs font-semibold text-report-muted sm:min-w-[640px] sm:px-4 sm:py-2">
        <span>項目名稱</span>
        <span class="border-l border-report-border pl-2">本次數值</span>
        <span class="border-l border-report-border pl-2">上次數值</span>
      </div>
      <div
        v-for="item in measured"
        :key="item.key"
        class="grid min-w-[300px] grid-cols-[1fr_2fr_2fr] gap-x-0 border-b border-report-border px-3 py-2 text-sm last:border-0 sm:min-w-[640px] sm:px-4 sm:py-3"
      >
        <span class="min-w-0 pr-2 font-medium text-report-foreground">{{ item.label }}</span>
        <span class="min-w-0 border-l border-report-canvas pl-2 text-report-text">
          <strong class="font-medium">{{ item.display }}</strong>
        </span>
        <span class="min-w-0 border-l border-report-canvas pl-2 text-report-text">
          <template v-if="previousMeasurementLabel(item)">
            <small class="mr-1 text-xs text-report-subtle sm:hidden">上次</small>
            <strong class="font-medium">{{ previousMeasurementLabel(item) }}</strong>
            <small v-if="previousDateLabel(item)" class="block text-xs text-report-muted sm:ml-1 sm:inline">({{ previousDateLabel(item) }})</small>
          </template>
        </span>
      </div>
    </div>
    <div v-if="others.length" class="mt-4 grid gap-4 sm:grid-cols-2">
      <ReportField v-for="item in others" :key="item.key" :item="item" :class="spanClass(item, 'report')" />
    </div>
  </section>
</template>
