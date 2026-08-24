<script setup>
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { CalendarClock, CalendarPlus, CalendarX, ChevronLeft, ChevronRight, PawPrint, Phone, User } from '@lucide/vue';
import { http } from '../api/http';
import { clinicDateInput, formatDate } from '../lib/datetime';
import { APPOINTMENT_STATUS_META, APPOINTMENT_VIEWS } from '../lib/appointmentStatus';
import { useSearchQueryParam } from '../composables/useSearchQueryParam';
import { useToast } from '../composables/useToast';
import AppointmentFormDialog from '../components/AppointmentFormDialog.vue';
import AppointmentCreatePatientDialog from '../components/AppointmentCreatePatientDialog.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EmptyState from '../components/EmptyState.vue';
import ListSkeleton from '../components/ListSkeleton.vue';
import FilterTabs from '../components/FilterTabs.vue';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { DatePicker } from '../components/ui/date-picker';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';

const router = useRouter();
const toast = useToast();

const date = useSearchQueryParam('date', clinicDateInput());
const view = useSearchQueryParam('status', 'all');

const appointments = ref([]);
const counts = ref({});
const loading = ref(false);
const error = ref('');

const formDialogOpen = ref(false);
const createPatientTarget = ref(null);
const cancelTarget = ref(null);
const statusUpdatingId = ref('');

let requestSequence = 0;

async function fetchAppointments() {
  const currentRequest = ++requestSequence;
  loading.value = true;
  error.value = '';
  try {
    const { data } = await http.get('/appointments', {
      params: { date: date.value || clinicDateInput(), ...(view.value && view.value !== 'all' ? { status: view.value } : {}) },
    });
    if (currentRequest !== requestSequence) return;
    appointments.value = data.items ?? [];
    counts.value = data.counts ?? {};
  } catch (err) {
    if (currentRequest === requestSequence) error.value = '預約清單暫時無法載入，請稍後重試';
  } finally {
    if (currentRequest === requestSequence) loading.value = false;
  }
}

watch([date, view], fetchAppointments, { immediate: true });

function shiftDate(days) {
  const [year, month, day] = (date.value || clinicDateInput()).split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  date.value = next.toISOString().slice(0, 10);
}

function goToday() {
  date.value = clinicDateInput();
}

function selectView(key) {
  view.value = key;
}

const headerDateLabel = computed(() => formatDate(date.value, '選擇日期'));

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

async function confirmCancel() {
  if (!cancelTarget.value) return;
  const appointment = cancelTarget.value;
  cancelTarget.value = null;
  await markStatus(appointment, 'cancelled');
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
        { key: 'arrived', label: '已到診', variant: 'outline', handler: () => markStatus(appointment, 'arrived') },
        { key: 'cancel', label: '取消', variant: 'ghost', class: 'text-destructive hover:bg-destructive/10', handler: () => openCancel(appointment) },
      ];
    case 'arrived':
      return [
        { key: 'report', label: '建立健檢報告', variant: 'default', handler: () => startReport(appointment) },
        { key: 'complete', label: '標記完成', variant: 'outline', handler: () => markStatus(appointment, 'completed') },
        { key: 'cancel', label: '取消', variant: 'ghost', class: 'text-destructive hover:bg-destructive/10', handler: () => openCancel(appointment) },
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
        <p class="mt-1 text-sm text-muted-foreground">接電話時登記，自動彙整成每天的看診列表。</p>
      </div>
      <Button type="button" @click="formDialogOpen = true"><CalendarPlus class="h-4 w-4" stroke-width="1.75" />新增預約</Button>
    </div>

    <div class="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3 shadow-sm">
      <Button type="button" variant="ghost" size="icon" aria-label="前一天" @click="shiftDate(-1)"><ChevronLeft class="h-4 w-4" /></Button>
      <div class="min-w-40 flex-1 sm:flex-none">
        <DatePicker v-model="date" aria-label="選擇日期" />
      </div>
      <Button type="button" variant="ghost" size="icon" aria-label="後一天" @click="shiftDate(1)"><ChevronRight class="h-4 w-4" /></Button>
      <Button type="button" variant="outline" size="sm" @click="goToday">回到今天</Button>
      <span class="ml-auto flex items-center gap-1.5 text-sm font-medium text-foreground">
        <CalendarClock class="h-4 w-4 text-muted-foreground" stroke-width="1.75" />{{ headerDateLabel }}
      </span>
    </div>

    <FilterTabs :model-value="view || 'all'" :items="APPOINTMENT_VIEWS" :counts="counts" aria-label="預約狀態" @update:model-value="selectView" />

    <ListSkeleton v-if="loading" :rows="4" />
    <EmptyState v-else-if="!error && !appointments.length" :icon="CalendarX" title="這天沒有預約" description="按右上角新增一筆預約" />

    <template v-else-if="appointments.length">
      <!-- 桌機：表格 -->
      <Card class="hidden overflow-hidden p-0 shadow-sm xl:block dark:shadow-none">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>時間</TableHead>
              <TableHead>寵物／飼主</TableHead>
              <TableHead>原因</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead class="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="appointment in appointments" :key="appointment._id">
              <TableCell class="text-sm tabular-nums text-foreground">{{ appointment.time || '未定' }}</TableCell>
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
            <span class="shrink-0 text-sm font-medium tabular-nums text-foreground">{{ appointment.time || '未定' }}</span>
          </div>

          <Badge variant="status" :class="APPOINTMENT_STATUS_META[appointment.status]?.class">{{ APPOINTMENT_STATUS_META[appointment.status]?.label }}</Badge>

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
    </template>
  </section>

  <AppointmentFormDialog :open="formDialogOpen" :default-date="date" @close="formDialogOpen = false" @created="onAppointmentCreated" />
  <AppointmentCreatePatientDialog :appointment="createPatientTarget" @close="createPatientTarget = null" @created="onPatientCreated" />
  <ConfirmDialog
    :open="Boolean(cancelTarget)"
    title="取消預約"
    :description="`確定要取消 ${cancelTarget?.petName || cancelTarget?.ownerName || ''} 的預約嗎？`"
    confirm-label="取消預約"
    @update:open="(value) => !value && (cancelTarget = null)"
    @confirm="confirmCancel"
  />
</template>
