<script setup>
import { Label } from '../ui/label';

defineProps({
  item: { type: Object, required: true },
  inputId: { type: String, required: true },
});
</script>

<template>
  <div class="space-y-1.5">
    <Label :id="`${inputId}-label`" :for="inputId" class="text-xs font-medium text-ink-500 dark:text-zinc-400">
      {{ item.label }}
      <span v-if="item.unit" class="text-ink-400 dark:text-zinc-500">（{{ item.unit }}）</span>
      <template v-if="item.required">
        <span class="text-red-600 dark:text-red-400" aria-hidden="true">*</span><span class="sr-only">必填</span>
      </template>
    </Label>
    <slot />
  </div>
</template>
