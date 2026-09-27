<script setup>
import { DropdownMenuLabel } from 'reka-ui';
import { cn } from '@/lib/utils';

const props = defineProps({
  class: { type: [Boolean, null, String, Object, Array], required: false, skipCheck: true },
});
</script>

<template>
  <DropdownMenuLabel data-slot="dropdown-menu-label" :class="cn('spec-label px-3 pt-2 pb-1', props.class)">
    <slot />
  </DropdownMenuLabel>
</template>
