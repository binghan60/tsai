<script setup>
import PageHeader from './PageHeader.vue';

// 設定頁（表單管理、文字模板、預填模板）共用的外框：跟其他清單頁同一個頁首。
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  count: { type: [Number, String], default: null },
  unit: { type: String, default: '' },
});
</script>

<template>
  <section class="flex flex-col gap-5">
    <PageHeader :title="title" :description="description" :count="count" :unit="unit">
      <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    </PageHeader>
    <slot />
  </section>
</template>
