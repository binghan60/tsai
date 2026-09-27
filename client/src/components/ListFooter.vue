<script setup>
import { computed } from 'vue';
import Pagination from './Pagination.vue';

// 清單卡片的底部：左邊「第 1–10 筆，共 1,284 筆」、右邊分頁。清單頁共用。
const props = defineProps({
  page: { type: Number, required: true },
  totalPages: { type: Number, required: true },
  total: { type: Number, required: true },
  pageSize: { type: Number, required: true },
});
const emit = defineEmits(['update:page']);

const range = computed(() => {
  if (!props.total) return '沒有資料';
  const start = (props.page - 1) * props.pageSize + 1;
  const end = Math.min(props.page * props.pageSize, props.total);
  return `第 ${start.toLocaleString('zh-TW')}–${end.toLocaleString('zh-TW')} 筆，共 ${props.total.toLocaleString('zh-TW')} 筆`;
});
</script>

<template>
  <footer class="flex flex-wrap items-center gap-3 border-t border-border px-5 py-2.5">
    <span class="num text-xs text-subtle-foreground">{{ range }}</span>
    <Pagination class="ml-auto" :page="page" :total-pages="totalPages" @update:page="emit('update:page', $event)" />
  </footer>
</template>
