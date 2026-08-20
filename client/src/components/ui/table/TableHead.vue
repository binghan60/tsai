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
  <th
    data-slot="table-head"
    :class="
      cn(
        // 原本是 text-foreground，字級字色都跟內文一樣，表頭整個沉進資料裡。
        // 表頭的層級訊號改由「底色 + 弱化文字色」承擔，而不是靠加粗——
        // 加粗會跟儲存格裡本來就有的 font-medium 打架。
        // sticky 是因為一頁 25 筆捲到一半就看不到欄位名了。
        'bg-muted/40 text-muted-foreground sticky top-0 z-10 h-11 px-5 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0',
        props.class,
      )
    "
  >
    <slot />
  </th>
</template>
