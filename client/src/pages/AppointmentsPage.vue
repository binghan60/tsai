<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { CalendarX2, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Lock, Pencil, Phone, Plus, User, UserPlus, UserX } from '@lucide/vue';
import { http } from '../api/http';
import { useToast } from '../composables/useToast';
import {
  SESSIONS,
  SURGERY_BLOCK,
  assignSessionIndex,
  groupBySession,
  isIdentityConfirmed,
  nowIndexInSession,
  splitAppointmentsByQueueState,
} from '../lib/appointmentTimeline';
import { clinicDateInput, formatDate, formatDateTime, shiftDateInput, weekdayLabel } from '../lib/datetime';
import { useSearchQueryParam } from '../composables/useSearchQueryParam';
import { DatePicker } from '../components/ui/date-picker';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import ListSkeleton from '../components/ListSkeleton.vue';
import RowActions from '../components/RowActions.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import NewAppointmentDialog from '../components/NewAppointmentDialog.vue';
import EditAppointmentDialog from '../components/EditAppointmentDialog.vue';
import CancelAppointmentDialog from '../components/CancelAppointmentDialog.vue';
import CheckInDialog from '../components/CheckInDialog.vue';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription } from '../components/ui/alert';

const router = useRouter();
const toast = useToast();

// 看哪一天。同步進網址（?date=），等於今天時參數會被省略——
// 這樣返回、重整、把網址貼給別人都還在同一天上，跟其他列表頁的做法一致。
const today = clinicDateInput();
const selectedDate = useSearchQueryParam('date', today);
const isToday = computed(() => selectedDate.value === today);

const appointments = ref([]);
const loading = ref(false);
const error = ref('');
const now = ref(new Date());
let nowTimer;
let refreshTimer;

const expandedIds = ref(new Set());
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

const ROW_ACTIONS = [
  { key: 'edit', label: '編輯掛號' },
  { key: 'no_show', label: '標記未到' },
  { key: 'cancel', label: '取消掛號', danger: true },
];

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

watch(selectedDate, (value) => {
  // DatePicker 的清除鈕會送出空字串，但這頁一定得停在某一天。
  if (!value) {
    selectedDate.value = today;
    return;
  }
  expandedIds.value = new Set();
  fetchAppointments();
});

const appointmentGroups = computed(() => splitAppointmentsByQueueState(appointments.value));
// 候診佇列＝已報到還沒看完的人，由上而下就是看診順序。清單長度是「往後排」的上限。
const waitingQueue = computed(() => appointmentGroups.value.waiting);
// 時間軸只剩還沒報到的人，它的軸就純粹是時間。
const upcomingAppointments = computed(() => appointmentGroups.value.scheduled);
const hasAnyAppointment = computed(() => appointments.value.length > 0);
const closedGroups = computed(() => [
  { key: 'cancelled', label: '已取消', icon: CalendarX2, items: appointmentGroups.value.cancelled },
  { key: 'no_show', label: '未到', icon: UserX, items: appointmentGroups.value.noShow },
].filter((group) => group.items.length));
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
      description: `確定要取消「${petName}」的報到嗎？這筆掛號會回到尚未報到，並清除目前的看診序號。`,
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
const sessionGroups = computed(() => groupBySession(upcomingAppointments.value, SESSIONS));
const nowSessionIndex = computed(() => assignSessionIndex(now.value.getHours() * 60 + now.value.getMinutes(), SESSIONS));
const nowLabel = computed(() =>
  `${String(now.value.getHours()).padStart(2, '0')}:${String(now.value.getMinutes()).padStart(2, '0')}`
);
const checkinTimeOptions = { hour: '2-digit', minute: '2-digit', hour12: false };

function isExpanded(id) {
  return expandedIds.value.has(id);
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
        visitNote: appointment.visitNote ?? '',
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
    toast.success('已加入今日掛號', '新增成功');
    newAppointmentOpen.value = false;
    await fetchAppointments({ silent: true });
  } catch (err) {
    newAppointmentError.value = err.response?.data?.message || '掛號失敗，請稍後再試';
  } finally {
    newAppointmentSubmitting.value = false;
  }
}

async function completeVisit(appointment) {
  const draft = simpleForms[appointment._id] || {};
  setBusy(appointment._id, true);
  try {
    const { data } = await http.post(`/appointments/${appointment._id}/complete`, {
      weightKg: draft.weightKg === '' || draft.weightKg == null ? null : Number(draft.weightKg),
      temperatureC: draft.temperatureC === '' || draft.temperatureC == null ? null : Number(draft.temperatureC),
      visitNote: draft.visitNote || '',
    });
    await router.push(`/pets/${data.petId}/records/new?fromAppointment=${data._id}`);
  } catch (err) {
    reportApiError(err, '完成看診失敗，請稍後再試');
    setBusy(appointment._id, false);
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
  fetchAppointments();
  nowTimer = setInterval(() => {
    now.value = new Date();
  }, 30_000);
  // 只有今天的清單會自己變動（有人報到、看完診）；停在別天時不必一直重抓。
  refreshTimer = setInterval(() => {
    if (isToday.value) fetchAppointments({ silent: true });
  }, 60_000);
});
onBeforeUnmount(() => {
  clearInterval(nowTimer);
  clearInterval(refreshTimer);
});
</script>

<template>
  <section class="mx-auto max-w-7xl space-y-5">
    <PageHeader title="掛號" description="依門診時段掌握報到順序，候診中可直接完成量測與看診。">
      <template #actions>
        <Button type="button" @click="newAppointmentOpen = true"><UserPlus class="h-4 w-4" stroke-width="1.75" />掛號</Button>
      </template>
    </PageHeader>

    <!-- ── 日期面板 ──
         看的是哪一天由這裡決定，時間軸與候診佇列都跟著它走。 -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <Button type="button" variant="secondary" size="icon-sm" aria-label="前一天" @click="selectedDate = shiftDateInput(selectedDate, -1)">
          <ChevronLeft class="h-4 w-4" stroke-width="1.75" />
        </Button>
        <DatePicker v-model="selectedDate" :clearable="false" class="w-40" aria-label="選擇要查看的日期" />
        <Button type="button" variant="secondary" size="icon-sm" aria-label="後一天" @click="selectedDate = shiftDateInput(selectedDate, 1)">
          <ChevronRight class="h-4 w-4" stroke-width="1.75" />
        </Button>
        <span class="text-sm font-medium" :class="isToday ? 'text-primary' : 'text-muted-foreground'">
          {{ weekdayLabel(selectedDate) }}<template v-if="isToday"> · 今天</template>
        </span>
      </div>
      <Button v-if="!isToday" type="button" variant="secondary" size="sm" @click="selectedDate = today">回到今天</Button>
    </div>

    <ListSkeleton v-if="loading" :rows="4" />
    <Alert v-else-if="error" variant="destructive">
      <AlertDescription class="flex items-center justify-between gap-3">
        <span>{{ error }}</span>
        <Button type="button" variant="outline" size="sm" class="shrink-0" @click="fetchAppointments">重新載入</Button>
      </AlertDescription>
    </Alert>

    <template v-else>
      <!-- ── 候診佇列 ──
           報到之後預約時間就不再決定任何事，人已經在診所裡；決定誰先看的是這份順序。
           所以候診中的人從時間軸抽出來自成一區：這份清單由上而下就是看診順序，
           上下鍵移動的意思才不會跟時間軸的「幾點」混在一起。 -->
      <Card v-if="waitingQueue.length" class="overflow-hidden p-0">
        <div class="flex items-start justify-between gap-3 p-5 pb-3">
          <div>
            <h2 class="text-base font-semibold text-foreground">候診中</h2>
            <p class="mt-0.5 text-xs text-muted-foreground">依報到先後排；看完診離開後，後面的人往前遞補</p>
          </div>
          <span class="inline-flex h-6.5 min-w-6.5 shrink-0 items-center justify-center rounded-full bg-accent px-2 text-xs font-semibold text-accent-foreground">{{ waitingQueue.length }}</span>
        </div>

        <ul class="divide-y divide-border border-t border-border">
          <li v-for="appointment in waitingQueue" :key="appointment._id" class="px-5 py-3.5">
            <div class="flex flex-wrap items-center gap-3.5">
              <span
                class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-base font-bold tabular-nums text-accent-foreground"
                :aria-label="`目前排第 ${appointment.checkinNumber} 位`"
              >{{ appointment.checkinNumber }}</span>

              <span
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                :class="isIdentityConfirmed(appointment) ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'"
              >
                <User class="h-4.5 w-4.5" stroke-width="1.75" />
              </span>

              <div class="min-w-0 flex-1">
                <span class="block truncate text-sm font-semibold text-foreground">{{ appointment.petName || '寵物姓名未填' }}</span>
                <span class="flex items-center gap-1 truncate text-xs text-muted-foreground">
                  {{ appointment.ownerName || '飼主未填' }}
                  <template v-if="appointment.ownerPhone">
                    <span class="text-border">·</span>
                    <Phone class="h-3 w-3 shrink-0" stroke-width="1.75" />{{ appointment.ownerPhone }}
                  </template>
                  <template v-if="appointment.checkedInAt">
                    <span class="text-border">·</span>
                    <Clock class="h-3 w-3 shrink-0" stroke-width="1.75" />報到 {{ formatDateTime(appointment.checkedInAt, checkinTimeOptions) }}
                  </template>
                </span>
              </div>

              <div class="flex shrink-0 items-center gap-1.5">
                <Button type="button" variant="destructive" size="sm" :disabled="isBusy(appointment._id)" @click="actionToConfirm = { appointment, key: 'undo_check_in' }">
                  取消報到
                </Button>
                <Button type="button" variant="secondary" size="icon-sm" :aria-label="`編輯 ${appointment.petName || '這筆'} 的掛號`" @click="editTarget = appointment">
                  <Pencil class="h-4 w-4" stroke-width="1.75" />
                </Button>
                <Button type="button" variant="secondary" size="icon-sm" :aria-label="isExpanded(appointment._id) ? '收合' : '展開量測與完成看診'" @click="toggleExpanded(appointment)">
                  <component :is="isExpanded(appointment._id) ? ChevronUp : ChevronDown" class="h-4 w-4" stroke-width="1.75" />
                </Button>
              </div>
            </div>

            <div v-if="isExpanded(appointment._id)" class="mt-3.5 space-y-3.5 border-t border-border pt-3.5">
              <div class="grid gap-3.5 sm:grid-cols-2">
                <label class="space-y-1.5 text-xs font-medium text-foreground">
                  體重
                  <div class="relative">
                    <input v-model="simpleForms[appointment._id].weightKg" type="number" min="0" step="0.1" class="h-10 w-full rounded-lg border border-input bg-card px-3 pr-10 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
                    <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">kg</span>
                  </div>
                </label>
                <label class="space-y-1.5 text-xs font-medium text-foreground">
                  體溫
                  <div class="relative">
                    <input v-model="simpleForms[appointment._id].temperatureC" type="number" min="0" step="0.1" class="h-10 w-full rounded-lg border border-input bg-card px-3 pr-10 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
                    <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">°C</span>
                  </div>
                </label>
              </div>
              <label class="block space-y-1.5 text-xs font-medium text-foreground">
                備註
                <textarea v-model="simpleForms[appointment._id].visitNote" rows="2" class="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"></textarea>
                <span class="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                  <Lock class="h-3.5 w-3.5 shrink-0" stroke-width="1.75" />僅供內部使用（藥品／費用等），不會出現在健檢報告中
                </span>
              </label>
              <div class="flex justify-end">
                <Button type="button" size="sm" :disabled="isBusy(appointment._id)" @click="completeVisit(appointment)">
                  <Check class="h-4 w-4" stroke-width="2" />完成看診
                </Button>
              </div>
            </div>
          </li>
        </ul>
      </Card>

      <Card class="overflow-hidden p-0">
        <div class="flex items-start justify-between gap-3 p-5 pb-3">
          <div>
            <h2 class="text-base font-semibold text-foreground">{{ isToday ? '今日看診時間軸' : '看診時間軸' }}</h2>
            <p class="mt-0.5 text-xs text-muted-foreground">尚未報到的掛號，依預約時段排列</p>
          </div>
          <span class="inline-flex h-6.5 min-w-6.5 shrink-0 items-center justify-center rounded-full bg-muted px-2 text-xs font-semibold text-foreground">{{ upcomingAppointments.length }}</span>
        </div>

        <EmptyState
          v-if="!hasAnyAppointment"
          inset
          :icon="UserPlus"
          :title="isToday ? '今天還沒有任何掛號' : `${formatDate(selectedDate)} 沒有任何掛號`"
          description="按右上角「掛號」開始。"
        />

        <div v-else class="px-5 pb-5">
          <!-- 時間軸空掉不代表今天沒事——人可能都報到了，也可能都取消了。
               這兩種情況下面的「已取消／未到」仍要看得到，所以空訊息只換掉時段清單。 -->
          <p v-if="!upcomingAppointments.length" class="rounded-xl border border-dashed border-border bg-muted px-3.5 py-4 text-center text-sm text-muted-foreground">
            沒有等待報到的掛號，{{ isToday ? '今天' : formatDate(selectedDate) }}的掛號都已經報到或結束了。
          </p>

          <template v-else>
          <template v-for="(group, groupIndex) in sessionGroups" :key="group.session.id">
            <div v-if="groupIndex === 1" class="my-2 flex items-center gap-2 rounded-xl border border-dashed border-border bg-muted px-3.5 py-3 text-sm font-medium text-muted-foreground">
              <Plus class="h-4 w-4 shrink-0" stroke-width="1.75" />
              {{ SURGERY_BLOCK.label }} · {{ SURGERY_BLOCK.start }}–{{ SURGERY_BLOCK.end }}（不排診）
            </div>

            <div class="flex items-center gap-2 py-2.5 text-sm font-bold text-foreground">
              <Clock class="h-4 w-4 text-muted-foreground" stroke-width="1.75" />
              {{ group.session.label }} · {{ group.session.start }}–{{ group.session.end }}
            </div>

            <div class="border-l-2 border-border pl-4 sm:ml-28 sm:pl-7">
              <template v-for="(appointment, itemIndex) in group.items" :key="appointment._id">
                <div
                  v-if="isToday && groupIndex === nowSessionIndex && itemIndex === nowIndexInSession(group.items, now)"
                  class="my-1 flex items-center gap-2.5"
                >
                  <span class="h-0 flex-1 border-t-2 border-dashed border-primary"></span>
                  <span class="shrink-0 rounded-full bg-primary px-3 py-0.5 text-xs font-bold text-primary-foreground">現在 · {{ nowLabel }}</span>
                </div>

                <div class="relative py-2.5">
                  <span class="mb-1.5 block text-xs font-semibold text-muted-foreground sm:absolute sm:left-[-46px] sm:top-4 sm:mb-0 sm:w-18 sm:-translate-x-full sm:text-right sm:text-sm">
                    {{ new Date(appointment.scheduledAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }) }}
                  </span>
                  <span class="absolute left-[-17px] top-6 h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 border-dashed border-muted-foreground bg-card sm:left-[-30px] sm:top-5.5"></span>

                  <div>
                    <div class="flex flex-wrap items-center gap-3.5">
                      <!-- 時間軸上只會有還沒報到的列；看診序號要報到之後才配。 -->
                      <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-border text-muted-foreground">
                        <Clock class="h-4.5 w-4.5" stroke-width="1.75" />
                      </div>

                      <span
                        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                        :class="isIdentityConfirmed(appointment) ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'"
                      >
                        <User class="h-4.5 w-4.5" stroke-width="1.75" />
                      </span>

                      <div class="min-w-0 flex-1">
                        <span
                          class="block truncate text-sm font-semibold text-foreground"
                        >{{ appointment.petName || '寵物姓名未填' }}</span>
                        <span class="flex items-center gap-1 truncate text-xs text-muted-foreground">
                          {{ appointment.ownerName || '飼主未填' }}
                          <template v-if="appointment.ownerPhone">
                            <span class="text-border">·</span>
                            <Phone class="h-3 w-3 shrink-0" stroke-width="1.75" />{{ appointment.ownerPhone }}
                          </template>
                        </span>
                      </div>

                      <div class="ml-auto flex shrink-0 items-center gap-1.5 max-sm:w-full max-sm:justify-end">
                        <Button type="button" size="sm" :disabled="isBusy(appointment._id)" @click="checkIn(appointment)">報到</Button>
                        <RowActions :actions="ROW_ACTIONS" :label="`${appointment.petName || '這筆掛號'}的更多操作`" @select="(key) => requestRowAction(appointment, key)" />
                      </div>
                    </div>
                  </div>
                </div>
              </template>

              <!-- 「現在」晚於這個時段全部項目時，指示線要落在最後面，不是插在某一列前面。 -->
              <div
                v-if="isToday && groupIndex === nowSessionIndex && nowIndexInSession(group.items, now) === group.items.length"
                class="my-1 flex items-center gap-2.5"
              >
                <span class="h-0 flex-1 border-t-2 border-dashed border-primary"></span>
                <span class="shrink-0 rounded-full bg-primary px-3 py-0.5 text-xs font-bold text-primary-foreground">現在 · {{ nowLabel }}</span>
              </div>
            </div>
          </template>
          </template>

          <div v-if="closedGroups.length" class="mt-4 grid gap-3 sm:grid-cols-2">
            <section v-for="group in closedGroups" :key="group.key" class="min-w-0 rounded-xl bg-muted/50 p-3">
              <div class="mb-2 flex items-center justify-between gap-3">
                <h3 class="text-sm font-semibold text-foreground">{{ group.label }}</h3>
                <span class="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-card px-2 text-xs font-semibold tabular-nums text-foreground">{{ group.items.length }}</span>
              </div>
              <div class="space-y-2">
                <article
                  v-for="appointment in group.items"
                  :key="appointment._id"
                  class="grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg bg-card px-3 py-2.5"
                >
                  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <component :is="group.icon" class="h-4.5 w-4.5" stroke-width="1.75" />
                  </span>
                  <div class="min-w-0">
                    <p class="truncate text-sm font-semibold text-foreground">{{ appointment.petName || '寵物姓名未填' }}</p>
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
                        :title="appointment.cancelReason ? `取消原因：${appointment.cancelReason}` : '未填寫取消原因'"
                      >{{ appointment.cancelReason ? `取消原因：${appointment.cancelReason}` : '未填寫取消原因' }}</p>
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
    </template>

    <NewAppointmentDialog
      v-if="newAppointmentOpen"
      :date="selectedDate"
      :is-today="isToday"
      :submitting="newAppointmentSubmitting"
      :error-message="newAppointmentError"
      @submit="submitNewAppointment"
      @close="newAppointmentOpen = false"
    />

    <EditAppointmentDialog
      v-if="editTarget"
      :appointment="editTarget"
      :submitting="editSubmitting"
      :error-message="editError"
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
