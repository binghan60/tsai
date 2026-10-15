<script setup>
import { BedDouble } from '@lucide/vue';
import { Badge } from './ui/badge';

// 收了住院的看診（掛號的 hospitalizationId 有值）：掛號台、診療台的卡片上標「住院」。
// 跟初診同一個 info 色，多一個床的圖示分開。
</script>

<template>
  <Badge variant="status" class="bg-info-surface text-info"><BedDouble stroke-width="2" aria-hidden="true" />住院</Badge>
</template>
