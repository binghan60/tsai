<script setup>
import { Label } from '../ui/label';
import PreviousValue from './PreviousValue.vue';

defineProps({
  item: { type: Object, required: true },
  inputId: { type: String, required: true },
});
</script>

<template>
  <div class="space-y-1.5">
    <div class="flex items-center gap-2">
      <Label :id="`${inputId}-label`" :for="inputId" class="text-xs font-medium text-muted-foreground">
        {{ item.label }}
        <span v-if="item.unit" class="text-muted-foreground">（{{ item.unit }}）</span>
        <template v-if="item.required">
          <span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span>
        </template>
      </Label>
      <!-- 標籤列右上角的動作（藥櫃鈕）。 -->
      <div v-if="$slots['label-action']" class="ml-auto"><slot name="label-action" /></div>
    </div>
    <slot />
    <PreviousValue :item="item" compact />
  </div>
</template>
