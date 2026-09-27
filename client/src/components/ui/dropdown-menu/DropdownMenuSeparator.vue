<script setup>
import { DropdownMenuSeparator } from 'reka-ui';
import { cn } from '@/lib/utils';

const props = defineProps({
  class: { type: [Boolean, null, String, Object, Array], required: false, skipCheck: true },
});
</script>

<template>
  <DropdownMenuSeparator data-slot="dropdown-menu-separator" :class="cn('-mx-1 my-1 h-px bg-border', props.class)" />
</template>
