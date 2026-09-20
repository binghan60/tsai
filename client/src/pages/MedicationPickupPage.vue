<script setup>
import MedicationWorkspace from '../components/MedicationWorkspace.vue'

// 「登記續藥」在 MedicationWorkspace 自己的清單工具列上，這裡不再另外放一顆——
// 同一頁兩顆按鈕做同一件事，只會讓人以為它們不一樣。
</script>

<template>
  <div class="flex flex-col gap-3 xl:h-[calc(100dvh-2.5rem)]">
    <header>
      <h1 class="text-xl font-semibold">領藥</h1>
      <p class="mt-0.5 text-xs text-muted-foreground">核對待領藥品與飼主資料，完成交付後留下領藥紀錄。</p>
    </header>
    <MedicationWorkspace mode="reception" initial-filter="ready" :stages="['ready', 'collected']" />
  </div>
</template>
