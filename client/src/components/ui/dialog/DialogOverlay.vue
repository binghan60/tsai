<script setup>
import { reactiveOmit } from "@vueuse/core";
import { DialogOverlay } from "reka-ui";
import { cn } from "@/lib/utils";

const props = defineProps({
  forceMount: { type: Boolean, required: false },
  asChild: { type: Boolean, required: false },
  as: { type: null, required: false },
  class: {
    type: [Boolean, null, String, Object, Array],
    required: false,
    skipCheck: true,
  },
});

const delegatedProps = reactiveOmit(props, "class");

// 純色遮罩，不帶任何 backdrop-filter。全螢幕的 backdrop blur 要每一幀把底下
// 整個畫面重新模糊一次，是開關對話框最貴的一筆；純色只要合成一次，
// 之後的淡入淡出純粹是 opacity 動畫，完全交給 GPU。
// 少了模糊帶來的景深，改用更深的底色維持前後層次。
const OVERLAY_CLASS = 'fixed inset-0 z-50 bg-ink-900/60 dark:bg-black/70 data-open:animate-in data-open:fade-in-0 data-open:duration-150 data-closed:animate-out data-closed:fade-out-0 data-closed:duration-100';
</script>

<template>
  <DialogOverlay
    data-slot="dialog-overlay"
    v-bind="delegatedProps"
    :class="cn(OVERLAY_CLASS, props.class)"
  >
    <slot />
  </DialogOverlay>
</template>
