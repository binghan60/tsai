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
    :class="cn('relative z-10 flex flex-col gap-1 px-6 pt-5 pb-4 pr-16', props.class)"
  >
    <slot />
  </div>
</template>
