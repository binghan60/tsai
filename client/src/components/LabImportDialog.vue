<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { FlaskConical, Search } from '@lucide/vue'
import { http } from '../api/http'
import { useToast } from '../composables/useToast'
import { useWorkCountsStore } from '../stores/workCounts'
import { clinicDateInput, clinicTimeInput } from '../lib/datetime'
import { fillMessage, instrumentLabel } from '../lib/labResults'
import { labFlag } from '../../../shared/labValues.js'
import ModalDialog from './ModalDialog.vue'
import EmptyState from './EmptyState.vue'
import ListSkeleton from './ListSkeleton.vue'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'

// 診療台「檢驗報告」的匯入：列出還沒確認是哪隻貓的 IDEXX 結果，點一筆就歸給這隻貓、填進「這次看診」。
// 跟工具欄「檢驗」的待確認清單是同一批資料、同一支 API（POST /lab-results/:id/match），只是方向反過來——
// 那邊是「這份結果是哪隻貓的」，這裡已經知道是哪隻貓，只要選是哪一份。
// 不限當天（使用者要求）：昨天驗、今天回來看報告是常態，所以匯入時指定 appointmentId，填進這次看診而不是檢驗那一天的。
// 待確認的可能有幾百筆（IDEXX 主機補傳過歷史紀錄），所以新到舊只拿一頁，另外把跟這隻貓同名的撈出來排最前面，其餘靠搜尋。
const PAGE = 50
const props = defineProps({
  appointment: { type: Object, required: true },
})
const emit = defineEmits(['close', 'imported'])
const toast = useToast()
const counts = useWorkCountsStore()
const items = ref([])
const total = ref(0)
const keyword = ref('')
const loading = ref(true)
const busy = ref('')
let request = 0
let timer

const normalize = (name) => String(name ?? '').replace(/\s+/g, '').toLowerCase()
const isSameName = (item) => Boolean(item.patient?.name) && normalize(item.patient.name) === normalize(props.appointment.petName)

const rows = computed(() => items.value.map((item) => {
  const { purpose, name } = instrumentLabel(item.instrument)
  const day = item.runAt ? clinicDateInput(item.runAt) : ''
  return {
    id: item._id,
    title: [purpose, name].filter(Boolean).join(' '),
    // 當天驗的只寫時間，其他天的連日期一起寫。
    time: !item.runAt ? '' : day === props.appointment.date ? clinicTimeInput(item.runAt) : `${day} ${clinicTimeInput(item.runAt)}`,
    today: day === props.appointment.date,
    patient: item.patient?.name ?? '',
    owner: [item.client?.lastName, item.client?.firstName].filter(Boolean).join(' '),
    count: item.assays?.length ?? 0,
    abnormal: (item.assays ?? []).filter((assay) => labFlag(assay)).length,
    sameName: isSameName(item),
  }
}))

async function load() {
  const id = ++request
  loading.value = true
  const q = keyword.value.trim()
  try {
    const page = http.get('/lab-results', { params: { limit: PAGE, ...(q ? { q } : {}) } })
    // 沒在搜尋時，另外找跟這隻貓同名的：它們可能排在幾百筆之後，不撈出來就看不到。
    const named = !q && props.appointment.petName ? http.get('/lab-results', { params: { limit: 20, q: props.appointment.petName } }) : null
    const [latest, sameName] = await Promise.all([page, named])
    if (id !== request) return
    const first = (sameName?.data.items || []).filter(isSameName)
    const seen = new Set(first.map((item) => item._id))
    items.value = [...first, ...(latest.data.items || []).filter((item) => !seen.has(item._id))]
    total.value = latest.data.total ?? items.value.length
  } catch (err) {
    if (id === request) toast.error(err.response?.data?.message || '讀不到檢驗結果，請稍後再試')
  } finally {
    if (id === request) loading.value = false
  }
}

watch(keyword, () => {
  clearTimeout(timer)
  timer = setTimeout(load, 300)
})

async function undo(id) {
  try {
    await http.post(`/lab-results/${id}/unmatch`)
    toast.success(`已從${props.appointment.petName}拿掉這份結果，回到待確認`, '已復原')
  } catch (err) {
    toast.error(err.response?.data?.message || '復原失敗，請稍後再試')
  } finally {
    counts.loadLabResults()
    emit('imported')
  }
}

async function importResult(row) {
  if (busy.value) return
  busy.value = row.id
  try {
    const { data } = await http.post(`/lab-results/${row.id}/match`, { petId: props.appointment.petId, appointmentId: props.appointment._id })
    const { type, message } = fillMessage(data.fill, props.appointment.petName)
    toast.addToast({
      type,
      title: type === 'error' ? '填入失敗' : '已匯入',
      message,
      action: { label: '復原', handler: () => undo(row.id) },
    })
    items.value = items.value.filter((item) => item._id !== row.id)
    total.value = Math.max(0, total.value - 1)
    counts.loadLabResults()
    emit('imported')
  } catch (err) {
    toast.error(err.response?.data?.message || '匯入失敗，請稍後再試')
    // 別台已經處理掉了：重讀清單。
    if (err.response?.status === 409) load()
  } finally {
    busy.value = ''
  }
}

onMounted(load)
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <ModalDialog size="md" :icon="FlaskConical" title="匯入檢驗結果" :description="`還沒確認是哪隻貓的 IDEXX 結果，選一份歸給${appointment.petName}這次看診`" @close="emit('close')">
    <div class="flex min-h-0 flex-col gap-3 px-6 py-4">
      <div class="relative">
        <Search class="pointer-events-none absolute top-1/2 left-3 size-4.5 -translate-y-1/2 text-subtle-foreground" stroke-width="1.75" aria-hidden="true" />
        <Input v-model="keyword" type="search" class="pl-10" aria-label="搜尋 IDEXX 上的貓咪名字或飼主" placeholder="搜尋 IDEXX 上的貓咪名字或飼主" />
      </div>
      <ListSkeleton v-if="loading && !rows.length" :rows="3" />
      <EmptyState v-else-if="!rows.length" inset :icon="FlaskConical" :title="keyword.trim() ? '找不到符合的檢驗結果' : '沒有待確認的檢驗結果'" />
      <template v-else>
        <ul class="divide-y divide-border">
          <li v-for="row in rows" :key="row.id" class="flex items-center gap-4 py-3">
            <div class="min-w-0 flex-1">
              <p class="flex flex-wrap items-center gap-2 font-semibold">
                {{ row.title }}<span class="num text-sm font-normal text-subtle-foreground">{{ row.time }}</span>
                <Badge v-if="row.sameName" variant="status" class="bg-info-surface text-info">同名</Badge>
                <Badge v-if="row.today" variant="status" class="bg-success-surface text-success">今天</Badge>
                <Badge v-if="row.abnormal" variant="status" class="bg-danger-surface text-danger">異常 <span class="num">{{ row.abnormal }}</span> 項</Badge>
              </p>
              <p class="min-h-lh truncate text-sm text-muted-foreground">
                <span class="text-foreground">{{ row.patient }}</span><template v-if="row.owner">　{{ row.owner }}</template>　<span class="num">{{ row.count }}</span> 項
              </p>
            </div>
            <Button variant="soft" size="sm" class="shrink-0" :disabled="Boolean(busy)" @click="importResult(row)">{{ busy === row.id ? '匯入中…' : '匯入' }}</Button>
          </li>
        </ul>
        <p v-if="total > rows.length" class="text-sm text-muted-foreground">顯示最新 <span class="num">{{ rows.length }}</span> 筆，共 <span class="num">{{ total }}</span> 筆；用搜尋找更早的。</p>
      </template>
    </div>
  </ModalDialog>
</template>
