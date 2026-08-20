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
    <Label :id="`${inputId}-label`" :for="inputId" class="text-xs font-medium text-muted-foreground">
      {{ item.label }}
      <span v-if="item.unit" class="text-muted-foreground">（{{ item.unit }}）</span>
      <template v-if="item.required">
        <span class="text-red-600 dark:text-red-400" aria-hidden="true">*</span><span class="sr-only">必填</span>
      </template>
    </Label>
    <slot />
    <!-- 上次的紀錄跟在控制項之後，沒有歷史紀錄時整行不出現。 -->
    <PreviousValue :item="item" />
  </div>
</template>
