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
  <tr
    data-slot="table-row"
    :class="
      cn(
        // hover 原本是 bg-muted/50，但淺色的 --muted 是相當飽和的卡其(#dec99b)，
        // 整列滑過去會變土黃，很突兀。頁面當初只補了深色版的覆寫，淺色沒救。
        // accent 是專門給互動態的柔和色，兩個主題都成立。
        'hover:bg-accent/40 data-[state=selected]:bg-accent/60 border-b border-border transition-colors has-aria-expanded:bg-accent/40',
        props.class,
      )
    "
  >
    <slot />
  </tr>
</template>
