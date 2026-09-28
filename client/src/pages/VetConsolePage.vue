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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip'
import { Button } from '../components/ui/button'
import PageHeader from '../components/PageHeader.vue'
import { Alert, AlertDescription } from '../components/ui/alert'
import { DatePicker } from '../components/ui/date-picker'

// 醫師診療台：左欄是今日病患，右欄是目前這一筆的看診工作區。
// 刻意不做成「點一筆就換頁」——醫師手上常常同時有好幾隻貓在跑（等一隻的檢驗結果時先看下一隻），
// 換頁或 Modal 都會擋住這種來回切換。
//
// 左欄頂端三個頁籤：進行中（在院＋今日排程）／已交櫃台／已完成。後兩個原本是頁首開的大 Modal，
// 現在就地切換，點一筆照樣在右欄開工作區。暫存區、藥單、待辦在右側工具欄。
// 順序只由掛號資料決定（在院依報到時間、待報到依預約時段），點開、切換、看診都不會讓卡片換位置。
// 列上沒有關閉鈕：點哪一列就換成那隻貓，目前這一筆只用淡主色底輕輕標出來。工作區一次只掛一個，
// 切換前先等自動存檔送出（VisitWorkspace 的 flush），不另外保留切走那幾筆的輸入。工作區沒有關閉鈕，
// 送交櫃台後自動關。
const router = useRouter()
const toast = useToast()
const { loadTemplates: loadTextTemplates } = useTextTemplates()
const notifyChat = useAppointmentNotifier()
const today = clinicDateInput()
const date = useSearchQueryParam('date', today)
// ?open=<掛號 id>：從別頁（健檢報告的「引用本次看診」）直接打開那一筆的工作區；打開後就從網址拿掉。
const openParam = useSearchQueryParam('open', '')

const items = ref([])
const loading = ref(true)
const error = ref('')
const busy = ref(false)
const templates = ref([])
// 貓咪／飼主備註存在主檔上，列表 API 另外回一份以 id 為鍵的對照表（見 routes/appointments.js）。
const patientNotes = ref({ pets: {}, owners: {} })

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

// 目前開著的那一筆存進 localStorage：診間電腦被重新整理或當掉重開時，回到原本那隻貓。
// 綁 date 是因為換日期本來就會清空，隔天開機也不該還原昨天的病患。
const ACTIVE_STORAGE_KEY = 'clinic.vetConsoleActive'
function restoreActive(forDate) {
  try {
    const saved = JSON.parse(localStorage.getItem(ACTIVE_STORAGE_KEY) || 'null')
    return saved?.date === forDate ? String(saved.activeId || '') : ''
  } catch {
    return ''
  }
}
const activeId = ref(restoreActive(date.value))
const workspace = ref(null)
const queueTab = ref('active')
const now = ref(Date.now())
let clock
let request = 0

const isToday = computed(() => date.value === today)
const byId = computed(() => new Map(items.value.map((item) => [String(item._id), item])))
const active = computed(() => byId.value.get(activeId.value) || null)

function queue(filter) {
  return items.value.filter((item) => workflowFilter(item, filter)).sort((a, b) => new Date(a.checkedInAt || a.scheduledAt) - new Date(b.checkedInAt || b.scheduledAt))
}
const byTime = (key, direction) => (a, b) => direction * (new Date(a[key] || 0) - new Date(b[key] || 0))
// 已報到的手術另成一組放在「在院」下面：手術一待就是幾個小時，混在候診裡會把後面等看診的擠下去。
// 還沒報到的手術仍照時段排在「今日排程」。
const onsite = computed(() => queue('onsite').filter((item) => !item.isSurgery))
const surgery = computed(() => queue('onsite').filter((item) => item.isSurgery))
const scheduled = computed(() => items.value.filter((item) => workflowFilter(item, 'scheduled')).sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)))
// 已交櫃台：最早交出的在上面（在櫃台前等最久）；已完成：最近完成的在上面。
const handedOff = computed(() => [...queue('handoff')].sort(byTime('handoffAt', 1)))
const finished = computed(() => [...queue('completed')].sort(byTime('deskCompletedAt', -1)))

const QUEUE_TABS = [
  { key: 'active', label: '進行中' },
  { key: 'handoff', label: '已交櫃台' },
  { key: 'completed', label: '已完成' },
]
const queueCounts = computed(() => ({ active: onsite.value.length + surgery.value.length + scheduled.value.length, handoff: handedOff.value.length, completed: finished.value.length }))
const groups = computed(() => {
  if (queueTab.value === 'handoff') return [{ key: 'handoff', list: handedOff.value }]
  if (queueTab.value === 'completed') return [{ key: 'completed', list: finished.value }]
  return [
    { key: 'onsite', label: '在院', list: onsite.value, hint: '依報到順序', collapsible: true },
    { key: 'surgery', label: '手術', list: surgery.value, hint: '依報到順序', collapsible: true, tone: 'surgery' },
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
    if (!byId.value.has(activeId.value)) activeId.value = ''
    openFromLink()
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

// 重新整理要回到原本開著的那一筆，所以每次切換都寫回去。
watch([activeId, date], () => {
  try {
    localStorage.setItem(ACTIVE_STORAGE_KEY, JSON.stringify({ date: date.value, activeId: activeId.value }))
  } catch {
    /* 無痕視窗或停用儲存時就只是不還原，不影響看診。 */
  }
})

watch(date, () => {
  loading.value = true
  items.value = []
  activeId.value = ''
  refresh()
})

// 換成另一筆（或 '' 關閉）之前，先讓目前的工作區把自動存檔送出；存不進去就留在原地。
// 連點好幾列時以最後一次為準。
let pendingSwitch = null
async function switchTo(id) {
  pendingSwitch = id
  const leaving = active.value
  const saved = !workspace.value || id === activeId.value || (await workspace.value.flush())
  if (pendingSwitch !== id) return
  pendingSwitch = null
  if (!saved) {
    toast.error(`「${leaving?.petName || '這筆'}」還有內容沒有儲存成功，請先處理再切換`)
    return
  }
  activeId.value = id
}

// 點一筆只開啟工作區（可以先看資料）；真正開始看診要按「看診」／「開始看診」。
function openPatient(appointment) {
  return switchTo(String(appointment._id))
}

function openFromLink() {
  if (!openParam.value) return
  const target = byId.value.get(openParam.value)
  openParam.value = ''
  if (!target) return
  openPatient(target)
  // 切到那一筆所在的頁籤，左欄才看得到目前選中的是哪一列。
  if (workflowFilter(target, 'handoff')) queueTab.value = 'handoff'
  else if (workflowFilter(target, 'completed')) queueTab.value = 'completed'
  else queueTab.value = 'active'
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

function closeWorkspace(id) {
  if (activeId.value === id) switchTo('')
}

function onWorkspaceUpdate(appointment, action) {
  applyUpdate(appointment)
  if (action === 'handoff') {
    notifyChat(appointment, 'handoff')
    toast.success('已送交櫃台')
    closeWorkspace(String(appointment._id))
  } else if (action === 'reclaim') {
    notifyChat(appointment, 'reclaim')
    toast.success('已取回，可以繼續修改')
  }
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
        <Button variant="secondary" size="icon-sm" aria-label="前一天" @click="date = shiftDateInput(date, -1)"><ChevronLeft stroke-width="1.75" /></Button>
        <DatePicker v-model="date" :clearable="false" aria-label="診務日期" class="w-40" />
        <Button variant="secondary" size="icon-sm" aria-label="後一天" @click="date = shiftDateInput(date, 1)"><ChevronRight stroke-width="1.75" /></Button>
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
                class="flex w-full items-center gap-2 px-4 text-left"
                :class="group.tone === 'surgery' ? 'mt-2 border-y border-surgery/30 bg-surgery-surface py-2 text-surgery' : 'pt-3 pb-1.5 hover:text-foreground'"
                :aria-expanded="!isCollapsed(group.key)"
                :aria-label="`${isCollapsed(group.key) ? '展開' : '收合'}${group.label}`"
                @click="toggleGroup(group.key)"
              >
                <ChevronDown class="size-4 shrink-0 text-subtle-foreground transition-transform" :class="isCollapsed(group.key) ? '-rotate-90' : ''" stroke-width="2" aria-hidden="true" />
                <!-- 手術組的標題列用紫色標出（列本身不上色）：手術一待幾個小時，要一眼看得出哪幾隻在手術中。 -->
                <template v-if="group.tone === 'surgery'">
                  <Scissors class="size-4 shrink-0" stroke-width="2" aria-hidden="true" />
                  <span class="text-sm font-semibold">{{ group.label }}</span>
                  <span class="num inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-surgery px-1.5 text-xs font-semibold text-primary-foreground">{{ group.list.length }}</span>
                  <span class="ml-auto text-xs text-surgery/80">{{ group.hint }}</span>
                </template>
                <template v-else>
                  <span class="spec-label">{{ group.label }}</span>
                  <span class="num text-xs text-subtle-foreground">{{ group.list.length }}</span>
                  <span class="ml-auto text-xs text-subtle-foreground">{{ group.hint }}</span>
                </template>
              </button>
              <p v-if="!isCollapsed(group.key) && !group.list.length" class="px-4 py-3 text-sm text-subtle-foreground">目前沒有</p>

              <ul v-show="!isCollapsed(group.key)">
                <li
                  v-for="item in group.list"
                  :key="item._id"
                  class="group/row flex cursor-pointer items-center gap-3 border-b border-border px-4 transition-colors last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset"
                  :class="[compact ? 'min-h-14 py-2' : 'py-3', String(item._id) === activeId ? 'bg-accent/60' : 'hover:bg-hover']"
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
                      <span v-if="compact" class="min-w-0 flex-1 truncate text-sm text-muted-foreground" v-tip.overflow="item.reason || undefined">{{ item.reason }}</span>
                      <!-- 精簡版的標記只留圖示：一行放不下「手術：結紮」這種整顆徽章，滑過用 tooltip 看全文。 -->
                      <TooltipProvider v-if="compact" :delay-duration="150">
                        <span class="flex shrink-0 items-center gap-1">
                          <Tooltip v-if="item.isSurgery">
                            <TooltipTrigger as-child>
                              <span class="flex size-5 items-center justify-center" :aria-label="`手術：${item.surgeryName || ''}`"><Scissors class="size-4 text-surgery" stroke-width="2" /></span>
                            </TooltipTrigger>
                            <TooltipContent side="top"><span class="font-semibold">手術</span> {{ item.surgeryName || '未填名稱' }}</TooltipContent>
                          </Tooltip>
                          <Tooltip v-if="item.latenessMinutes > 0">
                            <TooltipTrigger as-child>
                              <span class="flex size-5 items-center justify-center" :aria-label="`遲到 ${item.latenessMinutes} 分`"><Clock class="size-4 text-danger" stroke-width="2" /></span>
                            </TooltipTrigger>
                            <TooltipContent side="top"><span class="font-semibold">遲到</span> <span class="num">{{ item.latenessMinutes }}</span> 分</TooltipContent>
                          </Tooltip>
                          <Tooltip v-if="notesFor(item).length">
                            <TooltipTrigger as-child>
                              <span class="flex size-5 items-center justify-center" :aria-label="notesFor(item).map((note) => `${note.label}備註：${note.text}`).join('；')"><AlertTriangle class="size-4" :class="severeNotes(item) ? 'text-danger' : 'text-warning'" stroke-width="2" /></span>
                            </TooltipTrigger>
                            <TooltipContent side="top" class="max-w-sm flex-col items-start gap-1 whitespace-normal">
                              <p v-for="note in notesFor(item)" :key="note.label" class="leading-relaxed"><span class="font-semibold">{{ note.label }}備註</span> {{ note.text }}</p>
                            </TooltipContent>
                          </Tooltip>
                        </span>
                      </TooltipProvider>
                      <!-- 詳細版的狀態與按鈕放在名字這一行：放在整列最右邊會跟下面的來院原因、備註搶寬度，
                           候診的列（有「看診」鈕）內容只剩三分之一寬。 -->
                      <span v-if="!compact" class="ml-auto flex shrink-0 items-center gap-3">
                        <span v-if="statusText(item)" class="num shrink-0 text-xs" :class="waitingTooLong(item) ? 'font-semibold text-danger' : 'text-subtle-foreground'">{{ statusText(item) }}</span>
                        <Button v-if="['onsite', 'surgery'].includes(group.key) && !workflowState(item).started" size="xs" class="shrink-0" :disabled="busy" @click.stop="startVisit(item)"><Stethoscope stroke-width="1.75" />看診</Button>
                        <Button v-if="group.key === 'handoff'" variant="secondary" size="xs" class="shrink-0" :disabled="busy" @click.stop="reclaim(item)"><Undo2 stroke-width="1.75" />取回</Button>
                      </span>
                    </div>
                    <template v-if="!compact">
                      <p class="text-base leading-snug" :class="item.reason ? 'text-foreground' : 'text-subtle-foreground'">{{ item.reason || '未填來院原因' }}</p>
                      <div v-if="item.isSurgery || item.latenessMinutes > 0" class="flex flex-wrap items-center gap-1.5">
                        <SurgeryBadge v-if="item.isSurgery" :name="item.surgeryName" />
                        <LatenessBadge :minutes="item.latenessMinutes" />
                      </div>
                      <PatientNotes :notes="notesFor(item)" />
                      <p v-if="item.internalNote" class="line-clamp-1 text-sm text-muted-foreground" v-tip.overflow="item.internalNote"><span class="font-medium text-foreground">掛號備註</span> {{ item.internalNote }}</p>
                    </template>
                  </div>

                  <template v-if="compact">
                    <span v-if="statusText(item)" class="num shrink-0 text-xs" :class="waitingTooLong(item) ? 'font-semibold text-danger' : 'text-subtle-foreground'">{{ statusText(item) }}</span>
                    <Button v-if="['onsite', 'surgery'].includes(group.key) && !workflowState(item).started" size="xs" class="shrink-0" :disabled="busy" @click.stop="startVisit(item)"><Stethoscope stroke-width="1.75" />看診</Button>
                    <Button v-if="group.key === 'handoff'" variant="secondary" size="xs" class="shrink-0" :disabled="busy" @click.stop="reclaim(item)"><Undo2 stroke-width="1.75" />取回</Button>
                  </template>
                </li>
              </ul>
            </div>
          </template>
        </div>
      </section>

      <section class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card" aria-label="看診工作區">
        <!-- 一次只掛目前這一筆；key 綁掛號 id，換貓就重建，草稿一定是那隻貓自己的。 -->
        <VisitWorkspace v-if="active" ref="workspace" :key="active._id" class="min-h-0 flex-1" :appointment="active" :templates="templates" @updated="onWorkspaceUpdate" @start="startVisit" @notes-updated="onNotesUpdated" @open-record="(appointment) => router.push({ path: `/records/${appointment.recordId}/edit`, query: { visit: appointment._id, visitDate: appointment.date } })" />
        <EmptyState v-if="!active && !loading" :icon="CalendarClock" title="從左邊選一位病患" description="點一筆可以先看資料，按「看診」才會記錄開始時間。輸入會自動存檔，換下一隻前會先存好。" inset class="my-auto" />
      </section>
    </div>
    <TextTemplatePickerDialog />
  </div>
</template>
