<script setup>
import { reactiveOmit } from '@vueuse/core';
import { PopoverContent, PopoverPortal, useForwardPropsEmits } from 'reka-ui';
import { cn } from '@/lib/utils';

const props = defineProps({
  forceMount: { type: Boolean, required: false },
  trapFocus: { type: Boolean, required: false },
  side: { type: null, required: false, default: 'bottom' },
  sideOffset: { type: Number, required: false, default: 6 },
  align: { type: null, required: false, default: 'start' },
  alignOffset: { type: Number, required: false },
  avoidCollisions: { type: Boolean, required: false },
  class: { type: [Boolean, null, String, Object, Array], required: false, skipCheck: true },
});
const emits = defineEmits(['escapeKeyDown', 'pointerDownOutside', 'focusOutside', 'interactOutside', 'openAutoFocus', 'closeAutoFocus']);

const delegatedProps = reactiveOmit(props, 'class');
const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <PopoverPortal>
    <PopoverContent
      data-slot="popover-content"
      v-bind="forwarded"
      :class="
        cn(
          'z-50 w-auto rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
          props.class,
        )
      "
    >
      <slot />
    </PopoverContent>
  </PopoverPortal>
</template>
