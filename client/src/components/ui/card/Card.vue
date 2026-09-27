<script setup>
import { cn } from "@/lib/utils";

const props = defineProps({
  class: {
    type: [Boolean, null, String, Object, Array],
    required: false,
    skipCheck: true,
  },
  size: { type: String, required: false, default: "default" },
});
</script>

<template>
  <div
    data-slot="card"
    :data-size="size"
    :class="
      cn(
        // 卡片自己帶邊框與底色，使用端不要再加 border／bg-card。
        // shadow-card 在淺色是 none，深色是一條頂端內側高光。
        'border border-border bg-card text-card-foreground shadow-card gap-4 overflow-hidden rounded-xl py-5 text-base has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:gap-3 data-[size=sm]:py-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl group/card flex flex-col',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
