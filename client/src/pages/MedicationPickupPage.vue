<script setup>
import { computed, ref } from 'vue'
import { Plus } from '@lucide/vue'
import MedicationWorkspace from '../components/MedicationWorkspace.vue'
import PageHeader from '../components/PageHeader.vue'
import { Button } from '../components/ui/button'
import { useStaffIdentity } from '../composables/useStaffIdentity'
import { useWorkCountsStore } from '../stores/workCounts'

// 藥單的全頁版：跟健檢報告一樣的滿版清單，點一筆整頁切到詳情（MedicationWorkspace 的全頁版型）。
// 跟工具欄的藥單面板是同一套功能、同一批藥單：全部階段都看得到，醫師審核、櫃台包藥與交付都能在這裡做，
// 依這台裝置的身分決定預設頁籤與可用動作（醫師看待確認，櫃台看未完成）。
// 「新增藥單」是櫃台的主要動作，照頁首規則放右上角；醫師端跟面板一樣不出現。
const workspace = ref(null)
const counts = useWorkCountsStore()
const { identity } = useStaffIdentity()
const doctor = computed(() => identity.value === 'vet')
</script>

<template>
  <div class="flex flex-col gap-5">
    <PageHeader title="藥單">
      <template v-if="!doctor" #actions>
        <Button @click="workspace?.create()"><Plus stroke-width="1.75" />新增藥單</Button>
      </template>
    </PageHeader>
    <MedicationWorkspace
      ref="workspace"
      :key="identity"
      :mode="doctor ? 'doctor' : 'reception'"
      :initial-filter="doctor ? 'review' : 'active'"
      @counts="counts.setMedications"
    />
  </div>
</template>
