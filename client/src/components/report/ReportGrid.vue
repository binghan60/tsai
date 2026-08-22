<script setup>
import { computed } from 'vue';
import { hasContent, measurementLabel, previousDateLabel, previousMeasurementLabel, referenceLabel } from './reportItem';
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
    <div v-if="measured.length" class="overflow-hidden rounded-xl border border-stone-200">
      <div class="hidden border-b border-stone-200 bg-stone-50/80 px-4 py-2 text-xs font-semibold text-stone-500 sm:grid sm:grid-cols-[1fr_2fr_2fr]">
        <span>項目名稱</span>
        <span class="border-l border-stone-200 pl-2">本次數值</span>
        <span class="border-l border-stone-200 pl-2">上次數值</span>
      </div>
      <div
        v-for="item in measured"
        :key="item.key"
        class="grid grid-cols-[1fr_auto] gap-x-0 gap-y-2 border-b border-stone-200 px-4 py-3 text-sm last:border-0 sm:grid-cols-[1fr_2fr_2fr] sm:gap-y-0"
      >
        <span class="min-w-0 pr-2 font-medium text-stone-800">{{ item.label }}</span>
        <span class="min-w-0 border-stone-100 pl-2 text-stone-700 sm:border-l">
          <strong class="font-medium">{{ item.display }}</strong>
          <small v-if="referenceLabel(item)" class="mt-0.5 block text-xs text-stone-500">參考 {{ referenceLabel(item) }}</small>
        </span>
        <span class="col-span-2 min-w-0 border-stone-100 text-stone-700 sm:col-span-1 sm:border-l sm:pl-2">
          <template v-if="previousMeasurementLabel(item)">
            <strong class="font-medium">{{ previousMeasurementLabel(item) }}</strong>
            <small v-if="previousDateLabel(item)" class="ml-1 text-xs text-stone-500">({{ previousDateLabel(item) }})</small>
          </template>
        </span>
      </div>
    </div>
    <div v-if="others.length" class="mt-4 grid gap-4 sm:grid-cols-2">
      <ReportField v-for="item in others" :key="item.key" :item="item" :class="spanClass(item, 'report')" />
    </div>
  </section>
</template>
