<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { http } from '../api/http'
import { getSocket } from '../api/socket'
import { clinicDateInput, clinicTimeInput } from '../lib/datetime'
import { instrumentLabel } from '../lib/labResults'
import { labFlag } from '../../../shared/labValues.js'

// 診療台的「檢驗報告」：這隻貓這次看診當天的 **IDEXX 原始結果**（加上醫師從別天匯入、指定給這次看診的），讓醫師邊看邊打紀錄。
// 刻意不是健檢報告上的數值（appointment.labValues）——使用者要的是 IDEXX 原文：儀器給的每一項、原本的代號、
// 單位與參考範圍，不管表單有沒有對應的欄位、也不管醫師後來在報告上改成什麼。
// 一台儀器一段（生化、血球各一份）。只顯示、不能改。
// 一次檢驗常有二三十項：排成兩欄、限制高度可捲動，下面的本次簡易紀錄才不會被推到畫面外。
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

function rangeText(assay) {
  const hasMin = assay.referenceMin !== null && assay.referenceMin !== undefined
  const hasMax = assay.referenceMax !== null && assay.referenceMax !== undefined
  if (hasMin && hasMax) return `${assay.referenceMin}–${assay.referenceMax}`
  if (hasMin) return `≥ ${assay.referenceMin}`
  if (hasMax) return `≤ ${assay.referenceMax}`
  return ''
}

const groups = computed(() => results.value.map((result) => {
  const { purpose, name } = instrumentLabel(result.instrument)
  return {
    id: result._id,
    title: [purpose, name].filter(Boolean).join(' '),
    // 不是這次看診當天驗的（匯入的舊結果）連日期一起寫，才不會被當成今天的數值。
    time: !result.runAt ? '' : clinicDateInput(result.runAt) === props.appointment.date
      ? clinicTimeInput(result.runAt)
      : `${clinicDateInput(result.runAt)} ${clinicTimeInput(result.runAt)}`,
    notes: result.notes ?? [],
    rows: (result.assays ?? []).map((assay) => ({ ...assay, flag: labFlag(assay), range: rangeText(assay) })),
  }
}))
const abnormal = computed(() => groups.value.reduce((sum, group) => sum + group.rows.filter((row) => row.flag).length, 0))

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
  <div class="max-h-80 min-h-12 space-y-3 overflow-y-auto rounded-lg bg-sunken px-3 py-2">
    <section v-for="group in groups" :key="group.id" :aria-label="`${group.title} ${group.time}`">
      <h4 class="flex items-baseline gap-2 pb-1 text-sm font-semibold">
        {{ group.title }}<span class="num text-xs font-normal text-subtle-foreground">{{ group.time }}</span>
      </h4>
      <div class="grid gap-x-6 @2xl/visit:grid-cols-2" role="table" :aria-label="`${group.title}的檢驗數值`">
        <div
          v-for="row in group.rows"
          :key="row.code"
          class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,8rem)] items-baseline gap-x-3 border-t border-border py-1.5 text-sm"
          role="row"
        >
          <span class="num truncate text-muted-foreground" role="cell" v-tip.overflow="row.code">{{ row.code }}</span>
          <span class="num text-right text-base font-semibold" :class="row.flag ? 'text-danger' : 'text-foreground'" role="cell">
            {{ row.value }}<span v-if="row.flag" class="ml-0.5" :aria-label="row.flag === '↑' ? '偏高' : '偏低'">{{ row.flag }}</span>
          </span>
          <span class="num truncate text-xs text-subtle-foreground" role="cell" v-tip.overflow="`${row.range} ${row.unit ?? ''}`.trim()">{{ row.range }}<template v-if="row.unit"> {{ row.unit }}</template></span>
        </div>
      </div>
      <!-- IDEXX 附在結果後面的原文註記（例如 SDMA 的判讀說明）。 -->
      <ul v-if="group.notes.length" class="mt-1.5 space-y-1 text-xs text-muted-foreground">
        <li v-for="(note, index) in group.notes" :key="index">{{ note }}</li>
      </ul>
    </section>
  </div>
</template>
