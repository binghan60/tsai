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
  <td
    data-slot="table-cell"
    :class="
      cn(
        // px-5 py-3 原本是每個使用點各自寫一次（單 RecordsListPage 就重複 12 次），
        // 收進元件層之後頁面只在真的要破例時才覆寫。
        'px-5 py-3 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0',
        props.class,
      )
    "
  >
    <slot />
  </td>
</template>
