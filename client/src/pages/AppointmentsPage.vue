<script setup>
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { CalendarPlus, CalendarX, PawPrint, Phone, Search, User, X } from '@lucide/vue';
import { http } from '../api/http';
import { clinicDateInput } from '../lib/datetime';
import { APPOINTMENT_STATUS_META, APPOINTMENT_VIEWS } from '../lib/appointmentStatus';
import { useSearchQueryParam } from '../composables/useSearchQueryParam';
import { useToast } from '../composables/useToast';
import AppointmentFormDialog from '../components/AppointmentFormDialog.vue';
import AppointmentCreatePatientDialog from '../components/AppointmentCreatePatientDialog.vue';
import CancelAppointmentDialog from '../components/CancelAppointmentDialog.vue';
import EmptyState from '../components/EmptyState.vue';
import ListSkeleton from '../components/ListSkeleton.vue';
import FilterTabs from '../components/FilterTabs.vue';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { DatePicker } from '../components/ui/date-picker';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';

const router = useRouter();
const toast = useToast();

const view = useSearchQueryParam('status', 'all');
const page = useSearchQueryParam('page', '1');
const query = useSearchQueryParam('q');
const dateFrom = useSearchQueryParam('from');
const dateTo = useSearchQueryParam('to');

const appointments = ref([]);
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

async function fetchAppointments() {
  const currentRequest = ++requestSequence;
  loading.value = true;
  error.value = '';
  try {
    const { data } = await http.get('/appointments', {
      params: {
        page: Number(page.value) || 1,
        ...(view.value && view.value !== 'all' ? { status: view.value } : {}),
        ...(query.value.trim() ? { q: query.value.trim() } : {}),
        ...(dateFrom.value ? { from: dateFrom.value } : {}),
        ...(dateTo.value ? { to: dateTo.value } : {}),
      },
    });
    if (currentRequest !== requestSequence) return;
    appointments.value = data.items ?? [];
    counts.value = data.counts ?? {};
    total.value = data.total ?? 0;
    limit.value = data.limit ?? 25;
    const returnedTotalPages = Math.max(Math.ceil(total.value / limit.value), 1);
    if (!appointments.value.length && total.value > 0 && currentPage.value > returnedTotalPages) {
      page.value = String(returnedTotalPages);
    }
  } catch (err) {
    if (currentRequest === requestSequence) error.value = '預約清單暫時無法載入，請稍後重試';
  } finally {
    if (currentRequest === requestSequence) loading.value = false;
  }
}

const currentPage = computed(() => Number(page.value) || 1);
const totalPages = computed(() => Math.max(Math.ceil(total.value / limit.value), 1));

function selectView(key) {
  if ((view.value || 'all') === key) return;
  view.value = key;
}

function goToPage(next) {
  const target = Math.min(Math.max(next, 1), totalPages.value);
  if (target === currentPage.value) return;
  page.value = String(target);
}

// 關鍵字與日期是選好、按下搜尋才查，跟健檢紀錄／寄送歷程同一套規矩。
function applyFilters() {
  if (page.value !== '1') page.value = '1';
  else fetchAppointments();
}

function clearSearchFilters() {
  query.value = '';
  dateFrom.value = '';
  dateTo.value = '';
  applyFilters();
}

watch(view, applyFilters);
watch(page, fetchAppointments, { immediate: true });

async function markStatus(appointment, status) {
  if (statusUpdatingId.value) return;
  statusUpdatingId.value = appointment._id;
  try {
    await http.patch(`/appointments/${appointment._id}/status`, { status });
    await fetchAppointments();
  } catch (err) {
    toast.error(err.response?.data?.message ?? '更新預約狀態失敗');
  } finally {
    statusUpdatingId.value = '';
  }
}

function openCancel(appointment) {
  cancelTarget.value = appointment;
}

function closeCancel() {
  if (cancelSubmitting.value) return;
  cancelTarget.value = null;
}

async function confirmCancel(reason) {
  if (!cancelTarget.value || cancelSubmitting.value) return;
  const appointment = cancelTarget.value;
  cancelSubmitting.value = true;
  try {
    await http.patch(`/appointments/${appointment._id}/status`, { status: 'cancelled', cancelReason: reason });
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
      toast.success('已建立病患檔案');
      await goToRecordForm(data.petId);
    } catch (err) {
      toast.error(err.response?.data?.message ?? '建立病患檔案失敗');
    }
    return;
  }
  createPatientTarget.value = appointment;
}

async function onPatientCreated(result) {
  createPatientTarget.value = null;
  toast.success('已建立病患檔案');
  await goToRecordForm(result.petId);
}

async function onAppointmentCreated() {
  formDialogOpen.value = false;
  toast.success('已建立預約');
  await fetchAppointments();
}

function getActions(appointment) {
  switch (appointment.status) {
    case 'scheduled':
      return [
        { key: 'arrived', label: '報到', variant: 'default', handler: () => markStatus(appointment, 'arrived') },
        { key: 'cancel', label: '取消', variant: 'destructive', handler: () => openCancel(appointment) },
      ];
    case 'arrived':
      return [
        { key: 'report', label: '建立健檢報告', variant: 'default', handler: () => startReport(appointment) },
        { key: 'complete', label: '標記完成', variant: 'outline', handler: () => markStatus(appointment, 'completed') },
        { key: 'cancel', label: '取消', variant: 'destructive', handler: () => openCancel(appointment) },
      ];
    case 'no_show':
    case 'cancelled':
      return [{ key: 'restore', label: '恢復預約', variant: 'outline', handler: () => markStatus(appointment, 'scheduled') }];
    default:
      return [];
  }
}
</script>

<template>
  <section class="mx-auto max-w-7xl space-y-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-foreground">電話預約</h1>
        <p class="mt-1 text-sm text-muted-foreground">接電話時登記，自動彙整成看診列表。</p>
      </div>
      <Button type="button" @click="formDialogOpen = true"><CalendarPlus class="h-4 w-4" stroke-width="1.75" />新增預約</Button>
    </div>

    <FilterTabs :model-value="view || 'all'" :items="APPOINTMENT_VIEWS" :counts="counts" aria-label="預約狀態" @update:model-value="selectView" />

    <form class="grid gap-3 rounded-xl border border-border bg-card p-3 shadow-sm sm:grid-cols-[minmax(220px,1fr)_170px_170px_auto_auto]" @submit.prevent="applyFilters">
      <label class="space-y-1 text-xs font-medium text-muted-foreground">
        <span>關鍵字</span>
        <span class="relative block">
          <Search class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id="appointments-search" v-model="query" type="search" class="pl-10" placeholder="寵物、飼主或電話" aria-label="搜尋預約" />
        </span>
      </label>
      <label class="space-y-1 text-xs font-medium text-muted-foreground"><span>起始日期</span><DatePicker v-model="dateFrom" aria-label="預約起始日期" /></label>
      <label class="space-y-1 text-xs font-medium text-muted-foreground"><span>結束日期</span><DatePicker v-model="dateTo" aria-label="預約結束日期" /></label>
      <Button type="submit" size="sm" class="self-end"><Search class="h-4 w-4" stroke-width="1.75" />搜尋</Button>
      <Button type="button" variant="outline" size="sm" class="self-end" :disabled="!query && !dateFrom && !dateTo" @click="clearSearchFilters"><X class="h-4 w-4" />清除</Button>
    </form>

    <ListSkeleton v-if="loading" :rows="4" />
    <EmptyState v-else-if="!error && !appointments.length" :icon="CalendarX" title="沒有符合條件的預約" description="調整搜尋條件，或按右上角新增一筆預約" />

    <template v-else-if="appointments.length">
      <!-- 桌機：表格 -->
      <Card class="hidden overflow-hidden p-0 shadow-sm xl:block dark:shadow-none">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>序號</TableHead>
              <TableHead>日期／時間</TableHead>
              <TableHead>寵物／飼主</TableHead>
              <TableHead>原因</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead class="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="appointment in appointments" :key="appointment._id">
              <TableCell class="text-sm tabular-nums text-foreground">{{ appointment.checkinNumber ? `第 ${appointment.checkinNumber} 號` : '—' }}</TableCell>
              <TableCell class="text-sm tabular-nums text-foreground">{{ appointment.date }}{{ appointment.time ? ` ${appointment.time}` : '' }}</TableCell>
              <TableCell>
                <router-link v-if="appointment.petId" :to="`/pets/${appointment.petId}`" class="group flex items-center gap-3">
                  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-belle-50 text-belle-600 dark:bg-brand-500/10 dark:text-brand-400">
                    <PawPrint class="h-5 w-5" stroke-width="1.75" />
                  </span>
                  <span class="min-w-0">
                    <span class="block truncate text-sm font-medium text-foreground group-hover:text-belle-600 dark:group-hover:text-brand-400">{{ appointment.petName || '寵物' }}</span>
                    <span class="block truncate text-xs text-muted-foreground">{{ appointment.ownerName }}</span>
                  </span>
                </router-link>
                <span v-else class="flex items-center gap-3">
                  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <User class="h-5 w-5" stroke-width="1.75" />
                  </span>
                  <span class="min-w-0">
                    <span class="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                      {{ appointment.ownerName }}
                      <Badge variant="status" class="bg-muted text-muted-foreground">初診</Badge>
                    </span>
                    <span class="block truncate text-xs text-muted-foreground">{{ appointment.petName || '寵物名稱未填' }}</span>
                  </span>
                </span>
              </TableCell>
              <TableCell class="max-w-56 truncate text-sm text-foreground">{{ appointment.reason || '—' }}</TableCell>
              <TableCell>
                <Badge variant="status" :class="APPOINTMENT_STATUS_META[appointment.status]?.class">{{ APPOINTMENT_STATUS_META[appointment.status]?.label }}</Badge>
              </TableCell>
              <TableCell class="text-right">
                <div class="flex justify-end gap-1.5">
                  <Button
                    v-for="action in getActions(appointment)"
                    :key="action.key"
                    type="button"
                    :variant="action.variant"
                    size="sm"
                    :class="action.class"
                    :disabled="statusUpdatingId === appointment._id"
                    @click="action.handler"
                  >{{ action.label }}</Button>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      <!-- 手機：卡片 -->
      <div class="space-y-3 xl:hidden">
        <Card v-for="appointment in appointments" :key="appointment._id" class="gap-3 p-4 shadow-sm dark:shadow-none">
          <div class="flex items-start justify-between gap-3">
            <div class="flex min-w-0 items-start gap-3">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-belle-50 text-belle-600 dark:bg-brand-500/10 dark:text-brand-400">
                <component :is="appointment.petId ? PawPrint : User" class="h-5 w-5" stroke-width="1.75" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                  {{ appointment.petName || appointment.ownerName }}
                  <Badge v-if="!appointment.petId" variant="status" class="bg-muted text-muted-foreground">初診</Badge>
                </span>
                <span class="flex items-center gap-1 truncate text-xs text-muted-foreground">
                  <User class="h-3 w-3 shrink-0" stroke-width="1.75" />{{ appointment.ownerName }}
                </span>
              </span>
            </div>
            <span class="shrink-0 text-sm font-medium tabular-nums text-foreground">{{ appointment.date }}{{ appointment.time ? ` ${appointment.time}` : '' }}</span>
          </div>

          <Badge variant="status" :class="APPOINTMENT_STATUS_META[appointment.status]?.class">{{ APPOINTMENT_STATUS_META[appointment.status]?.label }}</Badge>
          <p v-if="appointment.checkinNumber" class="text-xs font-medium tabular-nums text-muted-foreground">看診序：第 {{ appointment.checkinNumber }} 號</p>

          <p v-if="appointment.reason" class="text-xs text-muted-foreground">{{ appointment.reason }}</p>
          <p v-if="appointment.ownerPhone" class="flex items-center gap-1 text-xs text-muted-foreground"><Phone class="h-3 w-3 shrink-0" stroke-width="1.75" />{{ appointment.ownerPhone }}</p>

          <div class="flex flex-wrap gap-1.5">
            <Button
              v-for="action in getActions(appointment)"
              :key="action.key"
              type="button"
              :variant="action.variant"
              size="sm"
              :class="action.class"
              :disabled="statusUpdatingId === appointment._id"
              @click="action.handler"
            >{{ action.label }}</Button>
          </div>
        </Card>
      </div>

      <div v-if="totalPages > 1" class="flex items-center justify-between gap-3">
        <p class="text-xs tabular-nums text-muted-foreground">共 {{ total }} 筆・第 {{ currentPage }} / {{ totalPages }} 頁</p>
        <div class="flex gap-2">
          <Button type="button" variant="outline" size="sm" class="hidden sm:inline-flex" :disabled="currentPage <= 1" @click="goToPage(1)">第一頁</Button>
          <Button type="button" variant="outline" size="sm" :disabled="currentPage <= 1" @click="goToPage(currentPage - 1)">上一頁</Button>
          <Button type="button" variant="outline" size="sm" :disabled="currentPage >= totalPages" @click="goToPage(currentPage + 1)">下一頁</Button>
          <Button type="button" variant="outline" size="sm" class="hidden sm:inline-flex" :disabled="currentPage >= totalPages" @click="goToPage(totalPages)">最後頁</Button>
        </div>
      </div>
    </template>
  </section>

  <AppointmentFormDialog :open="formDialogOpen" :default-date="dateFrom || clinicDateInput()" @close="formDialogOpen = false" @created="onAppointmentCreated" />
  <AppointmentCreatePatientDialog :appointment="createPatientTarget" @close="createPatientTarget = null" @created="onPatientCreated" />
  <CancelAppointmentDialog :appointment="cancelTarget" :submitting="cancelSubmitting" @confirm="confirmCancel" @close="closeCancel" />
</template>
