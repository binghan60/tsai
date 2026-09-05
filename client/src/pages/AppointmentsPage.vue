<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { CalendarClock, CalendarX2, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Lock, MessageSquareText, Pencil, Phone, Settings, User, UserPlus, UserX, X } from '@lucide/vue';
import { http } from '../api/http';
import { useToast } from '../composables/useToast';
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
const editSubmitting = ref(false);
const editError = ref('');
const cancelTarget = ref(null);
const cancelSubmitting = ref(false);
const cancelError = ref('');
const completedVisitTarget = ref(null);
const completedVisitSaving = ref(false);
const completedVisitError = ref('');
const completedVisitForm = reactive({ weightKg: '', temperatureC: '', followUpDate: '', followUpTime: '', followUpReason: '', visitNote: '' });

const ROW_ACTIONS = [
  { key: 'edit', label: '編輯掛號' },
  { key: 'no_show', label: '標記未到' },
  { key: 'cancel', label: '取消掛號', danger: true },
];

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
    .filter((group) => group.items.length)
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
  try {
    await http.patch(`/appointments/${appointment._id}/check-in-number`, { checkinNumber: nextNumber });
    toast.success(`${appointment.petName || '這隻寵物'}已改拿 ${nextNumber} 號牌`, '號碼牌已更新');
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
    try {
      await http.post(`/appointments/${appointment._id}/check-in`, {});
      toast.success(`${appointment.petName || '這隻寵物'}已報到`, '報到完成');
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
  try {
    await http.post(`/appointments/${checkInTarget.value._id}/check-in`, values);
    toast.success('已建立正式病歷並報到', '報到完成');
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
    await http.post('/appointments', payload);
    toast.success(isToday.value ? '已加入今日掛號' : `已加入 ${formatDate(selectedDate.value)} 的掛號`, '新增成功');
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
      followUp ? `已在背景建立就診草稿，並掛上 ${formatDate(followUp.date)} ${followUp.time} 的回診` : '已在背景建立就診草稿',
      '看診完成'
    );
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
}

async function saveCompletedVisit() {
  if (!completedVisitTarget.value) return;
  if (followUpTimeMissing(completedVisitForm)) {
    completedVisitError.value = '已選擇回診日期，請一併填寫時間';
    return;
  }
  completedVisitSaving.value = true;
  completedVisitError.value = '';
  try {
    await http.patch(`/appointments/${completedVisitTarget.value._id}/visit-data`, {
      weightKg: completedVisitForm.weightKg === '' ? null : Number(completedVisitForm.weightKg),
      temperatureC: completedVisitForm.temperatureC === '' ? null : Number(completedVisitForm.temperatureC),
      followUpDate: completedVisitForm.followUpDate || '',
      followUpTime: completedVisitForm.followUpTime || '',
      followUpReason: completedVisitForm.followUpReason || '',
      visitNote: completedVisitForm.visitNote,
    });
    toast.success('已更新看診資料', '儲存完成');
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
  editSubmitting.value = true;
  editError.value = '';
  try {
    await http.put(`/appointments/${editTarget.value._id}`, payload);
    toast.success('掛號資料已更新', '儲存完成');
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
  try {
    await http.post(`/appointments/${appointment._id}/cancel`, { cancelReason });
    toast.info('已取消這筆掛號', '已更新');
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
  try {
    if (key === 'no_show') {
      await http.post(`/appointments/${appointment._id}/no-show`, {});
      toast.info('已標記未到診', '已更新');
    } else if (key === 'restore') {
      await http.post(`/appointments/${appointment._id}/restore`, {});
      toast.success('掛號已恢復至今日候診流程', '恢復完成');
    } else if (key === 'undo_check_in') {
      await http.post(`/appointments/${appointment._id}/restore`, {});
      toast.info('已恢復為尚未報到', '報到已取消');
    } else if (key === 'delete') {
      await http.delete(`/appointments/${appointment._id}`);
      toast.success('掛號已永久刪除', '刪除完成');
    }
    actionToConfirm.value = null;
    await fetchAppointments({ silent: true });
  } catch (err) {
    reportApiError(err, '操作失敗，請稍後再試');
  } finally {
    setBusy(appointment._id, false);
  }
}

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
          <div class="flex flex-wrap items-center gap-2 sm:justify-end">
            <span class="text-sm font-medium" :class="isToday ? 'text-primary' : 'text-muted-foreground'">
              {{ weekdayLabel(selectedDate) }}<template v-if="isToday"> · 今天</template>
            </span>
            <Button v-if="!isToday" type="button" variant="outline" size="sm" @click="selectedDate = today">回到今天</Button>
            <RowActions
              :actions="[
                { key: 'tomorrow', label: '明天' },
                { key: 'day_after_tomorrow', label: '後天' },
                { key: 'next_weekday', label: `下一個${weekdayLabel(selectedDate)}` },
                { key: 'prev_weekday', label: `上一個${weekdayLabel(selectedDate)}` },
              ]"
              :icon="CalendarClock"
              label="快速跳轉日期"
              @select="(key) => {
                if (key === 'tomorrow') selectedDate = shiftDateInput(today, 1);
                else if (key === 'day_after_tomorrow') selectedDate = shiftDateInput(today, 2);
                else if (key === 'next_weekday') selectedDate = shiftDateInput(selectedDate, 7);
                else if (key === 'prev_weekday') selectedDate = shiftDateInput(selectedDate, -7);
              }"
            />
          </div>
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
        <div
          v-for="stat in dayStats"
          :key="stat.key"
          class="flex min-w-0 flex-col items-center justify-center gap-0.5 px-1.5 py-2.5 transition-colors sm:flex-row sm:gap-2.5 sm:px-3 hover:bg-card/50 [&:not(:last-child)]:border-r [&:not(:last-child)]:border-border"
        >
          <span
            class="hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg sm:flex"
            :class="stat.iconBg"
            aria-hidden="true"
          >
            <component :is="stat.icon" class="h-3.5 w-3.5" stroke-width="1.9" />
          </span>
          <dt class="truncate text-xs font-medium text-muted-foreground">{{ stat.label }}</dt>
          <dd class="text-lg font-bold leading-none tabular-nums text-foreground">{{ loading || error ? '—' : stat.value }}</dd>
        </div>
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

        <EmptyState
          v-if="!hasAnyAppointment"
          inset
          :icon="UserPlus"
          :title="isToday ? '今天還沒有任何掛號' : `${formatDate(selectedDate)} 沒有任何掛號`"
          description="選擇「掛號」開始。"
        />

        <div v-else class="px-4 pb-4">
          <!-- 已取消、未到與已完成仍在下方各自保留；這裡只描述進行中的時間軸。 -->
          <p v-if="!timelineAppointments.length" class="rounded-xl border border-dashed border-border bg-muted px-3.5 py-4 text-center text-sm text-muted-foreground">
            {{ isToday ? '今天' : formatDate(selectedDate) }}沒有待報到或候診中的掛號。
          </p>

          <template v-else>
          <template v-for="group in visibleSessionGroups" :key="group.session.id">
            <div
              v-if="group.sessionIndex === 1 && sessionGroups[0]?.items.length"
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
                    :class="appointment.status === 'arrived' ? 'border-primary/25 bg-accent/35 shadow-2xs' : 'border-transparent hover:bg-field/30'"
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

      <details v-if="completedAppointments.length" class="group overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm dark:shadow-none">
        <summary class="flex min-h-12 list-none items-center gap-3 px-4 py-2.5 text-sm font-semibold marker:content-none hover:bg-muted/50">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-success-surface text-success ring-1 ring-success/20">
            <Check class="h-4 w-4" stroke-width="2" />
          </span>
          <span>已完成</span>
          <span class="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-success-surface px-2 text-xs font-semibold tabular-nums text-success ring-1 ring-success/20">{{ completedAppointments.length }}</span>
          <span class="ml-auto text-xs font-normal text-muted-foreground">查看今日完成紀錄</span>
          <ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" stroke-width="1.75" />
        </summary>
        <div class="overflow-x-auto border-t border-border">
          <table class="w-full min-w-[52rem] text-left text-sm">
            <thead class="bg-muted/50 text-xs font-semibold text-muted-foreground">
              <tr>
                <th class="px-4 py-3">病患</th>
                <th class="px-4 py-3">完成時間</th>
                <th class="px-4 py-3">體重</th>
                <th class="px-4 py-3">體溫</th>
                <th class="px-4 py-3">回診日期</th>
                <th class="px-4 py-3">看診備註</th>
                <th class="px-4 py-3">草稿表單</th>
                <th class="px-4 py-3"><span class="sr-only">操作</span></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              <tr v-for="appointment in completedAppointments" :key="appointment._id" class="bg-card hover:bg-muted/20">
                <td class="px-4 py-3">
                  <router-link v-if="appointment.petId" :to="`/pets/${appointment.petId}`" target="_blank" rel="noopener" class="font-semibold text-primary hover:underline">{{ appointment.petName || '—' }}</router-link>
                  <p v-else class="font-semibold text-foreground">{{ appointment.petName || '—' }}</p>
                  <p class="mt-0.5 text-xs text-muted-foreground">{{ appointment.ownerName || '—' }}</p>
                </td>
                <td class="whitespace-nowrap px-4 py-3 text-muted-foreground">{{ appointment.completedAt ? formatDateTime(appointment.completedAt, checkinTimeOptions) : '—' }}</td>
                <td class="whitespace-nowrap px-4 py-3 text-foreground">{{ appointment.weightKg == null ? '—' : `${appointment.weightKg} kg` }}</td>
                <td class="whitespace-nowrap px-4 py-3 text-foreground">{{ appointment.temperatureC == null ? '—' : `${appointment.temperatureC} °C` }}</td>
                <td class="whitespace-nowrap px-4 py-3 text-foreground">{{ followUpLabel(appointment) }}</td>
                <td class="max-w-64 px-4 py-3 text-muted-foreground"><p class="line-clamp-2 whitespace-pre-wrap">{{ appointment.visitNote || '—' }}</p></td>
                <td class="px-4 py-3 text-muted-foreground">{{ templateName(appointment.templateId) }}</td>
                <td class="px-4 py-3 text-right"><Button type="button" variant="secondary" size="sm" @click="openCompletedVisitEditor(appointment)"><Pencil class="h-3.5 w-3.5" />編輯</Button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
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
