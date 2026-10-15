<script setup>
import { Badge } from './ui/badge';

// 流浪貓標記（貓咪的 isStray、掛號的 isStray 快照）。掛號台、診療台、看診工作區、櫃台處理視窗、貓咪頁、病歷速覽共用這一顆。
// 顏色走 stray（暖棕）：身分標籤，跟初診的藍、手術的紫分開；灰色留給已取消／已停用。
</script>

<template>
  <Badge variant="status" class="bg-stray-surface text-stray">流浪貓</Badge>
</template>
