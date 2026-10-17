<script setup>
import { useVModel } from "@vueuse/core";
import { cn } from "@/lib/utils";

const props = defineProps({
  class: {
    type: [Boolean, null, String, Object, Array],
    required: false,
    skipCheck: true,
  },
  defaultValue: { type: [String, Number], required: false },
  modelValue: { type: [String, Number], required: false },
});

const emits = defineEmits(["update:modelValue"]);

const modelValue = useVModel(props, "modelValue", emits, {
  passive: true,
  defaultValue: props.defaultValue,
});
</script>

<template>
  <textarea
    v-model="modelValue"
    data-slot="textarea"
    :class="
      cn(
        'border-input bg-field text-foreground focus-visible:border-focus-border aria-invalid:ring-destructive/15 aria-invalid:border-destructive disabled:bg-sunken disabled:text-subtle-foreground rounded-lg border px-3 py-2 text-base leading-relaxed transition-[border-color,box-shadow] aria-invalid:ring-3 flex field-sizing-content min-h-24 min-w-0 w-full max-w-full outline-none placeholder:text-subtle-foreground disabled:cursor-not-allowed',
        props.class,
      )
    "
  />
</template>
