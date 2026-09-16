<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { AlertTriangle, CalendarPlus, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Clock3, Pin, Plus, RefreshCw } from '@lucide/vue'
import { http } from '../api/http'
import { useToast } from '../composables/useToast'
import { useClinicSync } from '../composables/useClinicSync'
import { useSearchQueryParam } from '../composables/useSearchQueryParam'
import { useAppointmentNotifier } from '../composables/useAppointmentNotifier'
import { clinicDateInput, clinicTimeInput, shiftDateInput, weekdayLabel } from '../lib/datetime'
import { appointmentsForTimeline, groupBySession, SURGERY_BLOCK } from '../lib/appointmentTimeline'
import { isOverdue, minutesPastSchedule } from '../lib/receptionBoard'
import { workflowFilter, workflowState, visitLabel } from '../../../shared/appointmentWorkflow.js'
import { usePinnedPetsStore } from '../stores/pinnedPets'
import HandoffSheet from '../components/HandoffSheet.vue'
import PinnedPetsList from '../components/PinnedPetsList.vue'
import RowActions from '../components/RowActions.vue'
import SideDrawer from '../components/SideDrawer.vue'
import AppointmentDrawer from '../components/AppointmentDrawer.vue'
import CheckInDrawer from '../components/CheckInDrawer.vue'
import CheckInDialog from '../components/CheckInDialog.vue'
import CancelAppointmentDialog from '../components/CancelAppointmentDialog.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import ModalDialog from '../components/ModalDialog.vue'
import FilterBar from '../components/FilterBar.vue'
import ListSkeleton from '../components/ListSkeleton.vue'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Alert, AlertDescription } from '../components/ui/alert'
import { DatePicker } from '../components/ui/date-picker'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover'
import { TimePicker } from '../components/ui/time-picker'
import { Label } from '../components/ui/label'
import { DialogDescription, DialogFooter, DialogTitle } from '../components/ui/dialog'
import { APPOINTMENT_TIME_MINUTE_STEP, APPOINTMENT_TIME_RANGES } from '../lib/appointmentTime'

// 櫃台工作台：照四步流水線排成四欄看板（待報到 → 在院 → 待櫃台處理 → 今日已完成），
// 欄標題的數字就是現況，一個畫面看完不必捲動。真正要人注意的例外（醫師申請修改、
// 遲到還沒報到、待審初診）才浮到最上面的警示列。
//
// 掛號、初診報到、時間軸、暫存區都開在看板右側的抽屜裡，而不是 Modal：
// 櫃台講電話掛號講到一半，交辦的飼主就站到櫃台前了，看板必須照樣看得到、按得到。
const router = useRouter()
const toast = useToast()
const notifyChat = useAppointmentNotifier()
const pinnedPets = usePinnedPetsStore()
const today = clinicDateInput()
const date = useSearchQueryParam('date', today)
const search = useSearchQueryParam('q', '')
const selected = useSearchQueryParam('selected', '')

const items = ref([])
const loading = ref(true)
const error = ref('')
const busy = ref(false)
const dialog = ref('')
const dialogError = ref('')
const target = ref(null)
const confirmation = ref(null)
const intakeReviewTarget = ref(null)
const intakeAppointmentDate = ref('')
const intakeAppointmentTime = ref('')
const templates = ref([])
const defaultTemplate = ref('')
const pendingIntakeCount = ref(0)
const showClosed = ref(false)
const now = ref(Date.now())
let clock
let request = 0

// 右側抽屜一次只顯示一個。新增掛號收起來時元件仍保持掛載（v-show），填到一半的內容不會消失。
const drawer = ref('')
const newDraftOpen = ref(false)
const newDraft = ref(null)

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
const timeline = computed(() => groupBySession(appointmentsForTimeline(items.value)))
const hasAlerts = computed(() => reopenRequests.value.length || overdue.value.length || pendingIntakeCount.value)
// 抽屜打開時「今日已完成」收成窄條，把寬度讓給前三欄——那三欄才是現在要做事的地方。
const drawerVisible = computed(() => Boolean(drawer.value))

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
function visitTypeLabel(item) {
  return item.visitType === 'new' ? '初診' : item.visitType === 'return' ? '回診' : ''
}
function surgeryLabel(item) {
  return `手術${item.surgeryName ? `：${item.surgeryName}` : ''}`
}
function latenessLabel(appointment) {
  return appointment.latenessMinutes > 0 ? `遲到 ${appointment.latenessMinutes} 分` : ''
}
function closedStatusMeta(appointment) {
  if (appointment.status === 'no_show') return { label: '未到診', class: 'bg-warning-surface text-warning' }
  return { label: '已取消', class: 'bg-muted text-muted-foreground' }
}
function dotClass(appointment) {
  const state = workflowState(appointment)
  if (state.handedOff) return 'bg-warning'
  if (state.started) return 'bg-info'
  if (appointment.status === 'arrived') return 'bg-primary'
  return 'bg-border'
}
function nowPosition(group) {
  if (!isToday.value || currentTime.value < group.session.start || currentTime.value > group.session.end) return -1
  const index = group.items.findIndex((item) => item.time && item.time > currentTime.value)
  return index < 0 ? group.items.length : index
}

function isInitialDataPending(appointment) {
  return appointment.visitType === 'new' && !appointment.petId && Boolean(appointment.intakeVerificationCode) && !appointment.intakeSubmissionId
}

// 待報到卡片上唯一的主要按鈕。資料齊全的回診一鍵報到；初診要建檔，開抽屜。
// 已超過寬限還沒報到的，報到鈕改成實心紅——在一整欄主色按鈕裡一眼挑得出來。
function scheduledPrimary(item) {
  if (item.visitType === 'new' && item.intakeSubmissionId && !item.petId) return { label: '審核初診表', run: () => openIntakeReview(item) }
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

async function refresh() {
  const token = ++request
  const requested = date.value
  try {
    const { data } = await http.get('/appointments', { params: { date: requested } })
    if (token !== request) return
    items.value = data.items || []
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

const { connected } = useClinicSync(date, refresh, applyUpdate)
watch(date, () => {
  loading.value = true
  items.value = []
  selected.value = ''
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
  if (kind === 'new') newDraftOpen.value = true
  drawer.value = kind
}
function closeDrawer() {
  if (drawer.value === 'new') newDraftOpen.value = false
  drawer.value = ''
  dialogError.value = ''
}
function toggleDrawer(kind) {
  drawer.value = drawer.value === kind ? '' : kind
}

async function loadPendingIntakeCount() {
  try {
    const { data } = await http.get('/intake-submissions')
    pendingIntakeCount.value = (data.items || []).length
  } catch {
    /* 初診審核數量載不到不影響既有櫃台工作。 */
  }
}

// 次要操作（⋯ 選單、候診卡片、未到／取消）共用同一個分派。
function admin(kind, appointment) {
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
    toast.error(err.response?.data?.message || '復原失敗，請從候診卡片取消報到')
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
    if (kind === 'new') newDraftOpen.value = false
    if (['new', 'edit', 'check-in'].includes(kind) && drawer.value === kind) drawer.value = ''
    dialog.value = ''
    confirmation.value = null
    toast.success(kind === 'new' && data.visitType === 'new' ? `初診掛號已建立，驗證碼：${data.intakeVerificationCode}` : '診務資料已更新')
  } catch (err) {
    dialogError.value = err.response?.data?.message || '操作失敗，請稍後重試'
    if (confirmation.value) toast.error(dialogError.value)
  } finally {
    busy.value = false
  }
}

async function issueIntakeCode() {
  if (busy.value) return
  busy.value = true
  try {
    const { data } = await http.post('/appointments', {
      date: date.value,
      petName: '初診資料待填',
      reason: '現場填寫初診資料',
    })
    applyUpdate(data)
    notifyChat(data, 'create')
    toast.success(`初診驗證碼：${data.intakeVerificationCode}`)
  } catch (err) {
    toast.error(err.response?.data?.message || '無法產生初診驗證碼，請稍後再試')
  } finally {
    busy.value = false
  }
}

const intakeMenuOpen = ref(false)
function intakeMenu(key) {
  intakeMenuOpen.value = false
  if (key === 'issue-code') issueIntakeCode()
  else if (key === 'review') router.push('/reception/intakes')
}

async function approveIntake(appointment) {
  if (busy.value || !appointment.intakeSubmissionId) return
  if (!intakeAppointmentDate.value || !intakeAppointmentTime.value) {
    toast.error('請先選擇掛號日期與時間')
    return
  }
  busy.value = true
  try {
    const { data } = await http.post(`/intake-submissions/${appointment.intakeSubmissionId}/approve`, { date: intakeAppointmentDate.value, time: intakeAppointmentTime.value })
    if (data.appointment) applyUpdate(data.appointment)
    else await refresh()
    await loadPendingIntakeCount()
    intakeReviewTarget.value = null
    intakeAppointmentDate.value = ''
    intakeAppointmentTime.value = ''
    toast.success('初診資料已核准並完成建檔')
  } catch (err) {
    toast.error(err.response?.data?.message || '核准初診資料失敗，請稍後再試')
  } finally {
    busy.value = false
  }
}

function intakeValue(value, fallback = '') {
  return value === null || value === undefined || value === '' ? fallback : value
}

function intakeBirthMonth(birthDate) {
  if (!birthDate) return ''
  const value = new Date(birthDate)
  if (Number.isNaN(value.getTime())) return ''
  return `（西元 ${value.getUTCFullYear()} 年 ${value.getUTCMonth() + 1} 月生）`
}

async function openIntakeReview(appointment) {
  if (busy.value || !appointment.intakeSubmissionId) return
  busy.value = true
  try {
    const { data } = await http.get(`/intake-submissions/${appointment.intakeSubmissionId}`)
    intakeReviewTarget.value = { ...appointment, owner: data.owner, pet: data.pet }
    intakeAppointmentDate.value = appointment.date || date.value
    intakeAppointmentTime.value = appointment.time || ''
  } catch (err) {
    toast.error(err.response?.data?.message || '無法載入初診資料，請稍後再試')
  } finally {
    busy.value = false
  }
}

async function rejectIntake(appointment) {
  if (busy.value || !appointment.intakeSubmissionId) return
  busy.value = true
  try {
    await http.post(`/intake-submissions/${appointment.intakeSubmissionId}/reject`)
    intakeReviewTarget.value = null
    await loadPendingIntakeCount()
    toast.success('初診資料已退回')
  } catch (err) {
    toast.error(err.response?.data?.message || '退回初診資料失敗，請稍後再試')
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

onMounted(() => {
  clock = setInterval(() => {
    now.value = Date.now()
  }, 30000)
  loadTemplates()
  loadPendingIntakeCount()
  refresh()
})
onBeforeUnmount(() => {
  request += 1
  clearInterval(clock)
})
</script>

<template>
  <div class="flex flex-col gap-3 xl:h-[calc(100dvh-2.5rem)]">
    <header class="flex flex-wrap items-center gap-x-4 gap-y-3">
      <div class="min-w-0">
        <h1 class="text-xl font-semibold">櫃台工作台</h1>
        <p class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>{{ date }}（{{ weekdayLabel(date) }}）<template v-if="isToday"> · 現在 {{ currentTime }}</template></span>
          <span class="inline-flex items-center gap-1.5"><span class="h-1.5 w-1.5 rounded-full" :class="connected ? 'bg-success' : 'bg-warning'"></span>{{ connected ? '即時同步' : '重新連線中' }}</span>
        </p>
      </div>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <FilterBar id="reception-search" v-model="search" label="搜尋診務" placeholder="病患、飼主、電話" class="w-64" />
        <div class="flex items-center gap-1">
          <Button variant="secondary" size="icon-sm" aria-label="前一天" @click="date = shiftDateInput(date, -1)"><ChevronLeft class="h-4 w-4" /></Button>
          <DatePicker v-model="date" :clearable="false" aria-label="診務日期" class="w-40" />
          <Button variant="secondary" size="icon-sm" aria-label="後一天" @click="date = shiftDateInput(date, 1)"><ChevronRight class="h-4 w-4" /></Button>
          <Button variant="secondary" size="sm" :disabled="isToday" @click="date = today">今天</Button>
        </div>
        <Button variant="secondary" size="sm" :aria-pressed="drawer === 'timeline'" @click="toggleDrawer('timeline')"><Clock3 class="h-4 w-4" stroke-width="1.75" />時間軸</Button>
        <Button variant="secondary" size="sm" :class="pinnedPets.items.length ? 'bg-accent text-accent-foreground hover:bg-accent/80' : ''" :aria-pressed="drawer === 'pinned'" @click="toggleDrawer('pinned')">
          <Pin class="h-4 w-4" stroke-width="1.75" />暫存區<span v-if="pinnedPets.items.length" class="tabular-nums">{{ pinnedPets.items.length }}</span>
        </Button>
        <Popover v-model:open="intakeMenuOpen">
          <PopoverTrigger as-child>
            <Button variant="secondary" size="sm" :aria-label="pendingIntakeCount ? `初診，${pendingIntakeCount} 份初診表待審核` : '初診'">
              <ClipboardList class="h-4 w-4" stroke-width="1.75" />初診
              <Badge v-if="pendingIntakeCount" variant="status" class="bg-danger-surface text-danger tabular-nums">{{ pendingIntakeCount }}</Badge>
              <ChevronDown class="h-4 w-4 text-muted-foreground" stroke-width="1.75" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" class="w-56 space-y-1 p-1">
            <button type="button" class="flex min-h-10 w-full items-center gap-2 rounded-md bg-muted/60 px-2.5 text-left text-sm font-medium hover:bg-secondary" @click="intakeMenu('review')">
              初診表審核<Badge v-if="pendingIntakeCount" variant="status" class="ml-auto bg-danger-surface text-danger tabular-nums">{{ pendingIntakeCount }}</Badge>
            </button>
            <button type="button" class="flex min-h-10 w-full items-center gap-2 rounded-md bg-muted/60 px-2.5 text-left text-sm font-medium hover:bg-secondary disabled:pointer-events-none disabled:opacity-50" :disabled="busy" @click="intakeMenu('issue-code')">
              發初診碼
            </button>
          </PopoverContent>
        </Popover>
        <Button size="sm" @click="openDrawer('new')">
          <Plus class="h-4 w-4" />
          <template v-if="newDraftOpen && drawer !== 'new'">繼續掛號<span v-if="newDraft?.draftName" class="max-w-32 truncate">：{{ newDraft.draftName }}</span></template>
          <template v-else>新增掛號</template>
        </Button>
      </div>
    </header>

    <!-- 警示列：只放「現在要有人看一眼」的例外，沒事時整條不出現。 -->
    <div v-if="!loading && hasAlerts" class="grid gap-2 md:grid-cols-3" aria-label="需要注意">
      <div v-if="reopenRequests.length" class="flex min-h-13 items-center gap-3 rounded-xl bg-danger-surface py-2 pl-4 pr-2 text-danger">
        <AlertTriangle class="h-4 w-4 shrink-0" stroke-width="1.75" />
        <p class="min-w-0 flex-1 truncate text-sm"><span class="font-semibold">醫師申請修改 {{ reopenRequests.length }}</span> · {{ reopenRequests[0].petName }}：{{ reopenRequests[0].reopenRequest.reason || '未填寫原因' }}</p>
        <Button size="sm" variant="secondary" class="shrink-0 bg-card text-danger hover:bg-card/80" @click="openSheet(reopenRequests[0])">處理</Button>
      </div>
      <div v-if="overdue.length" class="flex min-h-13 items-center gap-3 rounded-xl bg-danger-surface py-2 pl-4 pr-2 text-danger">
        <AlertTriangle class="h-4 w-4 shrink-0" stroke-width="1.75" />
        <p class="min-w-0 flex-1 truncate text-sm"><span class="font-semibold">遲到未報到 {{ overdue.length }}</span> · {{ overdue[0].petName }} {{ overdue[0].time }} 預約，已遲 {{ overdueMinutes(overdue[0]) }} 分</p>
        <Button v-if="scheduledPrimary(overdue[0])" size="sm" variant="secondary" class="shrink-0 bg-card text-danger hover:bg-card/80" :disabled="busy" @click="scheduledPrimary(overdue[0]).run()">{{ scheduledPrimary(overdue[0]).label }}</Button>
      </div>
      <div v-if="pendingIntakeCount" class="flex min-h-13 items-center gap-3 rounded-xl bg-muted py-2 pl-4 pr-2">
        <ClipboardList class="h-4 w-4 shrink-0 text-muted-foreground" stroke-width="1.75" />
        <p class="min-w-0 flex-1 truncate text-sm"><span class="font-semibold">待審初診表 {{ pendingIntakeCount }}</span><span class="text-muted-foreground"> · 飼主已填完表單</span></p>
        <Button size="sm" variant="secondary" class="shrink-0 bg-card hover:bg-card/80" as-child><router-link to="/reception/intakes">審核</router-link></Button>
      </div>
    </div>

    <Alert v-if="error" variant="destructive" class="flex items-center justify-between gap-3">
      <AlertDescription>{{ error }}</AlertDescription>
      <Button variant="secondary" size="sm" @click="refresh"><RefreshCw class="h-4 w-4" />重試</Button>
    </Alert>

    <ListSkeleton v-if="loading" :rows="5" />

    <div v-else class="flex min-h-0 flex-1 flex-col gap-3 xl:flex-row">
      <div class="grid min-h-0 flex-1 gap-3 md:grid-cols-2 xl:grid-rows-[minmax(0,1fr)]" :class="drawerVisible ? 'xl:grid-cols-[repeat(3,minmax(0,1fr))_3.5rem]' : 'xl:grid-cols-4'">
        <!-- 1. 待報到 -->
        <section class="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card" aria-labelledby="col-scheduled">
          <header class="flex shrink-0 items-baseline gap-2.5 border-b border-border px-4 py-3">
            <span class="text-2xl font-semibold leading-none tabular-nums">{{ scheduled.length }}</span>
            <h2 id="col-scheduled" class="text-base font-semibold">待報到</h2>
            <span class="ml-auto text-xs text-muted-foreground">依預約時段</span>
          </header>
          <div class="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
            <p v-if="!scheduled.length" class="px-2 py-6 text-center text-sm text-muted-foreground">沒有等待報到的預約</p>
            <article v-for="item in scheduled" :key="item._id" class="space-y-2 rounded-lg border p-3" :class="itemIsOverdue(item) ? 'border-danger/45' : 'border-border'">
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span class="text-sm font-semibold tabular-nums">{{ item.time || '未定' }}</span>
                <span class="min-w-0 truncate text-sm font-semibold">{{ item.petName }}</span>
                <span class="text-xs text-muted-foreground">{{ [item.species, visitTypeLabel(item)].filter(Boolean).join(' · ') }}</span>
                <span class="ml-auto flex flex-wrap gap-1.5">
                  <Badge v-if="itemIsOverdue(item)" variant="status" class="bg-danger-surface text-danger">遲到 {{ overdueMinutes(item) }} 分</Badge>
                  <Badge v-if="item.isSurgery" variant="status" class="bg-danger-surface text-danger">{{ surgeryLabel(item) }}</Badge>
                </span>
              </div>
              <p v-if="item.reason || item.internalNote" class="line-clamp-2 text-xs text-muted-foreground">
                <template v-if="item.reason">{{ item.reason }}</template><template v-if="item.reason && item.internalNote"> · </template><template v-if="item.internalNote"><span class="font-medium text-foreground">備註</span> {{ item.internalNote }}</template>
              </p>
              <p v-if="item.visitType === 'new' && !item.petId" class="text-xs text-muted-foreground">
                初診驗證碼 <span class="font-semibold tracking-[0.16em] text-foreground">{{ item.intakeVerificationUsedAt ? '已使用' : item.intakeVerificationCode || '未建立' }}</span><template v-if="isInitialDataPending(item)"> · 等飼主填初診表</template>
              </p>
              <div class="flex items-center gap-2">
                <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{{ item.ownerName || '未留飼主姓名' }}<template v-if="item.ownerPhone"> · {{ item.ownerPhone }}</template></span>
                <Button v-if="scheduledPrimary(item)" size="sm" :variant="scheduledPrimary(item).late ? 'destructive-solid' : 'default'" class="shrink-0" :disabled="busy" @click="scheduledPrimary(item).run()">{{ scheduledPrimary(item).label }}</Button>
                <RowActions :actions="scheduledActions(item)" :label="`${item.petName}的更多操作`" @select="(key) => admin(key, item)" />
              </div>
            </article>
          </div>
          <div class="shrink-0 border-t border-border">
            <button type="button" class="flex min-h-11 w-full items-center gap-2 bg-card px-4 text-left text-xs font-medium text-muted-foreground hover:bg-field" :aria-expanded="showClosed" @click="showClosed = !showClosed">
              未到／取消 {{ closedAppointments.length }}
              <ChevronDown class="ml-auto h-4 w-4 transition-transform" :class="{ '-rotate-90': !showClosed }" />
            </button>
            <div v-show="showClosed" class="max-h-64 space-y-1.5 overflow-y-auto px-2.5 pb-2.5">
              <p v-if="!closedAppointments.length" class="px-2 py-3 text-center text-xs text-muted-foreground">沒有未到或取消的預約</p>
              <div v-for="item in closedAppointments" :key="item._id" class="flex items-center gap-2 rounded-lg bg-field px-3 py-2">
                <span class="text-xs tabular-nums text-muted-foreground">{{ item.time || '未定' }}</span>
                <span class="min-w-0 flex-1 truncate text-sm">{{ item.petName }}</span>
                <Badge variant="status" :class="closedStatusMeta(item).class">{{ closedStatusMeta(item).label }}</Badge>
                <RowActions :actions="[{ key: 'restore', label: '恢復待報到' }, { key: 'edit', label: '修改預約' }]" :label="`${item.petName}的更多操作`" @select="(key) => admin(key, item)" />
              </div>
            </div>
          </div>
        </section>

        <!-- 2. 在院：看診中＋候診中 -->
        <section class="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card" aria-labelledby="col-onsite">
          <header class="flex shrink-0 items-baseline gap-2.5 border-b border-border px-4 py-3">
            <span class="text-2xl font-semibold leading-none tabular-nums">{{ visiting.length + waiting.length }}</span>
            <h2 id="col-onsite" class="text-base font-semibold">在院 · 看診／候診</h2>
          </header>
          <div class="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
            <p class="px-1.5 pt-1 text-xs font-medium text-muted-foreground">看診中 {{ visiting.length }}</p>
            <p v-if="!visiting.length" class="px-2 py-2 text-xs text-muted-foreground">目前沒有人在看診</p>
            <article v-for="item in visiting" :key="item._id" class="flex items-center gap-3 rounded-lg border border-border bg-field p-3">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold tabular-nums text-primary-foreground">{{ item.checkinNumber ?? '—' }}</span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-semibold">{{ item.petName }}<span class="ml-2 text-xs font-normal text-muted-foreground">{{ [item.species, visitTypeLabel(item)].filter(Boolean).join(' · ') }}</span></p>
                <p class="truncate text-xs text-muted-foreground">看診 {{ minutesSince(item.visitStartedAt) }} 分<template v-if="item.isSurgery"> · <span class="font-medium text-danger">{{ surgeryLabel(item) }}</span></template></p>
              </div>
            </article>

            <p class="px-1.5 pt-3 text-xs font-medium text-muted-foreground">候診中 {{ waiting.length }}</p>
            <p v-if="!waiting.length" class="px-2 py-2 text-xs text-muted-foreground">目前沒有候診中的病患</p>
            <article v-for="item in waiting" :key="item._id" class="flex items-center gap-3 rounded-lg border border-border p-3">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold tabular-nums">{{ item.checkinNumber ?? '—' }}</span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-semibold">{{ item.petName }}<span class="ml-2 text-xs font-normal text-muted-foreground">{{ [item.species, visitTypeLabel(item)].filter(Boolean).join(' · ') }}</span></p>
                <p class="truncate text-xs text-muted-foreground">
                  已等 {{ minutesSince(item.checkedInAt) }} 分<template v-if="latenessLabel(item)"> · <span class="font-medium text-danger">{{ latenessLabel(item) }}</span></template><template v-if="item.isSurgery"> · <span class="font-medium text-danger">{{ surgeryLabel(item) }}</span></template>
                </p>
              </div>
              <RowActions :actions="[{ key: 'restore', label: '取消報到' }, { key: 'edit', label: '修改掛號' }]" :label="`${item.petName}的更多操作`" @select="(key) => admin(key, item)" />
            </article>
          </div>
        </section>

        <!-- 3. 待櫃台處理：飼主人就站在櫃台前，用主色框起來 -->
        <section class="flex min-h-0 flex-col overflow-hidden rounded-xl border-2 border-primary bg-card" aria-labelledby="col-handoff">
          <header class="flex shrink-0 items-baseline gap-2.5 bg-accent px-4 py-3 text-accent-foreground">
            <span class="text-2xl font-semibold leading-none tabular-nums">{{ handoffs.length }}</span>
            <h2 id="col-handoff" class="text-base font-semibold">待櫃台處理</h2>
            <span class="ml-auto text-xs">飼主正在櫃台等</span>
          </header>
          <div class="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
            <p v-if="!handoffs.length" class="px-2 py-6 text-center text-sm text-muted-foreground">目前沒有等待處理的交辦</p>
            <article v-for="item in handoffs" :key="item._id" class="space-y-2.5 rounded-lg border border-border p-3">
              <div class="flex items-center gap-3">
                <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold tabular-nums text-primary-foreground">{{ item.checkinNumber ?? '—' }}</span>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-semibold">{{ item.petName }}<span class="ml-2 text-xs font-normal text-muted-foreground">{{ item.species }}</span></p>
                  <p class="truncate text-xs text-muted-foreground">{{ item.ownerName || '飼主待確認' }}<template v-if="item.ownerPhone"> · {{ item.ownerPhone }}</template></p>
                </div>
                <span class="shrink-0 text-xs text-muted-foreground">交出 {{ minutesSince(item.handoffAt) }} 分</span>
              </div>
              <p class="line-clamp-2 text-sm" :class="item.handoffNote ? '' : 'text-muted-foreground'">{{ item.handoffNote || '醫師沒有留下交辦事項' }}</p>
              <p v-if="item.specialCareNote" class="line-clamp-2 rounded-md bg-warning-surface px-2.5 py-1.5 text-xs text-warning"><span class="font-semibold">請轉告飼主：</span>{{ item.specialCareNote }}</p>
              <div class="flex flex-wrap items-center gap-1.5">
                <Badge v-if="latenessLabel(item)" variant="status" class="bg-danger-surface text-danger">{{ latenessLabel(item) }}</Badge>
                <Badge v-if="item.isSurgery" variant="status" class="bg-danger-surface text-danger">{{ surgeryLabel(item) }}</Badge>
                <Badge v-if="item.followUpRecommendation" variant="status" class="bg-muted text-muted-foreground">建議回診</Badge>
                <Button size="sm" class="ml-auto" @click="openSheet(item)">處理</Button>
              </div>
            </article>
          </div>
        </section>

        <!-- 4. 今日已完成（抽屜打開時收成窄條） -->
        <button v-if="drawerVisible" type="button" class="hidden min-h-0 flex-col items-center gap-2 rounded-xl border border-border bg-card py-3 hover:bg-field xl:flex" aria-label="關閉抽屜並顯示今日已完成" @click="drawer = ''">
          <span class="text-base font-semibold tabular-nums">{{ finished.length }}</span>
          <span class="text-xs tracking-widest text-muted-foreground [writing-mode:vertical-rl]">今日已完成</span>
        </button>
        <section class="min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card" :class="drawerVisible ? 'flex xl:hidden' : 'flex'" aria-labelledby="col-finished">
          <header class="flex shrink-0 items-baseline gap-2.5 border-b border-border px-4 py-3">
            <span class="text-2xl font-semibold leading-none tabular-nums">{{ finished.length }}</span>
            <h2 id="col-finished" class="text-base font-semibold">今日已完成</h2>
          </header>
          <div class="min-h-0 flex-1 overflow-y-auto p-2.5">
            <template v-if="followUps.length">
              <p class="px-1.5 pb-2 pt-1 text-xs font-medium text-muted-foreground">待安排回診 {{ followUps.length }}</p>
              <article v-for="item in followUps" :key="item._id" class="mb-2 space-y-2 rounded-lg border border-border p-3">
                <p class="truncate text-sm"><span class="font-semibold">{{ item.petName }}</span><span class="ml-2 text-xs text-muted-foreground">{{ item.ownerName || '飼主待確認' }}<template v-if="item.ownerPhone"> · {{ item.ownerPhone }}</template></span></p>
                <p class="line-clamp-2 text-xs text-muted-foreground">醫師建議：{{ item.followUpRecommendation || item.followUpReason }}</p>
                <div class="flex justify-end"><Button variant="secondary" size="sm" @click="openSheet(item)"><CalendarPlus class="h-4 w-4" />安排回診</Button></div>
              </article>
              <p class="px-1.5 pb-1 pt-3 text-xs font-medium text-muted-foreground">已結束</p>
            </template>
            <p v-if="!finished.length" class="px-2 py-6 text-center text-sm text-muted-foreground">還沒有完成的就診</p>
            <button v-for="item in finished" :key="item._id" type="button" class="flex min-h-11 w-full items-center gap-3 rounded-md bg-card px-2 text-left hover:bg-field" @click="openSheet(item)">
              <span class="w-11 shrink-0 text-xs tabular-nums text-muted-foreground">{{ item.time || '未定' }}</span>
              <span class="min-w-0 flex-1 truncate text-sm font-medium text-primary">{{ item.petName }}</span>
              <span v-if="item.followUpAppointmentId" class="shrink-0 text-xs text-muted-foreground">已約 {{ item.followUpDate?.slice(5) }}</span>
            </button>
          </div>
        </section>
      </div>

      <!-- 右側抽屜：頁面版面裡的一欄，不蓋住看板 -->
      <div v-if="drawer || newDraftOpen" v-show="drawer" class="order-first flex min-h-0 shrink-0 flex-col xl:order-none" :class="drawer === 'check-in' ? 'xl:w-176' : 'xl:w-144'">
        <AppointmentDrawer
          v-if="newDraftOpen"
          v-show="drawer === 'new'"
          ref="newDraft"
          class="min-h-0 flex-1"
          :date="date"
          :day-items="items"
          :templates="templates"
          :default-template-id="defaultTemplate"
          :submitting="busy"
          :error-message="drawer === 'new' ? dialogError : ''"
          @submit="(values) => submit(values, 'new')"
          @minimize="drawer = ''"
          @close="closeDrawer"
        />
        <AppointmentDrawer
          v-if="drawer === 'edit' && target"
          :key="target._id"
          class="min-h-0 flex-1"
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
        <SideDrawer v-if="drawer === 'timeline'" class="min-h-0 flex-1" title="看診時間軸" :description="`${date}（${weekdayLabel(date)}）`" @close="closeDrawer">
          <div v-for="(group, groupIndex) in timeline" :key="group.session.id" class="-mx-5 py-1">
            <p v-if="groupIndex === 1" class="px-5 py-2 text-xs text-muted-foreground">{{ SURGERY_BLOCK.start }}–{{ SURGERY_BLOCK.end }} · {{ SURGERY_BLOCK.label }}</p>
            <p class="flex items-center gap-2 px-5 py-1.5 text-xs font-semibold text-muted-foreground">
              {{ group.session.label }}<span class="font-normal">{{ group.session.start }}–{{ group.session.end }}</span>
            </p>
            <template v-for="(item, index) in group.items" :key="item._id">
              <div v-if="nowPosition(group) === index" class="flex items-center gap-2 px-5 py-1.5">
                <span class="text-xs text-primary">現在 {{ currentTime }}</span><span class="h-px flex-1 border-t border-dashed border-primary"></span>
              </div>
              <div class="flex items-center gap-3 px-5 py-1.5">
                <span class="w-11 shrink-0 text-xs tabular-nums text-muted-foreground">{{ item.time || '未定' }}</span>
                <span class="h-2 w-2 shrink-0 rounded-full" :class="dotClass(item)"></span>
                <span class="min-w-0 flex-1 truncate text-sm">{{ item.petName }}</span>
                <span v-if="latenessLabel(item)" class="shrink-0 text-xs font-medium text-danger">{{ latenessLabel(item) }}</span>
                <span class="shrink-0 text-xs text-muted-foreground">{{ visitLabel(item) }}</span>
              </div>
            </template>
            <div v-if="nowPosition(group) === group.items.length" class="flex items-center gap-2 px-5 py-1.5">
              <span class="text-xs text-primary">現在 {{ currentTime }}</span><span class="h-px flex-1 border-t border-dashed border-primary"></span>
            </div>
            <p v-if="!group.items.length" class="px-5 py-2 text-xs text-muted-foreground">此時段尚無預約</p>
          </div>
        </SideDrawer>
        <SideDrawer v-if="drawer === 'pinned'" class="min-h-0 flex-1" title="暫存區" description="在聊天室打 @ 標記就會放進來" @close="closeDrawer">
          <PinnedPetsList />
          <p v-if="!pinnedPets.items.length" class="py-6 text-center text-sm text-muted-foreground">暫存區是空的</p>
        </SideDrawer>
      </div>
    </div>

    <ModalDialog v-if="intakeReviewTarget" size="xl" @close="intakeReviewTarget = null">
      <div class="border-b border-border p-5 pr-16 sm:px-6"><DialogTitle>審核初診資料</DialogTitle><DialogDescription class="mt-1 text-xs">確認資料後再建立正式飼主與寵物資料。</DialogDescription></div>
      <div class="max-h-[min(68vh,48rem)] space-y-5 overflow-y-auto p-5 sm:p-6">
        <section class="rounded-xl border border-border p-4">
          <h3 class="mb-3 text-base font-semibold">貓孩兒</h3>
          <div class="grid gap-5 sm:grid-cols-2">
            <div class="space-y-2 text-sm">
              <p class="border-b border-dashed border-border pb-1 font-semibold text-primary">基本資料</p>
              <p>名字：{{ intakeValue(intakeReviewTarget.pet?.name) }}</p>
              <p>性別：{{ { male: '男生', female: '女生' }[intakeReviewTarget.pet?.sex] || '' }}</p>
              <p>年齡：{{ intakeBirthMonth(intakeReviewTarget.pet?.birthDate) }}</p>
              <p>品種：{{ intakeValue(intakeReviewTarget.pet?.breed) }}</p>
              <p>花色：{{ intakeValue(intakeReviewTarget.pet?.color) }}</p>
            </div>
            <div class="space-y-2 text-sm">
              <p class="border-b border-dashed border-border pb-1 font-semibold text-primary">生活狀況</p>
              <p>家中貓口：{{ intakeReviewTarget.pet?.householdCatCount ?? '' }}<template v-if="intakeReviewTarget.pet?.householdCatCount != null"> 隻</template></p>
              <p>
                主餐配菜：{{ intakeReviewTarget.pet?.foods?.join('、') || '' }}<template v-if="intakeReviewTarget.pet?.foodsOther">（{{ intakeReviewTarget.pet.foodsOther }}）</template>
              </p>
              <p>放飯頻率：{{ { free: '任食', scheduled: `定食定量${intakeReviewTarget.pet?.mealsPerDay ? `：一日 ${intakeReviewTarget.pet.mealsPerDay} 餐` : ''}` }[intakeReviewTarget.pet?.feedingType] || '' }}</p>
            </div>
          </div>
          <div class="mt-5 text-sm">
            <p class="border-b border-dashed border-border pb-1 font-semibold text-primary">醫療紀錄</p>
            <div class="mt-2 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
              <p>結紮：{{ { yes: '已結紮', no: '未結紮' }[intakeReviewTarget.pet?.neutered] || '' }}</p>
              <p>疫苗：{{ intakeReviewTarget.pet?.vaccineStatus === 'done' ? `已注射：${intakeReviewTarget.pet.vaccineDate || ''}` : intakeReviewTarget.pet?.vaccineStatus === 'none' ? '未注射' : '' }}</p>
              <p>
                病史：{{ intakeReviewTarget.pet?.medicalHistory?.join('、') || '' }}<template v-if="intakeReviewTarget.pet?.medicalHistoryOther">；{{ intakeReviewTarget.pet.medicalHistoryOther }}</template>
              </p>
              <p>藥物過敏：{{ intakeReviewTarget.pet?.allergyStatus === 'yes' ? `有：${intakeReviewTarget.pet.allergyType || ''}` : intakeReviewTarget.pet?.allergyStatus === 'none' ? '無過敏' : '' }}</p>
              <p>健檢：{{ intakeReviewTarget.pet?.checkupStatus === 'done' ? `有：${intakeReviewTarget.pet.checkupDate || ''}` : intakeReviewTarget.pet?.checkupStatus === 'none' ? '未健檢' : '' }}</p>
            </div>
          </div>
        </section>
        <section class="rounded-xl border border-border p-4 text-sm">
          <h3 class="mb-3 text-base font-semibold">家長</h3>
          <div class="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
            <p>姓名：{{ intakeValue(intakeReviewTarget.owner?.name) }}</p>
            <p>市話：{{ intakeValue(intakeReviewTarget.owner?.landline) }}</p>
            <p>手機：{{ intakeValue(intakeReviewTarget.owner?.phone) }}</p>
            <p>地址：{{ intakeValue(intakeReviewTarget.owner?.address) }}</p>
            <p>Email：{{ intakeValue(intakeReviewTarget.owner?.email) }}</p>
          </div>
        </section>
        <section class="rounded-xl border border-border p-4">
          <Label class="text-sm font-semibold">掛號安排</Label>
          <p class="mt-1 text-xs text-muted-foreground">核准後會以此日期與時間建立正式掛號；完成審核後才能報到。</p>
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <div><Label for="intake-appointment-date" class="text-xs">掛號日期</Label><DatePicker id="intake-appointment-date" v-model="intakeAppointmentDate" class="mt-1.5 w-full" aria-label="初診掛號日期" /></div>
            <div><Label for="intake-appointment-time" class="text-xs">掛號時間</Label><TimePicker id="intake-appointment-time" v-model="intakeAppointmentTime" class="mt-1.5 w-full" :ranges="APPOINTMENT_TIME_RANGES" :minute-step="APPOINTMENT_TIME_MINUTE_STEP" aria-label="初診掛號時間" /></div>
          </div>
        </section>
      </div>
      <DialogFooter><Button type="button" variant="secondary" :disabled="busy" @click="intakeReviewTarget = null">取消</Button><Button type="button" variant="destructive" :disabled="busy" @click="rejectIntake(intakeReviewTarget)">退回</Button><Button type="button" :disabled="busy" @click="approveIntake(intakeReviewTarget)">核准並掛號</Button></DialogFooter>
    </ModalDialog>
    <HandoffSheet v-if="activePatient" :key="activePatient._id" :appointment="activePatient" @updated="onSheetUpdate" @close="selected = ''" />
    <CheckInDialog v-if="dialog === 'check-in-detail' && target" :appointment="target" :late="itemIsOverdue(target)" :suggested-checkin-number="suggestedCheckinNumber()" :submitting="busy" :error-message="dialogError" @submit="(values) => submit(values, 'check-in-detail')" @close="dialog = ''" />
    <CancelAppointmentDialog v-if="dialog === 'cancel' && target" :appointment="target" :submitting="busy" :error-message="dialogError" @submit="(reason) => submit({ cancelReason: reason }, 'cancel')" @close="dialog = ''" />
    <ConfirmDialog v-if="confirmation" :open="true" :title="confirmation.title" :description="`病患：${target.petName}`" :loading="busy" @confirm="submit({}, confirmation.kind)" @cancel="confirmation = null" />
  </div>
</template>
