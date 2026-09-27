<script setup>
import { reactiveOmit } from '@vueuse/core';
import { DropdownMenuContent, DropdownMenuPortal, useForwardPropsEmits } from 'reka-ui';
import { cn } from '@/lib/utils';

const props = defineProps({
  side: { type: null, required: false, default: 'bottom' },
  sideOffset: { type: Number, required: false, default: 6 },
  align: { type: null, required: false, default: 'end' },
  alignOffset: { type: Number, required: false },
  avoidCollisions: { type: Boolean, required: false, default: true },
  class: { type: [Boolean, null, String, Object, Array], required: false, skipCheck: true },
});
const emits = defineEmits(['escapeKeyDown', 'pointerDownOutside', 'focusOutside', 'interactOutside', 'closeAutoFocus']);

const delegatedProps = reactiveOmit(props, 'class');
const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <DropdownMenuPortal>
    <DropdownMenuContent
      data-slot="dropdown-menu-content"
      v-bind="forwarded"
      :class="cn(
        'z-50 min-w-48 overflow-hidden rounded-xl border border-border bg-popover p-1 text-base text-popover-foreground shadow-menu outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2',
        props.class,
      )"
    >
      <slot />
    </DropdownMenuContent>
  </DropdownMenuPortal>
</template>
