<script setup>
// 規格欄：一排「小標題在上、值在下」的格子，格子之間一條細線。
// 用在工作區、處理視窗、貓咪詳情的標頭，取代「米克斯 · 公 · 已結紮 · 6 歲」那種一行串接。
// 內容放 <SpecCell label="…">值</SpecCell>。
//
// 換行時每一行的第一格也要頂格、不帶分隔線：每格都有左線＋左內距，整排往左拉出同樣的距離，
// 由外層 overflow-hidden 把每行開頭那條線裁掉（CSS 認不出「換行後的第一格」，只能這樣做）。
</script>

<template>
  <!-- 上下多留 4px 再用負邊距抵回來，格子裡的按鈕（複製電話）焦點框才不會被裁掉。 -->
  <div class="-my-1 overflow-hidden py-1">
    <div class="-ml-[17px] flex flex-wrap items-stretch gap-y-2 [&>*]:border-l [&>*]:border-border [&>*]:px-4">
      <slot />
    </div>
  </div>
</template>
