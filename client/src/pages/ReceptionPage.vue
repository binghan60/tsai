<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { AlertTriangle, CalendarPlus, Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Clock, Copy, PackageCheck, Pin, Plus, RefreshCw, User, X } from '@lucide/vue'
import { http } from '../api/http'
import { useToast } from '../composables/useToast'
import { useClinicSync } from '../composables/useClinicSync'
import { useSearchQueryParam } from '../composables/useSearchQueryParam'
import { useAppointmentNotifier } from '../composables/useAppointmentNotifier'
import { clinicDateInput, clinicTimeInput, shiftDateInput, weekdayLabel } from '../lib/datetime'
import { appointmentsForTimeline, groupBySession, isIdentityConfirmed, nowIndexInSession, SURGERY_BLOCK, visitTypeMeta } from '../lib/appointmentTimeline'
import { isOverdue, minutesPastSchedule, sessionAutoCollapsed } from '../lib/receptionBoard'
import { workflowFilter, workflowState } from '../../../shared/appointmentWorkflow.js'
import { patientNotesFor } from '../lib/appointmentDisplay'
import PatientNotes from '../components/PatientNotes.vue'
import { usePinnedPetsStore } from '../stores/pinnedPets'
import HandoffSheet from '../components/HandoffSheet.vue'
import MedicationWorkspace from '../components/MedicationWorkspace.vue'
import PinnedPetsList from '../components/PinnedPetsList.vue'
import RowActions from '../components/RowActions.vue'
import SurgeryBadge from '../components/SurgeryBadge.vue'
import LatenessBadge from '../components/LatenessBadge.vue'
import AppointmentDialog from '../components/AppointmentDialog.vue'
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

// 櫃台工作台：上方一條橫式流程列（待報到 → 在院 → 待櫃台處理 → 今日已完成，一格一個數字，
// 點一格只看那一段），下面整頁是看診時間軸——依預約時段排、左側軌道、時段可收合、「現在」虛線。
// 早期版本是四欄看板（每個階段一欄各自捲），實際用起來視線要在四個地方跳，比時間軸還雜，
// 所以改回時間軸當主體，階段只留一條數字列。
//
// 真正要人注意的例外（醫師申請修改、遲到還沒報到、待審初診）浮到流程列下方的警示列。
// 新增／修改掛號改成置中的雙欄 Modal（AppointmentDialog），填到一半可「收起」讓出看板；
// 初診報到仍開在時間軸右側的 SideDrawer（要一邊填一邊看看板）；暫存區是「看一批、看完就關」的查閱，走大 Modal。
const router = useRouter()
const toast = useToast()
const notifyChat = useAppointmentNotifier()
const pinnedPets = usePinnedPetsStore()
const today = clinicDateInput()
const date = useSearchQueryParam('date', today)
const search = useSearchQueryParam('q', '')
const selected = useSearchQueryParam('selected', '')
const stageFilter = useSearchQueryParam('stage', '')
const medicationCounts = ref({})
const newMedicationWorkspace = ref(null)
const medicationPacking = computed(() => medicationCounts.value.approved || 0)
const medicationActive = computed(() => ['review', 'approved', 'ready'].reduce((sum, key) => sum + (medicationCounts.value[key] || 0), 0))

const items = ref([])
// 寵物／飼主備註存在主檔上、不在掛號快照裡，由列表 API 另外回一份以 id 為鍵的對照表。
const patientNotes = ref({ pets: {}, owners: {} })
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
const now = ref(Date.now())
let clock
let request = 0

// 右側抽屜（初診報到、暫存區）一次只顯示一個；掛號 Modal 也借這個狀態管開關。
// 新增掛號收起來時元件仍保持掛載（v-if 看 newDraftOpen、open 看 drawer），填到一半的內容不會消失。
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
const hasAlerts = computed(() => reopenRequests.value.length || overdue.value.length || pendingIntakeCount.value)
const drawerVisible = computed(() => drawer.value === 'check-in')

// ── 流程列與時間軸 ──────────────────────────────────────────────────────────
// 流程列的四格就是四個篩選：點了只看那一段，再點一次清除。
// dot 是這一段在時間軸上的顏色（軌道上的點、卡片底色都用同一個），流程列的標籤旁帶同一顆點，
// 流程列本身就是圖例，不用另外解釋「藍色是什麼」。
const STAGES = [
  { key: 'scheduled', label: '待報到', dot: 'bg-muted-foreground/60 ring-1 ring-border' },
  { key: 'onsite', label: '在院', dot: 'bg-primary' },
  { key: 'handoff', label: '待櫃台處理', dot: 'bg-warning' },
  { key: 'completed', label: '今日已完成', dot: 'bg-muted-foreground/30' },
]
// 兩種不是階段的外框色：遲到未報到（紅）、手術（紫），只在還沒報到時當卡片底色。
const LEGEND = [
  { label: '遲到未報到', class: 'border-danger bg-danger-surface' },
  { label: '手術', class: 'border-surgery bg-surgery-surface' },
]
const stageCounts = computed(() => ({
  scheduled: scheduled.value.length,
  onsite: waiting.value.length + visiting.value.length,
  handoff: handoffs.value.length,
  completed: finished.value.length,
}))
function stageHint(key) {
  if (key === 'scheduled') return overdue.value.length ? `依預約時段 · ${overdue.value.length} 位已遲到` : '依預約時段'
  if (key === 'onsite') return `看診中 ${visiting.value.length} · 候診中 ${waiting.value.length}`
  if (key === 'handoff') return '飼主正在櫃台等'
  return followUps.value.length ? `待安排回診 ${followUps.value.length}` : ''
}
function toggleStage(key) {
  stageFilter.value = stageFilter.value === key ? '' : key
}

// 時間軸只放進行中的掛號（待報到、候診／看診中、待櫃台），依預約時間排；已完成與未到／取消收在下面。
const timelineItems = computed(() => appointmentsForTimeline(items.value.filter((item) => matches(item) && (!stageFilter.value || workflowFilter(item, stageFilter.value)))))
// 每張卡片要用到的階段外觀、徽章、按鈕先在這裡算好一次。模板裡逐項呼叫函式的話，
// 頁面任何狀態一動（開 Modal、每 30 秒的時鐘）整條時間軸都會重算一遍，卡片多的日子開視窗會頓。
const ARRIVED_ACTIONS = [{ key: 'restore', label: '取消報到' }, { key: 'edit', label: '修改掛號' }]
function decorate(item) {
  const kind = cardTone(item)
  return {
    ...item,
    ui: {
      kind,
      tone: TONE[kind],
      avatarClass: avatarClass(item),
      visitType: visitTypeMeta(item),
      chip: statusChip(item),
      notes: notesFor(item),
      primary: item.status === 'scheduled' ? scheduledPrimary(item) : null,
      actions: item.status === 'scheduled' ? scheduledActions(item) : ARRIVED_ACTIONS,
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
// 櫃台只看飼主備註——面對的是飼主本人；寵物備註（會咬人、保定方式）是給診間的。
function notesFor(item) {
  return patientNotesFor(item, patientNotes.value).filter((note) => note.key === 'owner')
}
function closedStatusMeta(appointment) {
  if (appointment.status === 'no_show') return { label: '未到診', class: 'bg-warning-surface text-warning' }
  return { label: '已取消', class: 'bg-muted text-muted-foreground' }
}

// 時間軸卡片的階段外觀：卡片底色、軌道上的點、頭像、狀態晶片走同一套判斷。
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
  // 待櫃台處理不用琥珀底：卡片裡的「請轉告飼主」與飼主備註本身就是琥珀底，疊在一起會糊成一片，
  // 改用白底加琥珀外框，裡面的提醒才浮得出來。
  handoff: { card: 'border-warning/70 bg-card ring-1 ring-warning/40', dot: 'bg-warning ring-4 ring-warning/20', tick: 'bg-warning/60', avatar: 'bg-warning-surface text-warning ring-1 ring-warning/25', chip: 'bg-warning-surface text-warning', checkin: 'text-warning' },
  visiting: { card: 'border-primary/25 bg-accent/40', dot: 'bg-primary ring-4 ring-primary/20', tick: 'bg-primary/60', avatar: 'bg-primary/10 text-primary ring-1 ring-primary/20', chip: 'bg-primary text-primary-foreground', checkin: 'text-primary' },
  waiting: { card: 'border-primary/25 bg-accent/40', dot: 'bg-primary ring-4 ring-primary/20', tick: 'bg-primary/60', avatar: 'bg-primary/10 text-primary ring-1 ring-primary/20', chip: 'bg-accent text-accent-foreground ring-1 ring-primary/20', checkin: 'text-primary' },
  late: { card: 'border-danger/35 bg-danger-surface/60', dot: 'bg-danger ring-4 ring-danger/20', tick: '', avatar: 'bg-accent text-accent-foreground', chip: '', checkin: '' },
  surgery: { card: 'border-surgery/35 bg-surgery-surface/60', dot: 'bg-surgery ring-4 ring-surgery/20', tick: '', avatar: 'bg-accent text-accent-foreground', chip: 'bg-info-surface text-info ring-1 ring-info/20', checkin: '' },
  scheduled: { card: 'border-transparent hover:bg-field/50', dot: 'bg-muted-foreground/60 ring-1 ring-border', tick: '', avatar: 'bg-accent text-accent-foreground', chip: 'bg-info-surface text-info ring-1 ring-info/20', checkin: '' },
}
function tone(item) {
  return TONE[cardTone(item)]
}
function avatarClass(item) {
  const key = cardTone(item)
  if (['late', 'surgery', 'scheduled'].includes(key) && !isIdentityConfirmed(item)) return 'bg-muted text-muted-foreground'
  return TONE[key].avatar
}
function statusChip(item) {
  const key = cardTone(item)
  const number = item.checkinNumber ? ` · 號碼牌 ${item.checkinNumber} 號` : ''
  if (key === 'handoff') return `待櫃台處理${number}`
  if (key === 'visiting') return `看診中${number}`
  if (key === 'waiting') return `已報到${number}`
  if (key === 'late') return ''
  return '未報到'
}
// 整張卡片可點：已交櫃台／已完成開處理視窗，還沒交出去的開修改掛號。右側按鈕留給主要動作。
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

const { connected } = useClinicSync(date, refresh, applyUpdate)
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

function openNewMedication() {
  newMedicationWorkspace.value?.create()
}

async function loadPendingIntakeCount() {
  try {
    const { data } = await http.get('/intake-submissions')
    pendingIntakeCount.value = (data.items || []).length
  } catch {
    /* 初診審核數量載不到不影響既有櫃台工作。 */
  }
}

// 次要操作（⋯ 選單、未到／取消）共用同一個分派。
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
    if (kind === 'new') newDraftOpen.value = false
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

async function loadMedicationCounts() {
  try {
    const { data } = await http.get('/medications', { params: { status: 'active', limit: 1 } })
    medicationCounts.value = data.counts || {}
  } catch {
    /* 包藥數量載不到不影響掛號台；打開包藥面板時會再重新載入。 */
  }
}

onMounted(() => {
  clock = setInterval(() => {
    now.value = Date.now()
  }, 30000)
  loadTemplates()
  loadPendingIntakeCount()
  loadMedicationCounts()
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
        <h1 class="text-xl font-semibold">櫃檯掛號台</h1>
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
        <Button variant="secondary" size="sm" :class="pinnedPets.items.length ? 'bg-accent text-accent-foreground hover:bg-accent/80' : ''" :aria-pressed="drawer === 'pinned'" @click="toggleDrawer('pinned')">
          <Pin class="h-4 w-4" stroke-width="1.75" />暫存區<span v-if="pinnedPets.items.length" class="tabular-nums">{{ pinnedPets.items.length }}</span>
        </Button>
        <Button variant="secondary" size="sm" :class="drawer === 'medications' ? 'bg-accent text-accent-foreground hover:bg-accent/80' : ''" :aria-pressed="drawer === 'medications'" @click="toggleDrawer('medications')">
          <PackageCheck class="h-4 w-4" stroke-width="1.75" />包藥<span v-if="medicationPacking" class="tabular-nums">{{ medicationPacking }}</span>
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
        <Button size="sm" @click="openNewMedication">
          <PackageCheck class="h-4 w-4" />領藥
        </Button>
        <Button size="sm" @click="openDrawer('new')">
          <Plus class="h-4 w-4" />
          <template v-if="newDraftOpen && drawer !== 'new'">繼續掛號<span v-if="newDraft?.draftName" class="max-w-32 truncate">：{{ newDraft.draftName }}</span></template>
          <template v-else>掛號</template>
        </Button>
      </div>
    </header>

    <div class="flex min-h-0 flex-1 flex-col gap-3">

    <!-- 流程列：四段橫排，一格一個數字，點一格只看那一段；第三格列出正站在櫃台前的人 -->
    <div v-if="!loading" class="grid overflow-hidden rounded-xl border border-border bg-card md:grid-cols-2 xl:grid-cols-[1fr_1fr_1.4fr_1fr]" role="group" aria-label="今日流程">
      <div
        v-for="(stage, index) in STAGES"
        :key="stage.key"
        class="flex min-h-16 items-center gap-2 px-3 py-2"
        :class="[
          index < STAGES.length - 1 ? 'border-b border-border xl:border-b-0 xl:border-r' : '',
          stageFilter === stage.key ? 'shadow-[inset_0_0_0_2px_var(--color-primary)]' : '',
        ]"
      >
        <button type="button" class="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 text-left hover:bg-field" :aria-pressed="stageFilter === stage.key" :aria-label="`${stage.label} ${stageCounts[stage.key]} 筆，${stageFilter === stage.key ? '清除篩選' : '只看這一段'}`" @click="toggleStage(stage.key)">
          <span class="text-2xl font-semibold leading-none tabular-nums">{{ stageCounts[stage.key] }}</span>
          <span class="min-w-0">
            <span class="flex items-center gap-1.5 text-sm font-semibold leading-tight"><span class="h-2.5 w-2.5 shrink-0 rounded-full" :class="stage.dot" aria-hidden="true"></span>{{ stage.label }}</span>
            <span v-if="stageHint(stage.key)" class="block truncate text-xs leading-tight text-muted-foreground">{{ stageHint(stage.key) }}</span>
          </span>
        </button>
        <div v-if="stage.key === 'handoff' && handoffs.length" class="flex shrink-0 flex-wrap justify-end gap-1.5">
          <button v-for="item in handoffs.slice(0, 4)" :key="item._id" type="button" class="inline-flex h-7 items-center gap-1.5 rounded-full bg-warning-surface pl-1 pr-2.5 text-xs font-medium text-warning hover:bg-muted" :aria-label="`處理 ${item.petName}`" @click="openSheet(item)">
            <span class="flex h-5 w-5 items-center justify-center rounded-full bg-warning text-xs font-semibold text-card tabular-nums">{{ item.checkinNumber || '·' }}</span>{{ item.petName }}
          </button>
        </div>
      </div>
    </div>

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
      <!-- 時間軸：整頁的主體。依預約時段排、報到後仍保留原位置。 -->
      <section class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card" aria-labelledby="timeline-title">
        <div class="flex shrink-0 items-start justify-between gap-3 px-4 pb-3 pt-4">
          <div>
            <h2 id="timeline-title" class="text-base font-semibold">{{ isToday ? '今日看診時間軸' : '看診時間軸' }}</h2>
            <p class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="顏色說明">
              <span v-for="stage in STAGES.slice(0, 3)" :key="stage.key" class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full" :class="stage.dot" aria-hidden="true"></span>{{ stage.label }}</span>
              <span v-for="item in LEGEND" :key="item.label" class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm border" :class="item.class" aria-hidden="true"></span>{{ item.label }}</span>
            </p>
          </div>
          <div class="flex items-center gap-2">
            <Button v-if="stageFilter" variant="secondary" size="xs" @click="stageFilter = ''"><X class="h-4 w-4" stroke-width="1.75" />清除篩選</Button>
            <span class="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-muted px-2 text-xs font-semibold tabular-nums">{{ timelineCount }}</span>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <div v-if="!timelineCount" class="mb-3 rounded-xl border border-dashed border-border bg-muted px-3.5 py-4 text-center" role="status">
            <p class="text-sm font-medium">{{ stageFilter ? '這一段目前沒有掛號' : `${isToday ? '今天' : date}${items.length ? '沒有待報到或候診中的掛號' : '還沒有任何掛號'}` }}</p>
            <p v-if="!stageFilter" class="mt-1 text-xs text-muted-foreground">點右上方「新增掛號」，資料會依預約時段顯示在時間軸上。</p>
          </div>

          <template v-for="(group, groupIndex) in timeline" :key="group.session.id">
            <div v-if="groupIndex === 1" class="my-2 flex items-center gap-2.5" :aria-label="`${SURGERY_BLOCK.label} ${SURGERY_BLOCK.start} 到 ${SURGERY_BLOCK.end}`">
              <span class="h-px flex-1 bg-border" aria-hidden="true"></span>
              <span class="shrink-0 text-xs font-medium text-muted-foreground">{{ SURGERY_BLOCK.label }} {{ SURGERY_BLOCK.start }}–{{ SURGERY_BLOCK.end }}</span>
              <span class="h-px flex-1 bg-border" aria-hidden="true"></span>
            </div>

            <button
              type="button"
              class="flex min-h-11 w-full items-center gap-2.5 rounded-xl border border-border/70 bg-field/50 px-3.5 text-left text-sm font-semibold hover:bg-accent/40"
              :aria-expanded="!isCollapsed(group)"
              :aria-controls="`reception-session-${group.session.id}`"
              @click="toggleSession(group)"
            >
              <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-card text-muted-foreground ring-1 ring-border/80"><Clock class="h-4 w-4" stroke-width="1.75" /></span>
              <span>{{ group.session.label }} · {{ group.session.start }}–{{ group.session.end }}</span>
              <span class="ml-auto inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-2 text-xs font-semibold tabular-nums text-muted-foreground">{{ group.items.length }}</span>
              <span v-if="isCollapsed(group) && pendingCount(group)" class="inline-flex h-6 items-center rounded-full bg-danger-surface px-2 text-xs font-semibold tabular-nums text-danger">{{ pendingCount(group) }} 待處理</span>
              <span class="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-card px-2.5 text-xs font-semibold text-primary ring-1 ring-border/80">
                {{ isCollapsed(group) ? '展開' : '收合' }}
                <ChevronDown class="h-4 w-4 transition-transform" :class="{ 'rotate-180': !isCollapsed(group) }" stroke-width="1.9" />
              </span>
            </button>

            <div v-show="!isCollapsed(group)" :id="`reception-session-${group.session.id}`" class="ml-2 border-l-2 border-border/80 pl-3 sm:ml-20 sm:pl-5">
              <div v-if="!group.items.length" class="relative py-3">
                <span class="absolute left-[-9px] top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-muted-foreground/60 ring-1 ring-border sm:left-[-21px]" aria-hidden="true"></span>
                <p class="rounded-xl border border-dashed border-border bg-field/30 px-3 py-4 text-center text-sm text-muted-foreground">此時段尚無掛號</p>
              </div>

              <template v-for="(item, index) in group.rows" :key="item._id">
                <div v-if="nowPosition(group) === index" class="my-1.5 flex items-center gap-2.5">
                  <span class="h-0 flex-1 border-t-2 border-dashed border-primary"></span>
                  <span class="shrink-0 rounded-full bg-primary px-3 py-0.5 text-xs font-bold text-primary-foreground">現在 · {{ currentTime }}</span>
                </div>

                <div class="relative py-1">
                  <span class="mb-1 block text-xs font-semibold tabular-nums text-muted-foreground sm:absolute sm:left-[-36px] sm:top-4 sm:mb-0 sm:w-14 sm:-translate-x-full sm:text-right sm:text-sm">{{ item.time || '未定' }}</span>
                  <span class="absolute left-[-9px] top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card sm:left-[-21px]" :class="item.ui.tone.dot" aria-hidden="true"></span>
                  <span v-if="item.ui.tone.tick" class="absolute left-[-9px] top-1/2 h-0.5 w-[9px] -translate-y-1/2 sm:left-[-21px] sm:w-[21px]" :class="item.ui.tone.tick" aria-hidden="true"></span>

                  <!-- 整張卡片可點（開詳情／處理視窗）；裡面的按鈕各自 stop，不會連帶觸發。 -->
                  <article class="cursor-pointer rounded-xl border px-3 py-2 transition-colors" :class="item.ui.tone.card" @click="cardClick(item)">
                    <div class="flex flex-wrap items-center gap-2.5">
                      <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" :class="item.ui.avatarClass"><User class="h-4 w-4" stroke-width="1.75" /></span>

                      <div class="min-w-0 flex-1">
                        <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span class="inline-flex h-6 shrink-0 items-center rounded-md px-2 text-xs font-semibold ring-1" :class="item.ui.visitType.classes">{{ item.ui.visitType.label }}</span>
                          <span class="truncate text-sm font-semibold">{{ item.petName || '—' }}</span>
                          <span v-if="item.species" class="text-xs text-muted-foreground">{{ item.species }}</span>
                          <SurgeryBadge v-if="item.isSurgery" :name="item.surgeryName" />
                          <LatenessBadge :minutes="item.ui.lateMinutes" />
                        </div>
                        <div class="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                          <span>{{ item.ownerName || '未留飼主姓名' }}</span>
                          <template v-if="item.ownerPhone">
                            <span class="text-border">·</span>
                            <span class="tabular-nums">{{ item.ownerPhone }}</span>
                            <button type="button" class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-field text-muted-foreground hover:bg-muted hover:text-foreground" :aria-label="`複製 ${item.ownerName || item.petName} 的電話`" @click.stop="copyPhone(item.ownerPhone)"><Copy class="h-3.5 w-3.5" stroke-width="1.75" /></button>
                          </template>
                          <template v-if="item.checkedInAt && item.status !== 'scheduled'">
                            <span class="text-border">·</span>
                            <span class="inline-flex items-center gap-1 font-medium" :class="item.ui.tone.checkin"><Clock class="h-3 w-3" stroke-width="1.9" />{{ clinicTimeInput(item.checkedInAt) }} 報到</span>
                          </template>
                          <template v-if="item.ui.kind === 'handoff'">
                            <span class="text-border">·</span>
                            <span>交出 {{ minutesSince(item.handoffAt) }} 分</span>
                          </template>
                          <template v-else-if="item.ui.kind === 'visiting'">
                            <span class="text-border">·</span>
                            <span>看診 {{ minutesSince(item.visitStartedAt) }} 分</span>
                          </template>
                          <template v-else-if="item.ui.kind === 'waiting'">
                            <span class="text-border">·</span>
                            <span>已等 {{ minutesSince(item.checkedInAt) }} 分</span>
                          </template>
                        </div>
                        <p class="mt-0.5 truncate text-xs" :class="item.reason ? 'text-foreground' : 'text-muted-foreground'" :title="item.reason">{{ item.reason || '未填來院原因' }}<template v-if="item.ui.kind === 'handoff' && item.handoffNote"><span class="text-muted-foreground"> · 交辦：{{ item.handoffNote }}</span></template></p>
                        <p v-if="item.ui.kind === 'handoff' && item.specialCareNote" class="mt-1 truncate rounded-md bg-warning-surface px-2 py-0.5 text-xs font-medium text-warning" :title="item.specialCareNote"><span class="font-semibold">請轉告飼主：</span>{{ item.specialCareNote }}</p>
                        <PatientNotes :notes="item.ui.notes" class="mt-1" />
                        <p v-if="item.internalNote && item.status === 'scheduled'" class="mt-0.5 truncate text-xs text-muted-foreground" :title="item.internalNote"><span class="font-medium text-foreground">掛號備註：</span>{{ item.internalNote }}</p>
                        <p v-if="item.visitType === 'new' && !item.petId" class="mt-0.5 text-xs text-muted-foreground">
                          初診驗證碼 <span class="font-semibold tracking-[0.16em] text-foreground">{{ item.intakeVerificationUsedAt ? '已使用' : item.intakeVerificationCode || '未建立' }}</span><template v-if="isInitialDataPending(item)"> · 等飼主填初診表</template>
                        </p>
                      </div>

                      <div class="ml-auto flex shrink-0 items-center gap-1.5" @click.stop>
                        <span v-if="item.ui.chip" class="inline-flex min-h-7 items-center rounded-md px-2.5 text-xs font-semibold" :class="item.ui.tone.chip">{{ item.ui.chip }}</span>
                        <template v-if="item.ui.kind === 'handoff'">
                          <Button size="sm" @click="openSheet(item)">處理</Button>
                        </template>
                        <template v-else-if="item.status === 'scheduled'">
                          <Button v-if="item.ui.primary" size="sm" :variant="item.ui.primary.late ? 'destructive-solid' : 'default'" :disabled="busy" @click="item.ui.primary.run()">{{ item.ui.primary.label }}</Button>
                          <RowActions :actions="item.ui.actions" :label="`${item.petName}的更多操作`" @select="(key) => admin(key, item)" />
                        </template>
                        <template v-else>
                          <RowActions :actions="ARRIVED_ACTIONS" :label="`${item.petName}的更多操作`" @select="(key) => admin(key, item)" />
                        </template>
                      </div>
                    </div>
                  </article>
                </div>
              </template>

              <!-- 「現在」晚於這個時段全部項目時，指示線落在最後面。 -->
              <div v-if="group.items.length && nowPosition(group) === group.items.length" class="my-1.5 flex items-center gap-2.5">
                <span class="h-0 flex-1 border-t-2 border-dashed border-primary"></span>
                <span class="shrink-0 rounded-full bg-primary px-3 py-0.5 text-xs font-bold text-primary-foreground">現在 · {{ currentTime }}</span>
              </div>
            </div>
          </template>

          <!-- 已完成與未到／取消：跟進行中的軌道分開，收在最下面。 -->
          <div v-if="!stageFilter || stageFilter === 'completed'" class="mt-4 grid gap-3 sm:grid-cols-2">
            <section class="min-w-0 rounded-xl bg-muted/40 p-3" aria-label="今日已完成">
              <div class="mb-2 flex items-center justify-between gap-3">
                <h3 class="text-sm font-semibold">今日已完成</h3>
                <span class="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-card px-2 text-xs font-semibold tabular-nums">{{ finished.length }}</span>
              </div>
              <div class="space-y-2">
                <article v-for="item in followUps" :key="`fu-${item._id}`" class="grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border/70 bg-card px-3 py-2.5">
                  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground"><CalendarPlus class="h-4 w-4" stroke-width="1.75" /></span>
                  <div class="min-w-0">
                    <p class="truncate text-sm font-semibold">{{ item.petName }}<span class="ml-2 text-xs font-normal text-muted-foreground">{{ item.ownerName || '飼主待確認' }}<template v-if="item.ownerPhone"> · {{ item.ownerPhone }}</template></span></p>
                    <p class="truncate text-xs text-muted-foreground">待安排回診 · 醫師建議：{{ item.followUpRecommendation || item.followUpReason }}</p>
                  </div>
                  <Button variant="secondary" size="xs" @click="openSheet(item)"><CalendarPlus class="h-4 w-4" />安排回診</Button>
                </article>
                <p v-if="!finished.length" class="px-1 py-2 text-xs text-muted-foreground">還沒有完成的就診</p>
                <button v-for="item in finished" :key="item._id" type="button" class="grid min-h-11 w-full min-w-0 grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg bg-card px-3 py-2 text-left hover:bg-field" @click="openSheet(item)">
                  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Check class="h-4 w-4" stroke-width="1.75" /></span>
                  <span class="min-w-0">
                    <span class="block truncate text-sm font-medium text-primary">{{ item.petName }}</span>
                    <span class="block truncate text-xs text-muted-foreground">飼主 {{ item.ownerName || '未填' }} · 原訂 {{ item.time || '未定' }}<template v-if="item.deskCompletedAt"> · {{ clinicTimeInput(item.deskCompletedAt) }} 完成</template></span>
                  </span>
                  <span v-if="item.followUpAppointmentId" class="shrink-0 text-xs text-muted-foreground">已約 {{ item.followUpDate?.slice(5) }}</span>
                </button>
              </div>
            </section>
            <section class="min-w-0 rounded-xl bg-muted/40 p-3" aria-label="未到與取消">
              <div class="mb-2 flex items-center justify-between gap-3">
                <h3 class="text-sm font-semibold">未到／取消</h3>
                <span class="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-card px-2 text-xs font-semibold tabular-nums">{{ closedAppointments.length }}</span>
              </div>
              <div class="space-y-2">
                <p v-if="!closedAppointments.length" class="px-1 py-2 text-xs text-muted-foreground">沒有未到或取消的預約</p>
                <article v-for="item in closedAppointments" :key="item._id" class="grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border/70 bg-card px-3 py-2.5">
                  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><X class="h-4 w-4" stroke-width="1.75" /></span>
                  <div class="min-w-0">
                    <p class="flex min-w-0 items-center gap-2 text-sm"><span class="truncate font-semibold">{{ item.petName }}</span><Badge variant="status" :class="closedStatusMeta(item).class">{{ closedStatusMeta(item).label }}</Badge></p>
                    <p class="truncate text-xs text-muted-foreground">飼主 {{ item.ownerName || '未填' }} · 原訂 {{ item.time || '未定' }}<template v-if="item.cancelReason"> · {{ item.cancelReason }}</template></p>
                  </div>
                  <RowActions :actions="[{ key: 'restore', label: '恢復待報到' }, { key: 'edit', label: '修改預約' }]" :label="`${item.petName}的更多操作`" @select="(key) => admin(key, item)" />
                </article>
              </div>
            </section>
          </div>
        </div>
      </section>

      <!-- 右側抽屜（初診報到）：頁面版面裡的一欄，不蓋住時間軸——櫃台要一邊建檔一邊看得到看板。 -->
      <div v-if="drawerVisible" class="order-first flex min-h-0 shrink-0 flex-col xl:order-none xl:w-176">
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

    <!-- 掛號 Modal：新增的那份元件在收起時仍掛載（open=false），填到一半的內容不會消失。 -->
    <AppointmentDialog
      v-if="newDraftOpen"
      ref="newDraft"
      :open="drawer === 'new'"
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

    <!-- 暫存區：跟診療台同一個呈現方式，大面板一列放得下兩隻，看完就關。 -->
    <ModalDialog v-if="drawer === 'pinned'" size="xl" @close="closeDrawer">
      <div class="border-b border-border p-5 pr-16 sm:px-6">
        <DialogTitle class="flex items-center gap-2">
          <Pin class="h-4.5 w-4.5 text-muted-foreground" stroke-width="1.75" />暫存區
          <span class="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-2 text-xs font-semibold tabular-nums">{{ pinnedPets.items.length }}</span>
        </DialogTitle>

      </div>
      <div class="max-h-[min(68vh,48rem)] min-h-72 overflow-y-auto p-5 sm:p-6">
        <PinnedPetsList />
        <p v-if="!pinnedPets.items.length" class="py-10 text-center text-sm text-muted-foreground">暫存區是空的</p>
      </div>
    </ModalDialog>

    <!-- 包藥跟暫存區一樣是從看板叫出的批次工作面板；完成包藥後，藥單會進到上方同層級的領藥工作區。 -->
    <ModalDialog v-if="drawer === 'medications'" size="xl" @close="closeDrawer">
      <div class="border-b border-border p-5 pr-16 sm:px-6">
        <DialogTitle class="flex items-center gap-2">
          <PackageCheck class="h-4.5 w-4.5 text-muted-foreground" stroke-width="1.75" />包藥
          <span class="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-2 text-xs font-semibold tabular-nums">{{ medicationActive }}</span>
        </DialogTitle>
        <DialogDescription class="mt-1 text-xs">查看未完成藥單，並依目前進度完成可執行的處理。</DialogDescription>
      </div>
      <div class="flex h-[min(72vh,52rem)] min-h-96 flex-col p-5 sm:p-6">
        <MedicationWorkspace mode="reception" initial-filter="review" :stages="['review', 'approved', 'ready']" :appointments="items" @counts="medicationCounts = $event" />
      </div>
    </ModalDialog>

    <!-- 「領藥」是快速登記入口，只開新增藥單，不連帶打開後方的包藥工作區。 -->
    <MedicationWorkspace ref="newMedicationWorkspace" mode="reception" :appointments="items" :show-list="false" />

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
    <HandoffSheet v-if="activePatient" :key="activePatient._id" :appointment="activePatient" :patient-notes="notesFor(activePatient)" @updated="onSheetUpdate" @close="selected = ''" />
    <CheckInDialog v-if="dialog === 'check-in-detail' && target" :appointment="target" :late="itemIsOverdue(target)" :suggested-checkin-number="suggestedCheckinNumber()" :submitting="busy" :error-message="dialogError" @submit="(values) => submit(values, 'check-in-detail')" @close="dialog = ''" />
    <CancelAppointmentDialog v-if="dialog === 'cancel' && target" :appointment="target" :submitting="busy" :error-message="dialogError" @submit="(reason) => submit({ cancelReason: reason }, 'cancel')" @close="dialog = ''" />
    <ConfirmDialog v-if="confirmation" :open="true" :title="confirmation.title" :description="`病患：${target.petName}`" :loading="busy" @confirm="submit({}, confirmation.kind)" @cancel="confirmation = null" />
    </div>
  </div>
</template>
