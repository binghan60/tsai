<script setup>
import { Check } from '@lucide/vue';
import { reactiveOmit } from '@vueuse/core';
import { CheckboxIndicator, CheckboxRoot, useForwardPropsEmits } from 'reka-ui';
import { cn } from '@/lib/utils';

const props = defineProps({
  defaultValue: { type: [Boolean, String], required: false },
  modelValue: { type: [Boolean, String], required: false },
  disabled: { type: Boolean, required: false },
  required: { type: Boolean, required: false },
  name: { type: String, required: false },
  value: { type: String, required: false },
  id: { type: String, required: false },
  asChild: { type: Boolean, required: false },
  as: { type: null, required: false },
  class: { type: [Boolean, null, String, Object, Array], required: false, skipCheck: true },
});
const emits = defineEmits(['update:modelValue']);
const forwarded = useForwardPropsEmits(reactiveOmit(props, 'class'), emits);
</script>

<template>
  <CheckboxRoot
    data-slot="checkbox"
    v-bind="forwarded"
    :class="cn('border-input bg-field data-[state=checked]:border-primary data-[state=checked]:bg-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 size-4 shrink-0 rounded-[4px] border shadow-xs transition-colors focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50', props.class)"
  >
    <CheckboxIndicator data-slot="checkbox-indicator" class="flex size-full items-center justify-center text-primary-foreground">
      <slot name="indicator"><Check class="size-3.5" stroke-width="3" /></slot>
    </CheckboxIndicator>
  </CheckboxRoot>
</template>
