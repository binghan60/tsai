<script setup>
import { Search } from '@lucide/vue';

defineProps({
  id: { type: String, required: true },
  label: { type: String, required: true },
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
});

const emit = defineEmits(['update:modelValue']);
</script>

<template>
  <div class="rounded-2xl border border-cream-300 bg-cream-50 p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
    <label :for="id" class="sr-only">{{ label }}</label>
    <div class="relative">
      <Search class="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-400 dark:text-zinc-400" stroke-width="1.75" aria-hidden="true" />
      <input
        :id="id"
        :value="modelValue"
        type="search"
        autocomplete="off"
        :placeholder="placeholder"
        class="min-h-11 w-full rounded-xl border border-cream-300 bg-white py-2.5 pl-11 pr-4 text-sm text-ink-900 placeholder:text-ink-400 focus:border-belle-500 focus:outline-none focus:ring-2 focus:ring-belle-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-brand-500 dark:focus:ring-brand-500/20"
        @input="emit('update:modelValue', $event.target.value)"
      />
    </div>
    <p v-if="loading" class="mt-2 px-1 text-xs text-ink-400 dark:text-zinc-400" role="status">搜尋中…</p>
    <p v-else-if="error" class="mt-2 px-1 text-xs text-red-700 dark:text-red-300">{{ error }}</p>
    <slot />
  </div>
</template>
