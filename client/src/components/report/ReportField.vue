<script setup>
import { computed } from 'vue';
import { labValueLabel, measurementLabel, statusText, valueText } from './reportItem';
import { familyOf } from '../../lib/fieldFamily';
import DentalChart from '../formfields/DentalChart.vue';

// 任何欄位型別都可能出現在任何版式的區塊裡。這是「不在原生版式裡」時的通用呈現：
// 一個標籤加一段內容，塞得進報告的任何容器。
const props = defineProps({ item: { type: Object, required: true } });

const family = computed(() => familyOf(props.item));
const images = computed(() => Array.isArray(props.item.value)
  ? props.item.value.filter((image) => image?.url)
  : []);
const imageSpanClass = (image) => ({ 4: 'col-span-4', 6: 'col-span-6', 12: 'col-span-12' }[Number(image?.span)] ?? 'col-span-12');

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
  <div v-if="item.type === 'image'" class="break-inside-avoid sm:col-span-2">
    <h3 class="text-xs font-semibold text-stone-500">{{ item.label }}</h3>
    <div v-if="images.length" class="mt-2 grid grid-cols-12 gap-4">
      <a v-for="(image, index) in images" :key="image.publicId || image.url" :href="image.url" target="_blank" rel="noopener noreferrer" class="block" :class="imageSpanClass(image)">
        <img :src="image.url" :alt="`${item.label}圖片 ${index + 1}`" class="block h-auto w-full bg-stone-50" />
        <p v-if="image.caption" class="pt-2 whitespace-pre-wrap text-sm leading-relaxed text-stone-700">{{ image.caption }}</p>
      </a>
    </div>
  </div>
  <div v-if="family === 'dental'" class="break-inside-avoid sm:col-span-2">
    <h3 class="text-xs font-semibold text-stone-500">{{ item.label }}</h3>
    <DentalChart class="mt-2" :model-value="item.value" readonly />
  </div>
  <div v-else-if="item.type !== 'image'" class="break-inside-avoid">
    <h3 class="text-xs font-semibold text-stone-500">{{ item.label }}</h3>
    <p
      class="mt-1 whitespace-pre-wrap text-sm leading-relaxed"
      :class="abnormal ? 'text-red-700' : 'text-stone-700'"
    >{{ text }}</p>
    <p v-if="item.note" class="mt-0.5 whitespace-pre-wrap text-xs text-stone-600">{{ item.note }}</p>
  </div>
</template>
