<script setup>
import { Circle } from '@lucide/vue';
import { reactiveOmit } from '@vueuse/core';
import { RadioGroupIndicator, RadioGroupItem, useForwardProps } from 'reka-ui';
import { cn } from '@/lib/utils';

const props = defineProps({
  value: { type: null, required: true },
  disabled: { type: Boolean, required: false },
  id: { type: String, required: false },
  asChild: { type: Boolean, required: false },
  as: { type: null, required: false },
  class: { type: [Boolean, null, String, Object, Array], required: false, skipCheck: true },
});
const forwarded = useForwardProps(reactiveOmit(props, 'class'));
</script>

<template>
  <RadioGroupItem
    data-slot="radio-group-item"
    v-bind="forwarded"
    :class="cn('border-input bg-field data-[state=checked]:border-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 size-4 shrink-0 rounded-full border shadow-xs transition-colors focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50', props.class)"
  >
    <RadioGroupIndicator data-slot="radio-group-indicator" class="flex size-full items-center justify-center text-primary">
      <slot name="indicator"><Circle class="size-2.5 fill-current" /></slot>
    </RadioGroupIndicator>
  </RadioGroupItem>
</template>
