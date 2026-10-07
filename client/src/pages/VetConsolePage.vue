<script setup>
import { apiErrorMessage } from '../lib/apiError.js'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { AlertTriangle, ArrowRight, CalendarClock, Check, ChevronLeft, ChevronRight, CircleDashed, Clock, Hourglass, RefreshCw, Stethoscope, Undo2 } from '@lucide/vue'
import { http } from '../api/http'
import { useToast } from '../composables/useToast'
import { useClinicSync } from '../composables/useClinicSync'
import { useSearchQueryParam } from '../composables/useSearchQueryParam'
import { useAppointmentNotifier } from '../composables/useAppointmentNotifier'
import { clinicDateInput, clinicTimeInput, shiftDateInput } from '../lib/datetime'
import { workflowFilter, workflowState } from '../../../shared/appointmentWorkflow.js'
import { latenessLabel, patientNotesFor } from '../lib/appointmentDisplay'
import { isOverdue, minutesPastSchedule } from '../lib/receptionBoard'
import { MIDDAY_BREAK, nowIndexInSession, SESSIONS } from '../lib/appointmentTimeline'
import PatientNotes from '../components/PatientNotes.vue'
import VisitWorkspace from '../components/VisitWorkspace.vue'
import SurgeryBadge from '../components/SurgeryBadge.vue'
import LatenessBadge from '../components/LatenessBadge.vue'
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
// 左欄頂端三個頁籤：進行中／已交櫃台／已完成。後兩個原本是頁首開的大 Modal，
// 現在就地切換，點一筆照樣在右欄開工作區。暫存區、藥單、待辦在右側工具欄。
// 「進行中」是一條清單，整條照預約時間排（在院、手術、還沒報到混在一起）。原本分在院／手術／今日排程三段、各有標題可收合。
// 每一列長得一樣：左邊一律是預約時間（有號碼牌的底下一行小字），名字旁「初診」「手術」標籤，
// 右邊一顆狀態徽章（未報到／候診／看診／交出／完成），手術另外整列淡紫底。
// 順序只由掛號資料決定，點開、切換、看診都不會讓卡片換位置。
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
// 進行中＝在院＋還沒報到，整條照預約時間排（左邊印的就是預約時間，順序要跟它對得上）。
// 候診先後不再是由上往下讀，要看狀態徽章——10:00 還沒來的會停在上面。
const inProgress = computed(() => items.value.filter((item) => workflowFilter(item, 'onsite') || workflowFilter(item, 'scheduled')).sort(byTime('scheduledAt', 1)))
// 已交櫃台：最早交出的在上面（在櫃台前等最久）；已完成：最近完成的在上面。
const handedOff = computed(() => [...queue('handoff')].sort(byTime('handoffAt', 1)))
const finished = computed(() => [...queue('completed')].sort(byTime('deskCompletedAt', -1)))

const QUEUE_TABS = [
  { key: 'active', label: '進行中' },
  { key: 'handoff', label: '已交櫃台' },
  { key: 'completed', label: '已完成' },
]
const queueCounts = computed(() => ({ active: inProgress.value.length, handoff: handedOff.value.length, completed: finished.value.length }))
const rows = computed(() => {
  if (queueTab.value === 'handoff') return handedOff.value
  if (queueTab.value === 'completed') return finished.value
  return inProgress.value
})
const canStart = (item) => queueTab.value === 'active' && item.status !== 'scheduled' && !workflowState(item).started
// 手術整列淡紫底（跟掛號台卡片同一個淡度），只在「進行中」：交出去、完成之後不用再一眼找到它。
// 選中那一列的淡主色底優先，工作區標頭本來就有手術徽章。
function rowTone(item) {
  if (String(item._id) === activeId.value) return 'bg-accent/60'
  if (queueTab.value === 'active' && item.isSurgery) return 'bg-surgery-surface/70 hover:bg-surgery-surface'
  return 'hover:bg-hover'
}

function minutesSince(value) {
  if (!value) return null
  return Math.max(0, Math.floor((now.value - new Date(value).getTime()) / 60000))
}
// 候診超過這個分鐘數，「候診 N 分」變紅——診間裡看不到候診區，數字要自己跳出來。
const LONG_WAIT_MINUTES = 20
function waitingTooLong(item) {
  const state = workflowState(item)
  return item.status === 'arrived' && !state.started && Boolean(item.checkedInAt) && minutesSince(item.checkedInAt) >= LONG_WAIT_MINUTES
}
// 過了預約時段（寬限同掛號台）還沒來的，徽章從「未報到」換成紅色「遲到 N 分」。只看今天。
function overdueMinutes(item) {
  return isToday.value && isOverdue(item, new Date(now.value)) ? minutesPastSchedule(item, new Date(now.value)) : 0
}
// 每一列右邊一顆狀態徽章。顏色跟號碼牌圓圈、掛號台同一套：候診主色淡面、看診中主色實心、交出琥珀、完成綠；
// 未報到灰——醫師對它還沒有事可做。紅色只給要人注意的：候診太久、過了時段還沒來。
const STATUS_TONE = {
  scheduled: 'bg-sunken text-muted-foreground',
  waiting: 'bg-accent text-accent-foreground ring-1 ring-inset ring-primary/30',
  visiting: 'bg-primary text-primary-foreground',
  handoff: 'bg-warning-surface text-warning',
  done: 'bg-success-surface text-success',
  alert: 'bg-danger-surface text-danger',
}
// 徽章只畫圖示＋數字（分鐘或時刻），省下寬度給來院原因；文字放滑過提示與 aria-label。
// 圖示：未報到虛線圓、候診沙漏、看診聽診器、交出箭頭、完成勾。遲到未報到仍是虛線圓、只換紅色——
// 時鐘圖示已經是列上「報到時遲到」的標記，不能再拿來表示別的事。
function minutesValue(value) {
  return `${minutesSince(value)} 分`
}
function statusBadge(item) {
  const state = workflowState(item)
  if (item.status === 'scheduled') {
    const late = overdueMinutes(item)
    return late
      // short：未報到那顆跟「看診」鈕同寬（80px），「遲到 22 分」放不下，縮成「遲 22 分」、全文在滑過提示。
      ? { icon: CircleDashed, value: `${late} 分`, label: latenessLabel(late), short: `遲 ${late} 分`, tone: 'alert' }
      : { icon: CircleDashed, value: '', label: '未報到', tone: 'scheduled' }
  }
  if (state.completed) {
    const at = clinicTimeInput(item.deskCompletedAt)
    return { icon: Check, value: at, label: at ? `${at} 完成` : '已完成', tone: 'done' }
  }
  if (state.handedOff) {
    const at = clinicTimeInput(item.handoffAt)
    return { icon: ArrowRight, value: at, label: at ? `${at} 交出` : '已交櫃台', tone: 'handoff' }
  }
  if (state.started) return { icon: Stethoscope, value: minutesValue(item.visitStartedAt), label: `看診 ${minutesValue(item.visitStartedAt)}`, tone: 'visiting' }
  if (item.status === 'arrived') {
    return item.checkedInAt
      ? { icon: Hourglass, value: minutesValue(item.checkedInAt), label: `候診 ${minutesValue(item.checkedInAt)}`, tone: waitingTooLong(item) ? 'alert' : 'waiting' }
      : { icon: Hourglass, value: '', label: '候診中', tone: 'waiting' }
  }
  return null
}
// 左側軌道上的圓點，跟狀態徽章同一套判斷：看診中實心、候診空心、未報到灰虛線、遲到未報到紅虛線、
// 候診太久紅框、交出琥珀、完成綠。外觀跟掛號台時間軸的軌道點同一組。
const DOT_TONE = {
  scheduled: 'border-2 border-dashed border-border-strong bg-card',
  late: 'border-2 border-dashed border-danger bg-card',
  waiting: 'border-2 border-primary bg-card',
  waitingLong: 'border-2 border-danger bg-card',
  visiting: 'bg-primary ring-4 ring-primary/20',
  handoff: 'bg-warning ring-4 ring-warning/20',
  done: 'bg-success',
}
function dotTone(item, status) {
  if (item.status === 'scheduled') return status?.tone === 'alert' ? 'late' : 'scheduled'
  if (status?.tone === 'alert') return 'waitingLong'
  return status?.tone || 'scheduled'
}
const currentTime = computed(() => clinicTimeInput(new Date(now.value)))
// 「進行中」照預約時間排，跟掛號台時間軸一樣插「現在」虛線（只在今天、門診時間內）與午休分隔（上下午都有人才畫）。
const rowViews = computed(() => {
  const views = rows.value.map((item) => {
    const status = statusBadge(item)
    return { kind: 'row', key: String(item._id), item, status, dot: DOT_TONE[dotTone(item, status)] }
  })
  if (queueTab.value !== 'active') return views
  const breakAt = rows.value.findIndex((item) => item.time >= MIDDAY_BREAK.end)
  const nowAt = isToday.value && currentTime.value >= SESSIONS[0].start && currentTime.value <= SESSIONS.at(-1).end ? nowIndexInSession(rows.value, new Date(now.value)) : -1
  const result = []
  views.forEach((view, index) => {
    if (index === breakAt && index > 0) result.push({ kind: 'break', key: 'break' })
    if (index === nowAt) result.push({ kind: 'now', key: 'now' })
    result.push(view)
  })
  if (nowAt === views.length && views.length) result.push({ kind: 'now', key: 'now' })
  return result
})
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
    toast.error(apiErrorMessage(err, '開始看診失敗，請稍後重試'))
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
    toast.error(apiErrorMessage(err, '取回失敗，請稍後重試'))
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
        <!-- 這一排的控制項都是 40 高：日期前後鈕跟日期欄同高（掛號台頁首同一組）。 -->
        <Button v-if="date !== today" variant="soft" @click="date = today">回到今天</Button>
        <Button variant="secondary" size="icon" aria-label="前一天" @click="date = shiftDateInput(date, -1)"><ChevronLeft stroke-width="1.75" /></Button>
        <DatePicker v-model="date" :clearable="false" aria-label="診務日期" class="w-40" />
        <Button variant="secondary" size="icon" aria-label="後一天" @click="date = shiftDateInput(date, 1)"><ChevronRight stroke-width="1.75" /></Button>
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
          <p v-else-if="!rows.length" class="px-4 py-3 text-sm text-subtle-foreground">目前沒有</p>
          <ul v-else>
            <template v-for="{ kind, key, item, status, dot } in rowViews" :key="key">
            <li v-if="kind === 'now'" class="flex items-center gap-2 border-b border-border px-4 py-1" :aria-label="`現在 ${currentTime}`">
              <span class="num w-12 shrink-0 text-xs font-semibold text-primary">{{ currentTime }}</span>
              <span class="h-0 flex-1 border-t-2 border-dashed border-primary" aria-hidden="true"></span>
              <span class="shrink-0 text-xs font-semibold text-primary">現在</span>
            </li>
            <li v-else-if="kind === 'break'" class="flex items-center gap-2 border-b border-border bg-sunken px-4 py-1.5 text-xs text-subtle-foreground" :aria-label="`${MIDDAY_BREAK.label} ${MIDDAY_BREAK.start} 到 ${MIDDAY_BREAK.end}`">
              <span class="font-semibold">{{ MIDDAY_BREAK.label }}</span>
              <span class="num">{{ MIDDAY_BREAK.start }}–{{ MIDDAY_BREAK.end }}</span>
            </li>
            <li
              v-else
              class="group/row flex cursor-pointer gap-2.5 border-b border-border px-4 transition-colors last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset"
              :class="[compact ? 'min-h-14 items-center py-2' : 'items-start py-3', rowTone(item)]"
              :aria-current="String(item._id) === activeId ? 'true' : undefined"
              role="button"
              tabindex="0"
              :aria-label="`開啟 ${item.petName}，${status?.label || ''}`"
              @click="openPatient(item)"
              @keydown.enter.self.prevent="openPatient(item)"
              @keydown.space.self.prevent="openPatient(item)"
            >
              <!-- 每一列左邊都是預約時間；已報到的底下一行號碼牌，還沒取號就空著。行高壓到 20＋16，精簡版有沒有號碼都是同一個列高。 -->
              <span class="flex w-12 shrink-0 flex-col">
                <span class="num text-base leading-5 font-semibold text-foreground">{{ item.time }}</span>
                <span v-if="item.checkinNumber != null" class="num text-xs leading-4 text-muted-foreground">{{ item.checkinNumber }} 號</span>
              </span>
              <!-- 軌道：一條直線貫穿整份清單（往上下撐滿列的內距），圓點是這一筆的階段。精簡版置中，詳細版對齊第一行。 -->
              <span class="relative w-3.5 shrink-0 self-stretch" :class="compact ? '-my-2' : '-my-3'" aria-hidden="true">
                <span class="absolute inset-y-0 left-1.5 w-0.5 bg-border"></span>
                <span class="absolute left-0.5 size-3 rounded-full" :class="[dot, compact ? 'top-1/2 -translate-y-1/2' : 'top-4.5']"></span>
              </span>

              <div class="min-w-0 flex-1" :class="compact ? '' : 'space-y-1'">
                <div class="flex min-w-0 items-center gap-2">
                  <span class="truncate text-base font-semibold text-foreground">{{ item.petName }}</span>
                  <Badge v-if="item.visitType === 'new'" variant="status" class="h-6 bg-info-surface px-2 text-info">初診</Badge>
                  <!-- 精簡版只寫「手術」（一行放不下「手術：結紮」），手術名稱滑過才出；詳細版整顆帶名稱。 -->
                  <SurgeryBadge v-if="item.isSurgery" :name="item.surgeryName" :short="compact" class="h-6 min-w-0 shrink px-2" />
                  <span v-if="compact" class="min-w-0 flex-1 truncate text-sm text-muted-foreground" v-tip.overflow="item.reason || undefined">{{ item.reason }}</span>
                  <TooltipProvider v-if="compact" :delay-duration="150">
                    <span class="flex shrink-0 items-center gap-1">
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
                  <!-- 詳細版兩行：第一行名字、標籤、狀態徽章，第二行來院原因＋按鈕。 -->
                  <Badge v-if="!compact && status && item.status !== 'scheduled'" variant="status" class="num ml-auto h-6 px-2" :class="STATUS_TONE[status.tone]" v-tip="status.label" :aria-label="status.label"><component :is="status.icon" stroke-width="2" aria-hidden="true" />{{ status.value }}</Badge>
                </div>
                <template v-if="!compact">
                  <div class="flex min-w-0 items-center gap-2">
                    <p class="min-h-lh min-w-0 flex-1 text-base leading-snug text-muted-foreground">{{ item.reason }}</p>
                    <span v-if="item.status === 'scheduled'" class="inline-flex h-9 w-20 shrink-0 items-center justify-center rounded-lg px-2 text-sm whitespace-nowrap leading-none font-semibold" :class="status?.tone === 'alert' ? 'border border-destructive/30 bg-destructive-surface text-destructive' : 'bg-secondary text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]'">{{ status?.short || status?.label }}</span>
                    <Button v-if="canStart(item)" size="xs" class="w-20 shrink-0" :disabled="busy" @click.stop="startVisit(item)"><Stethoscope stroke-width="1.75" />看診</Button>
                    <Button v-if="queueTab === 'handoff'" variant="secondary" size="xs" class="w-20 shrink-0" :disabled="busy" @click.stop="reclaim(item)"><Undo2 stroke-width="1.75" />取回</Button>
                  </div>
                  <div v-if="item.latenessMinutes > 0" class="flex flex-wrap items-center gap-1.5">
                    <LatenessBadge :minutes="item.latenessMinutes" />
                  </div>
                  <PatientNotes :notes="notesFor(item)" />
                  <p v-if="item.internalNote" class="line-clamp-1 text-sm text-muted-foreground" v-tip.overflow="item.internalNote"><span class="font-medium text-foreground">掛號備註</span> {{ item.internalNote }}</p>
                </template>
              </div>

              <template v-if="compact">
                <Badge v-if="status && item.status !== 'scheduled'" variant="status" class="num h-6 px-2" :class="STATUS_TONE[status.tone]" v-tip="status.label" :aria-label="status.label"><component :is="status.icon" stroke-width="2" aria-hidden="true" />{{ status.value }}</Badge>
                <span v-if="item.status === 'scheduled'" class="inline-flex h-9 w-20 shrink-0 items-center justify-center rounded-lg px-2 text-sm whitespace-nowrap leading-none font-semibold" :class="status?.tone === 'alert' ? 'border border-destructive/30 bg-destructive-surface text-destructive' : 'bg-secondary text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]'">{{ status?.short || status?.label }}</span>
                <Button v-if="canStart(item)" size="xs" class="w-20 shrink-0" :disabled="busy" @click.stop="startVisit(item)"><Stethoscope stroke-width="1.75" />看診</Button>
                <Button v-if="queueTab === 'handoff'" variant="secondary" size="xs" class="w-20 shrink-0" :disabled="busy" @click.stop="reclaim(item)"><Undo2 stroke-width="1.75" />取回</Button>
              </template>
            </li>
            </template>
          </ul>
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
