<script setup>
import { ArrowRight, Check } from '@lucide/vue';

const props = defineProps({
  title: { type: String, required: true },
  actionLabel: { type: String, default: '選擇' },
  ariaLabel: { type: String, default: '' },
  selected: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
});

const emit = defineEmits(['select']);
</script>

<template>
  <button
    type="button"
    class="group flex min-h-16 w-full items-center gap-3 rounded-xl border px-4 py-3 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px active:shadow-none disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none"
    :class="selected ? 'border-primary bg-accent' : 'border-border bg-card hover:border-primary/35 hover:bg-accent/40'"
    :disabled="disabled"
    :aria-label="ariaLabel || `${actionLabel}${title}`"
    :aria-pressed="selected || undefined"
    @click="emit('select')"
  >
    <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground transition-colors group-hover:bg-primary/15 group-hover:text-primary">
      <slot name="icon" />
    </span>

    <span class="min-w-0 flex-1">
      <span class="block truncate text-sm font-medium text-foreground">{{ title }}</span>
      <span class="mt-0.5 block min-w-0 text-xs text-muted-foreground">
        <slot name="description" />
      </span>
    </span>

    <span
      class="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors"
      :class="selected ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground group-hover:bg-primary/15 group-hover:text-primary'"
      aria-hidden="true"
    >
      <template v-if="selected">
        <Check class="h-4 w-4" stroke-width="1.75" />已選取
      </template>
      <template v-else>
        {{ actionLabel }}<ArrowRight class="h-4 w-4" stroke-width="1.75" />
      </template>
    </span>
  </button>
</template>
