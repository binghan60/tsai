<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CalendarPlus, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, ClipboardList, Plus, RefreshCw, UserCheck } from '@lucide/vue'
import { http } from '../api/http'
import { useToast } from '../composables/useToast'
import { useClinicSync } from '../composables/useClinicSync'
import { useSearchQueryParam } from '../composables/useSearchQueryParam'
import { useAppointmentNotifier } from '../composables/useAppointmentNotifier'
import { clinicDateInput, clinicTimeInput, shiftDateInput, weekdayLabel } from '../lib/datetime'
import { appointmentsForTimeline, groupBySession, SURGERY_BLOCK } from '../lib/appointmentTimeline'
import { workflowFilter, workflowState, visitLabel } from '../../../shared/appointmentWorkflow.js'
import HandoffSheet from '../components/HandoffSheet.vue'
import RowActions from '../components/RowActions.vue'
import NewAppointmentDialog from '../components/NewAppointmentDialog.vue'
import EditAppointmentDialog from '../components/EditAppointmentDialog.vue'
import CheckInDialog from '../components/CheckInDialog.vue'
import InitialCheckInDialog from '../components/InitialCheckInDialog.vue'
import CancelAppointmentDialog from '../components/CancelAppointmentDialog.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import ModalDialog from '../components/ModalDialog.vue'
import FilterBar from '../components/FilterBar.vue'
import ListSkeleton from '../components/ListSkeleton.vue'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Alert, AlertDescription } from '../components/ui/alert'
import { DatePicker } from '../components/ui/date-picker'
import { TimePicker } from '../components/ui/time-picker'
import { Label } from '../components/ui/label'
import { DialogDescription, DialogFooter, DialogTitle } from '../components/ui/dialog'
import { APPOINTMENT_TIME_MINUTE_STEP, APPOINTMENT_TIME_RANGES } from '../lib/appointmentTime'

// 櫃台工作台：以「現在該做什麼」分匣，時間軸退到右欄當參考。
// 三個匣子由上而下就是櫃台的優先順序——醫師已交辦的人正站在櫃台前面等，排最上面。
const toast = useToast()
const notifyChat = useAppointmentNotifier()
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
const lateCheckIn = ref(false)
const confirmation = ref(null)
const intakeReviewTarget = ref(null)
const intakeAppointmentDate = ref('')
const intakeAppointmentTime = ref('')
const templates = ref([])
const defaultTemplate = ref('')
const pendingIntakeCount = ref(0)
const showReopenRequests = ref(true)
const showHandoffs = ref(true)
const showWaiting = ref(true)
const showUpcoming = ref(true)
const showClosedAppointments = ref(true)
const showFollowUps = ref(true)
const showFinished = ref(true)
const now = ref(Date.now())
let clock
let request = 0

const keyword = computed(() => search.value.trim().toLowerCase())
function matches(appointment) {
  if (!keyword.value) return true
  return `${appointment.petName} ${appointment.ownerName} ${appointment.ownerPhone} ${appointment.reason}`.toLowerCase().includes(keyword.value)
}
function tray(filter, sortKey) {
  return items.value.filter((item) => workflowFilter(item, filter) && matches(item)).sort((a, b) => new Date(a[sortKey] || a.scheduledAt) - new Date(b[sortKey] || b.scheduledAt))
}

const handoffs = computed(() => tray('handoff', 'handoffAt'))
const waiting = computed(() => tray('waiting', 'checkedInAt'))
const scheduled = computed(() => tray('scheduled', 'scheduledAt'))
const upcoming = computed(() => scheduled.value)
const closedAppointments = computed(() => items.value.filter((item) => ['cancelled', 'no_show'].includes(item.status) && matches(item)).sort((a, b) => new Date(a.scheduledAt || 0) - new Date(b.scheduledAt || 0)))
const followUps = computed(() => tray('followup', 'handoffAt').filter((item) => workflowState(item).completed))
const reopenRequests = computed(() => items.value.filter((item) => workflowState(item).completed && item.reopenRequest?.requestedAt && !item.reopenRequest?.approvedAt && matches(item)).sort((a, b) => new Date(a.reopenRequest.requestedAt) - new Date(b.reopenRequest.requestedAt)))
const finished = computed(() => tray('completed', 'deskCompletedAt').filter((item) => !item.reopenRequest?.requestedAt || item.reopenRequest?.approvedAt))
const onsite = computed(() => items.value.filter((item) => workflowFilter(item, 'onsite')))
const waitingCount = computed(() => items.value.filter((item) => workflowFilter(item, 'waiting')).length)
const visitingCount = computed(() => items.value.filter((item) => workflowFilter(item, 'visiting')).length)
const activePatient = computed(() => items.value.find((item) => String(item._id) === selected.value) || null)
const currentTime = computed(() => clinicTimeInput(new Date(now.value)))
const timeline = computed(() => groupBySession(appointmentsForTimeline(items.value)))

function dotClass(appointment) {
  const state = workflowState(appointment)
  if (state.handedOff) return 'bg-warning'
  if (state.started) return 'bg-info'
  if (appointment.status === 'arrived') return 'bg-primary'
  return 'bg-border'
}
function nowPosition(group) {
  if (date.value !== today || currentTime.value < group.session.start || currentTime.value > group.session.end) return -1
  const index = group.items.findIndex((item) => item.time && item.time > currentTime.value)
  return index < 0 ? group.items.length : index
}
function excerpt(appointment) {
  return appointment.handoffNote || '醫師沒有留下交辦事項'
}
function closedStatusMeta(appointment) {
  if (appointment.status === 'no_show') return { label: '未到診', class: 'bg-warning-surface text-warning' }
  return { label: '已取消', class: 'bg-muted text-muted-foreground' }
}
function latenessLabel(appointment) {
  return appointment.latenessMinutes > 0 ? `遲到 ${appointment.latenessMinutes} 分` : ''
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
  const used = new Set();
  for (const appointment of items.value) {
    for (const number of [appointment.checkinNumber, ...(appointment.checkinNumberHistory ?? [])]) {
      if (Number.isSafeInteger(number) && number > 0) used.add(number);
    }
  }
  let candidate = 1;
  while (used.has(candidate)) candidate += 1;
  return candidate;
}

function isInitialDataPending(appointment) {
  return appointment.visitType === 'new'
    && !appointment.petId
    && Boolean(appointment.intakeVerificationCode)
    && !appointment.intakeSubmissionId;
}

const { connected } = useClinicSync(date, refresh, applyUpdate)
watch(date, () => {
  loading.value = true
  items.value = []
  selected.value = ''
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

async function loadPendingIntakeCount() {
  try {
    const { data } = await http.get('/intake-submissions')
    pendingIntakeCount.value = (data.items || []).length
  } catch {
    /* 初診審核數量載不到不影響既有櫃台工作。 */
  }
}

// 行政操作（新增／編輯／報到／取消／未到／恢復）共用同一條送出路徑，
// 差別只在打哪一支端點與事後要送哪一則聊天室通知。
function admin(kind, appointment = null) {
  target.value = appointment
  dialogError.value = ''
  if (kind === 'new') {
    dialog.value = 'new'
    return
  }
  if (kind === 'edit' || kind === 'cancel') {
    dialog.value = kind
    return
  }
  if (kind === 'check-in' || kind === 'check-in-late') {
    lateCheckIn.value = kind === 'check-in-late'
    dialog.value = 'check-in'
    return
  }
  confirmation.value = {
    kind,
    title: kind === 'no-show' ? '標記這筆預約未到？' : '恢復為待報到？',
  }
}

const NOTIFICATIONS = { 'check-in': 'check_in', cancel: 'cancel', 'no-show': 'no_show', edit: 'edit' }
async function submit(values, kind = dialog.value) {
  if (busy.value) return
  busy.value = true
  dialogError.value = ''
  try {
    let data
    if (kind === 'new') ({ data } = await http.post('/appointments', values))
    else if (kind === 'edit') ({ data } = await http.put(`/appointments/${target.value._id}`, { version: target.value.__v ?? 0, ...values }))
    else ({ data } = await http.post(`/appointments/${target.value._id}/${kind}`, { version: target.value.__v ?? 0, ...values }))
    applyUpdate(data)
    // 恢復是兩種動作共用一支端點：從候診退回待報到叫「取消報到」，
    // 從已取消／未到回來叫「恢復掛號」，聊天室要講得出差別。
    const action = kind === 'new' ? 'create' : kind === 'restore' ? (target.value?.status === 'arrived' ? 'undo_check_in' : 'restore') : NOTIFICATIONS[kind]
    if (action) notifyChat(data, action)
    dialog.value = ''
    confirmation.value = null
    lateCheckIn.value = false
    toast.success(kind === 'new' && data.visitType === 'new' ? `初診掛號已建立，驗證碼：${data.intakeVerificationCode}` : '診務資料已更新')
  } catch (err) {
    dialogError.value = err.response?.data?.message || '操作失敗，請稍後重試'
    if (!dialog.value) toast.error(dialogError.value)
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
  <div class="space-y-4 pb-8">
    <header class="flex flex-wrap items-center gap-4">
      <span class="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
        <ClipboardList class="h-5 w-5" stroke-width="1.75" />
      </span>
      <div>
        <h1 class="text-xl font-semibold">櫃台工作台</h1>
        <p class="mt-0.5 text-xs text-muted-foreground">報到、交辦處理與回診安排</p>
      </div>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <FilterBar id="reception-search" v-model="search" label="搜尋診務" placeholder="病患、飼主、電話" class="w-72" />
        <Button variant="secondary" size="icon-sm" aria-label="前一天" @click="date = shiftDateInput(date, -1)"><ChevronLeft class="h-4 w-4" /></Button>
        <DatePicker v-model="date" :clearable="false" aria-label="診務日期" class="w-40" />
        <Button variant="secondary" size="icon-sm" aria-label="後一天" @click="date = shiftDateInput(date, 1)"><ChevronRight class="h-4 w-4" /></Button>
        <Button variant="secondary" size="sm" :disabled="date === today" @click="date = today">今天</Button>
        <Button size="sm" class="bg-info-surface text-info hover:bg-info-surface/80" as-child
          ><router-link to="/reception/intakes" class="relative"
            >初診審核<span v-if="pendingIntakeCount" class="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-xs font-bold text-white ring-2 ring-background">{{ pendingIntakeCount > 99 ? '99+' : pendingIntakeCount }}</span></router-link
          ></Button
        >
        <Button variant="secondary" size="sm" :disabled="busy" @click="issueIntakeCode">發初診碼</Button>
        <Button size="sm" @click="admin('new')"><Plus class="h-4 w-4" />新增掛號</Button>
      </div>
    </header>

    <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <p>{{ date }} · {{ weekdayLabel(date) }} · 共 {{ items.length }} 筆</p>
      <span class="inline-flex items-center gap-1.5"> <span class="h-1.5 w-1.5 rounded-full" :class="connected ? 'bg-success' : 'bg-warning'"></span>{{ connected ? '即時同步' : '重新連線中' }} </span>
    </div>

    <Alert v-if="error" variant="destructive" class="flex items-center justify-between gap-3">
      <AlertDescription>{{ error }}</AlertDescription>
      <Button variant="secondary" size="sm" @click="refresh"><RefreshCw class="h-4 w-4" />重試</Button>
    </Alert>

    <ListSkeleton v-if="loading" :rows="5" />

    <div v-else class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div class="space-y-4">
        <section v-if="reopenRequests.length" class="overflow-hidden rounded-xl border border-warning/35 bg-card" aria-label="醫師申請修改">
          <button type="button" class="flex w-full flex-wrap items-center gap-3 border-b border-warning/25 bg-warning-surface px-5 py-3 text-left hover:bg-warning-surface/80" :aria-expanded="showReopenRequests" @click="showReopenRequests = !showReopenRequests">
            <ClipboardList class="h-5 w-5 text-warning" />
            <h2 class="text-base font-semibold text-warning">醫師申請修改</h2>
            <span class="inline-flex h-6 items-center rounded-full bg-card px-3 text-xs font-medium leading-none text-warning">{{ reopenRequests.length }} 筆</span>
            <p class="ml-auto text-xs text-warning/80">請確認後核准重新開啟就診</p>
            <ChevronDown class="h-4 w-4 text-warning/80 transition-transform" :class="{ '-rotate-90': !showReopenRequests }" />
          </button>
          <div v-show="showReopenRequests">
            <div v-for="item in reopenRequests" :key="item._id" class="flex flex-wrap items-center gap-4 border-b border-border px-5 py-3.5 last:border-b-0">
            <div class="w-40 shrink-0">
              <p class="truncate text-sm font-semibold">{{ item.petName }}</p>
              <p class="truncate text-xs text-muted-foreground">
                {{ item.ownerName || '未填飼主' }}<template v-if="item.ownerPhone"> · {{ item.ownerPhone }}</template>
              </p>
            </div>
            <p class="min-w-0 flex-1 truncate text-sm text-muted-foreground">{{ item.reopenRequest.reason || '未填寫申請原因' }}</p>
            <Button size="sm" class="shrink-0" @click="openSheet(item)">處理申請</Button>
            </div>
          </div>
        </section>

        <section class="overflow-hidden rounded-xl border border-primary/35 bg-card" aria-label="醫師已交辦">
          <button type="button" class="flex w-full flex-wrap items-center gap-3 border-b border-primary/25 bg-accent px-5 py-3 text-left hover:bg-accent/80" :aria-expanded="showHandoffs" @click="showHandoffs = !showHandoffs">
            <h2 class="text-base font-semibold text-accent-foreground">醫師已交辦 · 待處理</h2>
            <span class="inline-flex h-6 items-center rounded-full bg-card px-3 text-xs font-medium leading-none text-accent-foreground">{{ handoffs.length }} 位</span>
            <p class="ml-auto text-xs text-accent-foreground/80">飼主正在櫃台等，優先處理</p>
            <ChevronDown class="h-4 w-4 text-accent-foreground/80 transition-transform" :class="{ '-rotate-90': !showHandoffs }" />
          </button>
          <div v-show="showHandoffs">
            <p v-if="!handoffs.length" class="px-5 py-6 text-center text-sm text-muted-foreground">目前沒有等待處理的交辦。</p>
          <div v-for="item in handoffs" :key="item._id" class="border-b border-border px-5 py-3.5 last:border-b-0">
            <div class="flex flex-wrap items-center gap-4">
              <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-base font-semibold tabular-nums text-primary-foreground">{{ item.checkinNumber ?? '—' }}</span>
              <div class="w-40 shrink-0">
                <p class="truncate text-sm font-semibold">{{ item.petName }}</p>
                <p class="truncate text-xs text-muted-foreground">
                  {{ item.ownerName || '飼主待確認' }}<template v-if="item.ownerPhone"> · {{ item.ownerPhone }}</template>
                </p>
              </div>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm">{{ excerpt(item) }}</p>
                <div class="mt-1 flex flex-wrap gap-2">
                  <span v-if="latenessLabel(item)" class="inline-flex h-6 items-center rounded-full bg-danger-surface px-2.5 text-xs font-medium leading-none text-danger">{{ latenessLabel(item) }}</span>
                  <span v-if="item.isSurgery" class="inline-flex h-6 items-center rounded-full bg-danger-surface px-2.5 text-xs font-medium leading-none text-danger">手術{{ item.surgeryName ? '：' + item.surgeryName : '' }}</span>
                  <span v-if="item.specialCareNote" class="inline-flex h-6 items-center rounded-full bg-warning-surface px-2.5 text-xs font-medium leading-none text-warning">有飼主提醒</span>
                  <span v-if="item.followUpRecommendation" class="inline-flex h-6 items-center rounded-full bg-muted px-2.5 text-xs font-medium leading-none text-muted-foreground">建議回診</span>
                </div>
              </div>
              <Button size="sm" class="shrink-0" @click="openSheet(item)">處理</Button>
            </div>
              <p v-if="item.reason" class="mt-1.5 wrap-break-word pl-15 text-xs leading-snug text-muted-foreground">來院原因：{{ item.reason }}</p>
              <p v-if="item.internalNote" class="mt-1.5 whitespace-pre-wrap wrap-anywhere pl-15 text-xs leading-snug text-muted-foreground"><span class="font-medium text-foreground">備註：</span>{{ item.internalNote }}</p>
            </div>
          </div>
        </section>

        <section class="overflow-hidden rounded-xl border border-border bg-card" aria-label="候診中">
          <button type="button" class="flex w-full items-center gap-3 border-b border-border px-5 py-3 text-left hover:bg-field/40" :aria-expanded="showWaiting" @click="showWaiting = !showWaiting">
            <h2 class="text-base font-semibold">候診中</h2>
            <span class="inline-flex h-6 items-center rounded-full bg-muted px-3 text-xs font-medium leading-none">{{ waiting.length }} 位</span>
            <p class="ml-auto text-xs text-muted-foreground">已報到，等待看診</p>
            <ChevronDown class="h-4 w-4 text-muted-foreground transition-transform" :class="{ '-rotate-90': !showWaiting }" />
          </button>
          <div v-show="showWaiting">
            <p v-if="!waiting.length" class="px-5 py-6 text-center text-sm text-muted-foreground">目前沒有候診中的病患。</p>
          <div v-for="item in waiting" :key="item._id" class="border-b border-border px-5 py-3.5 last:border-b-0">
            <div class="flex flex-wrap items-center gap-4">
              <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-base font-semibold tabular-nums text-primary-foreground">{{ item.checkinNumber ?? '—' }}</span>
              <div class="w-40 shrink-0">
                <p class="truncate text-sm font-semibold">{{ item.petName }}</p>
                <p class="truncate text-xs text-muted-foreground">
                  {{ item.species || '未填品種' }}<template v-if="item.visitType"> · {{ item.visitType === 'new' ? '初診' : '回診' }}</template
                  ><template v-if="item.isSurgery">
                    · <span class="font-semibold text-danger">手術{{ item.surgeryName ? '：' + item.surgeryName : '' }}</span></template
                  ><template v-if="latenessLabel(item)">
                    · <span class="font-medium text-danger">{{ latenessLabel(item) }}</span></template
                  >
                </p>
              </div>
              <p class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {{ item.ownerName || '未留飼主姓名' }}<template v-if="item.ownerPhone"> · {{ item.ownerPhone }}</template>
              </p>
              <div class="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" :disabled="busy" @click="admin('restore', item)">取消報到</Button>
                <RowActions :actions="[{ key: 'edit', label: '修改掛號' }]" :label="`${item.petName}的更多操作`" @select="(key) => admin(key, item)" />
              </div>
            </div>
              <p v-if="item.reason" class="mt-1.5 wrap-break-word pl-15 text-xs leading-snug text-muted-foreground">來院原因：{{ item.reason }}</p>
              <p v-if="item.internalNote" class="mt-1.5 whitespace-pre-wrap wrap-anywhere pl-15 text-xs leading-snug text-muted-foreground"><span class="font-medium text-foreground">備註：</span>{{ item.internalNote }}</p>
            </div>
          </div>
        </section>

        <section class="overflow-hidden rounded-xl border border-border bg-card" aria-label="待報到">
          <button type="button" class="flex w-full items-center gap-3 border-b border-border px-5 py-3 text-left hover:bg-field/40" :aria-expanded="showUpcoming" @click="showUpcoming = !showUpcoming">
            <h2 class="text-base font-semibold">待報到</h2>
            <span class="inline-flex h-6 items-center rounded-full bg-muted px-3 text-xs font-medium leading-none">{{ upcoming.length }} 位</span>
            <p class="ml-auto text-xs text-muted-foreground">依預約時段</p>
            <ChevronDown class="h-4 w-4 text-muted-foreground transition-transform" :class="{ '-rotate-90': !showUpcoming }" />
          </button>
          <div v-show="showUpcoming">
            <p v-if="!upcoming.length" class="px-5 py-6 text-center text-sm text-muted-foreground">今天沒有等待報到的預約。</p>
          <div v-for="item in upcoming" :key="item._id" class="border-b border-border px-5 py-3.5 last:border-b-0">
            <div class="flex flex-wrap items-center gap-4">
              <span class="w-14 shrink-0 text-sm font-semibold tabular-nums">{{ item.time || '未定' }}</span>
              <div class="w-40 shrink-0">
                <p class="truncate text-sm font-semibold">{{ item.petName }}</p>
                <p class="truncate text-xs text-muted-foreground">
                  {{ item.species || '未填品種' }}<template v-if="item.visitType"> · {{ item.visitType === 'new' ? '初診' : '回診' }}</template
                  ><template v-if="item.isSurgery"> · <span class="font-semibold text-danger">手術{{ item.surgeryName ? '：' + item.surgeryName : '' }}</span></template>
                </p>
              </div>
              <p class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {{ item.ownerName || '未留飼主姓名' }}<template v-if="item.ownerPhone"> · {{ item.ownerPhone }}</template>
              </p>
              <div class="flex flex-wrap items-center gap-2">
                <Button v-if="item.visitType === 'new' && item.intakeSubmissionId && !item.petId" size="sm" class="bg-info-surface text-info hover:bg-info-surface/80" :disabled="busy" @click="openIntakeReview(item)"><ClipboardCheck class="h-4 w-4" />審核</Button>
                <Button v-else-if="!isInitialDataPending(item)" size="sm" :disabled="busy" @click="admin('check-in', item)"><UserCheck class="h-4 w-4" />報到</Button>
                <Button v-if="!isInitialDataPending(item)" variant="secondary" size="sm" :disabled="busy" @click="admin('no-show', item)">標記未到</Button>
                <Button variant="destructive" size="sm" :disabled="busy" @click="admin('cancel', item)">取消掛號</Button>
                <RowActions :actions="[{ key: 'edit', label: '修改預約' }]" :label="`${item.petName}的更多操作`" @select="(key) => admin(key, item)" />
              </div>
            </div>
              <p v-if="item.reason" class="mt-1.5 wrap-break-word pl-18 text-xs leading-snug text-muted-foreground">來院原因：{{ item.reason }}</p>
              <p v-if="item.internalNote" class="mt-1.5 whitespace-pre-wrap wrap-anywhere pl-18 text-xs leading-snug text-muted-foreground"><span class="font-medium text-foreground">備註：</span>{{ item.internalNote }}</p>
            <p v-if="item.visitType === 'new'" class="mt-1.5 pl-18 text-xs text-muted-foreground">
              初診驗證碼：<span class="font-semibold tracking-[0.16em] text-foreground">{{ item.intakeVerificationUsedAt ? '已使用' : item.intakeVerificationCode || '未建立' }}</span>
            </p>
            </div>
          </div>
        </section>

        <section class="overflow-hidden rounded-xl border border-border bg-card" aria-label="未到與取消">
          <button type="button" class="flex w-full items-center gap-3 border-b border-border px-5 py-3 text-left hover:bg-field/40" :aria-expanded="showClosedAppointments" @click="showClosedAppointments = !showClosedAppointments">
            <h2 class="text-base font-semibold">未到／取消</h2>
            <span class="inline-flex h-6 items-center rounded-full bg-muted px-3 text-xs font-medium leading-none">{{ closedAppointments.length }} 位</span>
            <p class="ml-auto text-xs text-muted-foreground">已標記未到或取消</p>
            <ChevronDown class="h-4 w-4 text-muted-foreground transition-transform" :class="{ '-rotate-90': !showClosedAppointments }" />
          </button>
          <div v-show="showClosedAppointments">
            <p v-if="!closedAppointments.length" class="px-5 py-6 text-center text-sm text-muted-foreground">目前沒有未到或取消的預約。</p>
          <div v-for="item in closedAppointments" :key="item._id" class="border-b border-border px-5 py-3.5 last:border-b-0">
            <div class="flex flex-wrap items-center gap-4">
              <div class="flex w-28 shrink-0 flex-wrap items-center gap-2">
                <span class="text-sm font-semibold tabular-nums text-muted-foreground">{{ item.time || '未定' }}</span>
                <Badge variant="status" :class="closedStatusMeta(item).class">{{ closedStatusMeta(item).label }}</Badge>
              </div>
              <div class="w-40 shrink-0">
                <p class="truncate text-sm font-semibold">{{ item.petName }}</p>
                <p class="truncate text-xs text-muted-foreground">
                  {{ item.species || '未填品種' }}<template v-if="item.visitType"> · {{ item.visitType === 'new' ? '初診' : '回診' }}</template
                  ><template v-if="item.isSurgery"> · <span class="font-semibold text-danger">手術{{ item.surgeryName ? '：' + item.surgeryName : '' }}</span></template>
                </p>
              </div>
              <p class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {{ item.ownerName || '未留飼主姓名' }}<template v-if="item.ownerPhone"> · {{ item.ownerPhone }}</template>
              </p>
              <div class="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" :disabled="busy" @click="admin('restore', item)">恢復待報到</Button>
                <RowActions :actions="[{ key: 'edit', label: '修改預約' }]" :label="`${item.petName}的更多操作`" @select="(key) => admin(key, item)" />
              </div>
            </div>
              <p v-if="item.reason" class="mt-1.5 wrap-break-word pl-18 text-xs leading-snug text-muted-foreground">來院原因：{{ item.reason }}</p>
              <p v-if="item.internalNote" class="mt-1.5 whitespace-pre-wrap wrap-anywhere pl-18 text-xs leading-snug text-muted-foreground"><span class="font-medium text-foreground">備註：</span>{{ item.internalNote }}</p>
            </div>
          </div>
        </section>

        <section v-if="followUps.length" class="overflow-hidden rounded-xl border border-border bg-card" aria-label="待安排回診">
          <button type="button" class="flex w-full items-center gap-3 border-b border-border px-5 py-3 text-left hover:bg-field/40" :aria-expanded="showFollowUps" @click="showFollowUps = !showFollowUps">
            <h2 class="text-base font-semibold">待安排回診</h2>
            <span class="inline-flex h-6 items-center rounded-full bg-muted px-3 text-xs font-medium leading-none">{{ followUps.length }} 位</span>
            <ChevronDown class="ml-auto h-4 w-4 text-muted-foreground transition-transform" :class="{ '-rotate-90': !showFollowUps }" />
          </button>
          <div v-show="showFollowUps">
            <div v-for="item in followUps" :key="item._id" class="flex flex-wrap items-center gap-4 border-b border-border px-5 py-3.5 last:border-b-0">
            <div class="w-40 shrink-0">
              <p class="truncate text-sm font-semibold">{{ item.petName }}</p>
              <p class="truncate text-xs text-muted-foreground">
                {{ item.ownerName || '飼主待確認' }}<template v-if="item.ownerPhone"> · {{ item.ownerPhone }}</template
                ><template v-if="latenessLabel(item)">
                  · <span class="font-medium text-danger">{{ latenessLabel(item) }}</span></template
                >
              </p>
            </div>
            <p class="min-w-0 flex-1 truncate text-sm">醫師建議：{{ item.followUpRecommendation || item.followUpReason }}</p>
            <Button variant="secondary" size="sm" class="shrink-0" @click="openSheet(item)"><CalendarPlus class="h-4 w-4" />安排回診</Button>
            </div>
          </div>
        </section>

        <section class="overflow-hidden rounded-xl border border-border bg-card">
          <button type="button" class="flex w-full items-center gap-3 bg-field/40 px-5 py-3 text-left" :aria-expanded="showFinished" @click="showFinished = !showFinished">
            <h2 class="text-base font-semibold text-muted-foreground">今日已完成</h2>
            <span class="inline-flex h-6 items-center rounded-full bg-muted px-3 text-xs font-medium leading-none">{{ finished.length }} 位</span>
            <ChevronDown class="ml-auto h-4 w-4 text-muted-foreground transition-transform" :class="{ '-rotate-90': !showFinished }" />
          </button>
          <div v-show="showFinished">
            <p v-if="!finished.length" class="px-5 py-5 text-center text-sm text-muted-foreground">今天還沒有完成的就診。</p>
            <button v-for="item in finished" :key="item._id" type="button" class="flex w-full items-center gap-4 border-t border-border px-5 py-3 text-left hover:bg-field" @click="openSheet(item)">
              <span class="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">{{ item.time || '未定' }}</span>
              <span class="w-40 shrink-0 truncate text-sm font-semibold">{{ item.petName }}</span>
              <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                >{{ item.ownerName
                }}<template v-if="latenessLabel(item)">
                  · <span class="font-medium text-danger">{{ latenessLabel(item) }}</span></template
                ><template v-if="item.followUpAppointmentId"> · 已約回診 {{ item.followUpDate }} {{ item.followUpTime }}</template></span
              >
            </button>
          </div>
        </section>
      </div>

      <aside class="space-y-4">
        <section class="rounded-xl border border-border bg-card p-5">
          <p class="text-xs text-muted-foreground">現在 {{ currentTime }} · 現場人數</p>
          <p class="mt-1 flex items-baseline gap-2">
            <span class="text-4xl font-semibold tabular-nums">{{ onsite.length }}</span>
            <span class="text-sm text-muted-foreground">位在院</span>
          </p>
          <div class="mt-4 grid grid-cols-3 gap-2 text-center">
            <div class="rounded-lg bg-field p-3">
              <p class="text-base font-semibold">{{ waitingCount }}</p>
              <p class="text-xs text-muted-foreground">候診中</p>
            </div>
            <div class="rounded-lg bg-field p-3">
              <p class="text-base font-semibold">{{ visitingCount }}</p>
              <p class="text-xs text-muted-foreground">看診中</p>
            </div>
            <div class="rounded-lg bg-accent p-3">
              <p class="text-base font-semibold text-accent-foreground">{{ handoffs.length }}</p>
              <p class="text-xs text-accent-foreground">待處理</p>
            </div>
          </div>
        </section>

        <section class="overflow-hidden rounded-xl border border-border bg-card" aria-label="看診時間軸">
          <div class="border-b border-border px-5 py-3"><h2 class="text-base font-semibold">看診時間軸</h2></div>
          <div v-for="(group, groupIndex) in timeline" :key="group.session.id" class="py-2">
            <p v-if="groupIndex === 1" class="px-5 py-2 text-xs text-muted-foreground">{{ SURGERY_BLOCK.start }}–{{ SURGERY_BLOCK.end }} · {{ SURGERY_BLOCK.label }}</p>
            <p class="flex items-center gap-2 px-5 py-1.5 text-xs font-semibold text-muted-foreground">
              {{ group.session.label }}<span class="font-normal">{{ group.session.start }}–{{ group.session.end }}</span>
            </p>
            <template v-for="(item, index) in group.items" :key="item._id">
              <div v-if="nowPosition(group) === index" class="flex items-center gap-2 px-5 py-1.5">
                <span class="text-xs text-primary">現在 {{ currentTime }}</span
                ><span class="h-px flex-1 border-t border-dashed border-primary"></span>
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
              <span class="text-xs text-primary">現在 {{ currentTime }}</span
              ><span class="h-px flex-1 border-t border-dashed border-primary"></span>
            </div>
            <p v-if="!group.items.length" class="px-5 py-2 text-xs text-muted-foreground">此時段尚無預約</p>
          </div>
        </section>
      </aside>
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
    <NewAppointmentDialog v-if="dialog === 'new'" :date="date" :is-today="date === today" :templates="templates" :default-template-id="defaultTemplate" :submitting="busy" :error-message="dialogError" @submit="submit" @close="dialog = ''" />
    <EditAppointmentDialog v-if="dialog === 'edit'" :appointment="target" :templates="templates" :submitting="busy" :error-message="dialogError" @submit="submit" @close="dialog = ''" />
    <InitialCheckInDialog v-if="dialog === 'check-in' && !target?.petId" :appointment="target" :late="lateCheckIn" :suggested-checkin-number="suggestedCheckinNumber()" :submitting="busy" :error-message="dialogError" @submit="submit" @close="dialog = ''" />
    <CheckInDialog v-else-if="dialog === 'check-in'" :appointment="target" :late="lateCheckIn" :suggested-checkin-number="suggestedCheckinNumber()" :submitting="busy" :error-message="dialogError" @submit="submit" @close="dialog = ''" />
    <CancelAppointmentDialog v-if="dialog === 'cancel'" :appointment="target" :submitting="busy" :error-message="dialogError" @submit="(reason) => submit({ cancelReason: reason })" @close="dialog = ''" />
    <ConfirmDialog v-if="confirmation" :open="true" :title="confirmation.title" :description="`病患：${target.petName}`" :loading="busy" @confirm="submit({}, confirmation.kind)" @cancel="confirmation = null" />
  </div>
</template>
