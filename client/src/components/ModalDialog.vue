<script setup>
import { Dialog, DialogContent } from './ui/dialog';

defineProps({
  contentClass: { type: String, default: 'sm:max-w-md' },
});
const emit = defineEmits(['close']);
</script>

<template>
  <Dialog :open="true" @update:open="(value) => !value && emit('close')">
    <DialogContent :class="['max-h-[90vh] flex flex-col p-0', contentClass]">
      <div class="relative flex max-h-[90vh] flex-col overflow-y-auto">
        <slot />
      </div>
    </DialogContent>
  </Dialog>
</template>
