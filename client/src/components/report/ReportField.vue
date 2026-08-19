<script setup>
import { computed } from 'vue';
import { labValueLabel, measurementLabel, referenceLabel, statusText, valueText } from './reportItem';
import { familyOf } from '../../lib/fieldFamily';

// 任何欄位型別都可能出現在任何版式的區塊裡。這是「不在原生版式裡」時的通用呈現：
// 一個標籤加一段內容，塞得進報告的任何容器。
const props = defineProps({ item: { type: Object, required: true } });

const family = computed(() => familyOf(props.item));

const text = computed(() => {
  const item = props.item;
  if (family.value === 'finding') return statusText(item.status);
  if (family.value === 'lab') {
    const value = labValueLabel(item);
    return value === '' ? statusText(item.status) : `${statusText(item.status)}・${value}`;
  }
  if (family.value === 'measurement') return measurementLabel(item) ?? '';
  return valueText(item);
});

const abnormal = computed(() => props.item.status === 'abnormal');
</script>

<template>
  <div class="break-inside-avoid">
    <h3 class="text-xs font-semibold text-stone-500">{{ item.label }}</h3>
    <p
      class="mt-1 whitespace-pre-wrap text-sm leading-relaxed"
      :class="abnormal ? 'text-red-700' : 'text-stone-700'"
    >{{ text }}</p>
    <p v-if="referenceLabel(item)" class="mt-0.5 text-[11px] text-stone-500">參考 {{ referenceLabel(item) }}</p>
    <p v-if="item.note" class="mt-0.5 whitespace-pre-wrap text-xs text-stone-600">{{ item.note }}</p>
  </div>
</template>
