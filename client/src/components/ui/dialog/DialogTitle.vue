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

// 對話框標題是區塊標題（22px）：對話框是覆蓋層不是頁面，不佔 H1。
const TITLE_CLASS = 'text-lg font-semibold text-foreground';
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
