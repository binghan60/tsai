<script setup>
import { onBeforeUnmount, onMounted } from 'vue'
import { getSocket } from '../api/socket'
import ClinicalNoteEntry from './ClinicalNoteEntry.vue'
import Pagination from './Pagination.vue'
import { Button } from './ui/button'
import { Alert, AlertDescription } from './ui/alert'

const props = defineProps({
  notes: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  page: { type: Number, default: 1 },
  totalPages: { type: Number, default: 1 },
  petId: { type: [String, Number], default: '' },
  title: { type: String, default: '歷次病歷日誌' },
  emptyText: { type: String, default: '尚無其他病歷日誌' },
  unlinkedText: { type: String, default: '尚未連結病患資料，無法查看歷次日誌。' },
  fullRecordLabel: { type: String, default: '完整病歷' },
  scrollable: { type: Boolean, default: false },
  // 撐滿父層高度、只有清單本身捲動（診療台工作區的右欄用）
  fill: { type: Boolean, default: false },
  // 清單本來就排除的那一筆看診（診療台、櫃台處理視窗不列「這次看診自己」）：它的異動不必重讀清單。
  excludeAppointmentId: { type: [String, Number], default: '' },
})

const emit = defineEmits(['load', 'saved'])
const socket = getSocket()

function noteBelongsToPanel(note) {
  return props.petId && String(note?.petId || '') === String(props.petId)
}

// 日誌有變就靜默重讀（不閃「載入中」）；正在修改的那一則由 ClinicalNoteEntry 自己保留輸入（以 _id 為 key，重讀不會卸載）。
// 診療台自動存檔、IDEXX 補傳都會連發通知，合併成一次。
let reloadTimer = null
function scheduleReload() {
  clearTimeout(reloadTimer)
  reloadTimer = setTimeout(() => emit('load', props.page, { silent: true }), 250)
}

function handleRemoteNoteUpdate(note) {
  if (!noteBelongsToPanel(note)) return
  if (props.excludeAppointmentId && String(note?.appointmentId || '') === String(props.excludeAppointmentId)) return
  scheduleReload()
}

// IDEXX 結果歸到看診、改數值、移除：日誌的「IDEXX 檢驗」那一列跟著變。這個通知沒有 petId，有貓咪才重讀。
function handleLabResultsUpdate() {
  if (props.petId) scheduleReload()
}

onMounted(() => {
  socket.on('clinical-note:updated', handleRemoteNoteUpdate)
  socket.on('lab-results:updated', handleLabResultsUpdate)
})

onBeforeUnmount(() => {
  clearTimeout(reloadTimer)
  socket.off('clinical-note:updated', handleRemoteNoteUpdate)
  socket.off('lab-results:updated', handleLabResultsUpdate)
})
</script>

<template>
  <!-- 外層不畫框：每一則日誌（ClinicalNoteEntry）本身就是卡片，用的地方（處理視窗、診療台右欄、藥單、病歷速覽）
       外面也已經有自己的區塊，再包一層框就是框中框。標題列直接接卡片清單。 -->
  <section :class="fill ? 'flex h-full min-h-0 flex-col' : ''">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-sm font-semibold sm:text-base">{{ title }}</h3>
      <Button v-if="petId" as-child variant="secondary" size="xs">
        <router-link :to="`/pets/${petId}`">{{ fullRecordLabel }}</router-link>
      </Button>
    </div>

    <p v-if="!petId" class="mt-3 text-sm text-muted-foreground">{{ unlinkedText }}</p>
    <p v-else-if="loading" class="mt-3 text-sm text-muted-foreground" role="status">載入病歷日誌中…</p>
    <Alert v-else-if="error" variant="destructive" class="mt-3">
      <AlertDescription>{{ error }}</AlertDescription>
      <Button variant="secondary" size="sm" @click="emit('load', page)">重試</Button>
    </Alert>

    <div v-else class="clinical-notes-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" :class="{ 'clinical-notes-content--scrollable': scrollable && !fill, 'min-h-0 flex-1 overflow-y-auto pr-2': fill }" :tabindex="scrollable || fill ? 0 : undefined" :aria-label="scrollable || fill ? title : undefined" :role="scrollable || fill ? 'region' : undefined">
      <div class="space-y-3 pt-3">
        <ClinicalNoteEntry v-for="note in notes" :key="note._id" :note="note" @saved="(payload) => emit('saved', payload)" />
      </div>
      <p v-if="!notes.length" class="mt-3 text-sm text-muted-foreground">{{ emptyText }}</p>
      <Pagination v-if="totalPages > 1" class="mt-4" :page="page" :total-pages="totalPages" @update:page="(next) => emit('load', next)" />
    </div>
  </section>
</template>

<style scoped>
@media (min-width: 1024px) {
  .clinical-notes-content--scrollable {
    max-height: clamp(22rem, 45vh, 40rem);
    overflow-y: auto;
    padding-right: 0.5rem;
  }
}
</style>
