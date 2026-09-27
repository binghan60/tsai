<script setup>
import { useVModel } from "@vueuse/core";
import { cn } from "@/lib/utils";

const props = defineProps({
  defaultValue: { type: [String, Number], required: false },
  modelValue: { type: [String, Number], required: false },
  class: {
    type: [Boolean, null, String, Object, Array],
    required: false,
    skipCheck: true,
  },
});

const emits = defineEmits(["update:modelValue"]);

const modelValue = useVModel(props, "modelValue", emits, {
  passive: true,
  defaultValue: props.defaultValue,
});
</script>

<template>
  <input
    v-model="modelValue"
    data-slot="input"
    :class="
      cn(
        // 40px 高、18px 字；淺色白底配深邊框，深色下凹一階。聚焦是主色邊框＋3px 光圈。
        'border-input bg-field text-foreground focus-visible:border-primary focus-visible:ring-focus-ring aria-invalid:ring-destructive/15 aria-invalid:border-destructive disabled:bg-sunken disabled:text-subtle-foreground h-10 rounded-lg border px-3 py-1 text-base transition-[border-color,box-shadow] file:h-6 file:text-sm file:font-medium focus-visible:ring-3 aria-invalid:ring-3 w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent file:text-foreground placeholder:text-subtle-foreground disabled:pointer-events-none disabled:cursor-not-allowed',
        props.class,
      )
    "
  />
</template>
