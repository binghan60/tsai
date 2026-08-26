<script setup>
import { Card } from './ui/card';
import { Skeleton } from './ui/skeleton';

// 清單頁的載入骨架。原本各頁都是一行「載入中…」，切頁時版面先塌成一行、
// 資料到了再撐開，那一下跳動是廉價感最主要的來源。
//
// 骨架的重點不是「好看的動畫」，是先把版面的高度佔住——所以列高固定 56px，
// 對齊桌機密集資料列；資料進來時位置幾乎不動。
defineProps({
  rows: { type: Number, default: 5 },
  // 有頭像／圖示欄的清單（飼主、寵物、報告）留一個圓形佔位
  avatar: { type: Boolean, default: true },
  // 對話框或卡片內部用：外層已經有一圈邊框，再包一層 Card 會變成框中框。
  // 跟 EmptyState 的 inset 是同一個理由。
  inset: { type: Boolean, default: false },
});
</script>

<template>
  <component :is="inset ? 'div' : Card" :class="inset ? '' : 'overflow-hidden p-0'" role="status" aria-label="載入中">
    <div class="divide-y divide-border">
      <div v-for="row in rows" :key="row" class="flex h-14 items-center gap-4 px-4 py-2.5">
        <Skeleton v-if="avatar" class="size-9 shrink-0 rounded-full" />
        <div class="min-w-0 flex-1 space-y-2">
          <Skeleton class="h-4 w-40 max-w-full" />
          <Skeleton class="h-3 w-24 max-w-full" />
        </div>
        <Skeleton class="hidden h-4 w-28 sm:block" />
        <Skeleton class="h-9 w-24 shrink-0 rounded-lg" />
      </div>
    </div>
  </component>
</template>
