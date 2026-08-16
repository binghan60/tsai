<script setup>
import { reactiveOmit } from "@vueuse/core";
import { DialogTitle, useForwardProps } from "reka-ui";
import { cn } from "@/lib/utils";

const props = defineProps({
  asChild: { type: Boolean, required: false },
  as: { type: null, required: false },
  class: {
    type: [Boolean, null, String, Object, Array],
    required: false,
    skipCheck: true,
  },
});

const delegatedProps = reactiveOmit(props, "class");

const forwardedProps = useForwardProps(delegatedProps);

// 對話框標題對到 CLAUDE.md 字級表的 H2（區塊標題）——
// 對話框是覆蓋層而不是頁面，最高標題不佔 H1。
// 原本的 text-lg／sm:text-xl 不在那張表的任何一層。
const TITLE_CLASS = 'text-base font-semibold tracking-tight text-ink-900 dark:text-white';
</script>

<template>
  <DialogTitle
    data-slot="dialog-title"
    v-bind="forwardedProps"
    :class="cn(TITLE_CLASS, props.class)"
  >
    <slot />
  </DialogTitle>
</template>
