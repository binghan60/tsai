<script setup>
import { computed } from 'vue';
import { hasContent } from './reportItem';
import ReportField from './ReportField.vue';

const props = defineProps({ section: { type: Object, required: true } });

const filled = computed(() => (props.section.items ?? []).filter(hasContent));
</script>

<template>
  <section v-if="filled.length" class="mt-8 space-y-5 break-inside-avoid">
    <h2 class="text-sm font-semibold text-brand-700">{{ section.title }}</h2>
    <ReportField v-for="item in filled" :key="item.key" :item="item" />
  </section>
</template>
