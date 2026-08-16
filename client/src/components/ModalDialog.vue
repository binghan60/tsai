<script setup>
import { Dialog, DialogContent } from './ui/dialog';

defineProps({
  contentClass: { type: String, default: 'sm:max-w-md' },
});
const emit = defineEmits(['close']);
</script>

<template>
  <Dialog :open="true" @update:open="(value) => !value && emit('close')">
    <!-- 兩層是刻意的：外層 DialogContent 不捲動，關閉鈕與頂部漸層條這些
         absolute 裝飾才會固定在原位；捲動一律交給內層這個容器。 -->
    <DialogContent :class="['max-h-[90vh] flex flex-col p-0', contentClass]">
      <div class="relative flex max-h-[90vh] flex-col overflow-y-auto">
        <slot />
      </div>
    </DialogContent>
  </Dialog>
</template>
