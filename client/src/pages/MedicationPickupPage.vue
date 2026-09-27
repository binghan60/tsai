<script setup>
import MedicationWorkspace from '../components/MedicationWorkspace.vue'
import PageHeader from '../components/PageHeader.vue'

// 「登記續藥」在 MedicationWorkspace 自己的清單工具列上，這裡不再另外放一顆——
// 同一頁兩顆按鈕做同一件事，只會讓人以為它們不一樣。
</script>

<template>
  <div class="flex flex-col gap-5 xl:h-[calc(100dvh-2.5rem)]">
    <PageHeader title="領藥" description="核對待領藥品與飼主資料，完成交付後留下領藥紀錄。" />
    <MedicationWorkspace mode="reception" initial-filter="ready" :stages="['ready', 'collected']" />
  </div>
</template>
