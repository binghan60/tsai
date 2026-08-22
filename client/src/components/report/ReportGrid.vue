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
    <dl v-if="measured.length" class="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-px overflow-hidden rounded-xl border border-stone-200 bg-stone-200">
      <div v-for="item in measured" :key="item.key" class="bg-white p-3 text-center" :class="spanClass(item, 'report')">
        <dt class="text-xs text-stone-500">{{ item.label }}</dt>
        <dd class="mt-1 text-sm font-semibold text-stone-900">{{ item.display }}</dd>
        <dd
          v-if="item.status && item.status !== 'not_checked'"
          class="mt-1 text-xs font-medium"
          :class="item.status === 'abnormal' ? 'text-red-700' : 'text-emerald-700'"
        >{{ item.status === 'abnormal' ? '異常' : '正常' }}・自動</dd>
        <dd v-if="referenceLabel(item)" class="mt-0.5 text-xs text-stone-500">參考 {{ referenceLabel(item) }}</dd>
        <dd v-if="previousMeasurementLabel(item)" class="mt-1 border-t border-stone-100 pt-1 text-[11px] text-stone-500">
          ↺ 上次 {{ previousMeasurementLabel(item) }}
          <span v-if="previousDateLabel(item)" class="block text-[10px] text-stone-400">({{ previousDateLabel(item) }})</span>
        </dd>
      </div>
    </dl>
    <div v-if="others.length" class="mt-4 grid gap-4 sm:grid-cols-2">
      <ReportField v-for="item in others" :key="item.key" :item="item" :class="spanClass(item, 'report')" />
    </div>
  </section>
</template>
