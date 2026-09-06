<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { CalendarClock, CalendarX2, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Lock, MessageSquareText, Pencil, Phone, Settings, User, UserPlus, UserX, X } from '@lucide/vue';
import { http } from '../api/http';
import { appointmentNotification, appointmentSubject, changedAppointmentFields, describeVisitChanges } from '../lib/appointmentNotifications';
import { useToast } from '../composables/useToast';
import { useAppointmentRealtime } from '../composables/useAppointmentRealtime';
import { useStaffIdentity } from '../composables/useStaffIdentity';
import { useChatStore } from '../stores/chat';
import {
  SESSIONS,
  SURGERY_BLOCK,
  appointmentsForTimeline,
  assignSessionIndex,
  groupBySession,
  isIdentityConfirmed,
  nowIndexInSession,
  splitAppointmentsByQueueState,
} from '../lib/appointmentTimeline';
import { clinicDateInput, formatDate, formatDateTime, shiftDateInput, startOfWeek, weekdayLabel } from '../lib/datetime';
import { useSearchQueryParam } from '../composables/useSearchQueryParam';
import { DatePicker } from '../components/ui/date-picker';
import { TimePicker } from '../components/ui/time-picker';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import ListSkeleton from '../components/ListSkeleton.vue';
import RowActions from '../components/RowActions.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import NewAppointmentDialog from '../components/NewAppointmentDialog.vue';
import EditAppointmentDialog from '../components/EditAppointmentDialog.vue';
import CancelAppointmentDialog from '../components/CancelAppointmentDialog.vue';
import CheckInDialog from '../components/CheckInDialog.vue';
import ModalDialog from '../components/ModalDialog.vue';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { DialogDescription, DialogFooter, DialogTitle } from '../components/ui/dialog';
import SegmentedControl from '../components/SegmentedControl.vue';

const toast = useToast();
const { identity } = useStaffIdentity();
const chatStore = useChatStore();

// 掛號上的動作（報到、取消、完成看診、改備註…）順手發一則訊息到全站聊天室，
// 讓開著聊天視窗的另一邊不用回頭看掛號頁也知道發生了什麼事；發言身分沿用這台
// 裝置在聊天室的固定身分，並標記 auto:true 讓聊天視窗知道這不是手動打字送出
// 的。這只是錦上添花的提示，貼失敗不影響掛號本身的操作，所以不 await、也不讓
// 錯誤往外拋。操作的這台裝置自己不用因為自己剛做的事跳未讀紅點——送出前先在
// chat store 佔位（見 markPendingAuto），該則訊息透過 Socket.IO 廣播回來時會
// 被認出來，只加進訊息紀錄但不計未讀。
function notifyChat(appointment, action, options) {
  const content = appointmentNotification(appointment, action, options);
  chatStore.markPendingAuto(identity.value, content);
  http.post('/chat/messages', { sender: identity.value, content, auto: true }).catch(() => {});
}

// 看哪一天。同步進網址（?date=），等於今天時參數會被省略——
// 這樣返回、重整、把網址貼給別人都還在同一天上，跟其他列表頁的做法一致。
const today = clinicDateInput();
const selectedDate = useSearchQueryParam('date', today);
const isToday = computed(() => selectedDate.value === today);

// 這是整頁層級的檢視切換，放進網址才能在重新整理、返回或分享連結後保留目前視圖。
const viewMode = useSearchQueryParam('view', 'day'); // 'day' | 'week'
if (!['day', 'week'].includes(viewMode.value)) viewMode.value = 'day';

const appointments = ref([]);
const formTemplates = ref([]);
const defaultTemplateId = ref('');
const savingDefaultTemplate = ref(false);
const defaultTemplateDialogOpen = ref(false);
const loading = ref(false);
const error = ref('');
const now = ref(new Date());
let nowTimer;
let refreshTimer;

const expandedIds = ref(new Set());
const collapsedSessionIds = ref(new Set());
const editingCardNumberId = ref(null);
const cardNumberDraft = ref('');
const simpleForms = reactive({});
const busyIds = ref(new Set());

const newAppointmentOpen = ref(false);
const newAppointmentSubmitting = ref(false);
const newAppointmentError = ref('');

const checkInTarget = ref(null);
const checkInSubmitting = ref(false);
const checkInError = ref('');
const actionToConfirm = ref(null);
const editTarget = ref(null);
const detailTarget = ref(null);
const detailAppointment = computed(() => appointments.value.find((item) => item._id === detailTarget.value?._id) ?? detailTarget.value);
const detailFields = computed(() => {
  const appointment = detailAppointment.value;
  if (!appointment) return [];
  return [
    ['病患', appointment.petName],
    ['物種', appointment.species],
    ['飼主', appointment.ownerName],
    ['聯絡電話', appointment.ownerPhone],
    ['掛號日期', formatDate(appointment.date)],
    ['預約時間', appointment.time || '未指定'],
    ['狀態', STATUS_LABEL[appointment.status]],
    ['就診類型', { new: '初診', return: '回診' }[appointment.visitType]],
    ['號碼牌', appointment.checkinNumber == null ? '—' : `${appointment.checkinNumber} 號`],
    ['已發號碼牌', appointment.checkinNumberHistory?.join('、')],
    ['報到時間', formatDateTime(appointment.checkedInAt)],
    ['完成時間', formatDateTime(appointment.completedAt)],
    ['體重', appointment.weightKg == null ? '—' : `${appointment.weightKg} kg`],
    ['體溫', appointment.temperatureC == null ? '—' : `${appointment.temperatureC} °C`],
    ['回診日期／時間', followUpLabel(appointment)],
    ['草稿表單', templateName(appointment.templateId)],
    ['來院原因', appointment.reason, true],
    ['回診原因', appointment.followUpReason, true],
    ['看診備註', appointment.visitNote, true],
    ...(appointment.cancelReason ? [['取消原因', appointment.cancelReason, true]] : []),
    ['建立時間', formatDateTime(appointment.createdAt)],
    ['更新時間', formatDateTime(appointment.updatedAt)],
  ];
});
const editSubmitting = ref(false);
const editError = ref('');
const cancelTarget = ref(null);
const cancelSubmitting = ref(false);
const cancelError = ref('');
const completedVisitTarget = ref(null);
const completedVisitSaving = ref(false);
const completedVisitError = ref('');
const completedVisitForm = reactive({ weightKg: '', temperatureC: '', followUpDate: '', followUpTime: '', followUpReason: '', visitNote: '' });
// 開編輯彈窗當下的快照，存起來給儲存時比對到底改了什麼，聊天室通知才能講清楚
// 「改了備註」還是「改了量測資料」，而不是每次都只講「已更新」。
const completedVisitOriginal = reactive({ weightKg: '', temperatureC: '', followUpDate: '', followUpTime: '', followUpReason: '', visitNote: '' });

const ROW_ACTIONS = [
  { key: 'edit', label: '編輯掛號' },
  { key: 'no_show', label: '標記未到' },
  { key: 'cancel', label: '取消掛號', danger: true },
];
const ROW_ACTIONS_ARRIVED = [
  { key: 'edit', label: '編輯掛號' },
  { key: 'undo_check_in', label: '取消報到', danger: true },
];

const STATUS_LABEL = {
  scheduled: '未報到',
  arrived: '候診中',
  completed: '已完成',
  cancelled: '已取消',
  no_show: '未到診',
};

const VISIT_TYPE_META = {
  new: { label: '初診', classes: 'bg-brand-50 text-brand-700 ring-brand-300/80 dark:bg-brand-950/60 dark:text-brand-200 dark:ring-brand-500/40' },
  return: { label: '回診', classes: 'bg-petrol-50 text-petrol-700 ring-petrol-300/80 dark:bg-petrol-950/60 dark:text-petrol-300 dark:ring-petrol-500/40' },
  unknown: { label: '類型未記錄', classes: 'bg-muted text-muted-foreground ring-border' },
};

function visitTypeMeta(appointment) {
  if (VISIT_TYPE_META[appointment?.visitType]) return VISIT_TYPE_META[appointment.visitType];
  // 舊資料在尚未報到時，petId 仍能代表掛號當下是否選了既有病患；報到後 petId
  // 可能是初診現場才建立的，這時不能再猜，明確標示未記錄。
  if (appointment?.status === 'scheduled') return appointment.petId ? VISIT_TYPE_META.return : VISIT_TYPE_META.new;
  return VISIT_TYPE_META.unknown;
}

function appointmentStatusClasses(status) {
  return {
    scheduled: 'bg-info-surface text-info',
    arrived: 'bg-accent text-accent-foreground',
    completed: 'bg-success-surface text-success',
    cancelled: 'bg-destructive-surface text-destructive',
    no_show: 'bg-muted text-muted-foreground',
  }[status] ?? 'bg-muted text-muted-foreground';
}

// 快速連按前後一天時，先發的請求可能後回來。用送出當下的日期比對，
// 對不上就整包丟掉——不然畫面會停在別天的資料上。
let dateRequestToken = 0;

async function fetchAppointments({ silent = false } = {}) {
  const requestedDate = selectedDate.value;
  const token = ++dateRequestToken;
  if (!silent) {
    loading.value = true;
    error.value = '';
  }
  try {
    const { data } = await http.get('/appointments', { params: { date: requestedDate } });
    if (token !== dateRequestToken) return;
    appointments.value = data.items ?? [];
  } catch {
    if (token !== dateRequestToken) return;
    if (!silent) error.value = '掛號資料暫時無法載入，請稍後重試';
  } finally {
    if (token === dateRequestToken && !silent) loading.value = false;
  }
}

async function fetchFormChoices() {
  try {
    const [{ data: templates }, { data: settings }] = await Promise.all([
      http.get('/settings/form-templates'),
      http.get('/settings/appointment-settings'),
    ]);
    formTemplates.value = templates ?? [];
    defaultTemplateId.value = settings?.defaultAppointmentTemplateId ? String(settings.defaultAppointmentTemplateId) : '';
  } catch {
    toast.error('表單選項暫時無法載入，請重新整理後再掛號', '無法載入表單');
  }
}

async function saveDefaultTemplate() {
  if (!defaultTemplateId.value) return;
  savingDefaultTemplate.value = true;
  try {
    const { data } = await http.put('/settings/appointment-settings', {
      defaultAppointmentTemplateId: defaultTemplateId.value,
    });
    defaultTemplateId.value = String(data.defaultAppointmentTemplateId);
    toast.success('新掛號會自動帶入這份表單，個別看診仍可改選', '預設表單已更新');
    defaultTemplateDialogOpen.value = false;
  } catch (err) {
    reportApiError(err, '預設表單更新失敗');
  } finally {
    savingDefaultTemplate.value = false;
  }
}

const appointmentGroups = computed(() => splitAppointmentsByQueueState(appointments.value));
// 候診佇列＝已報到還沒看完的人，由上而下依報到時間排列；牌號只供現場辨識。
const waitingQueue = computed(() => appointmentGroups.value.waiting);
// 尚未報到數量獨立用於流程摘要；時間軸本身會連同已報到項目一起顯示。
const upcomingAppointments = computed(() => appointmentGroups.value.scheduled);
// 時間軸保留預約當下的脈絡：報到後另外進入候診佇列，但仍留在原預約時間上。
const timelineAppointments = computed(() => appointmentsForTimeline(appointments.value));
const completedAppointments = computed(() =>
  appointments.value
    .filter((appointment) => appointment.status === 'completed')
    .sort((a, b) => new Date(b.completedAt || b.updatedAt || 0) - new Date(a.completedAt || a.updatedAt || 0))
);
const hasAnyAppointment = computed(() => appointments.value.length > 0);
const closedGroups = computed(() => [
  { key: 'cancelled', label: '已取消', icon: CalendarX2, items: appointmentGroups.value.cancelled },
  { key: 'no_show', label: '未到', icon: UserX, items: appointmentGroups.value.noShow },
].filter((group) => group.items.length));

// 統計摘要
const dayStats = computed(() => [
  { key: 'total', label: '今日掛號', icon: CalendarClock, value: appointments.value.length, iconBg: 'bg-primary/10 text-primary ring-1 ring-primary/20' },
  { key: 'scheduled', label: '待報到', icon: UserPlus, value: upcomingAppointments.value.length, iconBg: 'bg-info-surface text-info ring-1 ring-info/20' },
  { key: 'waiting', label: '候診中', icon: Clock, value: waitingQueue.value.length, iconBg: 'bg-petrol-100 text-petrol-700 dark:bg-petrol-900/50 dark:text-petrol-300 ring-1 ring-petrol-300/40' },
  { key: 'completed', label: '已完成', icon: Check, value: completedAppointments.value.length, iconBg: 'bg-success-surface text-success ring-1 ring-success/20' },
]);

// 「待報到／候診中／已完成」三格可以點擊，切成表格檢視只看那個狀態；再點一次
// 同一格清除篩選、回到候診卡片＋時間軸的預設畫面。「今日掛號」純粹顯示總數，
// 不參與篩選（它不是單一狀態，沒有對應的表格可以切）。
const STATUS_FILTER_MAP = { scheduled: 'scheduled', waiting: 'arrived', completed: 'completed' };
const statusFilter = ref(null);
function toggleStatusFilter(key) {
  const value = STATUS_FILTER_MAP[key];
  if (!value) return;
  statusFilter.value = statusFilter.value === value ? null : value;
}
const filteredByStatus = computed(() => {
  if (!statusFilter.value) return [];
  return [...appointments.value]
    .filter((item) => item.status === statusFilter.value)
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
});
// 從表格的候診中列跳回候診卡片並展開，複用同一套 simpleForms／completeVisit，
// 不用在表格裡重做一次量測表單。
function focusCandidate(appointment) {
  statusFilter.value = null;
  if (!expandedIds.value.has(appointment._id)) toggleExpanded(appointment);
}

// 週檢視相關
const weekStart = computed(() => startOfWeek(selectedDate.value));
const weekDates = computed(() => Array.from({ length: 7 }, (_, i) => shiftDateInput(weekStart.value, i)));
const weekEnd = computed(() => shiftDateInput(weekStart.value, 6));
const weekRangeLabel = computed(() => `${formatDate(weekStart.value)}–${formatDate(weekEnd.value)}`);
const weekSummary = ref(new Map()); // date -> count
const weekAppointments = ref(new Map()); // date -> appointments
const weekTotal = computed(() => Array.from(weekSummary.value.values()).reduce((sum, count) => sum + count, 0));
const weekSummaryLoading = ref(false);
const weekSummaryError = ref('');
let weekSummaryRequestToken = 0;

async function fetchWeekSummary() {
  if (viewMode.value !== 'week') return;
  const start = weekStart.value;
  const end = shiftDateInput(start, 6);
  const token = ++weekSummaryRequestToken;
  weekSummaryLoading.value = true;
  weekSummaryError.value = '';
  try {
    const [{ data }, ...dailyResponses] = await Promise.all([
      http.get('/appointments/summary', { params: { start, end } }),
      ...weekDates.value.map((date) => http.get('/appointments', { params: { date } })),
    ]);
    if (token !== weekSummaryRequestToken) return;
    const map = new Map(data.items.map((item) => [item.date, item.count]));
    weekSummary.value = map;
    weekAppointments.value = new Map(
      weekDates.value.map((date, index) => [date, dailyResponses[index].data.items ?? []])
    );
  } catch {
    if (token === weekSummaryRequestToken) {
      weekSummaryError.value = '無法載入週掛號統計，請稍後重試';
    }
  } finally {
    if (token === weekSummaryRequestToken) weekSummaryLoading.value = false;
  }
}

watch([selectedDate, viewMode], ([date, mode]) => {
  // DatePicker 的清除鈕會送出空字串，但這頁一定得停在某一天。
  if (!date) {
    selectedDate.value = today;
    return;
  }
  expandedIds.value = new Set();
  collapsedSessionIds.value = new Set();
  editingCardNumberId.value = null;
  cardNumberDraft.value = '';
  statusFilter.value = null;
  if (mode === 'week') fetchWeekSummary();
  else fetchAppointments();
});

const actionConfirmation = computed(() => {
  const pending = actionToConfirm.value;
  const petName = pending?.appointment?.petName || '這筆';
  if (pending?.key === 'delete') {
    return {
      title: '永久刪除這筆掛號？',
      description: `確定要永久刪除「${petName}」的掛號嗎？刪除後無法復原。`,
      confirmLabel: '刪除掛號',
      destructive: true,
    };
  }
  if (pending?.key === 'restore') {
    return {
      title: '恢復這筆掛號？',
      description: `確定要將「${petName}」恢復至今日候診流程嗎？`,
      confirmLabel: '恢復掛號',
      destructive: false,
    };
  }
  if (pending?.key === 'undo_check_in') {
    return {
      title: '取消這筆報到？',
      description: `確定要取消「${petName}」的報到嗎？這筆掛號會回到尚未報到並歸還實體號碼牌；此牌號今天不再配發。`,
      confirmLabel: '取消報到',
      destructive: true,
    };
  }
  return {
    title: '標記為未到診？',
    description: `確定要將「${petName}」標記為未到診嗎？`,
    confirmLabel: '標記未到',
    destructive: true,
  };
});
const sessionGroups = computed(() => groupBySession(timelineAppointments.value, SESSIONS));
const visibleSessionGroups = computed(() =>
  sessionGroups.value
    .map((group, sessionIndex) => ({ ...group, sessionIndex }))
    .filter((group) => group.items.length || !timelineAppointments.value.length)
);
const nowSessionIndex = computed(() => assignSessionIndex(now.value.getHours() * 60 + now.value.getMinutes(), SESSIONS));
const nowLabel = computed(() =>
  `${String(now.value.getHours()).padStart(2, '0')}:${String(now.value.getMinutes()).padStart(2, '0')}`
);
const checkinTimeOptions = { hour: '2-digit', minute: '2-digit', hour12: false };

function isExpanded(id) {
  return expandedIds.value.has(id);
}

function isSessionCollapsed(id) {
  return collapsedSessionIds.value.has(id);
}

function toggleSession(id) {
  const next = new Set(collapsedSessionIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsedSessionIds.value = next;
}

function toggleExpanded(appointment) {
  const next = new Set(expandedIds.value);
  if (next.has(appointment._id)) {
    next.delete(appointment._id);
  } else {
    next.add(appointment._id);
    if (!simpleForms[appointment._id]) {
      simpleForms[appointment._id] = {
        weightKg: appointment.weightKg ?? '',
        temperatureC: appointment.temperatureC ?? '',
        followUpDate: appointment.followUpDate ?? '',
        followUpTime: appointment.followUpTime ?? '',
        followUpReason: appointment.followUpReason ?? '',
        visitNote: appointment.visitNote ?? '',
        templateId: String(appointment.templateId || defaultTemplateId.value || ''),
      };
    }
  }
  expandedIds.value = next;
}

function isBusy(id) {
  return busyIds.value.has(id);
}

function setBusy(id, busy) {
  const next = new Set(busyIds.value);
  if (busy) next.add(id);
  else next.delete(id);
  busyIds.value = next;
}

function beginCardNumberEdit(appointment) {
  if (isBusy(appointment._id)) return;
  editingCardNumberId.value = appointment._id;
  cardNumberDraft.value = String(appointment.checkinNumber ?? '');
}

function cancelCardNumberEdit() {
  editingCardNumberId.value = null;
  cardNumberDraft.value = '';
}

async function submitCardNumber(appointment) {
  if (editingCardNumberId.value !== appointment._id) return;
  const nextNumber = Number(cardNumberDraft.value);
  cancelCardNumberEdit();

  if (!Number.isSafeInteger(nextNumber) || nextNumber < 1) {
    toast.error('請輸入從 1 開始的整數', '號碼牌不正確');
    return;
  }
  if (nextNumber === appointment.checkinNumber) return;

  setBusy(appointment._id, true);
  markSelfUpdate(appointment._id);
  try {
    const { data } = await http.patch(`/appointments/${appointment._id}/check-in-number`, { checkinNumber: nextNumber });
    toast.success(`${appointmentSubject(data)}的號碼牌已改為 ${data.checkinNumber} 號`, '號碼牌已更新');
    notifyChat(data, 'card_number');
    await fetchAppointments({ silent: true });
  } catch (err) {
    reportApiError(err, '號碼牌更新失敗，請稍後再試');
    await fetchAppointments({ silent: true });
  } finally {
    setBusy(appointment._id, false);
  }
}

function reportApiError(err, fallback) {
  toast.error(err.response?.data?.message || fallback, '操作失敗');
}

async function checkIn(appointment) {
  if (isIdentityConfirmed(appointment)) {
    setBusy(appointment._id, true);
    markSelfUpdate(appointment._id);
    try {
      const { data } = await http.post(`/appointments/${appointment._id}/check-in`, {});
      toast.success(`${appointmentSubject(data)}已報到`, '報到完成');
      notifyChat(data, 'check_in');
      await fetchAppointments({ silent: true });
    } catch (err) {
      reportApiError(err, '報到失敗，請稍後再試');
    } finally {
      setBusy(appointment._id, false);
    }
    return;
  }
  checkInError.value = '';
  checkInTarget.value = appointment;
}

async function submitCheckIn(values) {
  if (!checkInTarget.value) return;
  checkInSubmitting.value = true;
  checkInError.value = '';
  markSelfUpdate(checkInTarget.value._id);
  try {
    const { data } = await http.post(`/appointments/${checkInTarget.value._id}/check-in`, values);
    toast.success(`${appointmentSubject(data)}已報到`, '報到完成');
    notifyChat(data, 'check_in');
    checkInTarget.value = null;
    await fetchAppointments({ silent: true });
  } catch (err) {
    checkInError.value = err.response?.data?.message || '報到失敗，請稍後再試';
  } finally {
    checkInSubmitting.value = false;
  }
}

async function submitNewAppointment(payload) {
  newAppointmentSubmitting.value = true;
  newAppointmentError.value = '';
  try {
    const { data } = await http.post('/appointments', payload);
    toast.success(appointmentNotification(data, 'create'), '掛號已新增');
    notifyChat(data, 'create');
    newAppointmentOpen.value = false;
    await fetchAppointments({ silent: true });
  } catch (err) {
    newAppointmentError.value = err.response?.data?.message || '掛號失敗，請稍後再試';
  } finally {
    newAppointmentSubmitting.value = false;
  }
}

// 回診日期選填，但選了日期就要一併給時間，否則併進報告的時刻只會是沒有意義的午夜。
function followUpTimeMissing(draft) {
  return Boolean(draft?.followUpDate && !draft?.followUpTime);
}

async function completeVisit(appointment) {
  const draft = simpleForms[appointment._id] || {};
  if (followUpTimeMissing(draft)) {
    toast.error('已選擇回診日期，請一併填寫時間', '看診資料未完成');
    return;
  }
  setBusy(appointment._id, true);
  markSelfUpdate(appointment._id);
  try {
    const { data } = await http.post(`/appointments/${appointment._id}/complete`, {
      weightKg: draft.weightKg === '' || draft.weightKg == null ? null : Number(draft.weightKg),
      temperatureC: draft.temperatureC === '' || draft.temperatureC == null ? null : Number(draft.temperatureC),
      followUpDate: draft.followUpDate || '',
      followUpTime: draft.followUpTime || '',
      followUpReason: draft.followUpReason || '',
      visitNote: draft.visitNote || '',
      templateId: draft.templateId || undefined,
    });
    const followUp = data?.followUpAppointment;
    toast.success(
      followUp ? `已建立就診草稿，並新增 ${formatDate(followUp.date)} ${followUp.time} 的回診` : '已建立就診草稿',
      '看診完成'
    );
    notifyChat(data, 'complete');
    await fetchAppointments({ silent: true });
  } catch (err) {
    reportApiError(err, '完成看診失敗，請稍後再試');
  } finally {
    setBusy(appointment._id, false);
  }
}

function followUpLabel(appointment) {
  if (!appointment.followUpDate) return formatDate(appointment.followUpDate);
  return appointment.followUpTime ? `${formatDate(appointment.followUpDate)} ${appointment.followUpTime}` : formatDate(appointment.followUpDate);
}

function templateName(templateId) {
  return formTemplates.value.find((template) => String(template._id) === String(templateId))?.name ?? '未選擇表單';
}

function openCompletedVisitEditor(appointment) {
  completedVisitTarget.value = appointment;
  completedVisitError.value = '';
  completedVisitForm.weightKg = appointment.weightKg ?? '';
  completedVisitForm.temperatureC = appointment.temperatureC ?? '';
  completedVisitForm.followUpDate = appointment.followUpDate ?? '';
  completedVisitForm.followUpTime = appointment.followUpTime ?? '';
  completedVisitForm.followUpReason = appointment.followUpReason ?? '';
  completedVisitForm.visitNote = appointment.visitNote ?? '';
  Object.assign(completedVisitOriginal, completedVisitForm);
}

// 聊天室通知要講清楚改了什麼，不是每次都只講「已更新」；依實際變動的欄位組句子。
async function saveCompletedVisit() {
  if (!completedVisitTarget.value) return;
  if (followUpTimeMissing(completedVisitForm)) {
    completedVisitError.value = '已選擇回診日期，請一併填寫時間';
    return;
  }
  const changedParts = describeVisitChanges(completedVisitOriginal, completedVisitForm);
  if (!changedParts.length) {
    toast.info('看診資料沒有變更');
    completedVisitTarget.value = null;
    return;
  }
  completedVisitSaving.value = true;
  completedVisitError.value = '';
  markSelfUpdate(completedVisitTarget.value._id);
  try {
    const { data } = await http.patch(`/appointments/${completedVisitTarget.value._id}/visit-data`, {
      weightKg: completedVisitForm.weightKg === '' ? null : Number(completedVisitForm.weightKg),
      temperatureC: completedVisitForm.temperatureC === '' ? null : Number(completedVisitForm.temperatureC),
      followUpDate: completedVisitForm.followUpDate || '',
      followUpTime: completedVisitForm.followUpTime || '',
      followUpReason: completedVisitForm.followUpReason || '',
      visitNote: completedVisitForm.visitNote,
    });
    toast.success('已更新看診資料', '儲存完成');
    notifyChat(data, 'visit_data', { changedParts });
    completedVisitTarget.value = null;
    await fetchAppointments({ silent: true });
  } catch (err) {
    completedVisitError.value = err.response?.data?.message || '看診資料更新失敗';
  } finally {
    completedVisitSaving.value = false;
  }
}

function requestRowAction(appointment, key) {
  if (isBusy(appointment._id)) return;
  if (key === 'edit') {
    editError.value = '';
    editTarget.value = appointment;
    return;
  }
  if (key === 'cancel') {
    cancelError.value = '';
    cancelTarget.value = appointment;
    return;
  }
  actionToConfirm.value = { appointment, key };
}

async function submitEditAppointment(payload) {
  if (!editTarget.value) return;
  const fields = ['petName', 'species', 'ownerName', 'ownerPhone', 'time', 'reason', 'templateId'];
  if (!changedAppointmentFields(editTarget.value, payload, fields).length) {
    toast.info('掛號資料沒有變更');
    editTarget.value = null;
    return;
  }
  editSubmitting.value = true;
  markSelfUpdate(editTarget.value._id);
  editError.value = '';
  try {
    const { data } = await http.put(`/appointments/${editTarget.value._id}`, payload);
    toast.success('掛號資料已更新', '儲存完成');
    notifyChat(data, 'edit');
    editTarget.value = null;
    await fetchAppointments({ silent: true });
  } catch (err) {
    editError.value = err.response?.data?.message || '掛號資料更新失敗，請稍後再試';
  } finally {
    editSubmitting.value = false;
  }
}

async function submitCancelAppointment(cancelReason) {
  if (!cancelTarget.value) return;
  const appointment = cancelTarget.value;
  cancelSubmitting.value = true;
  cancelError.value = '';
  setBusy(appointment._id, true);
  markSelfUpdate(appointment._id);
  try {
    const { data } = await http.post(`/appointments/${appointment._id}/cancel`, { cancelReason });
    toast.info('已取消這筆掛號', '已更新');
    notifyChat(data, 'cancel');
    cancelTarget.value = null;
    await fetchAppointments({ silent: true });
  } catch (err) {
    cancelError.value = err.response?.data?.message || '取消掛號失敗，請稍後再試';
  } finally {
    cancelSubmitting.value = false;
    setBusy(appointment._id, false);
  }
}

async function confirmRowAction() {
  const pending = actionToConfirm.value;
  if (!pending) return;
  const { appointment, key } = pending;
  setBusy(appointment._id, true);
  markSelfUpdate(appointment._id);
  try {
    if (key === 'no_show') {
      const { data } = await http.post(`/appointments/${appointment._id}/no-show`, {});
      toast.info('已標記為未到診', '已更新');
      notifyChat(data, 'no_show');
    } else if (key === 'restore') {
      const { data } = await http.post(`/appointments/${appointment._id}/restore`, {});
      toast.success('掛號已恢復，等待報到', '恢復完成');
      notifyChat(data, 'restore');
    } else if (key === 'undo_check_in') {
      const { data } = await http.post(`/appointments/${appointment._id}/restore`, {});
      toast.info('已恢復為尚未報到', '報到已取消');
      notifyChat(data, 'undo_check_in');
    } else if (key === 'delete') {
      await http.delete(`/appointments/${appointment._id}`);
      toast.success('掛號已永久刪除', '刪除完成');
      notifyChat(appointment, 'delete');
    }
    actionToConfirm.value = null;
    await fetchAppointments({ silent: true });
  } catch (err) {
    reportApiError(err, '操作失敗，請稍後再試');
  } finally {
    setBusy(appointment._id, false);
  }
}

// 自己按下報到／完成看診等操作後，伺服器廣播的 appointment:updated 也會送回
// 自己這台裝置——這時不用再跳一次「即時同步」提示，那只是自己剛做的事。送出
// 請求前先標記，5 秒緩衝涵蓋一般的網路延遲；逾時沒被消費掉就自動視為過期。
const selfUpdateTimers = new Map();
function markSelfUpdate(id) {
  if (!id) return;
  clearTimeout(selfUpdateTimers.get(id));
  selfUpdateTimers.set(id, setTimeout(() => selfUpdateTimers.delete(id), 5000));
}
function consumeSelfUpdate(id) {
  if (!selfUpdateTimers.has(id)) return false;
  clearTimeout(selfUpdateTimers.get(id));
  selfUpdateTimers.delete(id);
  return true;
}

// 遠端更新（別台電腦報到、完成看診、修正看診資料）要讓人一眼注意到，短暫替
// 對應的卡片／列加上外框當顯目提示，1.8 秒後自動退場。
const highlightedIds = ref(new Set());
function isHighlighted(id) {
  return highlightedIds.value.has(id);
}
function flashHighlight(id) {
  const next = new Set(highlightedIds.value);
  next.add(id);
  highlightedIds.value = next;
  setTimeout(() => {
    const cleared = new Set(highlightedIds.value);
    cleared.delete(id);
    highlightedIds.value = cleared;
  }, 1800);
}

// 掛號狀態變動時即時反映，不用等 60 秒輪詢——開著同一頁的另一台電腦報到、
// 完成看診或修正看診資料後，這裡能立刻看到最新狀態。輪詢仍保留當保底。
function handleAppointmentUpdate(updated) {
  const isSelf = consumeSelfUpdate(updated._id);
  const index = appointments.value.findIndex((item) => item._id === updated._id);
  if (index === -1) {
    appointments.value.push(updated);
  } else {
    Object.assign(appointments.value[index], updated);
  }
  if (!isSelf) {
    toast.info(`${appointmentSubject(updated)}的掛號資料已同步，目前狀態：${STATUS_LABEL[updated.status] || '未知'}`, '即時同步');
    flashHighlight(updated._id);
  }
}
useAppointmentRealtime(selectedDate, { onAppointmentUpdate: handleAppointmentUpdate });

onMounted(() => {
  fetchFormChoices();
  if (viewMode.value === 'week') fetchWeekSummary();
  else fetchAppointments();
  nowTimer = setInterval(() => {
    now.value = new Date();
  }, 30_000);
  // 只有今天的清單會自己變動（有人報到、看完診）；停在別天時不必一直重抓。
  refreshTimer = setInterval(() => {
    if (viewMode.value === 'week') fetchWeekSummary();
    else if (isToday.value) fetchAppointments({ silent: true });
  }, 60_000);
});
onBeforeUnmount(() => {
  clearInterval(nowTimer);
  clearInterval(refreshTimer);
});
</script>

<template>
  <section class="mx-auto max-w-7xl space-y-4">
    <PageHeader title="掛號" description="依門診時段掌握報到順序，候診中可直接完成量測與看診。">
      <template #actions>
        <Button type="button" @click="newAppointmentOpen = true"><UserPlus class="h-4 w-4" stroke-width="1.75" />掛號</Button>
      </template>
    </PageHeader>

    <!-- 主視圖切換與日期導覽共用一張緊湊控制面板，避免操作內容開始前先堆三層卡片。 -->
    <Card class="overflow-hidden p-0 shadow-sm dark:shadow-none">
      <div class="grid gap-3 p-3 sm:p-4 lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-center">
        <div class="w-full">
          <SegmentedControl
            v-model="viewMode"
            :options="[
              { value: 'day', label: '單日', tabId: 'appointments-day-tab', panelId: 'appointments-day-panel' },
              { value: 'week', label: '本週', tabId: 'appointments-week-tab', panelId: 'appointments-week-panel' },
            ]"
            aria-label="掛號檢視模式"
            size="sm"
            full-width
          />
        </div>

        <div class="grid w-full gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center lg:flex lg:justify-end">
          
          <div class="flex w-full items-center gap-1 rounded-xl bg-muted/60 p-1 sm:w-auto">
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              :aria-label="viewMode === 'week' ? '上一週' : '前一天'"
              @click="selectedDate = shiftDateInput(selectedDate, viewMode === 'week' ? -7 : -1)"
            >
              <ChevronLeft class="h-4 w-4" stroke-width="1.75" />
            </Button>
            <DatePicker v-model="selectedDate" :clearable="false" class="min-w-0 flex-1 sm:w-40" aria-label="選擇要查看的日期" />
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              :aria-label="viewMode === 'week' ? '下一週' : '後一天'"
              @click="selectedDate = shiftDateInput(selectedDate, viewMode === 'week' ? 7 : 1)"
            >
              <ChevronRight class="h-4 w-4" stroke-width="1.75" />
            </Button>
          </div>
        </div>
      </div>

      <dl v-if="viewMode === 'day'" class="grid grid-cols-4 border-t border-border bg-field/30" :aria-busy="loading || undefined">
        <button
          v-for="stat in dayStats"
          :key="stat.key"
          type="button"
          class="flex min-w-0 flex-col items-center justify-center gap-0.5 px-1.5 py-2.5 transition-colors sm:flex-row sm:gap-2.5 sm:px-3 hover:bg-accent/40 [&:not(:last-child)]:border-r [&:not(:last-child)]:border-border"
          :class="statusFilter && STATUS_FILTER_MAP[stat.key] === statusFilter ? 'bg-accent text-accent-foreground' : ''"
          :aria-pressed="STATUS_FILTER_MAP[stat.key] === statusFilter"
          @click="stat.key === 'total' ? (statusFilter = null) : toggleStatusFilter(stat.key)"
        >
          <span
            class="hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg sm:flex"
            :class="stat.iconBg"
            aria-hidden="true"
          >
            <component :is="stat.icon" class="h-3.5 w-3.5" stroke-width="1.9" />
          </span>
          <dt class="truncate text-xs font-medium" :class="STATUS_FILTER_MAP[stat.key] === statusFilter ? 'text-accent-foreground' : 'text-muted-foreground'">{{ stat.label }}</dt>
          <dd class="text-lg font-bold leading-none tabular-nums" :class="STATUS_FILTER_MAP[stat.key] === statusFilter ? 'text-accent-foreground' : 'text-foreground'">{{ loading || error ? '—' : stat.value }}</dd>
        </button>
      </dl>

      <div v-else class="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-field/30 px-3 py-2.5 sm:px-4">
        <p class="text-xs font-medium text-muted-foreground">{{ weekRangeLabel }}</p>
        <p class="text-xs text-muted-foreground">
          本週共 <span class="font-bold tabular-nums text-foreground">{{ weekTotal }}</span> 筆掛號<template v-if="weekSummaryLoading"> · 更新中…</template>
        </p>
      </div>
    </Card>

    <ListSkeleton v-if="viewMode === 'day' && loading" :rows="4" />
    <Alert v-else-if="viewMode === 'day' && error" variant="destructive">
      <AlertDescription class="flex items-center justify-between gap-3">
        <span>{{ error }}</span>
        <Button type="button" variant="outline" size="sm" class="shrink-0" @click="fetchAppointments">重新載入</Button>
      </AlertDescription>
    </Alert>

    <template v-else>
      <!-- ── 單日檢視 ── -->
      <div v-if="viewMode === 'day'" id="appointments-day-panel" role="tabpanel" aria-labelledby="appointments-day-tab" class="space-y-4">
      <template v-if="!statusFilter">
      <!-- ── 候診佇列 ──
           報到之後預約時間就不再決定任何事，人已經在診所裡；決定誰先看的是這份順序。
           候診區依報到時間排列；時間軸仍保留原預約位置。紙本牌號只供辨識，不影響順序。 -->
      <div
         class="grid items-stretch gap-4 xl:grid-cols-[minmax(21rem,0.82fr)_minmax(0,1.7fr)]"
      >
       <Card class="h-full overflow-hidden p-0 shadow-sm dark:shadow-none">
        <div class="flex items-start justify-between gap-3 p-4 pb-3">
          <div>
            <h2 class="text-base font-semibold text-foreground">候診 <span class="inline-flex h-6.5 min-w-6.5 items-center justify-center rounded-full bg-accent px-2 text-xs font-bold text-accent-foreground ring-1 ring-primary/20">{{ waitingQueue.length }}</span> 位</h2>
            <p class="mt-0.5 text-xs text-muted-foreground">依報到時間排列；牌號可點擊修改，當日不重複發號</p>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <Button type="button" variant="secondary" size="icon-sm" aria-label="設定掛號預設表單" title="設定掛號預設表單" @click="defaultTemplateDialogOpen = true"><Settings class="h-4 w-4" stroke-width="1.75" /></Button>
          </div>
        </div>

        <ul v-if="waitingQueue.length" class="space-y-2.5 border-t border-border bg-field/30 p-3">
          <li
            v-for="appointment in waitingQueue"
            :key="appointment._id"
            class="rounded-xl border border-border/80 bg-card p-3 shadow-xs transition-all duration-150 hover:border-primary/40 hover:shadow-sm"
            :class="isHighlighted(appointment._id) ? 'ring-2 ring-warning' : ''"
          >
            <div class="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3">
              <input
                v-if="editingCardNumberId === appointment._id"
                v-model="cardNumberDraft"
                autofocus
                type="text"
                class="h-9 w-9 appearance-none rounded-lg border-2 border-primary bg-card text-center text-sm font-bold tabular-nums text-foreground outline-none focus-visible:ring-3 focus-visible:ring-primary/25 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                aria-label="輸入新的實體號碼牌編號"
                :disabled="isBusy(appointment._id)"
                @focus="$event.currentTarget.select()"
                @keydown.enter.prevent="$event.currentTarget.blur()"
                @keydown.esc.prevent="cancelCardNumberEdit"
                @blur="submitCardNumber(appointment)"
              />
              <button
                v-else
                type="button"
                class="group/number relative flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-primary text-sm font-bold tabular-nums text-primary-foreground shadow-xs transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring"
                :aria-label="`目前持有 ${appointment.checkinNumber} 號牌，點擊修改`"
                title="修改實體號碼牌"
                :disabled="isBusy(appointment._id)"
                @click="beginCardNumberEdit(appointment)"
              >
                {{ appointment.checkinNumber }}
                <span class="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-card text-primary ring-1 ring-border shadow-xs" aria-hidden="true">
                  <Pencil class="h-2.5 w-2.5" stroke-width="2" />
                </span>
              </button>

              <div class="min-w-0 flex-1">
                <div class="flex min-w-0 items-center gap-1.5">
                  <span
                    v-if="visitTypeMeta(appointment)"
                    class="inline-flex h-6 shrink-0 items-center rounded-md px-2 text-xs font-semibold ring-1 shadow-2xs"
                    :class="visitTypeMeta(appointment).classes"
                  >{{ visitTypeMeta(appointment).label }}</span>
                  <span class="truncate text-sm font-semibold text-foreground">{{ appointment.petName || '—' }}</span>
                </div>
                <div class="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span class="truncate">{{ appointment.ownerName || '—' }}</span>
                  <span v-if="appointment.ownerPhone" class="inline-flex items-center gap-1">
                    <Phone class="h-3 w-3 shrink-0" stroke-width="1.75" />{{ appointment.ownerPhone }}
                  </span>
                  <span v-if="appointment.checkedInAt" class="inline-flex items-center gap-1 font-medium text-primary">
                    <Clock class="h-3 w-3 shrink-0" stroke-width="1.75" />{{ formatDateTime(appointment.checkedInAt, checkinTimeOptions) }} 報到
                  </span>
                </div>
              </div>

              <span class="inline-flex h-7 shrink-0 items-center rounded-md bg-accent px-2 text-xs font-semibold text-accent-foreground ring-1 ring-primary/20">已報到</span>
            </div>

            <div class="mt-2.5 flex flex-wrap items-center justify-end gap-1.5 border-t border-border/60 pt-2.5">
              <Button
                type="button"
                variant="outline"
                size="xs"
                class="mr-auto"
                :aria-expanded="isExpanded(appointment._id)"
                :aria-label="isExpanded(appointment._id) ? '收合看診資料' : '展開看診資料'"
                @click="toggleExpanded(appointment)"
              >
                <component :is="isExpanded(appointment._id) ? ChevronUp : ChevronDown" class="h-4 w-4" stroke-width="1.75" />
                {{ isExpanded(appointment._id) ? '收合資料' : '看診資料' }}
              </Button>
              <Button type="button" variant="secondary" size="xs" :aria-label="`編輯 ${appointment.petName || '這筆'} 的掛號`" @click="editTarget = appointment">
                <Pencil class="h-4 w-4" stroke-width="1.75" />編輯
              </Button>
              <Button type="button" variant="destructive" size="xs" :disabled="isBusy(appointment._id)" @click="actionToConfirm = { appointment, key: 'undo_check_in' }">
                <X class="h-4 w-4" stroke-width="1.9" />
                取消
              </Button>
            </div>

            <div v-if="isExpanded(appointment._id)" class="mt-3.5 space-y-3.5 border-t border-border/60 pt-3.5">
              <div class="grid gap-3.5 sm:grid-cols-2">
                <label class="space-y-1.5 text-xs font-medium text-foreground">
                  體重
                  <div class="relative">
                    <input v-model="simpleForms[appointment._id].weightKg" type="text" class="h-10 w-full rounded-lg border border-input bg-card px-3 pr-10 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
                    <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">kg</span>
                  </div>
                </label>
                <label class="space-y-1.5 text-xs font-medium text-foreground">
                  體溫
                  <div class="relative">
                    <input v-model="simpleForms[appointment._id].temperatureC" type="text" class="h-10 w-full rounded-lg border border-input bg-card px-3 pr-10 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
                    <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">°C</span>
                  </div>
                </label>
              </div>
              <label class="block space-y-1.5 text-xs font-medium text-foreground">
                回診日期
                <div class="flex gap-2">
                  <DatePicker v-model="simpleForms[appointment._id].followUpDate" placeholder="選擇回診日期" aria-label="選擇回診日期" class="flex-1" />
                  <TimePicker v-model="simpleForms[appointment._id].followUpTime" placeholder="時間" aria-label="選擇回診時間" :disabled="!simpleForms[appointment._id].followUpDate" class="w-32 shrink-0" />
                </div>
                <span v-if="followUpTimeMissing(simpleForms[appointment._id])" class="block text-xs font-medium text-destructive">已選擇日期，請一併填寫時間</span>
                <span v-else class="block text-xs font-normal text-muted-foreground">完成看診時會直接掛上這個時段的下次回診。</span>
              </label>
              <label class="block space-y-1.5 text-xs font-medium text-foreground">
                回診原因
                <input v-model="simpleForms[appointment._id].followUpReason" type="text" placeholder="例：拆線、追蹤肝指數" class="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
              </label>
              <label class="block space-y-1.5 text-xs font-medium text-foreground">
                備註
                <textarea v-model="simpleForms[appointment._id].visitNote" rows="2" class="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"></textarea>
                <span class="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                  <Lock class="h-3.5 w-3.5 shrink-0" stroke-width="1.75" />僅供內部使用（藥品／費用等），不會出現在健檢報告中
                </span>
              </label>
              <div class="space-y-1.5">
                <label :for="`visit-template-${appointment._id}`" class="block text-xs font-medium text-foreground">建立草稿的表單</label>
                <Select v-model="simpleForms[appointment._id].templateId">
                  <SelectTrigger :id="`visit-template-${appointment._id}`" class="w-full"><SelectValue placeholder="選擇表單" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="template in formTemplates" :key="template._id" :value="template._id">{{ template.name }}</SelectItem>
                  </SelectContent>
                </Select>
                <p class="text-xs text-muted-foreground">完成看診後會立即建立並開啟這份表單的草稿。</p>
              </div>
              <div class="flex justify-end">
                <Button type="button" size="sm" :disabled="isBusy(appointment._id) || !simpleForms[appointment._id].templateId || followUpTimeMissing(simpleForms[appointment._id])" @click="completeVisit(appointment)">
                  <Check class="h-4 w-4" stroke-width="2" />完成看診
                </Button>
              </div>
            </div>
          </li>
        </ul>
        <div v-else class="border-t border-border bg-field/20 px-4 py-8 text-center">
          <p class="text-sm font-medium text-foreground">目前沒有候診中的病患</p>
          <p class="mt-1 text-xs text-muted-foreground">病患完成報到後會顯示在這裡</p>
        </div>
      </Card>

       <Card class="h-full overflow-hidden p-0 shadow-sm dark:shadow-none">
        <div class="flex items-start justify-between gap-3 p-4 pb-3">
          <div>
            <h2 class="text-base font-semibold text-foreground">{{ isToday ? '今日看診時間軸' : '看診時間軸' }}</h2>
            <p class="mt-0.5 text-xs text-muted-foreground">依預約時段排列；報到後仍保留原位置</p>
          </div>
          <span class="inline-flex h-6.5 min-w-6.5 shrink-0 items-center justify-center rounded-full bg-muted px-2 text-xs font-semibold text-foreground">{{ timelineAppointments.length }}</span>
        </div>

        <div class="px-4 pb-4">
          <!-- 已取消、未到與已完成仍在下方各自保留；這裡只描述進行中的時間軸。 -->
          <div v-if="!timelineAppointments.length" class="mb-3 rounded-xl border border-dashed border-border bg-muted px-3.5 py-4 text-center" role="status">
            <p class="text-sm font-medium text-foreground">
              {{ isToday ? '今天' : formatDate(selectedDate) }}{{ hasAnyAppointment ? '沒有待報到或候診中的掛號' : '還沒有任何掛號' }}
            </p>
            <p class="mt-1 text-xs text-muted-foreground">點選右上方「掛號」新增，資料會依預約時段顯示在下方時間軸。</p>
          </div>

          <template v-for="group in visibleSessionGroups" :key="group.session.id">
            <div
              v-if="group.sessionIndex === 1 && (sessionGroups[0]?.items.length || !timelineAppointments.length)"
              class="my-2 flex items-center gap-2.5"
              :aria-label="`${SURGERY_BLOCK.label} ${SURGERY_BLOCK.start} 到 ${SURGERY_BLOCK.end}，不排診`"
            >
              <span class="h-px flex-1 bg-border" aria-hidden="true"></span>
              <span class="shrink-0 text-xs font-medium text-muted-foreground">
                {{ SURGERY_BLOCK.label }} {{ SURGERY_BLOCK.start }}–{{ SURGERY_BLOCK.end }}
              </span>
              <span class="h-px flex-1 bg-border" aria-hidden="true"></span>
            </div>

            <button
              type="button"
              class="group/session flex w-full cursor-pointer items-center gap-2.5 rounded-xl border border-border/70 bg-field/50 px-3.5 py-2.5 text-left text-sm font-semibold text-foreground shadow-2xs transition-all hover:border-primary/40 hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :aria-expanded="!isSessionCollapsed(group.session.id)"
              :aria-controls="`appointment-session-${group.session.id}`"
              @click="toggleSession(group.session.id)"
            >
              <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-card text-muted-foreground ring-1 ring-border/80">
                <Clock class="h-4 w-4" stroke-width="1.75" />
              </span>
              <span>{{ group.session.label }} · {{ group.session.start }}–{{ group.session.end }}</span>
              <span class="ml-auto inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-2 text-xs font-semibold tabular-nums text-muted-foreground">
                {{ group.items.length }}
              </span>
              <span class="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-card px-2.5 text-xs font-semibold text-primary ring-1 ring-border/80 transition-colors group-hover/session:ring-primary/40">
                {{ isSessionCollapsed(group.session.id) ? '展開' : '收合' }}
                <ChevronDown
                  class="h-4 w-4 transition-transform duration-200 motion-reduce:transition-none"
                  :class="{ 'rotate-180': !isSessionCollapsed(group.session.id) }"
                  stroke-width="1.9"
                />
              </span>
            </button>

            <div
              :id="`appointment-session-${group.session.id}`"
              class="grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none"
              :class="isSessionCollapsed(group.session.id) ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'"
              :aria-hidden="isSessionCollapsed(group.session.id)"
              :inert="isSessionCollapsed(group.session.id)"
            >
              <div class="ml-2 min-h-0 border-l-2 border-border/80 pl-2 sm:ml-20 sm:pl-5">
              <div v-if="!group.items.length" class="relative py-4">
                <span class="absolute left-[-9px] top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-muted-foreground/60 ring-1 ring-border sm:left-[-21px]" aria-hidden="true"></span>
                <p class="rounded-xl border border-dashed border-border bg-field/30 px-3 py-5 text-center text-sm text-muted-foreground">此時段尚無掛號</p>
              </div>
              <template v-for="(appointment, itemIndex) in group.items" :key="appointment._id">
                <div
                  v-if="isToday && group.sessionIndex === nowSessionIndex && itemIndex === nowIndexInSession(group.items, now)"
                  class="my-1.5 flex items-center gap-2.5"
                >
                  <span class="h-0 flex-1 border-t-2 border-dashed border-primary"></span>
                  <span class="shrink-0 rounded-full bg-primary px-3 py-0.5 text-xs font-bold text-primary-foreground shadow-2xs">現在 · {{ nowLabel }}</span>
                </div>

                <div class="relative py-1">
                  <span class="mb-1 block text-xs font-semibold text-muted-foreground sm:absolute sm:left-[-36px] sm:top-3 sm:mb-0 sm:w-14 sm:-translate-x-full sm:text-right sm:text-sm">
                    {{ new Date(appointment.scheduledAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }) }}
                  </span>
                  <span
                    class="absolute left-[-9px] top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card sm:left-[-21px]"
                    :class="appointment.status === 'arrived'
                      ? 'bg-primary ring-4 ring-primary/20'
                      : 'bg-muted-foreground/60 ring-1 ring-border'"
                    aria-hidden="true"
                  ></span>
                  <span
                    v-if="appointment.status === 'arrived'"
                    class="absolute left-[-9px] top-1/2 h-0.5 w-[9px] -translate-y-1/2 bg-primary/60 sm:left-[-21px] sm:w-[21px]"
                    aria-hidden="true"
                  ></span>

                  <div
                    class="rounded-xl border px-3 py-2 transition-colors"
                    :class="[
                      appointment.status === 'arrived' ? 'border-primary/25 bg-accent/35 shadow-2xs' : 'border-transparent hover:bg-field/30',
                      isHighlighted(appointment._id) ? 'ring-2 ring-warning' : '',
                    ]"
                  >
                    <div class="flex flex-wrap items-center gap-2.5">
                      <span
                        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                        :class="appointment.status === 'arrived'
                          ? 'bg-primary/10 text-primary ring-1 ring-primary/20'
                          : isIdentityConfirmed(appointment)
                            ? 'bg-accent text-accent-foreground'
                            : 'bg-muted text-muted-foreground'"
                      >
                        <User class="h-4 w-4" stroke-width="1.75" />
                      </span>

                      <div class="min-w-0 flex-1">
                        <div class="flex min-w-0 items-center gap-1.5">
                          <span
                            v-if="visitTypeMeta(appointment)"
                            class="inline-flex h-6 shrink-0 items-center rounded-md px-2 text-xs font-semibold ring-1 shadow-2xs"
                            :class="visitTypeMeta(appointment).classes"
                          >{{ visitTypeMeta(appointment).label }}</span>
                          <span class="truncate text-sm font-semibold text-foreground">{{ appointment.petName || '—' }}</span>
                        </div>
                        <span class="flex items-center gap-1 truncate text-xs text-muted-foreground">
                          {{ appointment.ownerName || '—' }}
                          <template v-if="appointment.ownerPhone">
                            <span class="text-border">·</span>
                            <Phone class="h-3 w-3 shrink-0" stroke-width="1.75" />{{ appointment.ownerPhone }}
                          </template>
                          <template v-if="appointment.status === 'arrived' && appointment.checkedInAt">
                            <span class="text-border">·</span>
                            <Clock class="h-3 w-3 shrink-0 text-primary" stroke-width="1.9" />
                            <span class="font-medium text-primary">{{ formatDateTime(appointment.checkedInAt, checkinTimeOptions) }} 報到</span>
                          </template>
                        </span>
                        <p
                          v-if="appointment.reason"
                          class="mt-0.5 flex min-w-0 items-start gap-1 text-xs text-muted-foreground"
                        ><MessageSquareText class="mt-0.5 h-3 w-3 shrink-0" stroke-width="1.75" /><span class="min-w-0 whitespace-pre-wrap break-words">{{ appointment.reason }}</span></p>
                      </div>

                      <div class="ml-auto flex shrink-0 items-center gap-1.5">
                        <template v-if="appointment.status === 'arrived'">
                          <span class="inline-flex min-h-7 items-center rounded-md bg-accent px-2.5 text-xs font-semibold text-accent-foreground ring-1 ring-primary/20">
                            已報到<template v-if="appointment.checkinNumber"> · 號碼牌 {{ appointment.checkinNumber }} 號</template>
                          </span>
                        </template>
                        <template v-else>
                          <Button type="button" size="sm" :disabled="isBusy(appointment._id)" @click="checkIn(appointment)">報到</Button>
                          <RowActions :actions="ROW_ACTIONS" :label="`${appointment.petName || '這筆掛號'}的更多操作`" @select="(key) => requestRowAction(appointment, key)" />
                        </template>
                      </div>
                    </div>
                  </div>
                </div>
              </template>

              <!-- 「現在」晚於這個時段全部項目時，指示線要落在最後面，不是插在某一列前面。 -->
              <div
                v-if="isToday && group.sessionIndex === nowSessionIndex && nowIndexInSession(group.items, now) === group.items.length"
                class="my-1.5 flex items-center gap-2.5"
              >
                <span class="h-0 flex-1 border-t-2 border-dashed border-primary"></span>
                <span class="shrink-0 rounded-full bg-primary px-3 py-0.5 text-xs font-bold text-primary-foreground shadow-2xs">現在 · {{ nowLabel }}</span>
              </div>
              </div>
            </div>
          </template>

          <div v-if="closedGroups.length" class="mt-4 grid gap-3 sm:grid-cols-2">
            <section v-for="group in closedGroups" :key="group.key" class="min-w-0 rounded-xl bg-muted/40 p-3">
              <div class="mb-2 flex items-center justify-between gap-3">
                <h3 class="text-sm font-semibold text-foreground">{{ group.label }}</h3>
                <span class="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-card px-2 text-xs font-semibold tabular-nums text-foreground shadow-2xs">{{ group.items.length }}</span>
              </div>
              <div class="space-y-2">
                <article
                  v-for="appointment in group.items"
                  :key="appointment._id"
                  class="grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border/70 bg-card px-3 py-2.5 shadow-2xs"
                  :class="isHighlighted(appointment._id) ? 'ring-2 ring-warning' : ''"
                >
                  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <component :is="group.icon" class="h-4.5 w-4.5" stroke-width="1.75" />
                  </span>
                  <div class="min-w-0">
                    <p class="truncate text-sm font-semibold text-foreground">{{ appointment.petName || '—' }}</p>
                    <div
                      class="mt-0.5 grid min-w-0 gap-3 text-xs text-muted-foreground"
                      :class="group.key === 'cancelled' ? 'grid-cols-2' : 'grid-cols-1'"
                    >
                      <p class="flex min-w-0 items-center gap-1.5">
                        <span class="truncate">飼主 {{ appointment.ownerName || '未填' }}</span>
                        <span aria-hidden="true">·</span>
                        <span class="shrink-0 tabular-nums">原訂 {{ appointment.time }}</span>
                      </p>
                      <p
                        v-if="group.key === 'cancelled'"
                        class="truncate"
                        :class="{ 'italic text-muted-foreground/70': !appointment.cancelReason }"
                        :title="appointment.cancelReason ? `取消原因：${appointment.cancelReason}` : ''"
                      >{{ appointment.cancelReason ? `取消原因：${appointment.cancelReason}` : '—' }}</p>
                    </div>
                  </div>
                  <div class="flex shrink-0 items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      :disabled="isBusy(appointment._id)"
                      :aria-label="`恢復 ${appointment.petName || '這筆'} 的掛號`"
                      @click="actionToConfirm = { appointment, key: 'restore' }"
                    >恢復</Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="xs"
                      :disabled="isBusy(appointment._id)"
                      :aria-label="`刪除 ${appointment.petName || '這筆'} 的掛號`"
                      @click="actionToConfirm = { appointment, key: 'delete' }"
                    >刪除</Button>
                  </div>
                </article>
              </div>
            </section>
          </div>
        </div>
      </Card>
      </div>

      </template>

      <!-- ── 統計格篩選出來的表格檢視：只看單一狀態。已完成沿用原本「已完成」清單的欄位
           （完成時間／量測／回診／備註／草稿表單），比待報到／候診中多需要看的資訊更多，
           所以另外分支；其餘兩種狀態跟櫃台頁拿掉之前用過的版型一樣。 -->
      <template v-else>
        <EmptyState
          v-if="!filteredByStatus.length"
          :icon="UserPlus"
          :title="`今天沒有「${STATUS_LABEL[statusFilter]}」的掛號`"
          description="點一次上方統計格可以清除篩選，看回候診卡片與時間軸。"
        />

        <template v-else-if="statusFilter === 'completed'">
          <!-- 桌機：資料表 -->
          <Card class="hidden overflow-hidden p-0 shadow-sm xl:block dark:shadow-none">
            <div class="overflow-x-auto">
              <div class="min-w-[52rem] text-left text-sm" style="--data-columns: minmax(0, 1.6fr) minmax(0, 1.1fr) minmax(0, 0.7fr) minmax(0, 0.7fr) minmax(0, 1.1fr) minmax(0, 2.6fr) minmax(0, 1.2fr) 10rem">
                <div class="desktop-data-header text-xs font-semibold text-muted-foreground">
                    <span class="desktop-data-cell">病患</span>
                    <span class="desktop-data-cell">完成時間</span>
                    <span class="desktop-data-cell">體重</span>
                    <span class="desktop-data-cell">體溫</span>
                    <span class="desktop-data-cell">回診日期</span>
                    <span class="desktop-data-cell">看診備註</span>
                    <span class="desktop-data-cell">草稿表單</span>
                    <span class="desktop-data-cell"><span class="sr-only">操作</span></span>
                </div>
                  <div
                    v-for="appointment in filteredByStatus"
                    :key="appointment._id"
                    class="desktop-data-row bg-card hover:bg-muted/20"
                    :class="isHighlighted(appointment._id) ? 'ring-2 ring-warning' : ''"
                  >
                    <div class="desktop-data-cell">
                      <router-link v-if="appointment.petId" :to="`/pets/${appointment.petId}`" target="_blank" rel="noopener" class="block truncate font-semibold text-primary hover:underline">{{ appointment.petName || '—' }}</router-link>
                      <p v-else class="truncate font-semibold text-foreground">{{ appointment.petName || '—' }}</p>
                      <p class="truncate text-xs text-muted-foreground">{{ appointment.ownerName || '—' }}</p>
                    </div>
                    <div class="whitespace-nowrap desktop-data-cell text-muted-foreground">{{ appointment.completedAt ? formatDateTime(appointment.completedAt, checkinTimeOptions) : '—' }}</div>
                    <div class="whitespace-nowrap desktop-data-cell text-foreground">{{ appointment.weightKg == null ? '—' : `${appointment.weightKg} kg` }}</div>
                    <div class="whitespace-nowrap desktop-data-cell text-foreground">{{ appointment.temperatureC == null ? '—' : `${appointment.temperatureC} °C` }}</div>
                    <div class="whitespace-nowrap desktop-data-cell text-foreground">{{ followUpLabel(appointment) }}</div>
                    <div class="desktop-data-cell text-muted-foreground"><p class="truncate" :title="appointment.visitNote || undefined">{{ appointment.visitNote || '—' }}</p></div>
                    <div class="truncate desktop-data-cell text-muted-foreground">{{ templateName(appointment.templateId) }}</div>
                    <div class="desktop-data-cell flex items-center justify-end gap-1.5"><Button type="button" variant="outline" size="xs" :aria-label="`查看 ${appointment.petName || '這筆掛號'} 的完整內容`" @click="detailTarget = appointment">查看</Button><Button type="button" variant="secondary" size="xs" @click="openCompletedVisitEditor(appointment)"><Pencil class="h-3.5 w-3.5" />編輯</Button></div>
                  </div>
              </div>
            </div>
          </Card>

          <!-- 手機：卡片 -->
          <div class="space-y-3 xl:hidden">
            <Card
              v-for="appointment in filteredByStatus"
              :key="appointment._id"
              class="gap-2 p-4 shadow-sm dark:shadow-none"
              :class="isHighlighted(appointment._id) ? 'ring-2 ring-warning' : ''"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <router-link v-if="appointment.petId" :to="`/pets/${appointment.petId}`" class="block truncate font-semibold text-primary">{{ appointment.petName || '—' }}</router-link>
                  <p v-else class="truncate font-semibold text-foreground">{{ appointment.petName || '—' }}</p>
                  <p class="truncate text-xs text-muted-foreground">{{ appointment.ownerName || '—' }}</p>
                </div>
                <span class="shrink-0 text-xs text-muted-foreground">{{ appointment.completedAt ? formatDateTime(appointment.completedAt, checkinTimeOptions) : '—' }}</span>
              </div>
              <p class="text-sm text-foreground">
                {{ appointment.weightKg == null ? '—' : `${appointment.weightKg} kg` }} ・ {{ appointment.temperatureC == null ? '—' : `${appointment.temperatureC} °C` }} ・ 回診：{{ followUpLabel(appointment) }}
              </p>
              <p class="text-xs text-muted-foreground">草稿表單：{{ templateName(appointment.templateId) }}</p>
              <p class="whitespace-pre-wrap text-sm text-muted-foreground">看診備註：{{ appointment.visitNote || '—' }}</p>
              <Button type="button" variant="outline" size="xs" :aria-label="`查看 ${appointment.petName || '這筆掛號'} 的完整內容`" @click="detailTarget = appointment">查看</Button>
              <Button type="button" variant="secondary" size="sm" @click="openCompletedVisitEditor(appointment)"><Pencil class="h-3.5 w-3.5" />編輯</Button>
            </Card>
          </div>
        </template>

        <template v-else>
          <!-- 桌機：資料表 -->
          <Card class="hidden overflow-x-auto p-0 shadow-sm xl:block dark:shadow-none" style="--data-columns: 6rem minmax(9rem, 1fr) 6.5rem minmax(8rem, 0.9fr) minmax(8rem, 0.9fr) 16rem">
            <div class="min-w-[64rem]">
            <div class="desktop-data-header">
              <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">時間／牌號</span>
              <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">病患</span>
              <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">狀態</span>
              <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">量測</span>
              <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">回診</span>
              <span class="desktop-data-cell"><span class="sr-only">操作</span></span>
            </div>
            <div
              v-for="appointment in filteredByStatus"
              :key="appointment._id"
              class="desktop-data-row"
              :class="isHighlighted(appointment._id) ? 'ring-2 ring-warning' : ''"
            >
              <span class="desktop-data-cell whitespace-nowrap text-foreground">
                <template v-if="appointment.status === 'arrived'">
                  <input
                    v-if="editingCardNumberId === appointment._id"
                    v-model="cardNumberDraft"
                    autofocus
                    type="text"
                    class="h-8 w-12 rounded-md border-2 border-primary bg-card text-center text-sm font-bold tabular-nums text-foreground outline-none"
                    :disabled="isBusy(appointment._id)"
                    @focus="$event.currentTarget.select()"
                    @keydown.enter.prevent="$event.currentTarget.blur()"
                    @keydown.esc.prevent="cancelCardNumberEdit"
                    @blur="submitCardNumber(appointment)"
                  />
                  <button v-else type="button" class="rounded-md bg-primary px-2 py-1 text-xs font-bold tabular-nums text-primary-foreground" :disabled="isBusy(appointment._id)" @click="beginCardNumberEdit(appointment)">
                    {{ appointment.checkinNumber }} 號
                  </button>
                </template>
                <template v-else>{{ appointment.time || formatDateTime(appointment.scheduledAt, checkinTimeOptions, '—') }}</template>
              </span>
              <span class="desktop-data-cell min-w-0">
                <router-link v-if="appointment.petId" :to="`/pets/${appointment.petId}`" target="_blank" rel="noopener" class="block truncate font-semibold text-primary hover:underline">{{ appointment.petName || '—' }}</router-link>
                <p v-else class="truncate font-semibold text-foreground">{{ appointment.petName || '—' }}</p>
                <p class="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
                  {{ appointment.ownerName || '—' }}
                  <template v-if="appointment.ownerPhone"><Phone class="h-3 w-3 shrink-0" stroke-width="1.75" />{{ appointment.ownerPhone }}</template>
                </p>
              </span>
              <span class="desktop-data-cell"><span class="inline-flex h-6.5 items-center rounded-md px-2 text-xs font-semibold" :class="appointmentStatusClasses(appointment.status)">{{ STATUS_LABEL[appointment.status] }}</span></span>
              <span class="desktop-data-cell truncate" :class="appointment.weightKg == null && appointment.temperatureC == null ? 'text-muted-foreground' : 'text-foreground'">
                <template v-if="appointment.status !== 'scheduled'">{{ appointment.weightKg == null ? '—' : `${appointment.weightKg}kg` }}／{{ appointment.temperatureC == null ? '—' : `${appointment.temperatureC}°C` }}</template>
                <template v-else>—</template>
              </span>
              <span class="desktop-data-cell truncate text-muted-foreground">{{ appointment.status !== 'scheduled' ? followUpLabel(appointment) : '—' }}</span>
              <span class="desktop-data-cell flex items-center justify-end gap-1.5">
                <Button type="button" variant="outline" size="xs" :aria-label="`查看 ${appointment.petName || '這筆掛號'} 的完整內容`" @click="detailTarget = appointment">查看</Button>
                <template v-if="appointment.status === 'scheduled'">
                  <Button type="button" size="xs" :disabled="isBusy(appointment._id)" @click="checkIn(appointment)">報到</Button>
                  <RowActions :actions="ROW_ACTIONS" :label="`${appointment.petName || '這筆掛號'}的更多操作`" @select="(key) => requestRowAction(appointment, key)" />
                </template>
                <template v-else-if="appointment.status === 'arrived'">
                  <Button type="button" variant="secondary" size="xs" @click="focusCandidate(appointment)"><Pencil class="h-3.5 w-3.5" />看診資料</Button>
                  <RowActions :actions="ROW_ACTIONS_ARRIVED" :label="`${appointment.petName || '這筆掛號'}的更多操作`" @select="(key) => requestRowAction(appointment, key)" />
                </template>
                <template v-else>
                  <Button type="button" variant="secondary" size="xs" @click="openCompletedVisitEditor(appointment)"><Pencil class="h-3.5 w-3.5" />編輯</Button>
                </template>
              </span>
            </div>
            </div>
          </Card>

          <!-- 手機：卡片 -->
          <div class="space-y-3 xl:hidden">
            <Card
              v-for="appointment in filteredByStatus"
              :key="appointment._id"
              class="gap-2 p-4 shadow-sm dark:shadow-none"
              :class="isHighlighted(appointment._id) ? 'ring-2 ring-warning' : ''"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <router-link v-if="appointment.petId" :to="`/pets/${appointment.petId}`" class="block truncate font-semibold text-primary">{{ appointment.petName || '—' }}</router-link>
                  <p v-else class="truncate font-semibold text-foreground">{{ appointment.petName || '—' }}</p>
                  <p class="truncate text-xs text-muted-foreground">{{ appointment.ownerName || '—' }}<template v-if="appointment.ownerPhone"> · {{ appointment.ownerPhone }}</template></p>
                </div>
                <span class="shrink-0 text-xs tabular-nums text-muted-foreground">{{ appointment.status === 'arrived' ? `${appointment.checkinNumber} 號` : (appointment.time || formatDateTime(appointment.scheduledAt, checkinTimeOptions, '—')) }}</span>
              </div>
              <span class="inline-flex h-6.5 w-fit items-center rounded-md px-2 text-xs font-semibold" :class="appointmentStatusClasses(appointment.status)">{{ STATUS_LABEL[appointment.status] }}</span>
              <p v-if="appointment.status !== 'scheduled'" class="text-sm text-foreground">
                {{ appointment.weightKg == null ? '—' : `${appointment.weightKg} kg` }} ・ {{ appointment.temperatureC == null ? '—' : `${appointment.temperatureC} °C` }} ・ 回診：{{ followUpLabel(appointment) }}
              </p>
              <div class="flex flex-wrap gap-1.5">
                <Button type="button" variant="outline" size="xs" :aria-label="`查看 ${appointment.petName || '這筆掛號'} 的完整內容`" @click="detailTarget = appointment">查看</Button>
                <template v-if="appointment.status === 'scheduled'">
                  <Button type="button" size="sm" class="flex-1" :disabled="isBusy(appointment._id)" @click="checkIn(appointment)">報到</Button>
                  <RowActions :actions="ROW_ACTIONS" :label="`${appointment.petName || '這筆掛號'}的更多操作`" @select="(key) => requestRowAction(appointment, key)" />
                </template>
                <template v-else-if="appointment.status === 'arrived'">
                  <Button type="button" variant="secondary" size="sm" class="flex-1" @click="focusCandidate(appointment)"><Pencil class="h-3.5 w-3.5" />看診資料</Button>
                  <RowActions :actions="ROW_ACTIONS_ARRIVED" :label="`${appointment.petName || '這筆掛號'}的更多操作`" @select="(key) => requestRowAction(appointment, key)" />
                </template>
                <template v-else>
                  <Button type="button" variant="secondary" size="sm" class="flex-1" @click="openCompletedVisitEditor(appointment)"><Pencil class="h-3.5 w-3.5" />編輯</Button>
                </template>
              </div>
            </Card>
          </div>
        </template>
      </template>
      </div>

      <!-- ── 週檢視 ── -->
      <div v-if="viewMode === 'week'" id="appointments-week-panel" role="tabpanel" aria-labelledby="appointments-week-tab">
      <ListSkeleton v-if="weekSummaryLoading" :rows="2" />
      <Alert v-else-if="weekSummaryError" variant="destructive">
        <AlertDescription class="flex items-center justify-between gap-3">
          <span>{{ weekSummaryError }}</span>
          <Button type="button" variant="outline" size="sm" class="shrink-0" @click="fetchWeekSummary">重新載入</Button>
        </AlertDescription>
      </Alert>
      <Card v-else class="overflow-hidden p-0 shadow-sm dark:shadow-none">
        <div class="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
          <div>
            <h2 class="text-base font-semibold text-foreground">本週掛號</h2>
            <p class="mt-0.5 text-xs text-muted-foreground">{{ weekRangeLabel }} · 選擇日期查看單日掛號</p>
          </div>
        </div>
        <div class="overflow-x-auto px-4 pt-2 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div class="flex min-w-max snap-x snap-mandatory gap-2 sm:grid sm:min-w-0 sm:grid-cols-4 lg:grid-cols-7">
            <article
              v-for="date in weekDates"
              :key="date"
              class="flex w-72 snap-start flex-col rounded-xl border-2 px-2 py-3 text-center transition-all duration-150 sm:w-auto"
              :class="
                date === selectedDate
                  ? 'border-primary bg-card text-foreground shadow-sm'
                  : date === today
                    ? 'border-primary/50 bg-accent/40 text-foreground hover:bg-accent/70'
                    : 'border-border/70 bg-card text-foreground hover:border-primary/30 hover:bg-field/50'
              "
            >
              <span class="text-xs font-medium" :class="date === selectedDate || date === today ? 'text-primary' : 'text-muted-foreground'">{{ weekdayLabel(date) }}</span>
              <span class="text-sm font-bold" :class="date === today ? 'text-primary' : 'text-foreground'">{{ date.split('-')[2] }}</span>
              <span class="text-xs" :class="date === selectedDate || date === today ? 'font-medium text-primary' : 'text-muted-foreground'">
                {{ weekSummary.get(date) ?? 0 }} 筆
              </span>
              <div class="mt-2 w-full space-y-1 border-t border-border/60 pt-2 text-left">
                <p v-if="!(weekAppointments.get(date) ?? []).length" class="py-3 text-center text-xs text-muted-foreground">當天沒有掛號</p>
                <button v-for="appointment in (weekAppointments.get(date) ?? [])" :key="appointment._id" type="button" class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-field/60" @click="selectedDate = date; viewMode = 'day'">
                  <span class="w-10 shrink-0 font-medium tabular-nums text-muted-foreground">{{ appointment.time || formatDateTime(appointment.scheduledAt, checkinTimeOptions, '—') }}</span>
                  <span class="min-w-0 flex-1 truncate font-medium text-foreground">{{ appointment.petName || '—' }}</span>
                  <span class="shrink-0 rounded-full px-1.5 py-0.5 text-sm" :class="appointmentStatusClasses(appointment.status)">{{ appointment.status === 'completed' ? '完成' : appointment.status === 'arrived' ? '候診' : appointment.status === 'cancelled' ? '取消' : appointment.status === 'no_show' ? '未到' : '預約' }}</span>
                </button>
              </div>
            </article>
          </div>
        </div>
      </Card>
      </div>
    </template>

    <NewAppointmentDialog
      v-if="newAppointmentOpen"
      :date="selectedDate"
      :is-today="isToday"
      :submitting="newAppointmentSubmitting"
      :error-message="newAppointmentError"
      :templates="formTemplates"
      :default-template-id="defaultTemplateId"
      @submit="submitNewAppointment"
      @close="newAppointmentOpen = false"
    />

    <ModalDialog v-if="defaultTemplateDialogOpen" @close="defaultTemplateDialogOpen = false">
      <div class="p-6 pb-3 sm:p-7 sm:pb-3">
        <DialogTitle>掛號預設表單</DialogTitle>
        <DialogDescription class="mt-1">新掛號會自動帶入此表單；在看診欄位仍可個別改選。</DialogDescription>
      </div>
      <div class="space-y-1.5 p-6 pt-2 sm:p-7 sm:pt-2">
        <label for="default-appointment-template" class="text-sm font-medium text-foreground">預設表單</label>
        <Select v-model="defaultTemplateId">
          <SelectTrigger id="default-appointment-template" class="w-full"><SelectValue placeholder="選擇預設表單" /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="template in formTemplates" :key="template._id" :value="template._id">{{ template.name }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" :disabled="savingDefaultTemplate" @click="defaultTemplateDialogOpen = false">取消</Button>
        <Button type="button" :disabled="savingDefaultTemplate || !defaultTemplateId" @click="saveDefaultTemplate">{{ savingDefaultTemplate ? '儲存中…' : '儲存' }}</Button>
      </DialogFooter>
    </ModalDialog>

    <ModalDialog v-if="detailAppointment" size="lg" @close="detailTarget = null">
      <div class="p-6 pb-3 sm:p-7 sm:pb-3">
        <DialogTitle>掛號完整內容</DialogTitle>
        <DialogDescription class="mt-1">查看病患、掛號與看診資料。</DialogDescription>
      </div>
      <dl class="grid gap-4 p-6 pt-2 sm:grid-cols-2 sm:p-7 sm:pt-2">
        <div v-for="[label, value, fullWidth] in detailFields" :key="label" class="min-w-0 space-y-1" :class="{ 'sm:col-span-2': fullWidth }">
          <dt class="text-xs font-medium text-muted-foreground">{{ label }}</dt>
          <dd class="whitespace-pre-wrap break-words text-sm text-foreground [overflow-wrap:anywhere]">{{ value || '—' }}</dd>
        </div>
      </dl>
      <DialogFooter class="px-6 pb-6 sm:px-7 sm:pb-7">
        <Button type="button" variant="outline" @click="detailTarget = null">關閉</Button>
      </DialogFooter>
    </ModalDialog>

    <ModalDialog v-if="completedVisitTarget" @close="!completedVisitSaving && (completedVisitTarget = null)">
      <div class="p-6 pb-3 sm:p-7 sm:pb-3">
        <DialogTitle>編輯看診資料</DialogTitle>
        <DialogDescription class="mt-1">{{ completedVisitTarget.petName || '這筆掛號' }}的量測與內部備註；若草稿尚未結案，也會同步更新。</DialogDescription>
      </div>
      <form class="flex flex-col" @submit.prevent="saveCompletedVisit">
        <div class="space-y-4 p-6 pt-2 sm:p-7 sm:pt-2">
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="space-y-1.5 text-sm font-medium text-foreground">體重（kg）<input v-model="completedVisitForm.weightKg" type="text" class="h-11 w-full rounded-lg border border-input bg-field px-3 text-sm font-normal text-foreground" /></label>
            <label class="space-y-1.5 text-sm font-medium text-foreground">體溫（°C）<input v-model="completedVisitForm.temperatureC" type="text" class="h-11 w-full rounded-lg border border-input bg-field px-3 text-sm font-normal text-foreground" /></label>
          </div>
          <label class="block space-y-1.5 text-sm font-medium text-foreground">
            回診日期
            <div class="flex gap-2">
              <DatePicker v-model="completedVisitForm.followUpDate" placeholder="選擇回診日期" aria-label="選擇回診日期" class="flex-1" />
              <TimePicker v-model="completedVisitForm.followUpTime" placeholder="時間" aria-label="選擇回診時間" :disabled="!completedVisitForm.followUpDate" class="w-32 shrink-0" />
            </div>
            <span v-if="followUpTimeMissing(completedVisitForm)" class="block text-xs font-medium text-destructive">已選擇日期，請一併填寫時間</span>
            <span v-else class="block text-xs font-normal text-muted-foreground">尚未結案的報告會同步更新；已掛出去的下次回診號（若還沒報到）也會跟著改期。</span>
          </label>
          <label class="block space-y-1.5 text-sm font-medium text-foreground">
            回診原因
            <input v-model="completedVisitForm.followUpReason" type="text" placeholder="例：拆線、追蹤肝指數" class="h-11 w-full rounded-lg border border-input bg-field px-3 text-sm font-normal text-foreground" />
          </label>
          <label class="block space-y-1.5 text-sm font-medium text-foreground">看診備註<textarea v-model="completedVisitForm.visitNote" rows="4" class="w-full rounded-lg border border-input bg-field px-3 py-2 text-sm font-normal text-foreground"></textarea></label>
          <Alert v-if="completedVisitError" variant="destructive"><AlertDescription>{{ completedVisitError }}</AlertDescription></Alert>
        </div>
        <DialogFooter><Button type="button" variant="outline" :disabled="completedVisitSaving" @click="completedVisitTarget = null">取消</Button><Button type="submit" :disabled="completedVisitSaving || followUpTimeMissing(completedVisitForm)">{{ completedVisitSaving ? '儲存中…' : '儲存變更' }}</Button></DialogFooter>
      </form>
    </ModalDialog>

    <EditAppointmentDialog
      v-if="editTarget"
      :appointment="editTarget"
      :submitting="editSubmitting"
      :error-message="editError"
      :templates="formTemplates"
      :default-template-id="defaultTemplateId"
      @submit="submitEditAppointment"
      @close="editTarget = null"
    />

    <CancelAppointmentDialog
      v-if="cancelTarget"
      :appointment="cancelTarget"
      :submitting="cancelSubmitting"
      :error-message="cancelError"
      @submit="submitCancelAppointment"
      @close="cancelTarget = null"
    />

    <CheckInDialog
      v-if="checkInTarget"
      :appointment="checkInTarget"
      :submitting="checkInSubmitting"
      :error-message="checkInError"
      @submit="submitCheckIn"
      @close="checkInTarget = null"
    />
    <ConfirmDialog
      :open="Boolean(actionToConfirm)"
      :title="actionConfirmation.title"
      :description="actionConfirmation.description"
      :confirm-label="actionConfirmation.confirmLabel"
      :destructive="actionConfirmation.destructive"
      :loading="Boolean(actionToConfirm && isBusy(actionToConfirm.appointment._id))"
      @update:open="(value) => !value && (actionToConfirm = null)"
      @confirm="confirmRowAction"
    />
  </section>
</template>
