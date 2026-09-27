<script setup>
// 規格欄：一排「小標題在上、值在下」的格子，格子之間一條細線。
// 用在工作區、處理視窗、貓咪詳情的標頭，取代「米克斯 · 公 · 已結紮 · 6 歲」那種一行串接。
// 內容放 <SpecCell label="…">值</SpecCell>。
</script>

<template>
  <div class="flex flex-wrap items-stretch gap-y-2 [&>*]:px-4 [&>*:first-child]:pl-0 [&>*+*]:border-l [&>*+*]:border-border">
    <slot />
  </div>
</template>
