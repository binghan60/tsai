<script setup>
import PageHeader from './PageHeader.vue';

defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
});
</script>

<template>
  <section class="space-y-5">
    <div class="min-w-0 space-y-5">
      <PageHeader :title="title" :description="description">
        <template v-if="$slots.actions" #actions><slot name="actions" /></template>
      </PageHeader>

      <slot />
    </div>
  </section>
</template>
