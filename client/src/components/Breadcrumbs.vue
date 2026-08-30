<script setup>
import { ChevronRight } from '@lucide/vue';

defineProps({
  items: {
    type: Array,
    required: true,
  },
});
</script>

<template>
  <nav aria-label="麵包屑" class="inline-flex max-w-full overflow-x-auto rounded-xl border border-border/80 bg-card/85 p-1.5 text-sm shadow-sm">
    <ol class="flex min-w-max items-center gap-1 text-muted-foreground">
      <li v-for="(item, index) in items" :key="`${item.label}-${index}`" class="flex items-center gap-1.5">
        <ChevronRight v-if="index" aria-hidden="true" class="h-3.5 w-3.5 shrink-0 text-border" stroke-width="2" />
        <router-link v-if="item.to" :to="item.to" class="rounded-lg px-2 py-1 font-medium text-primary outline-none transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring">
          {{ item.label }}
        </router-link>
        <span v-else aria-current="page" class="max-w-56 truncate rounded-lg bg-accent px-2 py-1 font-semibold text-accent-foreground shadow-[inset_0_0_0_1px_hsl(var(--border)/0.45)] sm:max-w-sm">
          {{ item.label }}
        </span>
      </li>
    </ol>
  </nav>
</template>
