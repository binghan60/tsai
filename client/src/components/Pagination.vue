<script setup>
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from '@lucide/vue';
import { Button } from './ui/button';

// 全站清單頁共用的分頁列。
//
// 分頁列本身永遠顯示（就算只有一頁），邊界按鈕用 disabled 表達「到頭了」，
// 不是整列消失——列表筆數改變（篩選、換頁）時版面不會忽有忽無地跳動。
// 只有分頁膠囊本身，置中顯示；總筆數不重複顯示在這裡。
//
// 版面重新設計後，四顆各自獨立的方形按鈕收進一顆膠囊軌道：首頁／末頁降級成最小的
// 圓形圖示鈕退到兩側（診所資料量小，很少用到跳頁到底）；上一頁／下一頁才是常用的，
// 下一頁又比上一頁更常按（多數人是往後翻），所以下一頁用實心主色、上一頁只浮起一階。
const props = defineProps({
  page: { type: Number, required: true },
  totalPages: { type: Number, required: true },
});

const emit = defineEmits(['update:page']);

function goTo(next) {
  const target = Math.min(Math.max(next, 1), props.totalPages);
  if (target === props.page) return;
  emit('update:page', target);
}
</script>

<template>
  <div class="flex items-center justify-center">
    <div class="flex items-center gap-0.5 rounded-full border border-border bg-muted p-1.5">
      <Button type="button" variant="ghost" size="icon-xs" class="hidden sm:inline-flex" :disabled="page <= 1" aria-label="第一頁" @click="goTo(1)">
        <ChevronsLeft class="h-3.5 w-3.5" stroke-width="2.2" />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" class="bg-card text-primary shadow-sm hover:bg-card hover:text-primary disabled:bg-transparent disabled:text-muted-foreground" :disabled="page <= 1" aria-label="上一頁" @click="goTo(page - 1)">
        <ChevronLeft class="h-4 w-4" stroke-width="2.2" />
      </Button>
      <span class="px-3.5 text-xs tabular-nums whitespace-nowrap text-foreground">第 {{ page }} / {{ totalPages }} 頁</span>
      <Button type="button" variant="default" size="icon-sm" :disabled="page >= totalPages" aria-label="下一頁" @click="goTo(page + 1)">
        <ChevronRight class="h-4 w-4" stroke-width="2.2" />
      </Button>
      <Button type="button" variant="ghost" size="icon-xs" class="hidden sm:inline-flex" :disabled="page >= totalPages" aria-label="最後頁" @click="goTo(totalPages)">
        <ChevronsRight class="h-3.5 w-3.5" stroke-width="2.2" />
      </Button>
    </div>
  </div>
</template>
