<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { CalendarClock, ChevronLeft, ChevronRight, Pencil, Phone, UserPlus } from '@lucide/vue';
import { http } from '../api/http';
import { useToast } from '../composables/useToast';
import { useAppointmentNotificationsStore } from '../stores/appointmentNotifications';
import { useAppointmentRealtime } from '../composables/useAppointmentRealtime';
import { mergeVisitMessage, visitMessageSenderLabel } from '../lib/visitMessageThread';
import { markMessageAsSent, markMessageSending } from '../lib/sentMessageTracker';
import { isIdentityConfirmed } from '../lib/appointmentTimeline';
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
import VisitMessageThread from '../components/VisitMessageThread.vue';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { DialogDescription, DialogFooter, DialogTitle } from '../components/ui/dialog';
import SegmentedControl from '../components/SegmentedControl.vue';

// 這頁負責所有掛號行政操作（新增／報到／取消／標記未到／編輯／刪除／恢復），
// 並且是當天所有掛號狀態的總覽——包含即時看到醫生在看診頁填的量測／回診資料。
// 發言身分固定，不需要切換——見 CLAUDE.md「身分切換移除」的說明。
const SENDER = 'front_desk';
const toast = useToast();
const notifications = useAppointmentNotificationsStore();

const today = clinicDateInput();
const selectedDate = useSearchQueryParam('date', today);
const isToday = computed(() => selectedDate.value === today);
const viewMode = useSearchQueryParam('view', 'day'); // 'day' | 'week'
if (!['day', 'week'].includes(viewMode.value)) viewMode.value = 'day';

const appointments = ref([]);
const formTemplates = ref([]);
const defaultTemplateId = ref('');
const savingDefaultTemplate = ref(false);
const defaultTemplateDialogOpen = ref(false);
const loading = ref(false);
const error = ref('');
let refreshTimer;

const busyIds = ref(new Set());
const editingCardNumberId = ref(null);
const cardNumberDraft = ref('');
const sendingMessageIds = ref(new Set());

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

// 查看／留言彈窗：候診中是唯讀量測資料＋留言；已完成則量測／回診資料可編輯。
const detailTarget = ref(null);
const detailForm = reactive({ weightKg: '', temperatureC: '', followUpDate: '', followUpTime: '', followUpReason: '' });
const detailSaving = ref(false);
const detailError = ref('');

const checkinTimeOptions = { hour: '2-digit', minute: '2-digit', hour12: false };

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

// 全部狀態一起顯示、依時段排序——這是「當天所有掛號」的總覽，
// 候診中／已完成／已取消／未到都在同一份清單，用狀態欄分辨。上方統計格可以
// 點擊縮小範圍（例如只看候診中），再點一次同一格或點「今日掛號」清除篩選。
const statusFilter = ref('all');
const STATUS_FILTER_VALUES = new Set(['scheduled', 'arrived', 'completed']);
function toggleStatusFilter(value) {
  statusFilter.value = statusFilter.value === value ? 'all' : value;
}
const filteredAppointments = computed(() =>
  STATUS_FILTER_VALUES.has(statusFilter.value)
    ? appointments.value.filter((item) => item.status === statusFilter.value)
    : appointments.value
);
const sortedAppointments = computed(() =>
  [...filteredAppointments.value].sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
);
const hasAnyAppointment = computed(() => appointments.value.length > 0);

const dayStats = computed(() => {
  const items = appointments.value;
  return {
    total: items.length,
    scheduled: items.filter((item) => item.status === 'scheduled').length,
    waiting: items.filter((item) => item.status === 'arrived').length,
    completed: items.filter((item) => item.status === 'completed').length,
  };
});

const STATUS_META = {
  scheduled: { label: '未報到', classes: 'bg-info-surface text-info' },
  arrived: { label: '候診中', classes: 'bg-accent text-accent-foreground' },
  completed: { label: '已完成', classes: 'bg-success-surface text-success' },
  cancelled: { label: '已取消', classes: 'bg-destructive-surface text-destructive' },
  no_show: { label: '未到診', classes: 'bg-muted text-muted-foreground' },
};
function statusMeta(status) {
  return STATUS_META[status] ?? STATUS_META.scheduled;
}

// 週檢視相關
const weekStart = computed(() => startOfWeek(selectedDate.value));
const weekDates = computed(() => Array.from({ length: 7 }, (_, i) => shiftDateInput(weekStart.value, i)));
const weekEnd = computed(() => shiftDateInput(weekStart.value, 6));
const weekRangeLabel = computed(() => `${formatDate(weekStart.value)}–${formatDate(weekEnd.value)}`);
const weekSummary = ref(new Map());
const weekAppointments = ref(new Map());
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
  if (!date) {
    selectedDate.value = today;
    return;
  }
  editingCardNumberId.value = null;
  cardNumberDraft.value = '';
  statusFilter.value = 'all';
  if (mode === 'week') fetchWeekSummary();
  else fetchAppointments();
});

const ROW_ACTIONS_SCHEDULED = [
  { key: 'edit', label: '編輯掛號' },
  { key: 'no_show', label: '標記未到' },
  { key: 'cancel', label: '取消掛號', danger: true },
];
const ROW_ACTIONS_ARRIVED = [
  { key: 'edit', label: '編輯掛號' },
  { key: 'undo_check_in', label: '取消報到', danger: true },
];

function rowActionsFor(appointment) {
  return appointment.status === 'arrived' ? ROW_ACTIONS_ARRIVED : ROW_ACTIONS_SCHEDULED;
}

const actionConfirmation = computed(() => {
  const pending = actionToConfirm.value;
  const petName = pending?.appointment?.petName || '這筆';
  if (pending?.key === 'delete') {
    return { title: '永久刪除這筆掛號？', description: `確定要永久刪除「${petName}」的掛號嗎？刪除後無法復原。`, confirmLabel: '刪除掛號', destructive: true };
  }
  if (pending?.key === 'restore') {
    return { title: '恢復這筆掛號？', description: `確定要將「${petName}」恢復至今日候診流程嗎？`, confirmLabel: '恢復掛號', destructive: false };
  }
  if (pending?.key === 'undo_check_in') {
    return { title: '取消這筆報到？', description: `確定要取消「${petName}」的報到嗎？這筆掛號會回到尚未報到並歸還實體號碼牌；此牌號今天不再配發。`, confirmLabel: '取消報到', destructive: true };
  }
  return { title: '標記為未到診？', description: `確定要將「${petName}」標記為未到診嗎？`, confirmLabel: '標記未到', destructive: true };
});

function isBusy(id) {
  return busyIds.value.has(id);
}
function setBusy(id, busy) {
  const next = new Set(busyIds.value);
  if (busy) next.add(id);
  else next.delete(id);
  busyIds.value = next;
}

function reportApiError(err, fallback) {
  toast.error(err.response?.data?.message || fallback, '操作失敗');
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

function followUpLabel(appointment) {
  if (!appointment.followUpDate) return formatDate(appointment.followUpDate);
  return appointment.followUpTime ? `${formatDate(appointment.followUpDate)} ${appointment.followUpTime}` : formatDate(appointment.followUpDate);
}
function templateName(templateId) {
  return formTemplates.value.find((template) => String(template._id) === String(templateId))?.name ?? '未選擇表單';
}
function followUpTimeMissing(form) {
  return Boolean(form?.followUpDate && !form?.followUpTime);
}

function isSendingMessage(id) {
  return sendingMessageIds.value.has(id);
}
function setSendingMessage(id, sending) {
  const next = new Set(sendingMessageIds.value);
  if (sending) next.add(id);
  else next.delete(id);
  sendingMessageIds.value = next;
}
async function postVisitMessage(appointment, content) {
  const id = appointment._id;
  setSendingMessage(id, true);
  // 送出前就要先佔位：socket 廣播可能比這支 POST 的回應先送達，見 lib/sentMessageTracker.js。
  markMessageSending(id, SENDER, content);
  try {
    const { data } = await http.post(`/appointments/${id}/visit-messages`, { sender: SENDER, content });
    appointment.visitMessages = mergeVisitMessage(appointment.visitMessages ?? [], data);
    markMessageAsSent(data._id);
  } catch (err) {
    reportApiError(err, '留言送出失敗，請稍後再試');
  } finally {
    setSendingMessage(id, false);
  }
}

// 查看／留言彈窗——candidate 是陣列裡的同一個物件參照，socket 更新（醫生按「更新」
// 或發留言）會直接反映在開著的彈窗上，不需要另外處理。
function openDetail(appointment) {
  detailTarget.value = appointment;
  detailError.value = '';
  detailForm.weightKg = appointment.weightKg ?? '';
  detailForm.temperatureC = appointment.temperatureC ?? '';
  detailForm.followUpDate = appointment.followUpDate ?? '';
  detailForm.followUpTime = appointment.followUpTime ?? '';
  detailForm.followUpReason = appointment.followUpReason ?? '';
  notifications.clearAppointment(appointment._id, 'front-desk');
}
async function saveDetailForm() {
  if (!detailTarget.value) return;
  if (followUpTimeMissing(detailForm)) {
    detailError.value = '已選擇回診日期，請一併填寫時間';
    return;
  }
  detailSaving.value = true;
  detailError.value = '';
  try {
    await http.patch(`/appointments/${detailTarget.value._id}/visit-data`, {
      weightKg: detailForm.weightKg === '' ? null : Number(detailForm.weightKg),
      temperatureC: detailForm.temperatureC === '' ? null : Number(detailForm.temperatureC),
      followUpDate: detailForm.followUpDate || '',
      followUpTime: detailForm.followUpTime || '',
      followUpReason: detailForm.followUpReason || '',
    });
    toast.success('已更新看診資料', '儲存完成');
    detailTarget.value = null;
    await fetchAppointments({ silent: true });
  } catch (err) {
    detailError.value = err.response?.data?.message || '看診資料更新失敗';
  } finally {
    detailSaving.value = false;
  }
}

function handleVisitMessage({ appointmentId, message }) {
  const appointment = appointments.value.find((item) => item._id === appointmentId);
  if (!appointment) return;
  appointment.visitMessages = mergeVisitMessage(appointment.visitMessages ?? [], message);
  if (message.sender === SENDER) return;
  toast.info(message.content, `${visitMessageSenderLabel(message.sender)}留言`);
}
function handleAppointmentUpdate(updated) {
  const index = appointments.value.findIndex((item) => item._id === updated._id);
  if (index === -1) {
    appointments.value.push(updated);
    return;
  }
  Object.assign(appointments.value[index], updated);
}
useAppointmentRealtime(selectedDate, { onMessage: handleVisitMessage, onAppointmentUpdate: handleAppointmentUpdate });

onMounted(() => {
  fetchFormChoices();
  if (viewMode.value === 'week') fetchWeekSummary();
  else fetchAppointments();
  refreshTimer = setInterval(() => {
    if (viewMode.value === 'week') fetchWeekSummary();
    else if (isToday.value) fetchAppointments({ silent: true });
  }, 60_000);
});
onBeforeUnmount(() => {
  clearInterval(refreshTimer);
});
</script>

<template>
  <section class="mx-auto max-w-7xl space-y-4">
    <PageHeader title="櫃台" description="掛號、報到與當天所有狀態總覽，可即時看到醫生填寫的看診資料並回覆留言。">
      <template #actions>
        <Button type="button" @click="newAppointmentOpen = true"><UserPlus class="h-4 w-4" stroke-width="1.75" />掛號</Button>
      </template>
    </PageHeader>

    <Card class="overflow-hidden p-0 shadow-sm dark:shadow-none">
      <div class="grid gap-3 p-3 sm:p-4 lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-center">
        <div class="w-full">
          <SegmentedControl
            v-model="viewMode"
            :options="[
              { value: 'day', label: '單日', tabId: 'front-desk-day-tab', panelId: 'front-desk-day-panel' },
              { value: 'week', label: '本週', tabId: 'front-desk-week-tab', panelId: 'front-desk-week-panel' },
            ]"
            aria-label="櫃台檢視模式"
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
            <Button type="button" variant="secondary" size="icon-sm" aria-label="設定掛號預設表單" title="設定掛號預設表單" @click="defaultTemplateDialogOpen = true"><CalendarClock class="h-4 w-4" stroke-width="1.75" /></Button>
          </div>
          <div class="flex w-full items-center gap-1 rounded-xl bg-muted/60 p-1 sm:w-auto">
            <Button type="button" variant="secondary" size="icon-sm" :aria-label="viewMode === 'week' ? '上一週' : '前一天'" @click="selectedDate = shiftDateInput(selectedDate, viewMode === 'week' ? -7 : -1)">
              <ChevronLeft class="h-4 w-4" stroke-width="1.75" />
            </Button>
            <DatePicker v-model="selectedDate" :clearable="false" class="min-w-0 flex-1 sm:w-40" aria-label="選擇要查看的日期" />
            <Button type="button" variant="secondary" size="icon-sm" :aria-label="viewMode === 'week' ? '下一週' : '後一天'" @click="selectedDate = shiftDateInput(selectedDate, viewMode === 'week' ? 7 : 1)">
              <ChevronRight class="h-4 w-4" stroke-width="1.75" />
            </Button>
          </div>
        </div>
      </div>

      <dl v-if="viewMode === 'day'" class="grid grid-cols-4 border-t border-border bg-field/30" :aria-busy="loading || undefined">
        <button
          type="button"
          class="flex min-w-0 flex-col items-center justify-center gap-0.5 px-1.5 py-2.5 transition-colors sm:flex-row sm:gap-2.5 sm:px-3 [&:not(:last-child)]:border-r [&:not(:last-child)]:border-border hover:bg-accent/40"
          :class="statusFilter === 'all' ? 'bg-accent text-accent-foreground' : ''"
          :aria-pressed="statusFilter === 'all'"
          @click="statusFilter = 'all'"
        >
          <dt class="truncate text-xs font-medium" :class="statusFilter === 'all' ? 'text-accent-foreground' : 'text-muted-foreground'">今日掛號</dt>
          <dd class="text-lg font-bold leading-none tabular-nums" :class="statusFilter === 'all' ? 'text-accent-foreground' : 'text-foreground'">{{ loading || error ? '—' : dayStats.total }}</dd>
        </button>
        <button
          type="button"
          class="flex min-w-0 flex-col items-center justify-center gap-0.5 px-1.5 py-2.5 transition-colors sm:flex-row sm:gap-2.5 sm:px-3 [&:not(:last-child)]:border-r [&:not(:last-child)]:border-border hover:bg-accent/40"
          :class="statusFilter === 'scheduled' ? 'bg-accent text-accent-foreground' : ''"
          :aria-pressed="statusFilter === 'scheduled'"
          @click="toggleStatusFilter('scheduled')"
        >
          <dt class="truncate text-xs font-medium" :class="statusFilter === 'scheduled' ? 'text-accent-foreground' : 'text-muted-foreground'">待報到</dt>
          <dd class="text-lg font-bold leading-none tabular-nums" :class="statusFilter === 'scheduled' ? 'text-accent-foreground' : 'text-foreground'">{{ loading || error ? '—' : dayStats.scheduled }}</dd>
        </button>
        <button
          type="button"
          class="flex min-w-0 flex-col items-center justify-center gap-0.5 px-1.5 py-2.5 transition-colors sm:flex-row sm:gap-2.5 sm:px-3 [&:not(:last-child)]:border-r [&:not(:last-child)]:border-border hover:bg-accent/40"
          :class="statusFilter === 'arrived' ? 'bg-accent text-accent-foreground' : ''"
          :aria-pressed="statusFilter === 'arrived'"
          @click="toggleStatusFilter('arrived')"
        >
          <dt class="truncate text-xs font-medium" :class="statusFilter === 'arrived' ? 'text-accent-foreground' : 'text-muted-foreground'">候診中</dt>
          <dd class="text-lg font-bold leading-none tabular-nums" :class="statusFilter === 'arrived' ? 'text-accent-foreground' : 'text-foreground'">{{ loading || error ? '—' : dayStats.waiting }}</dd>
        </button>
        <button
          type="button"
          class="flex min-w-0 flex-col items-center justify-center gap-0.5 px-1.5 py-2.5 transition-colors sm:flex-row sm:gap-2.5 sm:px-3 hover:bg-accent/40"
          :class="statusFilter === 'completed' ? 'bg-accent text-accent-foreground' : ''"
          :aria-pressed="statusFilter === 'completed'"
          @click="toggleStatusFilter('completed')"
        >
          <dt class="truncate text-xs font-medium" :class="statusFilter === 'completed' ? 'text-accent-foreground' : 'text-muted-foreground'">已完成</dt>
          <dd class="text-lg font-bold leading-none tabular-nums" :class="statusFilter === 'completed' ? 'text-accent-foreground' : 'text-foreground'">{{ loading || error ? '—' : dayStats.completed }}</dd>
        </button>
      </dl>
      <div v-else class="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-field/30 px-3 py-2.5 sm:px-4">
        <p class="text-xs font-medium text-muted-foreground">{{ weekRangeLabel }}</p>
        <p class="text-xs text-muted-foreground">本週共 <span class="font-bold tabular-nums text-foreground">{{ weekTotal }}</span> 筆掛號<template v-if="weekSummaryLoading"> · 更新中…</template></p>
      </div>
    </Card>

    <ListSkeleton v-if="viewMode === 'day' && loading" :rows="5" />
    <Alert v-else-if="viewMode === 'day' && error" variant="destructive">
      <AlertDescription class="flex items-center justify-between gap-3">
        <span>{{ error }}</span>
        <Button type="button" variant="outline" size="sm" class="shrink-0" @click="fetchAppointments">重新載入</Button>
      </AlertDescription>
    </Alert>

    <template v-else>
      <!-- ── 單日檢視：一張表格顯示當天所有狀態 ── -->
      <div v-if="viewMode === 'day'" id="front-desk-day-panel" role="tabpanel" aria-labelledby="front-desk-day-tab">
        <EmptyState v-if="!hasAnyAppointment" :icon="UserPlus" :title="isToday ? '今天還沒有任何掛號' : `${formatDate(selectedDate)} 沒有任何掛號`" description="選擇「掛號」開始。" />
        <EmptyState v-else-if="!sortedAppointments.length" :icon="UserPlus" title="這個篩選條件下沒有掛號" description="點一次上方統計格可以清除篩選，看回所有狀態。" />

        <template v-else>
          <!-- 桌機：資料表 -->
          <Card class="hidden overflow-hidden p-0 shadow-sm xl:block dark:shadow-none" style="--data-columns: 6rem minmax(9rem, 1fr) 6.5rem minmax(8rem, 0.9fr) minmax(8rem, 0.9fr) 12rem">
            <div class="desktop-data-header">
              <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">時間／牌號</span>
              <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">病患</span>
              <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">狀態</span>
              <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">量測</span>
              <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">回診</span>
              <span class="desktop-data-cell"><span class="sr-only">操作</span></span>
            </div>
            <div v-for="appointment in sortedAppointments" :key="appointment._id" class="desktop-data-row">
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
              <span class="desktop-data-cell"><span class="inline-flex h-6.5 items-center rounded-md px-2 text-xs font-semibold" :class="statusMeta(appointment.status).classes">{{ statusMeta(appointment.status).label }}</span></span>
              <span class="desktop-data-cell truncate" :class="appointment.weightKg == null && appointment.temperatureC == null ? 'text-muted-foreground' : 'text-foreground'">
                <template v-if="['arrived', 'completed'].includes(appointment.status)">{{ appointment.weightKg == null ? '—' : `${appointment.weightKg}kg` }}／{{ appointment.temperatureC == null ? '—' : `${appointment.temperatureC}°C` }}</template>
                <template v-else>—</template>
              </span>
              <span class="desktop-data-cell truncate text-muted-foreground">{{ ['arrived', 'completed'].includes(appointment.status) ? followUpLabel(appointment) : '—' }}</span>
              <span class="desktop-data-cell flex items-center justify-end gap-1.5">
                <template v-if="appointment.status === 'scheduled'">
                  <Button type="button" size="xs" :disabled="isBusy(appointment._id)" @click="checkIn(appointment)">報到</Button>
                  <RowActions :actions="rowActionsFor(appointment)" :label="`${appointment.petName || '這筆掛號'}的更多操作`" @select="(key) => requestRowAction(appointment, key)" />
                </template>
                <template v-else-if="['arrived', 'completed'].includes(appointment.status)">
                  <Button type="button" variant="secondary" size="xs" class="relative" @click="openDetail(appointment)">
                    <Pencil class="h-3.5 w-3.5" />{{ appointment.status === 'completed' ? '留言／編輯' : '查看／留言' }}
                    <span v-if="notifications.isUnread(appointment._id, 'front-desk')" class="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-card" aria-label="有新留言" />
                  </Button>
                  <RowActions v-if="appointment.status === 'arrived'" :actions="rowActionsFor(appointment)" :label="`${appointment.petName || '這筆掛號'}的更多操作`" @select="(key) => requestRowAction(appointment, key)" />
                </template>
                <template v-else>
                  <Button type="button" variant="outline" size="xs" :disabled="isBusy(appointment._id)" @click="actionToConfirm = { appointment, key: 'restore' }">恢復</Button>
                  <Button type="button" variant="destructive" size="xs" :disabled="isBusy(appointment._id)" @click="actionToConfirm = { appointment, key: 'delete' }">刪除</Button>
                </template>
              </span>
            </div>
          </Card>

          <!-- 手機：卡片 -->
          <div class="space-y-3 xl:hidden">
            <Card v-for="appointment in sortedAppointments" :key="appointment._id" class="gap-2 p-4 shadow-sm dark:shadow-none">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <router-link v-if="appointment.petId" :to="`/pets/${appointment.petId}`" class="block truncate font-semibold text-primary">{{ appointment.petName || '—' }}</router-link>
                  <p v-else class="truncate font-semibold text-foreground">{{ appointment.petName || '—' }}</p>
                  <p class="truncate text-xs text-muted-foreground">{{ appointment.ownerName || '—' }}<template v-if="appointment.ownerPhone"> · {{ appointment.ownerPhone }}</template></p>
                </div>
                <span class="shrink-0 text-xs tabular-nums text-muted-foreground">{{ appointment.status === 'arrived' ? `${appointment.checkinNumber} 號` : (appointment.time || formatDateTime(appointment.scheduledAt, checkinTimeOptions, '—')) }}</span>
              </div>
              <span class="inline-flex h-6.5 w-fit items-center rounded-md px-2 text-xs font-semibold" :class="statusMeta(appointment.status).classes">{{ statusMeta(appointment.status).label }}</span>
              <p v-if="['arrived', 'completed'].includes(appointment.status)" class="text-sm text-foreground">
                {{ appointment.weightKg == null ? '—' : `${appointment.weightKg} kg` }} ・ {{ appointment.temperatureC == null ? '—' : `${appointment.temperatureC} °C` }} ・ 回診：{{ followUpLabel(appointment) }}
              </p>
              <div class="flex flex-wrap gap-1.5">
                <template v-if="appointment.status === 'scheduled'">
                  <Button type="button" size="sm" class="flex-1" :disabled="isBusy(appointment._id)" @click="checkIn(appointment)">報到</Button>
                  <RowActions :actions="rowActionsFor(appointment)" :label="`${appointment.petName || '這筆掛號'}的更多操作`" @select="(key) => requestRowAction(appointment, key)" />
                </template>
                <template v-else-if="['arrived', 'completed'].includes(appointment.status)">
                  <Button type="button" variant="secondary" size="sm" class="relative flex-1" @click="openDetail(appointment)">
                    <Pencil class="h-3.5 w-3.5" />{{ appointment.status === 'completed' ? '留言／編輯' : '查看／留言' }}
                    <span v-if="notifications.isUnread(appointment._id, 'front-desk')" class="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-card" aria-label="有新留言" />
                  </Button>
                  <RowActions v-if="appointment.status === 'arrived'" :actions="rowActionsFor(appointment)" :label="`${appointment.petName || '這筆掛號'}的更多操作`" @select="(key) => requestRowAction(appointment, key)" />
                </template>
                <template v-else>
                  <Button type="button" variant="outline" size="sm" class="flex-1" :disabled="isBusy(appointment._id)" @click="actionToConfirm = { appointment, key: 'restore' }">恢復</Button>
                  <Button type="button" variant="destructive" size="sm" :disabled="isBusy(appointment._id)" @click="actionToConfirm = { appointment, key: 'delete' }">刪除</Button>
                </template>
              </div>
            </Card>
          </div>
        </template>
      </div>

      <!-- ── 週檢視 ── -->
      <div v-if="viewMode === 'week'" id="front-desk-week-panel" role="tabpanel" aria-labelledby="front-desk-week-tab">
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
                :class="date === selectedDate ? 'border-primary bg-card text-foreground shadow-sm' : date === today ? 'border-primary/50 bg-accent/40 text-foreground hover:bg-accent/70' : 'border-border/70 bg-card text-foreground hover:border-primary/30 hover:bg-field/50'"
              >
                <span class="text-xs font-medium" :class="date === selectedDate || date === today ? 'text-primary' : 'text-muted-foreground'">{{ weekdayLabel(date) }}</span>
                <span class="text-sm font-bold" :class="date === today ? 'text-primary' : 'text-foreground'">{{ date.split('-')[2] }}</span>
                <span class="text-xs" :class="date === selectedDate || date === today ? 'font-medium text-primary' : 'text-muted-foreground'">{{ weekSummary.get(date) ?? 0 }} 筆</span>
                <div class="mt-2 w-full space-y-1 border-t border-border/60 pt-2 text-left">
                  <p v-if="!(weekAppointments.get(date) ?? []).length" class="py-3 text-center text-xs text-muted-foreground">當天沒有掛號</p>
                  <button v-for="appointment in (weekAppointments.get(date) ?? [])" :key="appointment._id" type="button" class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-field/60" @click="selectedDate = date; viewMode = 'day'">
                    <span class="w-10 shrink-0 font-medium tabular-nums text-muted-foreground">{{ appointment.time || formatDateTime(appointment.scheduledAt, checkinTimeOptions, '—') }}</span>
                    <span class="min-w-0 flex-1 truncate font-medium text-foreground">{{ appointment.petName || '—' }}</span>
                    <span class="shrink-0 rounded-full px-1.5 py-0.5 text-xs" :class="statusMeta(appointment.status).classes">{{ statusMeta(appointment.status).label }}</span>
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

    <ModalDialog v-if="detailTarget" @close="!detailSaving && (detailTarget = null)">
      <div class="p-6 pb-3 sm:p-7 sm:pb-3">
        <DialogTitle>{{ detailTarget.petName || '這筆掛號' }}</DialogTitle>
        <DialogDescription class="mt-1">
          {{ detailTarget.status === 'completed' ? '看診已完成，量測／回診資料可在此校正；下方是與醫生的留言。' : '醫生正在填寫的看診資料（唯讀，隨醫生更新即時反映）；下方可留言給醫生。' }}
        </DialogDescription>
      </div>
      <form v-if="detailTarget.status === 'completed'" class="flex flex-col" @submit.prevent="saveDetailForm">
        <div class="space-y-4 p-6 pt-2 sm:p-7 sm:pt-2">
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="space-y-1.5 text-sm font-medium text-foreground">體重（kg）<input v-model="detailForm.weightKg" type="text" class="h-11 w-full rounded-lg border border-input bg-field px-3 text-sm font-normal text-foreground" /></label>
            <label class="space-y-1.5 text-sm font-medium text-foreground">體溫（°C）<input v-model="detailForm.temperatureC" type="text" class="h-11 w-full rounded-lg border border-input bg-field px-3 text-sm font-normal text-foreground" /></label>
          </div>
          <label class="block space-y-1.5 text-sm font-medium text-foreground">
            回診日期
            <div class="flex gap-2">
              <DatePicker v-model="detailForm.followUpDate" placeholder="選擇回診日期" aria-label="選擇回診日期" class="flex-1" />
              <TimePicker v-model="detailForm.followUpTime" placeholder="時間" aria-label="選擇回診時間" :disabled="!detailForm.followUpDate" class="w-32 shrink-0" />
            </div>
            <span v-if="followUpTimeMissing(detailForm)" class="block text-xs font-medium text-destructive">已選擇日期，請一併填寫時間</span>
          </label>
          <label class="block space-y-1.5 text-sm font-medium text-foreground">
            回診原因
            <input v-model="detailForm.followUpReason" type="text" placeholder="例：拆線、追蹤肝指數" class="h-11 w-full rounded-lg border border-input bg-field px-3 text-sm font-normal text-foreground" />
          </label>
          <Alert v-if="detailError" variant="destructive"><AlertDescription>{{ detailError }}</AlertDescription></Alert>
          <div class="border-t border-border pt-4">
            <VisitMessageThread :messages="detailTarget.visitMessages || []" identity="front_desk" :sending="isSendingMessage(detailTarget._id)" @send="(content) => postVisitMessage(detailTarget, content)" />
          </div>
        </div>
        <DialogFooter><Button type="button" variant="outline" :disabled="detailSaving" @click="detailTarget = null">關閉</Button><Button type="submit" :disabled="detailSaving || followUpTimeMissing(detailForm)">{{ detailSaving ? '儲存中…' : '儲存變更' }}</Button></DialogFooter>
      </form>
      <div v-else class="space-y-4 p-6 pt-2 sm:p-7 sm:pt-2">
        <dl class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div><dt class="text-xs text-muted-foreground">體重</dt><dd class="font-medium text-foreground">{{ detailTarget.weightKg == null ? '—' : `${detailTarget.weightKg} kg` }}</dd></div>
          <div><dt class="text-xs text-muted-foreground">體溫</dt><dd class="font-medium text-foreground">{{ detailTarget.temperatureC == null ? '—' : `${detailTarget.temperatureC} °C` }}</dd></div>
          <div><dt class="text-xs text-muted-foreground">回診</dt><dd class="font-medium text-foreground">{{ followUpLabel(detailTarget) }}</dd></div>
        </dl>
        <div class="border-t border-border pt-4">
          <VisitMessageThread :messages="detailTarget.visitMessages || []" identity="front_desk" :sending="isSendingMessage(detailTarget._id)" @send="(content) => postVisitMessage(detailTarget, content)" />
        </div>
      </div>
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
