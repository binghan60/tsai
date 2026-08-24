<script setup>
import { PopoverTrigger } from 'reka-ui';

defineProps({
  disabled: { type: Boolean, required: false },
  asChild: { type: Boolean, required: false },
  as: { type: null, required: false },
});
</script>

<template>
  <PopoverTrigger v-bind="$props">
    <slot />
  </PopoverTrigger>
</template>
