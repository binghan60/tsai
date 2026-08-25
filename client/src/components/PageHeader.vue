<script setup>
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
});
</script>

<template>
  <header class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
    <div class="min-w-0">
      <h1 class="text-xl font-semibold text-foreground">{{ title }}</h1>
      <p v-if="description" class="mt-1 max-w-3xl text-sm text-muted-foreground">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="flex w-full shrink-0 flex-wrap items-center gap-2 md:w-auto md:justify-end">
      <slot name="actions" />
    </div>
  </header>
</template>
