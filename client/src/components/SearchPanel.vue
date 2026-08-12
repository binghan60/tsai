<script setup>
import { Search } from '@lucide/vue';
import { Card } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';

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
  <Card class="border-cream-300 p-3 shadow-sm dark:border-zinc-800 dark:shadow-none">
    <Label :for="id" class="sr-only">{{ label }}</Label>
    <div class="relative">
      <Search class="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-400 dark:text-zinc-400" stroke-width="1.75" aria-hidden="true" />
      <Input
        :id="id"
        :model-value="modelValue"
        type="search"
        autocomplete="off"
        :placeholder="placeholder"
        class="min-h-11 w-full pl-11"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </div>
    <p v-if="loading" class="mt-2 px-1 text-xs text-ink-400 dark:text-zinc-400" role="status">搜尋中…</p>
    <p v-else-if="error" class="mt-2 px-1 text-xs text-red-700 dark:text-red-300">{{ error }}</p>
    <slot />
  </Card>
</template>
