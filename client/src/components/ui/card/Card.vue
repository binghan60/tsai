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
        // 原本是 ring-1 ring-foreground/10。改成真的 border 有兩個原因：
        // 一、ring 是額外一圈 box-shadow，和使用端想加的 border 視覺上會疊成兩圈；
        // 二、使用端普遍寫 border-border 想換邊框色，但那只設顏色不設寬度，
        //     在沒有 border 寬度的 Card 上完全不生效——全站只有工作台統計卡
        //     因為多寫了一個 border 才有邊框，這是各頁長得不像同一套系統的主因。
        'border border-border bg-card text-card-foreground gap-4 overflow-hidden rounded-xl py-4 text-sm has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:gap-3 data-[size=sm]:py-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl group/card flex flex-col',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
