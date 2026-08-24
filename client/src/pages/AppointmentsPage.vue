<script setup>
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { CalendarPlus, CalendarX, ChevronLeft, ChevronRight, RefreshCw, Search, X } from '@lucide/vue';
import { http } from '../api/http';
import { clinicDateInput } from '../lib/datetime';
import { APPOINTMENT_VIEWS } from '../lib/appointmentStatus';
import { useSearchQueryParam } from '../composables/useSearchQueryParam';
import { useToast } from '../composables/useToast';
import AppointmentScheduleRow from '../components/AppointmentScheduleRow.vue';
import AppointmentQueuePanel from '../components/AppointmentQueuePanel.vue';
import AppointmentFormDialog from '../components/AppointmentFormDialog.vue';
import AppointmentCreatePatientDialog from '../components/AppointmentCreatePatientDialog.vue';
import CancelAppointmentDialog from '../components/CancelAppointmentDialog.vue';
import EmptyState from '../components/EmptyState.vue';
import ListSkeleton from '../components/ListSkeleton.vue';
import { Button } from '../components/ui/button';
import { DatePicker } from '../components/ui/date-picker';
import { Input } from '../components/ui/input';

const router = useRouter();
const toast = useToast();

const view = useSearchQueryParam('status', 'all');
const page = useSearchQueryParam('page', '1');
const query = useSearchQueryParam('q');
const dateFrom = useSearchQueryParam('from');
const dateTo = useSearchQueryParam('to');

if (!dateFrom.value && !dateTo.value) {
  const today = clinicDateInput();
  dateFrom.value = today;
  dateTo.value = today;
}

const appointments = ref([]);
const queueAppointments = ref([]);
const counts = ref({});
const total = ref(0);
const limit = ref(25);
const loading = ref(false);
const error = ref('');
const formDialogOpen = ref(false);
const createPatientTarget = ref(null);
const cancelTarget = ref(null);
const cancelSubmitting = ref(false);
const statusUpdatingId = ref('');

let requestSequence = 0;

const currentPage = computed(() => Number(page.value) || 1);
const totalPages = computed(() => Math.max(Math.ceil(total.value / limit.value), 1));
const selectedDay = computed(() => (dateFrom.value && dateFrom.value === dateTo.value ? dateFrom.value : ''));
const isToday = computed(() => selectedDay.value === clinicDateInput());

const selectedDayLabel = computed(() => {
  if (!selectedDay.value) return '自訂日期範圍';
  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date(`${selectedDay.value}T12:00:00`));
});

const dayOptions = computed(() => {
  const center = selectedDay.value || clinicDateInput();
  const start = new Date(`${center}T12:00:00`);
  start.setDate(start.getDate() - 3);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const value = clinicDateInput(date);
    return {
      value,
      weekday: new Intl.DateTimeFormat('zh-TW', { weekday: 'short' }).format(date),
      day: new Intl.DateTimeFormat('zh-TW', { day: 'numeric' }).format(date),
      isToday: value === clinicDateInput(),
    };
  });
});

const scheduleGroups = computed(() => {
  const groups = [
    { key: 'morning', label: '上午門診', hours: '09:00 – 12:00', items: [] },
    { key: 'afternoon', label: '下午門診', hours: '12:00 – 17:00', items: [] },
    { key: 'evening', label: '晚間門診', hours: '17:00 – 21:00', items: [] },
    { key: 'unscheduled', label: '待安排時段', hours: '尚未指定時間', items: [] },
  ];

  for (const appointment of appointments.value) {
    const hour = Number(String(appointment.time || '').split(':')[0]);
    const target = !appointment.time || Number.isNaN(hour)
      ? groups[3]
      : hour < 12 ? groups[0] : hour < 17 ? groups[1] : groups[2];
    target.items.push(appointment);
  }
  return groups.filter((group) => group.items.length);
});

const checkinQueue = computed(() => queueAppointments.value
  .slice()
  .sort((a, b) => (a.checkinNumber ?? Number.MAX_SAFE_INTEGER) - (b.checkinNumber ?? Number.MAX_SAFE_INTEGER)));

function actionsFor(appointment) {
  if (appointment.status === 'scheduled') {
    return [
      { key: 'arrive', label: '報到', variant: 'default' },
      { key: 'cancel', label: '取消', variant: 'destructive-solid' },
    ];
  }
  if (appointment.status === 'arrived') {
    return [
      { key: 'report', label: '開始看診', variant: 'default' },
      { key: 'complete', label: '完成', variant: 'outline' },
      { key: 'cancel', label: '取消', variant: 'destructive-solid' },
    ];
  }
  if (appointment.status === 'cancelled' || appointment.status === 'no_show') {
    return [{ key: 'restore', label: '恢復預約', variant: 'outline' }];
  }
  return [];
}

async function fetchAppointments() {
  const currentRequest = ++requestSequence;
  loading.value = true;
  error.value = '';
  try {
    const dateParams = {
      ...(dateFrom.value ? { from: dateFrom.value } : {}),
      ...(dateTo.value ? { to: dateTo.value } : {}),
    };
    const [{ data }, { data: queueData }] = await Promise.all([
      http.get('/appointments', {
        params: {
          page: currentPage.value,
          ...(view.value && view.value !== 'all' ? { status: view.value } : {}),
          ...(query.value.trim() ? { q: query.value.trim() } : {}),
          ...dateParams,
        },
      }),
      http.get('/appointments', {
        params: { page: 1, limit: 100, status: 'arrived', ...dateParams },
      }),
    ]);
    if (currentRequest !== requestSequence) return;
    appointments.value = data.items ?? [];
    queueAppointments.value = queueData.items ?? [];
    counts.value = data.counts ?? {};
    total.value = data.total ?? 0;
    limit.value = data.limit ?? 25;

    const lastPage = Math.max(Math.ceil(total.value / limit.value), 1);
    if (!appointments.value.length && total.value > 0 && currentPage.value > lastPage) {
      page.value = String(lastPage);
    }
  } catch {
    if (currentRequest === requestSequence) error.value = '無法載入預約資料，請稍後再試。';
  } finally {
    if (currentRequest === requestSequence) loading.value = false;
  }
}

function applyFilters() {
  if (page.value !== '1') page.value = '1';
  else fetchAppointments();
}

function setDay(value) {
  if (!value) return;
  dateFrom.value = value;
  dateTo.value = value;
  applyFilters();
}

function shiftDay(offset) {
  const current = selectedDay.value || clinicDateInput();
  const next = new Date(`${current}T12:00:00`);
  next.setDate(next.getDate() + offset);
  setDay(clinicDateInput(next));
}

function selectView(key) {
  if ((view.value || 'all') !== key) view.value = key;
}

function clearSearch() {
  if (!query.value) return;
  query.value = '';
  applyFilters();
}

function goToPage(next) {
  const target = Math.min(Math.max(next, 1), totalPages.value);
  if (target !== currentPage.value) page.value = String(target);
}

async function markStatus(appointment, status) {
  if (statusUpdatingId.value) return;
  statusUpdatingId.value = appointment._id;
  try {
    await http.patch(`/appointments/${appointment._id}/status`, { status });
    await fetchAppointments();
  } catch (err) {
    toast.error(err.response?.data?.message ?? '狀態更新失敗');
  } finally {
    statusUpdatingId.value = '';
  }
}

function openCancel(appointment) {
  cancelTarget.value = appointment;
}

function closeCancel() {
  if (!cancelSubmitting.value) cancelTarget.value = null;
}

async function confirmCancel(reason) {
  if (!cancelTarget.value || cancelSubmitting.value) return;
  const appointment = cancelTarget.value;
  cancelSubmitting.value = true;
  try {
    await http.patch(`/appointments/${appointment._id}/status`, {
      status: 'cancelled',
      cancelReason: reason,
    });
    cancelTarget.value = null;
    await fetchAppointments();
  } catch (err) {
    toast.error(err.response?.data?.message ?? '取消預約失敗');
  } finally {
    cancelSubmitting.value = false;
  }
}

async function goToRecordForm(petId) {
  await fetchAppointments();
  router.push(`/pets/${petId}/records/new`);
}

async function startReport(appointment) {
  if (appointment.petId) {
    router.push(`/pets/${appointment.petId}/records/new`);
    return;
  }
  if (appointment.petName) {
    try {
      const { data } = await http.post(`/appointments/${appointment._id}/create-patient`, {});
      toast.success('已建立病患資料');
      await goToRecordForm(data.petId);
    } catch (err) {
      toast.error(err.response?.data?.message ?? '建立病患資料失敗');
    }
    return;
  }
  createPatientTarget.value = appointment;
}

function handleRowAction(appointment, action) {
  if (action === 'arrive') return markStatus(appointment, 'arrived');
  if (action === 'report') return startReport(appointment);
  if (action === 'complete') return markStatus(appointment, 'completed');
  if (action === 'restore') return markStatus(appointment, 'scheduled');
  if (action === 'cancel') openCancel(appointment);
}

async function onPatientCreated(result) {
  createPatientTarget.value = null;
  toast.success('已建立病患資料');
  await goToRecordForm(result.petId);
}

async function onAppointmentCreated() {
  formDialogOpen.value = false;
  toast.success('預約已建立');
  await fetchAppointments();
}

watch(view, applyFilters);
watch(page, fetchAppointments, { immediate: true });
</script>

<template>
  <section class="mx-auto max-w-[1440px] space-y-5">
    <header class="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p class="text-xs font-semibold tracking-[0.16em] text-primary">CLINIC SCHEDULE</p>
        <h1 class="mt-1 text-2xl font-semibold tracking-tight text-foreground">預約與候診</h1>
        <p class="mt-1 text-sm text-muted-foreground">管理門診時段、病患報到與候診順序。</p>
      </div>
      <Button type="button" class="min-h-11 px-5" @click="formDialogOpen = true">
        <CalendarPlus class="h-4 w-4" stroke-width="1.75" />新增預約
      </Button>
    </header>

    <section class="overflow-hidden rounded-2xl border border-border bg-card shadow-sm dark:shadow-none">
      <div class="flex flex-col gap-4 border-b border-border p-4 lg:flex-row lg:items-center lg:justify-between">
        <div class="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="icon" aria-label="前一天" @click="shiftDay(-1)">
            <ChevronLeft class="h-4 w-4" />
          </Button>
          <div class="min-w-48 px-1">
            <p class="text-base font-semibold text-foreground">{{ isToday ? '今日門診' : selectedDayLabel }}</p>
            <p class="text-xs text-muted-foreground">{{ isToday ? selectedDayLabel : '查看指定日期的預約與候診狀態' }}</p>
          </div>
          <Button type="button" variant="outline" size="icon" aria-label="後一天" @click="shiftDay(1)">
            <ChevronRight class="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="sm" :disabled="isToday" @click="setDay(clinicDateInput())">回今天</Button>
          <DatePicker :model-value="selectedDay" class="w-36" aria-label="選擇門診日期" @update:model-value="setDay" />
        </div>

        <form class="flex w-full gap-2 lg:w-[23rem]" @submit.prevent="applyFilters">
          <span class="relative min-w-0 flex-1">
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input v-model="query" type="search" class="pr-9 pl-9" placeholder="病患、飼主或電話" aria-label="搜尋預約" />
            <button v-if="query" type="button" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="清除搜尋" @click="clearSearch">
              <X class="h-4 w-4" />
            </button>
          </span>
          <Button type="submit" variant="outline" size="sm">搜尋</Button>
          <Button type="button" variant="ghost" size="icon" aria-label="重新整理" @click="fetchAppointments">
            <RefreshCw class="h-4 w-4" :class="loading ? 'animate-spin' : ''" />
          </Button>
        </form>
      </div>

      <div class="grid grid-cols-7 gap-1 border-b border-border p-2 sm:gap-2 sm:p-3">
        <button
          v-for="day in dayOptions"
          :key="day.value"
          type="button"
          class="flex min-h-16 flex-col items-center justify-center rounded-xl border text-sm transition-colors"
          :class="selectedDay === day.value ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'"
          @click="setDay(day.value)"
        >
          <span class="text-xs font-medium">{{ day.isToday ? '今天' : day.weekday }}</span>
          <span class="mt-1 text-lg font-semibold leading-none">{{ day.day }}</span>
        </button>
      </div>

      <nav class="flex gap-1 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="預約狀態">
        <button
          v-for="item in APPOINTMENT_VIEWS"
          :key="item.key"
          type="button"
          class="shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
          :class="(view || 'all') === item.key ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
          @click="selectView(item.key)"
        >
          {{ item.label }}
          <span class="ml-1 text-xs opacity-70">{{ item.key === 'all' ? (counts.all ?? total) : (counts[item.key] ?? 0) }}</span>
        </button>
      </nav>
    </section>

    <div v-if="error" class="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{{ error }}</div>

    <div class="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <main class="min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm dark:shadow-none">
        <div class="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 class="text-base font-semibold text-foreground">門診時程</h2>
            <p class="mt-0.5 text-xs text-muted-foreground">{{ total }} 筆預約，依時間排序</p>
          </div>
          <span class="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
            待報到 {{ counts.scheduled || 0 }}
          </span>
        </div>

        <ListSkeleton v-if="loading" :rows="5" class="p-5" />
        <EmptyState
          v-else-if="!appointments.length"
          :icon="CalendarX"
          title="這天沒有預約"
          description="可切換日期，或建立一筆新的預約。"
          class="border-0"
        />
        <div v-else class="p-3 sm:p-5">
          <section v-for="group in scheduleGroups" :key="group.key" class="mb-7 last:mb-0">
            <div class="mb-2 flex items-center gap-3">
              <span class="text-sm font-semibold text-foreground">{{ group.label }}</span>
              <span class="text-xs text-muted-foreground">{{ group.hours }}</span>
              <span class="h-px flex-1 bg-border"></span>
              <span class="text-xs tabular-nums text-muted-foreground">{{ group.items.length }} 位</span>
            </div>
            <div class="overflow-hidden rounded-xl border border-border">
              <AppointmentScheduleRow
                v-for="appointment in group.items"
                :key="appointment._id"
                :appointment="appointment"
                :actions="actionsFor(appointment)"
                :busy="statusUpdatingId === appointment._id"
                @action="handleRowAction(appointment, $event)"
              />
            </div>
          </section>
        </div>

        <div v-if="totalPages > 1" class="flex items-center justify-between border-t border-border px-5 py-3">
          <p class="text-xs tabular-nums text-muted-foreground">第 {{ currentPage }} / {{ totalPages }} 頁</p>
          <div class="flex gap-2">
            <Button type="button" variant="outline" size="sm" :disabled="currentPage <= 1" @click="goToPage(currentPage - 1)">上一頁</Button>
            <Button type="button" variant="outline" size="sm" :disabled="currentPage >= totalPages" @click="goToPage(currentPage + 1)">下一頁</Button>
          </div>
        </div>
      </main>

      <AppointmentQueuePanel :queue="checkinQueue" :counts="counts" :total="counts.all ?? total" @start-report="startReport" />
    </div>
  </section>

  <AppointmentFormDialog
    :open="formDialogOpen"
    :default-date="selectedDay || clinicDateInput()"
    @close="formDialogOpen = false"
    @created="onAppointmentCreated"
  />
  <AppointmentCreatePatientDialog
    :appointment="createPatientTarget"
    @close="createPatientTarget = null"
    @created="onPatientCreated"
  />
  <CancelAppointmentDialog
    :appointment="cancelTarget"
    :submitting="cancelSubmitting"
    @confirm="confirmCancel"
    @close="closeCancel"
  />
</template>
