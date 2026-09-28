<script setup>
import { ref } from 'vue'
import { Plus } from '@lucide/vue'
import MedicationWorkspace from '../components/MedicationWorkspace.vue'
import PageHeader from '../components/PageHeader.vue'
import { Button } from '../components/ui/button'

// 交付藥包的全頁版：跟健檢報告一樣的滿版清單，點一筆整頁切到詳情（MedicationWorkspace 的全頁版型）。
// 「新增藥單」是這頁的主要動作，照頁首規則放右上角；按下去換成新增表單。
const workspace = ref(null)
</script>

<template>
  <div class="flex flex-col gap-5">
    <PageHeader title="藥單">
      <template #actions>
        <Button @click="workspace?.create()"><Plus stroke-width="1.75" />新增藥單</Button>
      </template>
    </PageHeader>
    <MedicationWorkspace ref="workspace" mode="reception" initial-filter="ready" :stages="['ready', 'collected']" />
  </div>
</template>
