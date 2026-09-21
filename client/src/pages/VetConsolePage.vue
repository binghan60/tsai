<script setup>
import MedicationWorkspace from '../components/MedicationWorkspace.vue'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { AlertTriangle, ArrowRight, CalendarClock, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, LayoutList, List, Pill, Pin, RefreshCw, Scissors, Stethoscope, Undo2, X } from '@lucide/vue'
import { http } from '../api/http'
import { getSocket } from '../api/socket'
import { useToast } from '../composables/useToast'
import { useClinicSync } from '../composables/useClinicSync'
import { useSearchQueryParam } from '../composables/useSearchQueryParam'
import { useAppointmentNotifier } from '../composables/useAppointmentNotifier'
import { clinicDateInput, clinicTimeInput, shiftDateInput, weekdayLabel } from '../lib/datetime'
import { workflowFilter, workflowState } from '../../../shared/appointmentWorkflow.js'
import { patientNotesFor, visitTypeLabel } from '../lib/appointmentDisplay'
import PatientNotes from '../components/PatientNotes.vue'
import { usePinnedPetsStore } from '../stores/pinnedPets'
import VisitWorkspace from '../components/VisitWorkspace.vue'
import PinnedPetsList from '../components/PinnedPetsList.vue'
import ModalDialog from '../components/ModalDialog.vue'
import ConsoleChip from '../components/ConsoleChip.vue'
import ConsoleChipBar from '../components/ConsoleChipBar.vue'
import SurgeryBadge from '../components/SurgeryBadge.vue'
import LatenessBadge from '../components/LatenessBadge.vue'
import CheckinNumber from '../components/CheckinNumber.vue'
import EmptyState from '../components/EmptyState.vue'
import ListSkeleton from '../components/ListSkeleton.vue'
import TextTemplatePickerDialog from '../components/formfields/TextTemplatePickerDialog.vue'
import { useTextTemplates } from '../composables/useTextTemplates'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Alert, AlertDescription } from '../components/ui/alert'
import { DatePicker } from '../components/ui/date-picker'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip'
import { medicationTodoCount } from '../../../shared/medicationWorkflow.js'

// 醫師診療台：左欄是今日病患（在院、今日排程；順序固定，點擊不會改變），右欄是可以同時開好幾筆的就診工作區。
// 刻意不做成「點一筆就換頁」——醫師手上常常同時有好幾隻動物在跑（等一隻的檢驗結果
// 時先看下一隻），換頁或 Modal 都會擋住這種來回切換。
//
// 左欄每一筆都直接列出來院原因與寵物／飼主備註：醫師看今天的排程是為了先準備器材，
// 「會咬人」「飼主很難溝通」要在叫進診間之前就知道，不能藏在點開之後。
const router = useRouter()
const toast = useToast()
const { loadTemplates: loadTextTemplates } = useTextTemplates()
const notifyChat = useAppointmentNotifier()
const pinnedPets = usePinnedPetsStore()
const today = clinicDateInput()
const date = useSearchQueryParam('date', today)
const medicationCounts = ref({})
// 醫師在等的只有「待醫師確認」那一段，不是未完成總數——口徑統一在 shared/medicationWorkflow.js。
const medicationTodo = computed(() => medicationTodoCount(medicationCounts.value, 'doctor'))
const medicationSocket = getSocket()
let medicationCountRequest = 0

const items = ref([])
const loading = ref(true)
const error = ref('')
const busy = ref(false)
const templates = ref([])
// 寵物／飼主備註存在主檔上，列表 API 另外回一份以 id 為鍵的對照表（見 routes/appointments.js）。
const patientNotes = ref({ pets: {}, owners: {} })
// 各工作區回報的「有未儲存內容」，佇列上顯示藍點。
const dirtyIds = reactive({})

const COMPACT_STORAGE_KEY = 'clinic.vetConsoleCompact'
function getInitialCompact() {
  try {
    const saved = localStorage.getItem(COMPACT_STORAGE_KEY)
    if (saved !== null) return saved === 'true'
  } catch {}
  return true
}
const isCompact = ref(getInitialCompact())
function setCompact(val) {
  isCompact.value = val
  try {
    localStorage.setItem(COMPACT_STORAGE_KEY, String(val))
  } catch {}
}

// 左欄的「在院」「今日排程」可以各自收合；收合只是藏起卡片（v-show，不重新排序也不卸載），
// 是這台電腦的顯示偏好，跟 isCompact 一樣存 localStorage。
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

// 同時開著的病患（左欄卡片就地標示，不另成群組），各自的未儲存輸入留在各自的工作區元件裡。
//
// 存進 localStorage 是必要的：診間電腦被重新整理、當掉重開、或不小心關掉分頁時，
// 醫師手上那幾隻動物不能跟著消失——留在畫面上的工作區就是他的待辦清單。
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
// 頁首 chip 群開的面板：暫存區／已交櫃台／已完成是「查閱用」的三份清單，藥單是待辦，
// 四者都不是手上的工作，所以不佔左欄「今日病患」的高度——那一欄要留給還要動手的病患。
// 用大 Modal 而不是側欄抽屜：這幾份是「一次看一批、看完就關」，不需要一邊看一邊寫，
// 攤在大面板上一列可以放兩筆，比擠在 384px 的窄欄好讀。一次只開一個，不持久化（重整就關）。
const drawer = ref('')
const now = ref(Date.now())
let clock
let request = 0

const isToday = computed(() => date.value === today)
const byId = computed(() => new Map(items.value.map((item) => [String(item._id), item])))
const openTabs = computed(() => openIds.value.map((id) => byId.value.get(id)).filter(Boolean))
const active = computed(() => byId.value.get(activeId.value) || null)
const isOpen = (item) => openIds.value.includes(String(item._id))
// 左欄的順序只由掛號資料決定（在院依報到時間、待報到依預約時段），跟「有沒有點開」「有沒有按看診」無關：
// 點開、切換、關閉、開始看診都只改卡片的底色與標籤，不會讓卡片換位置或換群組。
const onsite = computed(() => queue('onsite'))
const scheduled = computed(() => items.value.filter((item) => workflowFilter(item, 'scheduled')).sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)))
const handedOff = computed(() => queue('handoff'))
const finished = computed(() => queue('completed'))
const onsiteCount = computed(() => items.value.filter((item) => workflowFilter(item, 'onsite') || workflowFilter(item, 'handoff')).length)
const scheduledCount = computed(() => items.value.filter((item) => workflowFilter(item, 'scheduled')).length)

const mainGroups = computed(() => [
  { key: 'onsite', label: '在院', list: onsite.value, hint: '依報到順序' },
  { key: 'scheduled', label: '今日排程 · 待報到', list: scheduled.value, hint: '依時段' },
])

const referenceDrawers = computed(() => [
  { key: 'pinned', label: '暫存區', icon: Pin, count: pinnedPets.items.length, description: '在聊天室打 @ 標記就會放進來' },
  { key: 'handoff', label: '已交櫃台', icon: ArrowRight, count: handedOff.value.length, description: '櫃台還沒完成處理，可以取回補資料' },
  { key: 'completed', label: '已完成', icon: Check, count: finished.value.length, description: '櫃台已完成處理，點名字可查看內容' },
  // 藥單跟前三顆不同類：那三份是查閱，這一顆是待辦，所以走 todo（紅徽章、0 就不畫），
  // chip 群裡也用一條分隔線隔開。它現在跟其他三顆共用同一個面板，不再是頁面上的第二個 ModalDialog 特例。
  { key: 'medications', label: '藥單', icon: Pill, count: medicationTodo.value, tone: 'todo', description: '查看未完成藥單，並依目前進度完成可執行的處理' },
])
const activeDrawer = computed(() => referenceDrawers.value.find((entry) => entry.key === drawer.value) || null)
const drawerList = computed(() => (drawer.value === 'handoff' ? handedOff.value : drawer.value === 'completed' ? finished.value : []))
function toggleDrawer(key) {
  drawer.value = drawer.value === key ? '' : key
}
// 從查閱清單點病患：Modal 蓋住工作區，開了分頁就要把它關掉，否則看不到剛切過去的那一筆。
function openFromDrawer(appointment) {
  openPatient(appointment)
  drawer.value = ''
}

function queue(filter) {
  return items.value.filter((item) => workflowFilter(item, filter)).sort((a, b) => new Date(a.checkedInAt || a.scheduledAt) - new Date(b.checkedInAt || b.scheduledAt))
}

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
// 待報到的手術卡片淡紫底（跟櫃台頁同一套）：醫師看排程是為了先備器材。
function cardClass(item, groupKey) {
  if (String(item._id) === activeId.value) return 'border-primary bg-accent'
  // 開著但不是目前這一筆：留在原位、只加一圈主色淡框，切換分頁靠點卡片。
  if (isOpen(item)) return 'border-primary/40 bg-card hover:bg-field'
  if (groupKey === 'scheduled' && item.isSurgery) return 'border-surgery/35 bg-surgery-surface/60 hover:bg-surgery-surface'
  return 'border-border bg-card hover:bg-field'
}
function statusMeta(item) {
  const state = workflowState(item)
  if (state.completed) return '已完成'
  if (state.handedOff) return '已交櫃台'
  if (state.started) return `看診 ${minutesSince(item.visitStartedAt)} 分`
  if (item.status === 'arrived') return item.checkedInAt ? `已等 ${minutesSince(item.checkedInAt)} 分` : '候診中'
  if (item.status === 'scheduled') return item.time ? `${item.time} 掛號` : '未報到'
  return ''
}
function notesFor(item) {
  return patientNotesFor(item, patientNotes.value)
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

// 醫師在診間裡看不到櫃台，有人報到要在這頁直接講：從「待報到」變成「已報到」（或新增時就是已報到的現場掛號）
// 就跳一則提示。這頁的 toast 固定在上方，不用點開聊天室。只看今天，翻舊日期不吵。
function announceCheckIn(previous, next) {
  if (!isToday.value || next.status !== 'arrived' || workflowState(next).started) return
  if (previous && previous.status !== 'scheduled') return
  const detail = [next.checkinNumber ? `號碼牌 ${next.checkinNumber}` : '', next.reason].filter(Boolean).join(' · ')
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

const { connected } = useClinicSync(date, refresh, applyUpdate)

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

// 點卡片只開啟工作區（可以先看資料）；真正開始看診要按「看診」／「開始看診」。
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
    // 取回就是要接著補資料，所以直接切到工作區；查閱面板蓋在上面，一併關掉。
    openPatient(data)
    drawer.value = ''
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

async function refreshMedicationCounts() {
  const requestId = ++medicationCountRequest
  try {
    const { data } = await http.get('/medications', { params: { status: 'review', limit: 1 } })
    if (requestId === medicationCountRequest) medicationCounts.value = data.counts || {}
  } catch {
    /* 計數更新失敗時保留目前數字，下一次即時事件或重新連線會再同步。 */
  }
}

onMounted(() => {
  clock = setInterval(() => {
    now.value = Date.now()
  }, 30000)
  loadTemplates()
  loadTextTemplates().catch(() => {})
  refresh()
  refreshMedicationCounts()
  medicationSocket.on('medication:updated', refreshMedicationCounts)
  medicationSocket.on('connect', refreshMedicationCounts)
})
onBeforeUnmount(() => {
  request += 1
  medicationCountRequest += 1
  clearInterval(clock)
  medicationSocket.off('medication:updated', refreshMedicationCounts)
  medicationSocket.off('connect', refreshMedicationCounts)
})
</script>

<template>
  <div class="flex flex-col gap-3 xl:h-[calc(100dvh-2.5rem)]">
    <header class="flex flex-wrap items-center gap-x-4 gap-y-3">
      <div class="flex shrink-0 items-baseline gap-2">
        <h1 class="text-xl font-semibold">醫師診療台</h1>
      </div>
      <!-- 面板群放在標題與日期之間：它們跟「今天是哪一天」無關，也不是主要操作，
           夾在中間才不會跟右邊那組日期控制搶同一塊視線。前三顆是查閱、藥單是待辦，中間一條分隔線。 -->
      <div class="flex flex-1 items-center justify-center">
        <ConsoleChipBar aria-label="工作面板">
          <template v-for="(entry, index) in referenceDrawers" :key="entry.key">
            <span v-if="entry.tone === 'todo' && index" class="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden="true"></span>
            <ConsoleChip :icon="entry.icon" :label="entry.label" :count="entry.count" :tone="entry.tone" :active="drawer === entry.key" @click="toggleDrawer(entry.key)" />
          </template>
        </ConsoleChipBar>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <Button variant="secondary" size="icon-sm" aria-label="前一天" @click="date = shiftDateInput(date, -1)"><ChevronLeft class="h-4 w-4" /></Button>
        <DatePicker v-model="date" :clearable="false" aria-label="診務日期" class="w-36" />
        <Button variant="secondary" size="icon-sm" aria-label="後一天" @click="date = shiftDateInput(date, 1)"><ChevronRight class="h-4 w-4" /></Button>
        <!-- 只在不是今天時出現：當天它一直是 disabled，留著等於白佔 80px，而這一行沒有 80px 可以浪費。 -->
        <Button v-if="date !== today" variant="secondary" size="sm" @click="date = today">今天</Button>
      </div>
    </header>

    <div class="flex min-h-0 flex-1 flex-col gap-3">
      <Alert v-if="error" variant="destructive" class="flex items-center justify-between gap-3">
        <AlertDescription>{{ error }}</AlertDescription>
        <Button variant="secondary" size="sm" @click="refresh"><RefreshCw class="h-4 w-4" />重試</Button>
      </Alert>

      <div class="flex min-h-0 flex-1 flex-col gap-3 xl:flex-row">
        <section class="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card xl:w-100 xl:shrink-0" aria-label="今日病患">
          <header class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
            <div class="flex items-center gap-2">
              <h2 class="text-base font-semibold">今日病患</h2>
              <Badge variant="status" class="bg-accent text-accent-foreground tabular-nums">在院 {{ onsiteCount }} · 待到 {{ scheduledCount }}</Badge>
            </div>
            <div class="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
              <button type="button" class="flex items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors" :class="isCompact ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'" :aria-pressed="isCompact" @click="setCompact(true)" title="精簡版：節省高度，瀏覽更多病患">
                <List class="h-3.5 w-3.5" stroke-width="2" />
                <span>精簡</span>
              </button>
              <button type="button" class="flex items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors" :class="!isCompact ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'" :aria-pressed="!isCompact" @click="setCompact(false)" title="詳細版：完整顯示所有備註與資訊">
                <LayoutList class="h-3.5 w-3.5" stroke-width="2" />
                <span>詳細</span>
              </button>
            </div>
          </header>

          <div class="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
            <ListSkeleton v-if="loading" :rows="4" />
            <template v-else>
              <template v-for="group in mainGroups" :key="group.key">
                <div v-if="group.list.length || !group.hideWhenEmpty" class="pt-2">
                  <button type="button" class="mb-1.5 flex w-full items-center gap-2 rounded-md bg-transparent px-1.5 py-1 text-left text-xs font-semibold text-muted-foreground transition-colors hover:bg-field focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" :aria-expanded="!isCollapsed(group.key)" :aria-label="`${isCollapsed(group.key) ? '展開' : '收合'}${group.label}`" @click="toggleGroup(group.key)">
                    <ChevronDown class="h-3.5 w-3.5 shrink-0 transition-transform" :class="isCollapsed(group.key) ? '-rotate-90' : ''" stroke-width="2" aria-hidden="true" />
                    {{ group.label }}<span class="font-normal">{{ group.list.length }}</span>
                    <span v-if="isCollapsed(group.key) && group.list.some((item) => dirtyIds[String(item._id)])" class="h-2 w-2 shrink-0 rounded-full bg-primary" title="收合的病患有尚未儲存的內容"><span class="sr-only">收合的病患有尚未儲存的內容</span></span>
                    <span v-if="group.hint" class="ml-auto font-normal">{{ group.hint }}</span>
                  </button>
                  <p v-if="!isCollapsed(group.key) && !group.list.length" class="px-1.5 py-2 text-xs text-muted-foreground">目前沒有</p>
                  <article v-for="item in group.list" v-show="!isCollapsed(group.key)" :key="item._id" class="cursor-pointer rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" :class="[cardClass(item, group.key), isCompact ? 'mb-1.5 p-2' : 'mb-2 p-3']" role="button" tabindex="0" :aria-label="`開啟 ${item.petName}`" @click="openPatient(item)" @keydown.enter.self.prevent="openPatient(item)" @keydown.space.self.prevent="openPatient(item)">
                    <!-- 精簡版內容：緊湊兩行式佈局，高度縮減 60%，單行截斷原因，安全警示微標籤（不含 emoji） -->
                    <div v-if="isCompact" class="flex items-start gap-2">
                      <span v-if="group.key === 'scheduled'" class="w-9 shrink-0 pt-0.5 text-xs font-semibold tabular-nums text-muted-foreground">{{ item.time || '未定' }}</span>
                      <CheckinNumber v-else :appointment="item" size="sm" />

                      <div class="min-w-0 flex-1 space-y-0.5">
                        <div class="flex items-center gap-1.5">
                          <span class="truncate text-sm font-semibold" :class="String(item._id) === activeId ? 'text-accent-foreground' : ''">{{ item.petName }}</span>
                          <span class="shrink-0 text-xs text-muted-foreground">{{ [item.species, visitTypeLabel(item)].filter(Boolean).join(' · ') }}</span>

                          <TooltipProvider v-if="notesFor(item).length" :delay-duration="100">
                            <Tooltip>
                              <TooltipTrigger as-child>
                                <button type="button" class="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded bg-warning-surface px-1.5 py-0.5 text-[11px] font-semibold text-warning transition-colors hover:bg-warning/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-warning" :aria-label="notesFor(item).some((n) => n.text.includes('咬') || n.text.includes('凶')) ? '注意備註' : '提醒備註'" @click.stop>
                                  <AlertTriangle class="h-3 w-3" stroke-width="2" aria-hidden="true" />
                                  <span>{{ notesFor(item).some((n) => n.text.includes('咬') || n.text.includes('凶')) ? '注意' : '提醒' }}</span>
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top" align="start" :arrow="false" class="flex flex-col gap-1.5 max-w-xs whitespace-normal rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg">
                                <div v-for="note in notesFor(item)" :key="note.key" class="whitespace-pre-wrap break-words rounded-md bg-warning-surface px-2.5 py-1.5 text-xs font-medium text-warning leading-relaxed">
                                  <span class="font-semibold">{{ note.label }}備註：</span>{{ note.text }}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>

                          <TooltipProvider v-if="item.isSurgery" :delay-duration="100">
                            <Tooltip>
                              <TooltipTrigger as-child>
                                <button type="button" class="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded bg-surgery-surface px-1.5 py-0.5 text-[11px] font-semibold text-surgery transition-colors hover:bg-surgery/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-surgery" :aria-label="item.surgeryName ? `手術：${item.surgeryName}` : '手術'" @click.stop>
                                  <Scissors class="h-3 w-3" stroke-width="2" aria-hidden="true" />
                                  <span>手術</span>
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top" align="start" :arrow="false" class="max-w-xs whitespace-normal rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg">
                                <div class="rounded-md bg-surgery-surface px-2.5 py-1.5 text-xs font-medium text-surgery leading-relaxed"><span class="font-semibold">手術：</span>{{ item.surgeryName?.trim() || '未填手術名稱' }}</div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>

                          <TooltipProvider v-if="item.latenessMinutes > 0" :delay-duration="100">
                            <Tooltip>
                              <TooltipTrigger as-child>
                                <button type="button" class="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded bg-danger-surface px-1.5 py-0.5 text-[11px] font-semibold text-danger tabular-nums transition-colors hover:bg-danger/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-danger" :aria-label="`遲到 ${item.latenessMinutes} 分`" @click.stop>
                                  <Clock class="h-3 w-3" stroke-width="2" aria-hidden="true" />
                                  <span>+{{ item.latenessMinutes }}分</span>
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top" align="start" :arrow="false" class="max-w-xs whitespace-normal rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg">
                                <div class="rounded-md bg-danger-surface px-2.5 py-1.5 text-xs font-medium text-danger leading-relaxed tabular-nums"><span class="font-semibold">遲到：</span>超過預約時間 {{ item.latenessMinutes }} 分鐘</div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>

                          <span v-if="group.key !== 'scheduled'" class="ml-auto shrink-0 text-xs" :class="waitingTooLong(item) ? 'font-semibold text-danger' : 'text-muted-foreground'">{{ statusMeta(item) }}</span>
                          <span v-if="dirtyIds[String(item._id)]" class="h-2 w-2 shrink-0 rounded-full bg-primary" title="有尚未儲存的內容"><span class="sr-only">有尚未儲存的內容</span></span>
                        </div>

                        <p class="truncate text-xs leading-tight" :class="item.reason ? 'text-muted-foreground' : 'text-muted-foreground/60 italic'" :title="item.reason || '未填來院原因'">
                          {{ item.reason || '未填來院原因' }}
                        </p>
                      </div>

                      <Button v-if="group.key === 'onsite' && !workflowState(item).started" size="xs" class="h-7 shrink-0 px-2 text-xs" :disabled="busy" @click.stop="startVisit(item)"><Stethoscope class="h-3.5 w-3.5" />看診</Button>
                      <Button v-if="isOpen(item)" variant="secondary" size="icon-xs" class="h-7 w-7 shrink-0" :aria-label="`關閉 ${item.petName}`" @click.stop="closeTab(String(item._id))"><X class="h-3.5 w-3.5" /></Button>
                    </div>

                    <!-- 詳細版內容：完整展開所有備註、徽章與掛號紀錄 -->
                    <div v-else class="flex items-start gap-2.5">
                      <span v-if="group.key === 'scheduled'" class="w-11 shrink-0 pt-0.5 text-sm font-semibold tabular-nums">{{ item.time || '未定' }}</span>
                      <CheckinNumber v-else :appointment="item" />

                      <div class="min-w-0 flex-1 space-y-1">
                        <div class="flex items-center gap-1.5">
                          <span class="truncate text-sm font-semibold" :class="String(item._id) === activeId ? 'text-accent-foreground' : ''">{{ item.petName }}</span>
                          <span class="shrink-0 text-xs text-muted-foreground">{{ [item.species, visitTypeLabel(item)].filter(Boolean).join(' · ') }}</span>
                          <span v-if="group.key !== 'scheduled'" class="ml-auto shrink-0 text-xs" :class="waitingTooLong(item) ? 'font-semibold text-danger' : 'text-muted-foreground'">{{ statusMeta(item) }}</span>
                          <span v-if="dirtyIds[String(item._id)]" class="h-2 w-2 shrink-0 rounded-full bg-primary" title="有尚未儲存的內容"><span class="sr-only">有尚未儲存的內容</span></span>
                        </div>
                        <p class="text-sm font-medium leading-snug" :class="item.reason ? 'text-foreground' : 'text-muted-foreground'">{{ item.reason || '未填來院原因' }}</p>
                        <div v-if="item.isSurgery || item.latenessMinutes > 0" class="flex flex-wrap items-center gap-1.5">
                          <SurgeryBadge v-if="item.isSurgery" :name="item.surgeryName" />
                          <LatenessBadge :minutes="item.latenessMinutes" />
                        </div>
                        <PatientNotes :notes="notesFor(item)" />
                        <p v-if="item.internalNote" class="line-clamp-1 text-xs text-muted-foreground" :title="item.internalNote"><span class="font-medium text-foreground">掛號備註：</span>{{ item.internalNote }}</p>
                      </div>

                      <Button v-if="group.key === 'onsite' && !workflowState(item).started" size="xs" class="shrink-0" :disabled="busy" @click.stop="startVisit(item)"><Stethoscope class="h-4 w-4" />看診</Button>
                      <Button v-if="isOpen(item)" variant="secondary" size="icon-xs" class="shrink-0" :aria-label="`關閉 ${item.petName}`" @click.stop="closeTab(String(item._id))"><X class="h-3.5 w-3.5" /></Button>
                    </div>
                  </article>
                </div>
              </template>
            </template>
          </div>
        </section>

        <section class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card" aria-label="看診工作區">
          <!-- 每個開著的病患各自掛一個工作區並用 v-show 切換，不是共用一個再換 props——
             元件被銷毀重建就等於把還沒存檔的輸入丟掉，那正是要避免的事。 -->
          <VisitWorkspace v-for="tab in openTabs" v-show="String(tab._id) === activeId" :key="tab._id" class="min-h-0 flex-1" :appointment="tab" :templates="templates" @updated="onWorkspaceUpdate" @start="startVisit" @close="closeTab(String(tab._id))" @dirty="onDirty" @notes-updated="onNotesUpdated" @open-record="(appointment) => router.push({ path: `/records/${appointment.recordId}/edit`, query: { visit: appointment._id, visitDate: appointment.date } })" />
          <EmptyState v-if="!active && !loading" :icon="CalendarClock" title="從左邊選一位病患" description="點卡片可以先看資料，按「看診」才會記錄開始時間。可以同時開好幾位，切換不會清空已輸入的內容。" inset />
        </section>
      </div>

      <!-- 查閱用的大 Modal：一次看一批、看完就關，所以用蓋住畫面的大面板而不是側欄。
         點病患會開／切到工作區分頁並自動關掉這個面板。 -->
      <ModalDialog v-if="activeDrawer" size="xl" :title="activeDrawer.label" :description="activeDrawer.description" :icon="activeDrawer.icon" :count="drawer === 'medications' ? null : activeDrawer.count" @close="drawer = ''">
        <!-- 藥單面板自己要撐滿高度（裡面有清單與詳情兩個檢視要切換），查閱清單則是內容多高就多高、
           min-h 只是不讓「目前沒有」塌成一條窄橫幅——xl 面板有 1280px 寬，內容 100px 高時比例會像壞掉。 -->
        <div v-if="drawer === 'medications'" class="flex h-[min(72vh,52rem)] min-h-96 flex-col p-5 sm:p-6">
          <MedicationWorkspace mode="doctor" initial-filter="review" :stages="['review', 'approved', 'ready']" @counts="medicationCounts = $event" />
        </div>
        <div v-else class="max-h-[min(68vh,48rem)] min-h-72 overflow-y-auto p-5 sm:p-6">
          <template v-if="drawer === 'pinned'">
            <PinnedPetsList />
            <p v-if="!pinnedPets.items.length" class="py-10 text-center text-sm text-muted-foreground">暫存區是空的</p>
          </template>
          <template v-else>
            <p v-if="!drawerList.length" class="py-10 text-center text-sm text-muted-foreground">目前沒有</p>
            <div v-else class="grid gap-2.5 lg:grid-cols-2">
              <article v-for="item in drawerList" :key="item._id" class="flex items-start gap-3 rounded-xl border border-border p-3">
                <CheckinNumber :appointment="item" />
                <div class="min-w-0 flex-1 space-y-1">
                  <div class="flex items-center gap-1.5">
                    <button type="button" class="min-w-0 truncate bg-transparent text-left text-sm font-semibold text-primary" @click="openFromDrawer(item)">{{ item.petName }}</button>
                    <span class="shrink-0 text-xs text-muted-foreground">{{ [item.species, visitTypeLabel(item)].filter(Boolean).join(' · ') }}</span>
                    <span class="ml-auto shrink-0 text-xs text-muted-foreground">{{ statusMeta(item) }}</span>
                  </div>
                  <p class="text-sm leading-snug" :class="item.reason ? '' : 'text-muted-foreground'">{{ item.reason || '未填來院原因' }}</p>
                  <div v-if="item.isSurgery || item.latenessMinutes > 0" class="flex flex-wrap items-center gap-1.5">
                    <SurgeryBadge v-if="item.isSurgery" :name="item.surgeryName" />
                    <LatenessBadge :minutes="item.latenessMinutes" />
                  </div>
                  <PatientNotes :notes="notesFor(item)" />
                </div>
                <Button v-if="drawer === 'handoff'" variant="secondary" size="xs" class="shrink-0" :disabled="busy" @click="reclaim(item)"><Undo2 class="h-4 w-4" />取回</Button>
              </article>
            </div>
          </template>
        </div>
      </ModalDialog>
      <TextTemplatePickerDialog />
    </div>
  </div>
</template>
