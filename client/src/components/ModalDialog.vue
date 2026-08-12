<script setup>
import { Dialog, DialogContent } from './ui/dialog';

defineProps({
  contentClass: { type: String, default: 'sm:max-w-md' },
});
const emit = defineEmits(['close']);
</script>

<template>
  <Dialog :open="true" @update:open="(value) => !value && emit('close')">
    <DialogContent :class="['max-h-[85vh] overflow-y-auto', contentClass]">
      <slot />
    </DialogContent>
  </Dialog>
</template>
