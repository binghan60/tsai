<script setup>
import { computed } from 'vue';
import { hasContent } from './reportItem';
import { spanClass } from '../../lib/fieldSpan';
import ReportField from './ReportField.vue';

const props = defineProps({ section: { type: Object, required: true } });

// 沒填的欄位不進報告，否則飼主看到的 PDF 上會留下一個只有標題的空欄位。
const items = computed(() => (props.section.items ?? []).filter(hasContent));
</script>

<template>
  <section v-if="items.length" class="mt-8 break-inside-avoid">
    <h2 class="mb-3 text-sm font-semibold text-brand-700">{{ section.title }}</h2>
    <div class="grid gap-5 rounded-xl border border-stone-200 p-4 sm:grid-cols-2">
      <ReportField v-for="item in items" :key="item.key" :item="item" :class="spanClass(item, 'report')" />
    </div>
  </section>
</template>
