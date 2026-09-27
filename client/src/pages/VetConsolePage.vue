<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { AlertTriangle, CalendarClock, ChevronDown, ChevronLeft, ChevronRight, Clock, RefreshCw, Scissors, Stethoscope, Undo2 } from '@lucide/vue'
import { http } from '../api/http'
import { useToast } from '../composables/useToast'
import { useClinicSync } from '../composables/useClinicSync'
import { useSearchQueryParam } from '../composables/useSearchQueryParam'
import { useAppointmentNotifier } from '../composables/useAppointmentNotifier'
import { clinicDateInput, clinicTimeInput, shiftDateInput } from '../lib/datetime'
import { workflowFilter, workflowState } from '../../../shared/appointmentWorkflow.js'
import { patientNotesFor } from '../lib/appointmentDisplay'
import PatientNotes from '../components/PatientNotes.vue'
import VisitWorkspace from '../components/VisitWorkspace.vue'
import SurgeryBadge from '../components/SurgeryBadge.vue'
import LatenessBadge from '../components/LatenessBadge.vue'
import CheckinNumber from '../components/CheckinNumber.vue'
import EmptyState from '../components/EmptyState.vue'
import ListSkeleton from '../components/ListSkeleton.vue'
import FilterTabs from '../components/FilterTabs.vue'
import SegmentedControl from '../components/SegmentedControl.vue'
import TextTemplatePickerDialog from '../components/formfields/TextTemplatePickerDialog.vue'
import { useTextTemplates } from '../composables/useTextTemplates'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import PageHeader from '../components/PageHeader.vue'
import { Alert, AlertDescription } from '../components/ui/alert'
import { DatePicker } from '../components/ui/date-picker'

// 醫師診療台：左欄是今日病患，右欄是可以同時開好幾筆的看診工作區。
// 刻意不做成「點一筆就換頁」——醫師手上常常同時有好幾隻貓在跑（等一隻的檢驗結果時先看下一隻），
// 換頁或 Modal 都會擋住這種來回切換。
//
// 左欄頂端三個頁籤：進行中（在院＋今日排程）／已交櫃台／已完成。後兩個原本是頁首開的大 Modal，
// 現在就地切換，點一筆照樣在右欄開工作區。暫存區、藥單、待辦在右側工具欄。
// 順序只由掛號資料決定（在院依報到時間、待報到依預約時段），點開、切換、看診都不會讓卡片換位置。
// 列上沒有關閉鈕：點哪一列就切到哪一個工作區，目前這一筆只用淡主色底＋左側色條輕輕標出來。切走的工作區仍掛著，
// 回來時沒存完的輸入還在；要關掉用工作區標頭的 X，送交櫃台後也會自動關。
const router = useRouter()
const toast = useToast()
const { loadTemplates: loadTextTemplates } = useTextTemplates()
const notifyChat = useAppointmentNotifier()
const today = clinicDateInput()
const date = useSearchQueryParam('date', today)

const items = ref([])
const loading = ref(true)
const error = ref('')
const busy = ref(false)
const templates = ref([])
// 貓咪／飼主備註存在主檔上，列表 API 另外回一份以 id 為鍵的對照表（見 routes/appointments.js）。
const patientNotes = ref({ pets: {}, owners: {} })
// 各工作區回報的「有未儲存內容」，佇列上顯示藍點。
const dirtyIds = reactive({})

// 精簡（一行一筆）／詳細（原因、備註全展開）是這台電腦的顯示偏好，存 localStorage。
const DENSITY_STORAGE_KEY = 'clinic.vetConsoleDensity'
function readDensity() {
  try {
    return localStorage.getItem(DENSITY_STORAGE_KEY) === 'detailed' ? 'detailed' : 'compact'
  } catch {
    return 'compact'
  }
}
const density = ref(readDensity())
watch(density, (value) => {
  try {
    localStorage.setItem(DENSITY_STORAGE_KEY, value)
  } catch {}
})
const compact = computed(() => density.value === 'compact')
const DENSITY_OPTIONS = [
  { value: 'compact', label: '精簡' },
  { value: 'detailed', label: '詳細' },
]

// 「在院」「今日排程」可以各自收合（v-show，不重新排序也不卸載），同樣是裝置偏好。
const GROUPS_STORAGE_KEY = 'clinic.vetConsoleCollapsedGroups'
function restoreCollapsed() {
  try {
    const saved = JSON.parse(localStorage.getItem(GROUPS_STORAGE_KEY) || '{}')
    return saved && typeof saved === 'object' ? saved : {}
  } catch {
    return {}
  }
}
const collapsedGroups = reactive(restoreCollapsed())
const isCollapsed = (key) => Boolean(collapsedGroups[key])
function toggleGroup(key) {
  collapsedGroups[key] = !collapsedGroups[key]
  try {
    localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(collapsedGroups))
  } catch {}
}

// 同時開著的病患，各自的未儲存輸入留在各自的工作區元件裡。
// 存進 localStorage：診間電腦被重新整理或當掉重開時，醫師手上那幾隻貓不能跟著消失。
// 綁 date 是因為換日期本來就會清空，隔天開機也不該還原昨天的病患。
const TABS_STORAGE_KEY = 'clinic.vetConsoleTabs'
function restoreTabs(forDate) {
  try {
    const saved = JSON.parse(localStorage.getItem(TABS_STORAGE_KEY) || 'null')
    if (!saved || saved.date !== forDate) return { openIds: [], activeId: '' }
    return {
      openIds: Array.isArray(saved.openIds) ? saved.openIds.map(String) : [],
      activeId: String(saved.activeId || ''),
    }
  } catch {
    return { openIds: [], activeId: '' }
  }
}
const restored = restoreTabs(date.value)
const openIds = ref(restored.openIds)
const activeId = ref(restored.activeId)
const queueTab = ref('active')
const now = ref(Date.now())
let clock
let request = 0

const isToday = computed(() => date.value === today)
const byId = computed(() => new Map(items.value.map((item) => [String(item._id), item])))
const openTabs = computed(() => openIds.value.map((id) => byId.value.get(id)).filter(Boolean))
const active = computed(() => byId.value.get(activeId.value) || null)

function queue(filter) {
  return items.value.filter((item) => workflowFilter(item, filter)).sort((a, b) => new Date(a.checkedInAt || a.scheduledAt) - new Date(b.checkedInAt || b.scheduledAt))
}
const byTime = (key, direction) => (a, b) => direction * (new Date(a[key] || 0) - new Date(b[key] || 0))
const onsite = computed(() => queue('onsite'))
const scheduled = computed(() => items.value.filter((item) => workflowFilter(item, 'scheduled')).sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)))
// 已交櫃台：最早交出的在上面（在櫃台前等最久）；已完成：最近完成的在上面。
const handedOff = computed(() => [...queue('handoff')].sort(byTime('handoffAt', 1)))
const finished = computed(() => [...queue('completed')].sort(byTime('deskCompletedAt', -1)))

const QUEUE_TABS = [
  { key: 'active', label: '進行中' },
  { key: 'handoff', label: '已交櫃台' },
  { key: 'completed', label: '已完成' },
]
const queueCounts = computed(() => ({ active: onsite.value.length + scheduled.value.length, handoff: handedOff.value.length, completed: finished.value.length }))
const groups = computed(() => {
  if (queueTab.value === 'handoff') return [{ key: 'handoff', list: handedOff.value }]
  if (queueTab.value === 'completed') return [{ key: 'completed', list: finished.value }]
  return [
    { key: 'onsite', label: '在院', list: onsite.value, hint: '依報到順序', collapsible: true },
    { key: 'scheduled', label: '今日排程', list: scheduled.value, hint: '依時段', collapsible: true },
  ]
})

function minutesSince(value) {
  if (!value) return null
  return Math.max(0, Math.floor((now.value - new Date(value).getTime()) / 60000))
}
// 候診超過這個分鐘數，「已等 N 分」變紅——診間裡看不到候診區，數字要自己跳出來。
const LONG_WAIT_MINUTES = 20
function waitingTooLong(item) {
  const state = workflowState(item)
  return item.status === 'arrived' && !state.started && Boolean(item.checkedInAt) && minutesSince(item.checkedInAt) >= LONG_WAIT_MINUTES
}
function statusText(item) {
  const state = workflowState(item)
  if (state.completed) return clinicTimeInput(item.deskCompletedAt) ? `${clinicTimeInput(item.deskCompletedAt)} 完成` : '已完成'
  if (state.handedOff) return clinicTimeInput(item.handoffAt) ? `${clinicTimeInput(item.handoffAt)} 交出` : '已交櫃台'
  if (state.started) return `看診 ${minutesSince(item.visitStartedAt)} 分`
  if (item.status === 'arrived') return item.checkedInAt ? `已等 ${minutesSince(item.checkedInAt)} 分` : '候診中'
  return ''
}
function notesFor(item) {
  return patientNotesFor(item, patientNotes.value)
}
function severeNotes(item) {
  return notesFor(item).some((note) => note.text.includes('咬') || note.text.includes('凶'))
}

async function refresh() {
  const token = ++request
  const requested = date.value
  try {
    const { data } = await http.get('/appointments', { params: { date: requested } })
    if (token !== request) return
    // 輪詢整批換掉前先比對，斷線期間報到的也要講。
    const previous = new Map(items.value.map((item) => [String(item._id), item]))
    if (previous.size) for (const item of data.items || []) announceCheckIn(previous.get(String(item._id)) || null, item)
    items.value = data.items || []
    patientNotes.value = { pets: data.patientNotes?.pets || {}, owners: data.patientNotes?.owners || {} }
    error.value = ''
    // 已經不存在的病患（換日期、被刪除）自動關掉，避免停在一筆看不到的病患上。
    openIds.value = openIds.value.filter((id) => items.value.some((item) => String(item._id) === id))
    if (!openIds.value.includes(activeId.value)) activeId.value = openIds.value.at(-1) || ''
  } catch {
    if (token === request) error.value = '資料更新失敗，請重新載入；目前顯示的可能不是最新進度。'
  } finally {
    if (token === request) loading.value = false
  }
}

// 醫師在診間裡看不到櫃台，有人報到要在這頁直接講：從「待報到」變成「已報到」
// （或新增時就是已報到的現場掛號）就跳一則提示。只看今天，翻舊日期不吵。
function announceCheckIn(previous, next) {
  if (!isToday.value || next.status !== 'arrived' || workflowState(next).started) return
  if (previous && previous.status !== 'scheduled') return
  const detail = [next.checkinNumber ? `號碼牌 ${next.checkinNumber}` : '', next.reason].filter(Boolean).join('，')
  toast.success(detail, `${next.petName} 已報到`)
}

function applyUpdate(item) {
  if (item.date !== date.value) {
    items.value = items.value.filter((p) => String(p._id) !== String(item._id))
    return
  }
  const index = items.value.findIndex((p) => String(p._id) === String(item._id))
  if (index < 0) {
    items.value.push(item)
    announceCheckIn(null, item)
    return
  }
  // __v 只會往前走；比目前手上的舊就是遲到的廣播，丟掉。
  if ((item.__v ?? 0) < (items.value[index].__v ?? 0)) return
  announceCheckIn(items.value[index], item)
  items.value[index] = item
}

useClinicSync(date, refresh, applyUpdate)

// 重新整理要回到原本開著的那幾筆，所以每次開關／切換都寫回去。
watch(
  [openIds, activeId, date],
  () => {
    try {
      localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({ date: date.value, openIds: openIds.value, activeId: activeId.value }))
    } catch {
      /* 無痕視窗或停用儲存時就只是不還原，不影響看診。 */
    }
  },
  { deep: true },
)

watch(date, () => {
  loading.value = true
  items.value = []
  openIds.value = []
  activeId.value = ''
  refresh()
})

// 點一筆只開啟工作區（可以先看資料）；真正開始看診要按「看診」／「開始看診」。
function openPatient(appointment) {
  const id = String(appointment._id)
  if (!openIds.value.includes(id)) openIds.value.push(id)
  activeId.value = id
}

async function startVisit(appointment) {
  if (busy.value || appointment.visitStartedAt || appointment.handoffAt || appointment.deskCompletedAt) return
  busy.value = true
  try {
    const { data } = await http.post(`/appointments/${appointment._id}/workflow/start`, { version: appointment.__v ?? 0 })
    applyUpdate(data)
    openPatient(data)
    toast.success('已開始看診')
  } catch (err) {
    toast.error(err.response?.data?.message || '開始看診失敗，請稍後重試')
  } finally {
    busy.value = false
  }
}

function closeTab(id) {
  // 工作區卸載時不會替你存檔；自動儲存只要 1.2 秒，等它存完再關。
  if (dirtyIds[id]) {
    toast.error('這筆還有內容正在儲存，請稍候再關閉')
    return
  }
  openIds.value = openIds.value.filter((item) => item !== id)
  if (activeId.value === id) activeId.value = openIds.value.at(-1) || ''
}

function onWorkspaceUpdate(appointment, action) {
  applyUpdate(appointment)
  if (action === 'handoff') {
    notifyChat(appointment, 'handoff')
    toast.success('已送交櫃台')
    closeTab(String(appointment._id))
  } else if (action === 'reclaim') {
    notifyChat(appointment, 'reclaim')
    toast.success('已取回，可以繼續修改')
  }
}

function onDirty(id, value) {
  if (value) dirtyIds[id] = true
  else delete dirtyIds[id]
}

function onNotesUpdated({ kind, id, notes }) {
  const bucket = kind === 'pet' ? 'pets' : 'owners'
  const next = { ...patientNotes.value[bucket] }
  if (notes.trim()) next[id] = notes.trim()
  else delete next[id]
  patientNotes.value = { ...patientNotes.value, [bucket]: next }
}

async function reclaim(appointment) {
  if (busy.value) return
  busy.value = true
  try {
    const { data } = await http.post(`/appointments/${appointment._id}/workflow/reclaim`, { version: appointment.__v ?? 0 })
    applyUpdate(data)
    notifyChat(data, 'reclaim')
    // 取回就是要接著補資料：切回「進行中」並開工作區。
    openPatient(data)
    queueTab.value = 'active'
  } catch (err) {
    toast.error(err.response?.data?.message || '取回失敗，請稍後重試')
  } finally {
    busy.value = false
  }
}

async function loadTemplates() {
  try {
    const { data } = await http.get('/settings/form-templates')
    templates.value = data
  } catch {
    /* 表單選項只影響「建立正式表單」，載不到不擋看診。 */
  }
}

onMounted(() => {
  clock = setInterval(() => {
    now.value = Date.now()
  }, 30000)
  loadTemplates()
  loadTextTemplates().catch(() => {})
  refresh()
})
onBeforeUnmount(() => {
  request += 1
  clearInterval(clock)
})
</script>

<template>
  <div class="flex flex-col gap-5 xl:h-[calc(100dvh-2.5rem)]">
    <PageHeader title="診療台">
      <template #actions>
        <Button v-if="date !== today" variant="soft" size="sm" @click="date = today">回到今天</Button>
        <Button variant="ghost" size="icon-sm" aria-label="前一天" @click="date = shiftDateInput(date, -1)"><ChevronLeft stroke-width="1.75" /></Button>
        <DatePicker v-model="date" :clearable="false" aria-label="診務日期" class="w-40" />
        <Button variant="ghost" size="icon-sm" aria-label="後一天" @click="date = shiftDateInput(date, 1)"><ChevronRight stroke-width="1.75" /></Button>
      </template>
    </PageHeader>

    <Alert v-if="error" variant="destructive" class="flex items-center justify-between gap-3">
      <AlertDescription>{{ error }}</AlertDescription>
      <Button variant="secondary" size="sm" @click="refresh"><RefreshCw stroke-width="1.75" />重試</Button>
    </Alert>

    <div class="flex min-h-0 flex-1 flex-col gap-4 xl:flex-row">
      <section class="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card xl:w-100 xl:shrink-0" aria-label="今日病患">
        <header class="flex shrink-0 flex-col gap-2.5 border-b border-border px-4 py-3">
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-lg font-semibold">今日病患</h2>
            <SegmentedControl v-model="density" :options="DENSITY_OPTIONS" size="sm" aria-label="清單顯示方式" />
          </div>
          <FilterTabs v-model="queueTab" :items="QUEUE_TABS" :counts="queueCounts" aria-label="病患進度" class="w-full [&>button]:flex-1" />
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto pb-2">
          <ListSkeleton v-if="loading" :rows="4" inset />
          <template v-else>
            <div v-for="group in groups" :key="group.key">
              <button
                v-if="group.collapsible"
                type="button"
                class="flex w-full items-center gap-2 px-4 pt-3 pb-1.5 text-left hover:text-foreground"
                :aria-expanded="!isCollapsed(group.key)"
                :aria-label="`${isCollapsed(group.key) ? '展開' : '收合'}${group.label}`"
                @click="toggleGroup(group.key)"
              >
                <ChevronDown class="size-4 shrink-0 text-subtle-foreground transition-transform" :class="isCollapsed(group.key) ? '-rotate-90' : ''" stroke-width="2" aria-hidden="true" />
                <span class="spec-label">{{ group.label }}</span>
                <span class="num text-xs text-subtle-foreground">{{ group.list.length }}</span>
                <span v-if="isCollapsed(group.key) && group.list.some((item) => dirtyIds[String(item._id)])" class="size-2 shrink-0 rounded-full bg-info" title="收合的病患有尚未儲存的內容"><span class="sr-only">收合的病患有尚未儲存的內容</span></span>
                <span class="ml-auto text-xs text-subtle-foreground">{{ group.hint }}</span>
              </button>
              <p v-if="!isCollapsed(group.key) && !group.list.length" class="px-4 py-3 text-sm text-subtle-foreground">目前沒有</p>

              <ul v-show="!isCollapsed(group.key)">
                <li
                  v-for="item in group.list"
                  :key="item._id"
                  class="group/row flex cursor-pointer items-center gap-3 border-b border-border px-4 transition-colors last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset"
                  :class="[compact ? 'min-h-14 py-2' : 'py-3', String(item._id) === activeId ? 'bg-accent/60 shadow-[inset_3px_0_0_var(--primary)]' : 'hover:bg-hover']"
                  :aria-current="String(item._id) === activeId ? 'true' : undefined"
                  role="button"
                  tabindex="0"
                  :aria-label="`開啟 ${item.petName}`"
                  @click="openPatient(item)"
                  @keydown.enter.self.prevent="openPatient(item)"
                  @keydown.space.self.prevent="openPatient(item)"
                >
                  <span v-if="group.key === 'scheduled'" class="num w-12 shrink-0 text-base font-semibold" :class="item.isSurgery ? 'text-surgery' : 'text-foreground'">{{ item.time || '未定' }}</span>
                  <CheckinNumber v-else :appointment="item" :size="compact ? 'sm' : 'md'" />

                  <div class="min-w-0 flex-1" :class="compact ? '' : 'space-y-1'">
                    <div class="flex min-w-0 items-center gap-2">
                      <span class="truncate text-base font-semibold text-foreground">{{ item.petName }}</span>
                      <Badge v-if="item.visitType === 'new'" variant="status" class="h-6 bg-info-surface px-2 text-info">初診</Badge>
                      <span v-if="compact" class="min-w-0 flex-1 truncate text-sm text-muted-foreground" :title="item.reason || undefined">{{ item.reason }}</span>
                      <!-- 精簡版的標記只留圖示（滑過看全文）：一行放不下「手術：結紮」這種整顆徽章。 -->
                      <span v-if="compact" class="flex shrink-0 items-center gap-1">
                        <Scissors v-if="item.isSurgery" class="size-4 text-surgery" stroke-width="2" :aria-label="`手術：${item.surgeryName || ''}`" />
                        <Clock v-if="item.latenessMinutes > 0" class="size-4 text-danger" stroke-width="2" :aria-label="`遲到 ${item.latenessMinutes} 分`" />
                        <AlertTriangle v-if="notesFor(item).length" class="size-4" :class="severeNotes(item) ? 'text-danger' : 'text-warning'" stroke-width="2" :aria-label="notesFor(item).map((note) => `${note.label}備註：${note.text}`).join('；')" />
                      </span>
                    </div>
                    <template v-if="!compact">
                      <p class="text-base leading-snug" :class="item.reason ? 'text-foreground' : 'text-subtle-foreground'">{{ item.reason || '未填來院原因' }}</p>
                      <div v-if="item.isSurgery || item.latenessMinutes > 0" class="flex flex-wrap items-center gap-1.5">
                        <SurgeryBadge v-if="item.isSurgery" :name="item.surgeryName" />
                        <LatenessBadge :minutes="item.latenessMinutes" />
                      </div>
                      <PatientNotes :notes="notesFor(item)" />
                      <p v-if="item.internalNote" class="line-clamp-1 text-sm text-muted-foreground" :title="item.internalNote"><span class="font-medium text-foreground">掛號備註</span> {{ item.internalNote }}</p>
                    </template>
                  </div>

                  <span v-if="statusText(item)" class="num shrink-0 text-xs" :class="waitingTooLong(item) ? 'font-semibold text-danger' : 'text-subtle-foreground'">{{ statusText(item) }}</span>
                  <span v-if="dirtyIds[String(item._id)]" class="size-2 shrink-0 rounded-full bg-info" title="有尚未儲存的內容"><span class="sr-only">有尚未儲存的內容</span></span>
                  <Button v-if="group.key === 'onsite' && !workflowState(item).started" size="xs" class="shrink-0" :disabled="busy" @click.stop="startVisit(item)"><Stethoscope stroke-width="1.75" />看診</Button>
                  <Button v-if="group.key === 'handoff'" variant="secondary" size="xs" class="shrink-0" :disabled="busy" @click.stop="reclaim(item)"><Undo2 stroke-width="1.75" />取回</Button>
                </li>
              </ul>
            </div>
          </template>
        </div>
      </section>

      <section class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card" aria-label="看診工作區">
        <!-- 每個開著的病患各自掛一個工作區並用 v-show 切換，不是共用一個再換 props——
             元件被銷毀重建就等於把還沒存檔的輸入丟掉，那正是要避免的事。 -->
        <VisitWorkspace v-for="tab in openTabs" v-show="String(tab._id) === activeId" :key="tab._id" class="min-h-0 flex-1" :appointment="tab" :templates="templates" @updated="onWorkspaceUpdate" @start="startVisit" @close="closeTab(String(tab._id))" @dirty="onDirty" @notes-updated="onNotesUpdated" @open-record="(appointment) => router.push({ path: `/records/${appointment.recordId}/edit`, query: { visit: appointment._id, visitDate: appointment.date } })" />
        <EmptyState v-if="!active && !loading" :icon="CalendarClock" title="從左邊選一位病患" description="點一筆可以先看資料，按「看診」才會記錄開始時間。可以同時開好幾位，切換不會清空已輸入的內容。" inset class="my-auto" />
      </section>
    </div>
    <TextTemplatePickerDialog />
  </div>
</template>
