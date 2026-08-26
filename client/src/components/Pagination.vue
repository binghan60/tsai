<script setup>
import { computed } from 'vue';
import { ChevronLeft, ChevronRight } from '@lucide/vue';
import { Button } from './ui/button';
import { paginationItems } from '../lib/pagination';

// 全站清單頁共用的分頁列。
//
// 分頁列本身永遠顯示（就算只有一頁），邊界按鈕用 disabled 表達「到頭了」，
// 不是整列消失——列表筆數改變（篩選、換頁）時版面不會忽有忽無地跳動。
// 只有分頁膠囊本身，置中顯示；總筆數不重複顯示在這裡。
//
// 七頁以內全部展開；頁數更多時保留第一頁、最後一頁與目前頁附近頁碼，避免分頁列
// 無限制變寬。上一頁／下一頁維持固定位置，目前頁用實心主色表示。
const props = defineProps({
  page: { type: Number, required: true },
  totalPages: { type: Number, required: true },
});

const emit = defineEmits(['update:page']);
const items = computed(() => paginationItems(props.page, props.totalPages));

function goTo(next) {
  const target = Math.min(Math.max(next, 1), props.totalPages);
  if (target === props.page) return;
  emit('update:page', target);
}
</script>

<template>
  <nav class="flex max-w-full items-center justify-center overflow-x-auto" aria-label="分頁導覽">
    <div class="flex items-center gap-0.5 rounded-xl border border-border bg-muted p-1.5">
      <Button type="button" variant="ghost" size="icon-xs" :disabled="page <= 1" aria-label="上一頁" @click="goTo(page - 1)">
        <ChevronLeft class="h-4 w-4" stroke-width="2.2" />
      </Button>

      <template v-for="item in items" :key="item.type === 'page' ? `page-${item.value}` : `ellipsis-${item.key}`">
        <Button
          v-if="item.type === 'page'"
          type="button"
          :variant="item.value === page ? 'default' : 'ghost'"
          size="icon-xs"
          class="tabular-nums"
          :aria-label="`第 ${item.value} 頁`"
          :aria-current="item.value === page ? 'page' : undefined"
          @click="goTo(item.value)"
        >{{ item.value }}</Button>
        <span v-else class="flex size-9 shrink-0 items-center justify-center text-xs text-muted-foreground" aria-hidden="true">…</span>
      </template>

      <Button type="button" variant="ghost" size="icon-xs" :disabled="page >= totalPages" aria-label="下一頁" @click="goTo(page + 1)">
        <ChevronRight class="h-4 w-4" stroke-width="2.2" />
      </Button>
    </div>
  </nav>
</template>
