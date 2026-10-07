<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { http } from '../api/http'
import { getSocket } from '../api/socket'
import LabResultGroups from './LabResultGroups.vue'

// 診療台的「檢驗報告」：這隻貓這次看診當天的 **IDEXX 原始結果**（加上醫師從別天匯入、指定給這次看診的），讓醫師邊看邊打紀錄。
// 刻意不是健檢報告上的數值（appointment.labValues）——使用者要的是 IDEXX 原文：儀器給的每一項、原本的代號、
// 單位與參考範圍，不管表單有沒有對應的欄位、也不管醫師後來在報告上改成什麼。
// 表格本身是 LabResultGroups（病歷日誌的「IDEXX 檢驗」也用它）；這裡負責讀資料與外框。
// 一次檢驗常有二三十項：限制高度可捲動，下面的本次簡易紀錄才不會被推到畫面外。
const props = defineProps({
  appointment: { type: Object, required: true },
})

const results = ref([])
let request = 0

async function load() {
  const id = ++request
  if (!props.appointment.petId || !props.appointment.date) {
    results.value = []
    return
  }
  try {
    // 當天驗的，加上醫師從別天匯入、指定給這次看診的。
    const { data } = await http.get('/lab-results', {
      params: { petId: props.appointment.petId, date: props.appointment.date, appointmentId: props.appointment._id, limit: 50 },
    })
    // API 是新到舊；這裡照檢驗先後排，先驗的在上面。
    if (id === request) results.value = [...(data.items || [])].reverse()
  } catch {
    // 讀不到就維持原樣；下一次有結果進來會再讀。
  }
}

const table = ref(null)
const abnormal = computed(() => table.value?.abnormal ?? 0)

// 新結果進來、有人在「檢驗」面板選了這隻貓：伺服器廣播 lab-results:updated，重讀一次。
const socket = getSocket()
onMounted(() => {
  load()
  socket.on('lab-results:updated', load)
})
onBeforeUnmount(() => socket.off('lab-results:updated', load))
watch(() => [props.appointment.petId, props.appointment.date], load)

defineExpose({ abnormal, reload: load })
</script>

<template>
  <!-- 還沒有結果時格子照畫、內容空著（不補「尚無檢驗」這類字）。 -->
  <div class="max-h-80 min-h-12 overflow-y-auto rounded-lg bg-sunken px-3 py-2">
    <LabResultGroups ref="table" :results="results" :base-date="appointment.date" />
  </div>
</template>
