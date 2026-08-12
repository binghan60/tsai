<script setup>
import { cn } from "@/lib/utils";

const props = defineProps({
  class: {
    type: [Boolean, null, String, Object, Array],
    required: false,
    skipCheck: true,
  },
});
</script>

<template>
  <div
    data-slot="dialog-header"
    :class="cn('relative z-10 flex flex-col gap-1.5 p-6 pb-4 pr-12 sm:p-7 sm:pb-4 sm:pr-14', props.class)"
  >
    <slot />
  </div>
</template>
