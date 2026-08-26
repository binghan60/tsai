<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Check, ChevronDown, ChevronUp, Clock, Lock, Phone, Plus, User, UserPlus } from '@lucide/vue';
import { http } from '../api/http';
import { useToast } from '../composables/useToast';
import {
  SESSIONS,
  SURGERY_BLOCK,
  assignSessionIndex,
  groupBySession,
  isIdentityConfirmed,
  nowIndexInSession,
  splitActiveAndClosed,
} from '../lib/appointmentTimeline';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import ListSkeleton from '../components/ListSkeleton.vue';
import RowActions from '../components/RowActions.vue';
import NewAppointmentDialog from '../components/NewAppointmentDialog.vue';
import CheckInDialog from '../components/CheckInDialog.vue';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription } from '../components/ui/alert';

const router = useRouter();
const toast = useToast();

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

const ROW_ACTIONS = [
  { key: 'no_show', label: '標記未到' },
  { key: 'cancel', label: '取消掛號', danger: true },
];

async function fetchAppointments() {
  loading.value = true;
  error.value = '';
  try {
    const { data } = await http.get('/appointments');
    appointments.value = data.items ?? [];
  } catch {
    error.value = '今日掛號暫時無法載入，請稍後重試';
  } finally {
    loading.value = false;
  }
}

const activeAppointments = computed(() => splitActiveAndClosed(appointments.value).active);
const closedAppointments = computed(() => splitActiveAndClosed(appointments.value).closed);
const sessionGroups = computed(() => groupBySession(activeAppointments.value, SESSIONS));
const nowSessionIndex = computed(() => assignSessionIndex(now.value.getHours() * 60 + now.value.getMinutes(), SESSIONS));
const nowLabel = computed(() =>
  `${String(now.value.getHours()).padStart(2, '0')}:${String(now.value.getMinutes()).padStart(2, '0')}`
);

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
      await fetchAppointments();
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
    await fetchAppointments();
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
    await fetchAppointments();
  } catch (err) {
    newAppointmentError.value = err.response?.data?.message || '新增掛號失敗，請稍後再試';
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

async function handleRowAction(appointment, key) {
  setBusy(appointment._id, true);
  try {
    if (key === 'no_show') {
      await http.post(`/appointments/${appointment._id}/no-show`, {});
      toast.info('已標記未到診', '已更新');
    } else if (key === 'cancel') {
      await http.post(`/appointments/${appointment._id}/cancel`, {});
      toast.info('已取消這筆掛號', '已更新');
    }
    await fetchAppointments();
  } catch (err) {
    reportApiError(err, '操作失敗，請稍後再試');
  } finally {
    setBusy(appointment._id, false);
  }
}

async function updateCheckinNumber(appointment, rawValue) {
  const checkinNumber = Number(rawValue);
  if (!Number.isInteger(checkinNumber) || checkinNumber < 1 || checkinNumber === appointment.checkinNumber) return;
  try {
    await http.put(`/appointments/${appointment._id}`, { checkinNumber });
    await fetchAppointments();
  } catch (err) {
    reportApiError(err, '看診序號調整失敗');
    await fetchAppointments();
  }
}

onMounted(() => {
  fetchAppointments();
  nowTimer = setInterval(() => {
    now.value = new Date();
  }, 30_000);
  refreshTimer = setInterval(fetchAppointments, 60_000);
});
onBeforeUnmount(() => {
  clearInterval(nowTimer);
  clearInterval(refreshTimer);
});
</script>

<template>
  <section class="mx-auto max-w-4xl space-y-5">
    <PageHeader title="掛號與候診">
      <template #actions>
        <Button type="button" @click="newAppointmentOpen = true"><UserPlus class="h-4 w-4" stroke-width="1.75" />新增掛號</Button>
      </template>
    </PageHeader>

    <ListSkeleton v-if="loading" :rows="4" />
    <Alert v-else-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>

    <template v-else>
      <Card class="overflow-hidden p-0">
        <div class="flex items-start justify-between gap-3 p-5 pb-3">
          <div>
            <h2 class="text-base font-semibold text-foreground">今日看診時間軸</h2>
            <p class="mt-0.5 max-w-md text-xs text-muted-foreground">號碼可直接點擊修改看診順序；沿時間軸找到對應時段即可報到。</p>
          </div>
          <span class="inline-flex h-6.5 min-w-6.5 shrink-0 items-center justify-center rounded-full bg-muted px-2 text-xs font-semibold text-foreground">{{ activeAppointments.length }}</span>
        </div>

        <EmptyState v-if="!activeAppointments.length && !closedAppointments.length" inset :icon="UserPlus" title="今天還沒有任何掛號" description="按右上角「新增掛號」開始。" />

        <div v-else class="px-5 pb-5">
          <template v-for="(group, groupIndex) in sessionGroups" :key="group.session.id">
            <div v-if="groupIndex === 1" class="my-2 flex items-center gap-2 rounded-xl border border-dashed border-border bg-muted px-3.5 py-3 text-sm font-medium text-muted-foreground">
              <Plus class="h-4 w-4 shrink-0" stroke-width="1.75" />
              {{ SURGERY_BLOCK.label }} · {{ SURGERY_BLOCK.start }}–{{ SURGERY_BLOCK.end }}（不排診）
            </div>

            <div class="flex items-center gap-2 py-2.5 text-sm font-bold text-foreground">
              <Clock class="h-4 w-4 text-muted-foreground" stroke-width="1.75" />
              {{ group.session.label }} · {{ group.session.start }}–{{ group.session.end }}
            </div>

            <div class="ml-28 border-l-2 border-border pl-7">
              <template v-for="(appointment, itemIndex) in group.items" :key="appointment._id">
                <div
                  v-if="groupIndex === nowSessionIndex && itemIndex === nowIndexInSession(group.items, now)"
                  class="my-1 flex items-center gap-2.5"
                >
                  <span class="h-0 flex-1 border-t-2 border-dashed border-primary"></span>
                  <span class="shrink-0 rounded-full bg-primary px-3 py-0.5 text-xs font-bold text-primary-foreground">現在 · {{ nowLabel }}</span>
                </div>

                <div class="relative py-2.5">
                  <span class="absolute left-[-46px] top-4 w-18 -translate-x-full text-right text-sm font-semibold text-muted-foreground">
                    {{ new Date(appointment.scheduledAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }) }}
                  </span>
                  <span
                    class="absolute left-[-30px] top-5.5 h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 bg-card"
                    :class="appointment.status === 'arrived' ? 'border-primary' : 'border-dashed border-muted-foreground'"
                  ></span>

                  <div class="rounded-xl" :class="isExpanded(appointment._id) ? 'border border-border bg-accent/40 p-3.5' : ''">
                    <div class="flex items-center gap-3.5">
                      <!-- 候診中：看診序號，可直接點擊修改 -->
                      <div v-if="appointment.status === 'arrived'" class="relative h-10 w-10 shrink-0">
                        <input
                          type="number"
                          min="1"
                          class="h-10 w-10 rounded-full border border-input bg-field text-center text-base font-bold text-primary outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                          :value="appointment.checkinNumber"
                          :aria-label="`調整 ${appointment.petName || '這筆掛號'} 的看診序號`"
                          @change="updateCheckinNumber(appointment, $event.target.value)"
                        />
                      </div>
                      <!-- 尚未報到：佔位，還沒排進候診順序 -->
                      <div v-else class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-border text-muted-foreground">
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
                          class="block truncate text-sm font-semibold"
                          :class="isIdentityConfirmed(appointment) ? 'text-primary' : 'text-foreground'"
                        >{{ appointment.petName || '寵物姓名未填' }}</span>
                        <span class="flex items-center gap-1 truncate text-xs text-muted-foreground">
                          {{ appointment.ownerName }}
                          <template v-if="appointment.ownerPhone">
                            <span class="text-border">·</span>
                            <Phone class="h-3 w-3 shrink-0" stroke-width="1.75" />{{ appointment.ownerPhone }}
                          </template>
                        </span>
                      </div>

                      <template v-if="appointment.status === 'arrived'">
                        <Button type="button" variant="ghost" size="icon-sm" :aria-label="isExpanded(appointment._id) ? '收合' : '展開'" @click="toggleExpanded(appointment)">
                          <component :is="isExpanded(appointment._id) ? ChevronUp : ChevronDown" class="h-4 w-4" stroke-width="1.75" />
                        </Button>
                      </template>
                      <template v-else>
                        <Button type="button" size="sm" :disabled="isBusy(appointment._id)" @click="checkIn(appointment)">報到</Button>
                        <RowActions :actions="ROW_ACTIONS" @select="(key) => handleRowAction(appointment, key)" />
                      </template>
                    </div>

                    <div v-if="appointment.status === 'arrived' && isExpanded(appointment._id)" class="mt-3.5 space-y-3.5 border-t border-border pt-3.5">
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
                  </div>
                </div>
              </template>

              <!-- 「現在」晚於這個時段全部項目時，指示線要落在最後面，不是插在某一列前面。 -->
              <div
                v-if="groupIndex === nowSessionIndex && nowIndexInSession(group.items, now) === group.items.length"
                class="my-1 flex items-center gap-2.5"
              >
                <span class="h-0 flex-1 border-t-2 border-dashed border-primary"></span>
                <span class="shrink-0 rounded-full bg-primary px-3 py-0.5 text-xs font-bold text-primary-foreground">現在 · {{ nowLabel }}</span>
              </div>
            </div>
          </template>

          <div v-if="closedAppointments.length" class="mt-4 space-y-2 border-t border-border pt-4">
            <div class="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              已取消／未到
              <span class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-semibold text-foreground">{{ closedAppointments.length }}</span>
            </div>
            <div v-for="appointment in closedAppointments" :key="appointment._id" class="flex items-center gap-3 py-1.5 opacity-70">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <User class="h-4 w-4" stroke-width="1.75" />
              </span>
              <span class="min-w-0 flex-1 truncate text-sm text-foreground line-through decoration-muted-foreground">{{ appointment.petName || '寵物姓名未填' }}</span>
              <span class="shrink-0 truncate text-xs text-muted-foreground">{{ appointment.ownerName }} · 原訂 {{ appointment.time || '現場' }}</span>
              <span class="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{{ appointment.status === 'cancelled' ? '已取消' : '未到' }}</span>
            </div>
          </div>
        </div>
      </Card>
    </template>

    <NewAppointmentDialog
      v-if="newAppointmentOpen"
      :submitting="newAppointmentSubmitting"
      :error-message="newAppointmentError"
      @submit="submitNewAppointment"
      @close="newAppointmentOpen = false"
    />

    <CheckInDialog
      v-if="checkInTarget"
      :appointment="checkInTarget"
      :submitting="checkInSubmitting"
      :error-message="checkInError"
      @submit="submitCheckIn"
      @close="checkInTarget = null"
    />
  </section>
</template>
