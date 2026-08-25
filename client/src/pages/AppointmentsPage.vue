<script setup>
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { CalendarPlus, CalendarX } from '@lucide/vue';
import { http } from '../api/http';
import { clinicDateInput } from '../lib/datetime';
import { APPOINTMENT_STATUS_META, APPOINTMENT_VIEWS } from '../lib/appointmentStatus';
import { useSearchQueryParam } from '../composables/useSearchQueryParam';
import { useToast } from '../composables/useToast';
import FilterTabs from '../components/FilterTabs.vue';
import FilterBar from '../components/FilterBar.vue';
import AppointmentScheduleRow from '../components/AppointmentScheduleRow.vue';
import AppointmentQueuePanel from '../components/AppointmentQueuePanel.vue';
import AppointmentFormDialog from '../components/AppointmentFormDialog.vue';
import AppointmentCreatePatientDialog from '../components/AppointmentCreatePatientDialog.vue';
import CancelAppointmentDialog from '../components/CancelAppointmentDialog.vue';
import CheckinAppointmentDialog from '../components/CheckinAppointmentDialog.vue';
import EmptyState from '../components/EmptyState.vue';
import ListSkeleton from '../components/ListSkeleton.vue';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';

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
const checkinTarget = ref(null);
const statusUpdatingId = ref('');
const vitalsUpdatingId = ref('');

let requestSequence = 0;

const currentPage = computed(() => Number(page.value) || 1);
const totalPages = computed(() => Math.max(Math.ceil(total.value / limit.value), 1));
// 只服務 AppointmentFormDialog 的預設日期：起訖日相同時視為「單日」，帶入新增預約表單。
const selectedDay = computed(() => (dateFrom.value && dateFrom.value === dateTo.value ? dateFrom.value : ''));

// 門診時段依實際看診時間分組：上午 10:00–11:30、下午 14:00–19:30，
// 中間的休診空檔（11:30–14:00）以 13:00 為界分派給最近的門診。
const groups = [
  { key: 'morning', label: '上午門診', hours: '10:00 – 11:30', items: [] },
  { key: 'afternoon', label: '下午門診', hours: '14:00 – 19:30', items: [] },
  { key: 'unscheduled', label: '待安排時段', hours: '尚未指定時間', items: [] },
  { key: 'cancelled', label: '已取消預約', hours: '不列入候診順序', items: [] },
];

const scheduleGroups = computed(() => {
  const buckets = groups.map((group) => ({ ...group, items: [] }));

  for (const appointment of appointments.value) {
    if (appointment.status === 'cancelled') {
      buckets[3].items.push(appointment);
      continue;
    }
    const [hourStr, minuteStr] = String(appointment.time || '').split(':');
    const hour = Number(hourStr);
    if (!appointment.time || Number.isNaN(hour)) {
      buckets[2].items.push(appointment);
      continue;
    }
    const minutesOfDay = hour * 60 + Number(minuteStr || 0);
    const target = minutesOfDay < 13 * 60 ? buckets[0] : buckets[1];
    target.items.push(appointment);
  }
  return buckets.filter((group) => group.items.length);
});

const checkinQueue = computed(() => queueAppointments.value
  .filter((appointment) => appointment.status === 'arrived')
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
    // 開始看診／完成已由候診卡片的量測資料手風琴取代——展開填寫體重、體溫、備註後按儲存，
    // 就代表看診結束，直接把預約轉成已完成，不再需要另外兩顆按鈕。
    return [{ key: 'cancel', label: '取消', variant: 'destructive-solid' }];
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

function selectView(key) {
  if ((view.value || 'all') !== key) view.value = key;
}

function goToPage(next) {
  const target = Math.min(Math.max(next, 1), totalPages.value);
  if (target !== currentPage.value) page.value = String(target);
}

async function markStatus(appointment, status, checkinNumber) {
  if (statusUpdatingId.value) return false;
  statusUpdatingId.value = appointment._id;
  try {
    await http.patch(`/appointments/${appointment._id}/status`, {
      status,
      ...(checkinNumber !== undefined && String(checkinNumber).trim() ? { checkinNumber } : {}),
    });
    await fetchAppointments();
    return true;
  } catch (err) {
    toast.error(err.response?.data?.message ?? '狀態更新失敗');
  } finally {
    statusUpdatingId.value = '';
  }
}

async function saveVitals(appointment, payload) {
  if (vitalsUpdatingId.value) return;
  vitalsUpdatingId.value = appointment._id;
  try {
    await http.put(`/appointments/${appointment._id}`, payload);
    // 量測資料存檔即代表看診結束，直接把預約轉成已完成，不用再另外按「完成」。
    await http.patch(`/appointments/${appointment._id}/status`, { status: 'completed' });
    toast.success('已完成看診');
    await fetchAppointments();
  } catch (err) {
    toast.error(err.response?.data?.message ?? '儲存失敗');
  } finally {
    vitalsUpdatingId.value = '';
  }
}

async function confirmCheckin(checkinNumber) {
  if (!checkinTarget.value) return;
  const checkedIn = await markStatus(checkinTarget.value, 'arrived', checkinNumber);
  if (checkedIn) checkinTarget.value = null;
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
  if (action === 'arrive') {
    checkinTarget.value = appointment;
    return;
  }
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
  <section class="mx-auto max-w-7xl space-y-3">
    <div>
      <h1 class="text-xl font-semibold text-foreground">預約與候診</h1>
      <p class="mt-1 text-sm text-muted-foreground">管理門診時段、病患報到與候診順序。</p>
    </div>

    <FilterTabs :model-value="view || 'all'" :items="APPOINTMENT_VIEWS" :counts="counts" aria-label="預約狀態" @update:model-value="selectView" />

    <div class="flex flex-wrap items-center justify-between gap-3">
      <FilterBar
        id="appointments-search"
        v-model="query"
        label="搜尋預約"
        placeholder="病患、飼主或電話"
        with-date-range
        :date-from="dateFrom"
        :date-to="dateTo"
        date-from-label="起始日期"
        date-to-label="結束日期"
        class="max-w-xl"
        @update:date-from="dateFrom = $event"
        @update:date-to="dateTo = $event"
        @submit="applyFilters"
      />
      <Button type="button" @click="formDialogOpen = true">
        <CalendarPlus class="h-4 w-4" stroke-width="1.75" />新增預約
      </Button>
    </div>

    <div v-if="error" class="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{{ error }}</div>

    <div class="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <main class="min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm dark:shadow-none">
        <div class="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div>
            <h2 class="text-base font-semibold text-foreground">門診時程</h2>
            <p class="mt-0.5 text-xs text-muted-foreground">{{ total }} 筆預約，依時間排序</p>
          </div>
          <Badge variant="status" :class="APPOINTMENT_STATUS_META.scheduled.class">待報到 {{ counts.scheduled || 0 }}</Badge>
        </div>

        <ListSkeleton v-if="loading" :rows="5" class="p-3" />
        <EmptyState
          v-else-if="!appointments.length"
          :icon="CalendarX"
          title="這天沒有預約"
          description="可切換日期，或建立一筆新的預約。"
          class="border-0"
        />
        <div v-else class="p-2 sm:p-2.5">
          <section v-for="group in scheduleGroups" :key="group.key" class="mb-2.5 last:mb-0">
            <div class="mb-1 flex items-center gap-2">
              <span class="text-sm font-semibold" :class="group.key === 'cancelled' ? 'text-destructive' : 'text-foreground'">{{ group.label }}</span>
              <span class="text-xs" :class="group.key === 'cancelled' ? 'text-destructive/80' : 'text-muted-foreground'">{{ group.hours }}</span>
              <span class="h-px flex-1" :class="group.key === 'cancelled' ? 'bg-destructive/30' : 'bg-border'"></span>
              <span class="text-xs tabular-nums" :class="group.key === 'cancelled' ? 'text-destructive' : 'text-muted-foreground'">{{ group.items.length }} 位</span>
            </div>
            <div class="overflow-hidden rounded-xl border" :class="group.key === 'cancelled' ? 'border-destructive/30 bg-destructive/5' : 'border-border'">
              <AppointmentScheduleRow
                v-for="appointment in group.items"
                :key="appointment._id"
                :appointment="appointment"
                :actions="actionsFor(appointment)"
                :busy="statusUpdatingId === appointment._id"
                :vitals-saving="vitalsUpdatingId === appointment._id"
                @action="handleRowAction(appointment, $event)"
                @save-vitals="saveVitals(appointment, $event)"
              />
            </div>
          </section>
        </div>

        <div v-if="totalPages > 1" class="flex items-center justify-between border-t border-border px-4 py-2.5">
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
  <CheckinAppointmentDialog
    :appointment="checkinTarget"
    :submitting="statusUpdatingId === checkinTarget?._id"
    @confirm="confirmCheckin"
    @close="checkinTarget = null"
  />
</template>
