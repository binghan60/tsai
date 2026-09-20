<script setup>
import { ref } from 'vue'
import { Plus } from '@lucide/vue'
import MedicationWorkspace from '../components/MedicationWorkspace.vue'
import { Button } from '../components/ui/button'

const workspace = ref(null)
</script>

<template>
  <div class="flex flex-col gap-3 xl:h-[calc(100dvh-2.5rem)]">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold">領藥</h1>
        <p class="mt-0.5 text-xs text-muted-foreground">核對待領藥品與飼主資料，完成交付後留下領藥紀錄。</p>
      </div>
      <Button @click="workspace?.create()"><Plus class="h-4 w-4" />新增藥單</Button>
    </header>
    <MedicationWorkspace ref="workspace" mode="reception" initial-filter="ready" :stages="['ready', 'collected']" />
  </div>
</template>
