<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import PatientLink from '../components/PatientLink.vue'
import { AlertTriangle, CalendarPlus, Cat, Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Copy, Pill, Plus, RefreshCw, X } from '@lucide/vue'
import { http } from '../api/http'
import { useToast } from '../composables/useToast'
import { useClinicSync } from '../composables/useClinicSync'
import { useSearchQueryParam } from '../composables/useSearchQueryParam'
import { useAppointmentNotifier } from '../composables/useAppointmentNotifier'
import { canRequestLab, useLabRequest } from '../composables/useLabRequest'
import { clinicDateInput, clinicTimeInput, shiftDateInput, weekdayLabel } from '../lib/datetime'
import { appointmentsForTimeline, groupBySession, isIdentityConfirmed, MIDDAY_BREAK, nowIndexInSession } from '../lib/appointmentTimeline'
import { isOverdue, minutesPastSchedule, sessionAutoCollapsed } from '../lib/receptionBoard'
import { workflowFilter, workflowState } from '../../../shared/appointmentWorkflow.js'
import { patientNotesFor } from '../lib/appointmentDisplay'
import { useUtilityPanelStore } from '../stores/utilityPanel'
import { useWorkCountsStore } from '../stores/workCounts'
import PatientNotes from '../components/PatientNotes.vue'
import HandoffSheet from '../components/HandoffSheet.vue'
import RowActions from '../components/RowActions.vue'
import SurgeryBadge from '../components/SurgeryBadge.vue'
import LatenessBadge from '../components/LatenessBadge.vue'
import AppointmentDialog from '../components/AppointmentDialog.vue'
import CheckInDrawer from '../components/CheckInDrawer.vue'
import CheckInDialog from '../components/CheckInDialog.vue'
import CancelAppointmentDialog from '../components/CancelAppointmentDialog.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import FilterBar from '../components/FilterBar.vue'
import ListSkeleton from '../components/ListSkeleton.vue'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import PageHeader from '../components/PageHeader.vue'
import { Alert, AlertDescription } from '../components/ui/alert'
import { DatePicker } from '../components/ui/date-picker'

// 掛號台：上方一條流程列（待報到 → 在院 → 待櫃台處理 → 已完成，一格一個數字，點一格只看那一段），
// 下面整頁是看診時間軸——依預約時段排、左側軌道、時段可收合、「現在」虛線。
// 真正要人注意的例外（醫師申請修改、遲到還沒報到、待審初診）浮到流程列下方的警示列。
//
// 新增／修改掛號是置中的雙欄 Modal（AppointmentDialog）；初診報到開在時間軸右側（要一邊建檔一邊看時間軸）。
// 暫存區、藥單、待辦、初診、聊天都在右側工具欄。
const toast = useToast()
const notifyChat = useAppointmentNotifier()
const panel = useUtilityPanelStore()
const counts = useWorkCountsStore()
const today = clinicDateInput()
const date = useSearchQueryParam('date', today)
const search = useSearchQueryParam('q', '')
const selected = useSearchQueryParam('selected', '')
const stageFilter = useSearchQueryParam('stage', '')

const items = ref([])
// 貓咪／飼主備註存在主檔上、不在掛號快照裡，由列表 API 另外回一份以 id 為鍵的對照表。
const patientNotes = ref({ pets: {}, owners: {} })
const loading = ref(true)
const error = ref('')
const busy = ref(false)
const dialog = ref('')
const dialogError = ref('')
const target = ref(null)
const confirmation = ref(null)
const templates = ref([])
const defaultTemplate = ref('')
const now = ref(Date.now())
let clock
let request = 0

// 右側抽屜（初診報到）與掛號 Modal 共用這個狀態：一次只會開一個。
const drawer = ref('')

const keyword = computed(() => search.value.trim().toLowerCase())
function matches(appointment) {
  if (!keyword.value) return true
  return `${appointment.petName} ${appointment.ownerName} ${appointment.ownerPhone} ${appointment.reason}`.toLowerCase().includes(keyword.value)
}
function tray(filter, sortKey) {
  return items.value.filter((item) => workflowFilter(item, filter) && matches(item)).sort((a, b) => new Date(a[sortKey] || a.scheduledAt) - new Date(b[sortKey] || b.scheduledAt))
}

const isToday = computed(() => date.value === today)
const handoffs = computed(() => tray('handoff', 'handoffAt'))
const waiting = computed(() => tray('waiting', 'checkedInAt'))
const visiting = computed(() => tray('visiting', 'visitStartedAt'))
const scheduled = computed(() => tray('scheduled', 'scheduledAt'))
const closedAppointments = computed(() => tray('cancelled', 'scheduledAt'))
const followUps = computed(() => tray('followup', 'handoffAt').filter((item) => workflowState(item).completed))
const reopenRequests = computed(() => items.value.filter((item) => workflowState(item).completed && item.reopenRequest?.requestedAt && !item.reopenRequest?.approvedAt && matches(item)).sort((a, b) => new Date(a.reopenRequest.requestedAt) - new Date(b.reopenRequest.requestedAt)))
const finished = computed(() => tray('completed', 'deskCompletedAt').filter((item) => !item.reopenRequest?.requestedAt || item.reopenRequest?.approvedAt))
const overdue = computed(() => (isToday.value ? scheduled.value.filter((item) => isOverdue(item, new Date(now.value))) : []))
const activePatient = computed(() => items.value.find((item) => String(item._id) === selected.value) || null)
const currentTime = computed(() => clinicTimeInput(new Date(now.value)))
const hasAlerts = computed(() => reopenRequests.value.length || overdue.value.length || counts.intake)
const drawerVisible = computed(() => drawer.value === 'check-in')

// ── 流程列與時間軸 ──────────────────────────────────────────────────────────
// 流程列的四格就是四個篩選：點了只看那一段，再點一次清除。
// dot 是這一段在時間軸軌道上的點色，流程列本身就是圖例。
const STAGES = [
  { key: 'scheduled', label: '待報到', dot: 'bg-subtle-foreground/60' },
  { key: 'onsite', label: '在院', dot: 'bg-primary' },
  { key: 'handoff', label: '待櫃台處理', dot: 'bg-warning' },
  { key: 'completed', label: '已完成', dot: 'bg-success' },
]
const stageCounts = computed(() => ({
  scheduled: scheduled.value.length,
  onsite: waiting.value.length + visiting.value.length,
  handoff: handoffs.value.length,
  completed: finished.value.length,
}))
function stageHint(key) {
  if (key === 'scheduled') return overdue.value.length ? `${overdue.value.length} 位已遲到` : '依預約時段'
  if (key === 'onsite') return `看診中 ${visiting.value.length}，候診 ${waiting.value.length}`
  if (key === 'handoff') return '飼主正在櫃台等'
  return followUps.value.length ? `待安排回診 ${followUps.value.length}` : ''
}
function toggleStage(key) {
  stageFilter.value = stageFilter.value === key ? '' : key
}

// 時間軸只放進行中的掛號（待報到、候診／看診中、待櫃台），依預約時間排；已完成與未到／取消收在下面。
const timelineItems = computed(() => appointmentsForTimeline(items.value.filter((item) => matches(item) && (!stageFilter.value || workflowFilter(item, stageFilter.value)))))
// 每張卡片要用到的階段外觀、進度、按鈕先在這裡算好一次，模板裡不逐項呼叫函式——
// 每 30 秒的時鐘一動，整條時間軸都會重算一遍，卡片多的日子開視窗會頓。
// 在院的卡片：伺服器有開「送 IDEXX」時多一項送 IDEXX／取消送 IDEXX（跟診療台的按鈕是同一件事）。
const labRequest = useLabRequest()
function arrivedActions(item) {
  const lab = labRequest.enabled.value && canRequestLab(item)
    ? [item.labRequestedAt ? { key: 'lab-cancel', label: '取消送 IDEXX' } : { key: 'lab-request', label: '送 IDEXX' }]
    : []
  return [...lab, { key: 'restore', label: '取消報到' }, { key: 'edit', label: '修改掛號' }]
}
function decorate(item) {
  const kind = cardTone(item)
  return {
    ...item,
    ui: {
      kind,
      tone: TONE[kind],
      confirmed: isIdentityConfirmed(item),
      progress: progress(item, kind),
      notes: notesFor(item),
      primary: item.status === 'scheduled' ? scheduledPrimary(item) : null,
      actions: item.status === 'scheduled' ? scheduledActions(item) : arrivedActions(item),
      lateMinutes: item.status === 'scheduled' ? (itemIsOverdue(item) ? overdueMinutes(item) : 0) : item.latenessMinutes,
    },
  }
}
const timeline = computed(() => groupBySession(timelineItems.value).map((group) => ({ ...group, rows: group.items.map(decorate) })))
const timelineCount = computed(() => timelineItems.value.length)

// 還要櫃台動手的：遲到未報到、待櫃台處理。時段結束後有這些就不自動收合。
function isPending(item) {
  return itemIsOverdue(item) || workflowFilter(item, 'handoff')
}
// 使用者手動開合過的時段以手動為準，其餘照「時段已結束且沒有待處理」自動收合。
const manualCollapse = reactive({})
function isCollapsed(group) {
  if (group.session.id in manualCollapse) return manualCollapse[group.session.id]
  return sessionAutoCollapsed(group, { now: new Date(now.value), isToday: isToday.value, isPending })
}
function toggleSession(group) {
  manualCollapse[group.session.id] = !isCollapsed(group)
}
function pendingCount(group) {
  return group.items.filter(isPending).length
}
function nowPosition(group) {
  if (!isToday.value || currentTime.value < group.session.start || currentTime.value > group.session.end) return -1
  return nowIndexInSession(group.items, new Date(now.value))
}

function minutesSince(value) {
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return 0
  return Math.max(0, Math.floor((now.value - time) / 60000))
}
function overdueMinutes(item) {
  return isToday.value ? minutesPastSchedule(item, new Date(now.value)) : 0
}
function itemIsOverdue(item) {
  return isToday.value && isOverdue(item, new Date(now.value))
}
// 櫃台只看飼主備註——面對的是飼主本人；貓咪備註（會咬人、保定方式）是給診間的。
function notesFor(item) {
  return patientNotesFor(item, patientNotes.value).filter((note) => note.key === 'owner')
}
function closedStatusMeta(appointment) {
  if (appointment.status === 'no_show') return { label: '未到診', class: 'bg-warning-surface text-warning' }
  return { label: '已取消', class: 'bg-sunken text-muted-foreground' }
}

// 時間軸卡片的階段外觀：卡片底色、軌道上的點走同一套判斷。
// 還沒報到的卡片才用遲到（紅）／手術（紫）當底色；報到之後階段色接手，遲到／手術只留徽章。
function cardTone(item) {
  const state = workflowState(item)
  if (item.status === 'pending_checkout' || (state.handedOff && !state.completed)) return 'handoff'
  if (item.status === 'arrived') return state.started ? 'visiting' : 'waiting'
  if (itemIsOverdue(item)) return 'late'
  if (item.isSurgery) return 'surgery'
  return 'scheduled'
}
const TONE = {
  // 待櫃台處理用白底加琥珀外框：卡片裡的「請轉告飼主」與飼主備註本身是琥珀底，底色也琥珀會糊成一片。
  handoff: { card: 'border-warning/60 bg-card shadow-[inset_3px_0_0_var(--warning)]', dot: 'bg-warning ring-4 ring-warning/20', status: 'text-warning' },
  visiting: { card: 'border-primary/30 bg-accent/60', dot: 'bg-primary ring-4 ring-primary/20', status: 'text-accent-foreground' },
  waiting: { card: 'border-primary/30 bg-accent/60', dot: 'bg-primary ring-4 ring-primary/20', status: 'text-accent-foreground' },
  late: { card: 'border-danger/30 bg-danger-surface/70', dot: 'bg-danger ring-4 ring-danger/20', status: 'text-danger' },
  surgery: { card: 'border-surgery/30 bg-surgery-surface/70', dot: 'bg-surgery ring-4 ring-surgery/20', status: 'text-muted-foreground' },
  scheduled: { card: 'border-border bg-card hover:bg-hover', dot: 'bg-subtle-foreground/50', status: 'text-muted-foreground' },
}
// 卡片右側「進度」欄：一行狀態＋一行時間，跟飼主、電話兩欄上下對齊。
function progress(item, kind) {
  const number = item.checkinNumber ? `${item.checkinNumber} 號` : ''
  if (kind === 'handoff') return { label: '待櫃台處理', detail: `交出 ${minutesSince(item.handoffAt)} 分`, number }
  if (kind === 'visiting') return { label: '看診中', detail: `${minutesSince(item.visitStartedAt)} 分`, number }
  if (kind === 'waiting') return { label: '候診中', detail: item.checkedInAt ? `${clinicTimeInput(item.checkedInAt)} 報到` : '', number }
  if (kind === 'late') return { label: '遲到未報到', detail: `已遲 ${overdueMinutes(item)} 分`, number: '' }
  return { label: '未報到', detail: '', number: '' }
}
// 整張卡片可點：已交櫃台／已完成開處理視窗，待審初診表開初診面板，其餘開修改掛號。右側按鈕留給主要動作。
function cardClick(item) {
  const state = workflowState(item)
  if (state.handedOff) return openSheet(item)
  if (item.visitType === 'new' && item.intakeSubmissionId && !item.petId) return openIntakeReview(item)
  return openDrawer('edit', item)
}
async function copyPhone(phone) {
  try {
    await navigator.clipboard.writeText(phone)
    toast.success(phone, '已複製電話')
  } catch {
    toast.error('無法複製，請手動選取電話')
  }
}

function isInitialDataPending(appointment) {
  return appointment.visitType === 'new' && !appointment.petId && Boolean(appointment.intakeVerificationCode) && !appointment.intakeSubmissionId
}

// 待報到卡片上唯一的主要按鈕。資料齊全的回診一鍵報到；初診要建檔，開抽屜。
// 已超過寬限還沒報到的，報到鈕改成實心紅——在一整排主色按鈕裡一眼挑得出來。
function scheduledPrimary(item) {
  if (item.visitType === 'new' && item.intakeSubmissionId && !item.petId) return { label: '審核', run: () => openIntakeReview(item) }
  if (isInitialDataPending(item)) return null
  const late = itemIsOverdue(item)
  if (!item.petId) return { label: '報到…', late, run: () => openDrawer('check-in', item) }
  return { label: late ? '遲到' : '報到', late, run: () => quickCheckIn(item) }
}
function scheduledActions(item) {
  const actions = []
  if (item.petId) actions.push({ key: 'check-in-detail', label: '報到（改到院時間／號碼牌）' })
  if (!isInitialDataPending(item)) actions.push({ key: 'no-show', label: '標記未到' })
  actions.push({ key: 'edit', label: '修改掛號' })
  actions.push({ key: 'cancel', label: '取消掛號', danger: true })
  return actions
}

// 飼主送出的初診表在右側初診面板裡逐欄審核。
function openIntakeReview(item) {
  panel.push({ type: 'review', submissionId: String(item.intakeSubmissionId) }, 'intake')
}

async function refresh() {
  const token = ++request
  const requested = date.value
  try {
    const { data } = await http.get('/appointments', { params: { date: requested } })
    if (token !== request) return
    items.value = data.items || []
    patientNotes.value = { pets: data.patientNotes?.pets || {}, owners: data.patientNotes?.owners || {} }
    error.value = ''
  } catch {
    if (token === request) error.value = '資料更新失敗，請重新載入；目前顯示的可能不是最新進度。'
  } finally {
    if (token === request) loading.value = false
  }
}

function applyUpdate(item) {
  if (item.date !== date.value) {
    items.value = items.value.filter((p) => String(p._id) !== String(item._id))
    return
  }
  const index = items.value.findIndex((p) => String(p._id) === String(item._id))
  if (index < 0) items.value.push(item)
  else if ((item.__v ?? 0) >= (items.value[index].__v ?? 0)) items.value[index] = item
}

function suggestedCheckinNumber() {
  const used = new Set()
  for (const appointment of items.value) {
    for (const number of [appointment.checkinNumber, ...(appointment.checkinNumberHistory ?? [])]) {
      if (Number.isSafeInteger(number) && number > 0) used.add(number)
    }
  }
  let candidate = 1
  while (used.has(candidate)) candidate += 1
  return candidate
}

useClinicSync(date, refresh, applyUpdate)
watch(date, () => {
  loading.value = true
  items.value = []
  selected.value = ''
  for (const key of Object.keys(manualCollapse)) delete manualCollapse[key]
  if (drawer.value === 'edit' || drawer.value === 'check-in') drawer.value = ''
  refresh()
})

function openSheet(appointment) {
  selected.value = String(appointment._id)
}

function onSheetUpdate(appointment, action, options = {}) {
  applyUpdate(appointment)
  if (action === 'complete') {
    notifyChat(appointment, 'desk_complete')
    toast.success('已完成處理')
  } else if (action === 'followup') {
    notifyChat(appointment, 'follow_up')
    if (!options.silentToast) toast.success('回診已預約')
  }
}

function openDrawer(kind, appointment = null) {
  dialogError.value = ''
  target.value = appointment
  drawer.value = kind
}
function closeDrawer() {
  drawer.value = ''
  dialogError.value = ''
}

// 次要操作（⋯ 選單、未到／取消）共用同一個分派。
async function toggleLabRequest(appointment, requested) {
  const data = await labRequest.setLabRequest(appointment, requested)
  if (data) applyUpdate(data)
}

function admin(kind, appointment) {
  if (kind === 'lab-request' || kind === 'lab-cancel') return toggleLabRequest(appointment, kind === 'lab-request')
  target.value = appointment
  dialogError.value = ''
  if (kind === 'edit') return openDrawer('edit', appointment)
  if (kind === 'cancel' || kind === 'check-in-detail') {
    dialog.value = kind
    return
  }
  confirmation.value = {
    kind,
    title: kind === 'no-show' ? '標記這筆預約未到？' : appointment.status === 'arrived' ? '取消這筆報到？' : '恢復為待報到？',
  }
}

// 回診資料齊全就不必開任何視窗：號碼牌自動配發，超過寬限時間自動記遲到（分鐘數由後端從預約時間起算），
// 按錯了從提示上「復原」。要指定到院時間或號碼牌，走 ⋯ 選單裡的「報到（改到院時間／號碼牌）」。
async function quickCheckIn(item) {
  if (busy.value) return
  busy.value = true
  const late = itemIsOverdue(item)
  try {
    const { data } = await http.post(`/appointments/${item._id}/check-in`, { version: item.__v ?? 0, isLate: late })
    applyUpdate(data)
    notifyChat(data, 'check_in')
    const detail = [`號碼牌 ${data.checkinNumber}`, late && data.latenessMinutes ? `記遲到 ${data.latenessMinutes} 分` : ''].filter(Boolean).join('，')
    toast.success(detail, `${data.petName} 已報到`, { action: { label: '復原', handler: () => undoCheckIn(data._id) } })
  } catch (err) {
    toast.error(err.response?.data?.message || '報到失敗，請稍後重試')
  } finally {
    busy.value = false
  }
}

async function undoCheckIn(id) {
  const current = items.value.find((item) => String(item._id) === String(id))
  if (!current || current.status !== 'arrived' || workflowState(current).started) {
    toast.error('這筆已經開始看診或狀態已變更，無法復原')
    return
  }
  try {
    const { data } = await http.post(`/appointments/${id}/restore`, { version: current.__v ?? 0 })
    applyUpdate(data)
    notifyChat(data, 'undo_check_in')
    toast.success(`${data.petName} 已退回待報到`, '已復原')
  } catch (err) {
    toast.error(err.response?.data?.message || '復原失敗，請從卡片取消報到')
  }
}

const NOTIFICATIONS = { 'check-in': 'check_in', 'check-in-detail': 'check_in', cancel: 'cancel', 'no-show': 'no_show', edit: 'edit' }
const ENDPOINTS = { 'check-in-detail': 'check-in' }
async function submit(values, kind) {
  if (busy.value) return
  busy.value = true
  dialogError.value = ''
  const previousStatus = target.value?.status
  try {
    let data
    if (kind === 'new') ({ data } = await http.post('/appointments', values))
    else if (kind === 'edit') ({ data } = await http.put(`/appointments/${target.value._id}`, { version: target.value.__v ?? 0, ...values }))
    else ({ data } = await http.post(`/appointments/${target.value._id}/${ENDPOINTS[kind] || kind}`, { version: target.value.__v ?? 0, ...values }))
    applyUpdate(data)
    // 恢復是兩種動作共用一支端點：從候診退回待報到叫「取消報到」，
    // 從已取消／未到回來叫「恢復掛號」，聊天室要講得出差別。
    const action = kind === 'new' ? 'create' : kind === 'restore' ? (previousStatus === 'arrived' ? 'undo_check_in' : 'restore') : NOTIFICATIONS[kind]
    if (action) notifyChat(data, action)
    if (['new', 'edit', 'check-in'].includes(kind) && drawer.value === kind) drawer.value = ''
    dialog.value = ''
    confirmation.value = null
    if (kind === 'new' && data.visitType === 'new') toast.success(`初診掛號已建立，驗證碼：${data.intakeVerificationCode}`)
    // 掛到別天的不會出現在今天的時間軸上，提示要講清楚掛在哪一天。
    else if (kind === 'new' || kind === 'edit') toast.success(`${data.date}（${weekdayLabel(data.date)}）${data.time}`, `${data.petName} 已掛號`)
    else toast.success('診務資料已更新')
  } catch (err) {
    dialogError.value = err.response?.data?.message || '操作失敗，請稍後重試'
    if (confirmation.value) toast.error(dialogError.value)
  } finally {
    busy.value = false
  }
}

async function loadTemplates() {
  try {
    const [{ data: forms }, { data: settings }] = await Promise.all([http.get('/settings/form-templates'), http.get('/settings/appointment-settings')])
    templates.value = forms
    defaultTemplate.value = settings.defaultAppointmentTemplateId || ''
  } catch {
    toast.error('無法載入表單選項，請稍後再試')
  }
}

function newMedication() {
  panel.push({ type: 'create' }, 'medications')
}

onMounted(() => {
  clock = setInterval(() => {
    now.value = Date.now()
  }, 30000)
  loadTemplates()
  refresh()
})
onBeforeUnmount(() => {
  request += 1
  clearInterval(clock)
})
</script>

<template>
  <div class="flex flex-col gap-5 xl:h-[calc(100dvh-2.5rem)]">
    <PageHeader title="掛號台">
      <template #meta><span class="num text-lg text-subtle-foreground">{{ currentTime }}</span></template>
      <template #actions>
        <!-- 這一排的控制項都是 40 高：日期前後鈕跟日期欄、右邊的主要動作同高。 -->
        <Button v-if="!isToday" variant="soft" @click="date = today">回到今天</Button>
        <Button variant="secondary" size="icon" aria-label="前一天" @click="date = shiftDateInput(date, -1)"><ChevronLeft stroke-width="1.75" /></Button>
        <DatePicker v-model="date" :clearable="false" aria-label="診務日期" class="w-40" />
        <Button variant="secondary" size="icon" aria-label="後一天" @click="date = shiftDateInput(date, 1)"><ChevronRight stroke-width="1.75" /></Button>
        <span class="mx-1.5 h-6 w-px bg-border" aria-hidden="true"></span>
        <Button variant="soft" @click="newMedication"><Pill stroke-width="1.75" />新增藥單</Button>
        <Button @click="openDrawer('new')"><Plus stroke-width="1.75" />掛號</Button>
      </template>
    </PageHeader>

    <!-- 流程列：四段橫排，一格一個數字，點一格只看那一段；第三格列出正站在櫃台前的人 -->
    <div v-if="!loading" class="grid overflow-hidden rounded-xl border border-border bg-card shadow-card md:grid-cols-2 xl:grid-cols-[1fr_1fr_1.5fr_1fr]" role="group" aria-label="今日流程">
      <div
        v-for="(stage, index) in STAGES"
        :key="stage.key"
        class="flex min-h-18 items-center gap-2 px-3 py-2"
        :class="[
          index < STAGES.length - 1 ? 'border-b border-border xl:border-b-0 xl:border-r' : '',
          stageFilter === stage.key ? 'bg-accent' : '',
        ]"
      >
        <button type="button" class="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1 text-left hover:bg-hover" :aria-pressed="stageFilter === stage.key" :aria-label="`${stage.label} ${stageCounts[stage.key]} 筆，${stageFilter === stage.key ? '清除篩選' : '只看這一段'}`" @click="toggleStage(stage.key)">
          <span class="num text-xl leading-none font-semibold">{{ stageCounts[stage.key] }}</span>
          <span class="min-w-0">
            <span class="flex items-center gap-1.5 text-base leading-tight font-semibold"><span class="size-2.5 shrink-0 rounded-full" :class="stage.dot" aria-hidden="true"></span>{{ stage.label }}</span>
            <span v-if="stageHint(stage.key)" class="block truncate text-sm leading-tight text-muted-foreground">{{ stageHint(stage.key) }}</span>
          </span>
        </button>
        <div v-if="stage.key === 'handoff' && handoffs.length" class="flex shrink-0 flex-wrap justify-end gap-1.5">
          <button v-for="item in handoffs.slice(0, 4)" :key="item._id" type="button" class="inline-flex h-8 items-center gap-1.5 rounded-full bg-warning-surface pr-3 pl-1 text-sm font-semibold text-warning hover:bg-warning/15" :aria-label="`處理 ${item.petName}`" @click="openSheet(item)">
            <span class="num flex size-6 items-center justify-center rounded-full bg-warning text-xs font-semibold text-card">{{ item.checkinNumber || '–' }}</span>{{ item.petName }}
          </button>
        </div>
      </div>
    </div>

    <!-- 警示列：只放「現在要有人看一眼」的例外，沒事時整條不出現。 -->
    <div v-if="!loading && hasAlerts" class="grid gap-2 md:grid-cols-3" aria-label="需要注意">
      <div v-if="reopenRequests.length" class="flex min-h-13 items-center gap-3 rounded-xl bg-danger-surface py-2 pr-2 pl-4 text-danger">
        <AlertTriangle class="size-5 shrink-0" stroke-width="1.75" />
        <p class="min-w-0 flex-1 truncate"><span class="font-semibold">醫師申請修改 {{ reopenRequests.length }}</span>　<PatientLink :pet-id="reopenRequests[0].petId" quiet>{{ reopenRequests[0].petName }}</PatientLink><template v-if="reopenRequests[0].reopenRequest.reason">：{{ reopenRequests[0].reopenRequest.reason }}</template></p>
        <Button size="sm" variant="soft" class="shrink-0" @click="openSheet(reopenRequests[0])">處理</Button>
      </div>
      <div v-if="overdue.length" class="flex min-h-13 items-center gap-3 rounded-xl bg-danger-surface py-2 pr-2 pl-4 text-danger">
        <AlertTriangle class="size-5 shrink-0" stroke-width="1.75" />
        <p class="min-w-0 flex-1 truncate"><span class="font-semibold">遲到 {{ overdue.length }}</span>　<PatientLink :pet-id="overdue[0].petId" quiet>{{ overdue[0].petName }}</PatientLink> <span class="num">{{ overdue[0].time }}</span> 預約，已遲 {{ overdueMinutes(overdue[0]) }} 分</p>
        <Button v-if="scheduledPrimary(overdue[0])" size="sm" variant="soft" class="shrink-0" :disabled="busy" @click="scheduledPrimary(overdue[0]).run()">{{ scheduledPrimary(overdue[0]).label }}</Button>
      </div>
      <div v-if="counts.intake" class="flex min-h-13 items-center gap-3 rounded-xl bg-info-surface py-2 pr-2 pl-4 text-info">
        <ClipboardList class="size-5 shrink-0" stroke-width="1.75" />
        <p class="min-w-0 flex-1 truncate"><span class="font-semibold">待審初診表 {{ counts.intake }}</span>　飼主已填完表單</p>
        <Button size="sm" variant="soft" class="shrink-0" @click="panel.open('intake')">審核</Button>
      </div>
    </div>

    <Alert v-if="error" variant="destructive" class="flex items-center justify-between gap-3">
      <AlertDescription>{{ error }}</AlertDescription>
      <Button variant="secondary" size="sm" @click="refresh"><RefreshCw stroke-width="1.75" />重試</Button>
    </Alert>

    <ListSkeleton v-if="loading" :rows="5" />

    <div v-else class="flex min-h-0 flex-1 flex-col gap-4 xl:flex-row">
      <!-- 時間軸：整頁的主體。依預約時段排、報到後仍保留原位置。 -->
      <section class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card" aria-labelledby="timeline-title">
        <div class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 id="timeline-title" class="text-lg font-semibold">{{ isToday ? '今日看診' : '看診時間軸' }} <span class="num ml-1 text-base font-medium text-subtle-foreground">{{ timelineCount }}</span></h2>
          <div class="flex shrink-0 items-center gap-2">
            <Button v-if="stageFilter" variant="soft" @click="stageFilter = ''"><X stroke-width="1.75" />清除篩選</Button>
            <FilterBar id="reception-search" v-model="search" label="搜尋診務" placeholder="貓咪、飼主、電話" class="w-64" />
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-5">
          <div v-if="!timelineCount" class="mb-3 rounded-xl border border-dashed border-border-strong px-4 py-5 text-center" role="status">
            <p class="font-semibold">{{ stageFilter ? '這一段目前沒有掛號' : `${isToday ? '今天' : date}${items.length ? '沒有待報到或候診中的掛號' : '還沒有任何掛號'}` }}</p>
            <p v-if="!stageFilter" class="mt-1 text-sm text-muted-foreground">按右上角「掛號」，掛號會依預約時段排在時間軸上。</p>
          </div>

          <template v-for="(group, groupIndex) in timeline" :key="group.session.id">
            <div v-if="groupIndex === 1" class="my-3 flex items-center gap-3" :aria-label="`${MIDDAY_BREAK.label} ${MIDDAY_BREAK.start} 到 ${MIDDAY_BREAK.end}`">
              <span class="h-px flex-1 bg-border" aria-hidden="true"></span>
              <span class="shrink-0 text-sm text-subtle-foreground">{{ MIDDAY_BREAK.label }} <span class="num">{{ MIDDAY_BREAK.start }}–{{ MIDDAY_BREAK.end }}</span></span>
              <span class="h-px flex-1 bg-border" aria-hidden="true"></span>
            </div>

            <button
              type="button"
              class="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-hover"
              :aria-expanded="!isCollapsed(group)"
              :aria-controls="`reception-session-${group.session.id}`"
              @click="toggleSession(group)"
            >
              <ChevronDown class="size-5 shrink-0 text-subtle-foreground transition-transform" :class="isCollapsed(group) ? '-rotate-90' : ''" stroke-width="1.75" />
              <span class="text-base font-semibold">{{ group.session.label }}</span>
              <span class="num text-sm text-subtle-foreground">{{ group.session.start }}–{{ group.session.end }}</span>
              <span class="num text-sm text-subtle-foreground">{{ group.items.length }} 筆</span>
              <span v-if="isCollapsed(group) && pendingCount(group)" class="ml-auto inline-flex h-6 items-center rounded-full bg-danger-surface px-2.5 text-xs font-semibold text-danger">{{ pendingCount(group) }} 待處理</span>
            </button>

            <div v-show="!isCollapsed(group)" :id="`reception-session-${group.session.id}`" class="mb-2 ml-2 border-l-2 border-border pl-4 sm:ml-19 sm:pl-5">
              <div v-if="!group.items.length" class="relative py-3">
                <span class="absolute top-1/2 -left-4.25 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-subtle-foreground/40 sm:-left-5.25" aria-hidden="true"></span>
                <p class="rounded-xl border border-dashed border-border px-3 py-4 text-center text-sm text-subtle-foreground">此時段尚無掛號</p>
              </div>

              <template v-for="(item, index) in group.rows" :key="item._id">
                <div v-if="nowPosition(group) === index" class="my-2 flex items-center gap-2.5">
                  <span class="h-0 flex-1 border-t-2 border-dashed border-primary"></span>
                  <span class="num shrink-0 rounded-full bg-primary px-3 py-0.5 text-xs font-bold text-primary-foreground">現在 {{ currentTime }}</span>
                </div>

                <div class="relative py-1">
                  <span class="num mb-1 block text-sm font-semibold text-muted-foreground sm:absolute sm:top-4 sm:-left-9 sm:mb-0 sm:w-14 sm:-translate-x-full sm:text-right sm:text-base" :class="item.isSurgery && item.status === 'scheduled' ? 'text-surgery' : ''">{{ item.time }}</span>
                  <span class="absolute top-1/2 -left-4.25 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card sm:-left-5.25" :class="item.ui.tone.dot" aria-hidden="true"></span>

                  <!-- 整張卡片可點（開處理視窗／初診審核／修改掛號）；裡面的按鈕各自 stop，不會連帶觸發。 -->
                  <article class="cursor-pointer rounded-xl border px-4 py-3 transition-colors" :class="item.ui.tone.card" @click="cardClick(item)">
                    <!-- 每張卡片各自是一個 grid，欄寬必須全部固定：按鈕欄若是 auto，「處理」「報到＋⋯」「只有 ⋯」寬度不同，
                         前面的飼主、電話、進度就會一張卡片一個位置。按鈕欄的寬度以最寬的「報到…＋⋯」為準。 -->
                    <div class="grid items-center gap-x-5 gap-y-2 xl:grid-cols-[minmax(0,1fr)_8rem_10rem_9rem_8.5rem]">
                      <div class="flex min-w-0 items-start gap-3">
                        <span class="flex size-10 shrink-0 items-center justify-center rounded-full" :class="item.ui.confirmed ? 'bg-accent text-accent-foreground' : 'bg-sunken text-subtle-foreground'"><Cat class="size-5" stroke-width="1.75" /></span>
                        <div class="min-w-0 flex-1 space-y-1">
                          <div class="flex min-w-0 flex-wrap items-center gap-2">
                            <span class="truncate text-base font-semibold"><PatientLink :pet-id="item.petId">{{ item.petName || '—' }}</PatientLink></span>
                            <Badge v-if="item.visitType === 'new'" variant="status" class="bg-info-surface text-info">初診</Badge>
                            <SurgeryBadge v-if="item.isSurgery" :name="item.surgeryName" />
                            <LatenessBadge :minutes="item.ui.lateMinutes" />
                            <Badge v-if="item.labRequestedAt && canRequestLab(item)" variant="status" class="bg-info-surface text-info">已送 IDEXX</Badge>
                          </div>
                          <p class="min-h-lh truncate text-foreground" v-tip.overflow="item.reason">{{ item.reason }}</p>
                          <p v-if="item.ui.kind === 'handoff' && item.specialCareNote" class="truncate rounded-md bg-warning-surface px-2.5 py-1 text-sm font-medium text-warning" v-tip.overflow="item.specialCareNote"><span class="font-semibold">請轉告飼主</span>　{{ item.specialCareNote }}</p>
                          <PatientNotes :notes="item.ui.notes" />
                          <p v-if="item.internalNote && item.status === 'scheduled'" class="truncate text-sm text-muted-foreground" v-tip.overflow="item.internalNote"><span class="font-medium text-foreground">掛號備註</span>　{{ item.internalNote }}</p>
                          <p v-if="item.visitType === 'new' && !item.petId" class="text-sm text-muted-foreground">
                            初診驗證碼 <span class="num font-semibold tracking-[0.16em] text-foreground">{{ item.intakeVerificationUsedAt ? '已使用' : item.intakeVerificationCode || '未建立' }}</span><template v-if="isInitialDataPending(item)">，等飼主填初診表</template>
                          </p>
                        </div>
                      </div>

                      <!-- 右側三欄：飼主、電話、進度，每張卡片上下對齊，掃一眼就能對上是誰、打給誰、到哪一步。 -->
                      <div class="min-w-0 xl:pl-2">
                        <span class="spec-label block">飼主</span>
                        <span class="block min-h-lh truncate"><PatientLink v-if="item.ownerName" :pet-id="item.petId" quiet>{{ item.ownerName }}</PatientLink></span>
                      </div>
                      <div class="min-w-0">
                        <span class="spec-label block">電話</span>
                        <span v-if="item.ownerPhone" class="flex items-center gap-1">
                          <span class="num truncate">{{ item.ownerPhone }}</span>
                          <button type="button" class="flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)] hover:bg-secondary-hover hover:text-foreground" :aria-label="`複製 ${item.ownerName || item.petName} 的電話`" @click.stop="copyPhone(item.ownerPhone)"><Copy class="size-4" stroke-width="1.75" /></button>
                        </span>
                        <span v-else class="text-subtle-foreground">—</span>
                      </div>
                      <div class="min-w-0">
                        <span class="spec-label block">進度<template v-if="item.ui.progress.number">　<span class="num">{{ item.ui.progress.number }}</span></template></span>
                        <span class="block truncate font-semibold" :class="item.ui.tone.status">{{ item.ui.progress.label }}</span>
                        <span v-if="item.ui.progress.detail" class="num block truncate text-sm text-subtle-foreground">{{ item.ui.progress.detail }}</span>
                      </div>

                      <div class="flex shrink-0 items-center justify-end gap-1.5" @click.stop>
                        <template v-if="item.ui.kind === 'handoff'">
                          <Button @click="openSheet(item)">處理</Button>
                          <!-- 沒有 ⋯ 選單時補一個同尺寸的空位，主要按鈕才跟其他卡片對齊。 -->
                          <span class="size-10 shrink-0" aria-hidden="true"></span>
                        </template>
                        <template v-else-if="item.status === 'scheduled'">
                          <Button v-if="item.ui.primary" :variant="item.ui.primary.late ? 'destructive-solid' : 'default'" :disabled="busy" @click="item.ui.primary.run()">{{ item.ui.primary.label }}</Button>
                          <RowActions size="default" :actions="item.ui.actions" :label="`${item.petName}的更多操作`" @select="(key) => admin(key, item)" />
                        </template>
                        <RowActions v-else size="default" :actions="arrivedActions(item)" :label="`${item.petName}的更多操作`" @select="(key) => admin(key, item)" />
                      </div>
                    </div>
                  </article>
                </div>
              </template>

              <!-- 「現在」晚於這個時段全部項目時，指示線落在最後面。 -->
              <div v-if="group.items.length && nowPosition(group) === group.items.length" class="my-2 flex items-center gap-2.5">
                <span class="h-0 flex-1 border-t-2 border-dashed border-primary"></span>
                <span class="num shrink-0 rounded-full bg-primary px-3 py-0.5 text-xs font-bold text-primary-foreground">現在 {{ currentTime }}</span>
              </div>
            </div>
          </template>

          <!-- 已完成與未到／取消：跟進行中的軌道分開，收在最下面。 -->
          <div v-if="!stageFilter || stageFilter === 'completed'" class="mt-5 grid gap-4 lg:grid-cols-2">
            <section class="min-w-0 rounded-xl bg-sunken p-4" aria-label="今日已完成">
              <div class="mb-3 flex items-center justify-between gap-3">
                <h3 class="text-base font-semibold">已完成</h3>
                <span class="num text-sm text-subtle-foreground">{{ finished.length }}</span>
              </div>
              <div class="space-y-2">
                <article v-for="item in followUps" :key="`fu-${item._id}`" class="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
                  <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground"><CalendarPlus class="size-4" stroke-width="1.75" /></span>
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-semibold"><PatientLink :pet-id="item.petId">{{ item.petName }}</PatientLink></p>
                    <p class="truncate text-sm text-muted-foreground">待安排回診　{{ item.followUpRecommendation || item.followUpReason }}</p>
                  </div>
                  <Button variant="soft" size="sm" @click="openSheet(item)">安排回診</Button>
                </article>
                <p v-if="!finished.length" class="py-2 text-sm text-subtle-foreground">還沒有完成的就診</p>
                <button v-for="item in finished" :key="item._id" type="button" class="flex min-h-12 w-full min-w-0 items-center gap-3 rounded-lg bg-card px-3 py-2 text-left hover:bg-hover" @click="openSheet(item)">
                  <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-success-surface text-success"><Check class="size-4" stroke-width="2" /></span>
                  <span class="min-w-0 flex-1 truncate font-semibold text-primary">{{ item.petName }}</span>
                  <span class="truncate text-sm text-muted-foreground">{{ item.ownerName }}</span>
                  <span v-if="item.deskCompletedAt" class="num shrink-0 text-sm text-subtle-foreground">{{ clinicTimeInput(item.deskCompletedAt) }}</span>
                  <Badge v-if="item.followUpAppointmentId" variant="status" class="bg-accent text-accent-foreground">回診 <span class="num">{{ item.followUpDate?.slice(5) }}</span></Badge>
                </button>
              </div>
            </section>
            <section class="min-w-0 rounded-xl bg-sunken p-4" aria-label="未到與取消">
              <div class="mb-3 flex items-center justify-between gap-3">
                <h3 class="text-base font-semibold">未到／取消</h3>
                <span class="num text-sm text-subtle-foreground">{{ closedAppointments.length }}</span>
              </div>
              <div class="space-y-2">
                <p v-if="!closedAppointments.length" class="py-2 text-sm text-subtle-foreground">沒有未到或取消的預約</p>
                <article v-for="item in closedAppointments" :key="item._id" class="flex min-w-0 items-center gap-3 rounded-lg bg-card px-3 py-2">
                  <Badge variant="status" :class="closedStatusMeta(item).class">{{ closedStatusMeta(item).label }}</Badge>
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-semibold"><PatientLink :pet-id="item.petId">{{ item.petName }}</PatientLink></p>
                    <p class="truncate text-sm text-muted-foreground"><span class="num">{{ item.time }}</span>　{{ item.cancelReason || item.ownerName }}</p>
                  </div>
                  <RowActions :actions="[{ key: 'restore', label: '恢復待報到' }, { key: 'edit', label: '修改預約' }]" :label="`${item.petName}的更多操作`" @select="(key) => admin(key, item)" />
                </article>
              </div>
            </section>
          </div>
        </div>
      </section>

      <!-- 右側抽屜（初診報到）：頁面版面裡的一欄，不蓋住時間軸——櫃台要一邊建檔一邊看得到時間軸。 -->
      <div v-if="drawerVisible" class="order-first flex min-h-0 shrink-0 flex-col xl:order-0 xl:w-176">
        <CheckInDrawer
          v-if="drawer === 'check-in' && target"
          :key="target._id"
          class="min-h-0 flex-1"
          :appointment="target"
          :late="itemIsOverdue(target)"
          :suggested-checkin-number="suggestedCheckinNumber()"
          :submitting="busy"
          :error-message="dialogError"
          @submit="(values) => submit(values, 'check-in')"
          @close="closeDrawer"
        />
      </div>
    </div>

    <!-- 掛號 Modal：關閉即捨棄尚未送出的內容。 -->
    <AppointmentDialog
      v-if="drawer === 'new'"
      :date="date"
      :day-items="items"
      :templates="templates"
      :default-template-id="defaultTemplate"
      :submitting="busy"
      :error-message="dialogError"
      @submit="(values) => submit(values, 'new')"
      @close="closeDrawer"
    />
    <AppointmentDialog
      v-if="drawer === 'edit' && target"
      :key="target._id"
      :appointment="target"
      :date="date"
      :day-items="items"
      :templates="templates"
      :default-template-id="defaultTemplate"
      :submitting="busy"
      :error-message="dialogError"
      @submit="(values) => submit(values, 'edit')"
      @close="closeDrawer"
    />

    <HandoffSheet v-if="activePatient" :key="activePatient._id" :appointment="activePatient" :patient-notes="patientNotesFor(activePatient, patientNotes).filter((note) => note.key === 'owner')" @updated="onSheetUpdate" @close="selected = ''" />
    <CheckInDialog v-if="dialog === 'check-in-detail' && target" :appointment="target" :late="itemIsOverdue(target)" :suggested-checkin-number="suggestedCheckinNumber()" :submitting="busy" :error-message="dialogError" @submit="(values) => submit(values, 'check-in-detail')" @close="dialog = ''" />
    <CancelAppointmentDialog v-if="dialog === 'cancel' && target" :appointment="target" :submitting="busy" :error-message="dialogError" @submit="(reason) => submit({ cancelReason: reason }, 'cancel')" @close="dialog = ''" />
    <ConfirmDialog v-if="confirmation" :open="true" :title="confirmation.title" :description="`病患：${target.petName}`" :loading="busy" @confirm="submit({}, confirmation.kind)" @cancel="confirmation = null" />
  </div>
</template>
