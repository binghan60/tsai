<script setup>
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
});
</script>

<template>
  <section class="mx-auto max-w-7xl space-y-5">
    <div class="min-w-0 space-y-5">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-xl font-semibold text-foreground">{{ title }}</h1>
          <p v-if="description" class="mt-1 text-sm text-muted-foreground">{{ description }}</p>
        </div>
        <slot name="actions" />
      </div>

      <slot />
    </div>
  </section>
</template>
