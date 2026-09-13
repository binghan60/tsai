<script setup>
import { RadioGroupRoot, useForwardPropsEmits } from 'reka-ui';

const props = defineProps({
  defaultValue: { type: null, required: false },
  modelValue: { type: null, required: false },
  disabled: { type: Boolean, required: false },
  required: { type: Boolean, required: false },
  name: { type: String, required: false },
  orientation: { type: String, required: false, default: 'vertical' },
  dir: { type: String, required: false },
  loop: { type: Boolean, required: false },
  asChild: { type: Boolean, required: false },
  as: { type: null, required: false },
});
const emits = defineEmits(['update:modelValue']);
const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <RadioGroupRoot data-slot="radio-group" v-bind="forwarded"><slot /></RadioGroupRoot>
</template>
