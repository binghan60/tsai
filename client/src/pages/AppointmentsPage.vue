<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { Check, ChevronDown, ChevronUp, Clock } from '@lucide/vue';
import { http } from '../api/http';
import { useToast } from '../composables/useToast';
import { useAppointmentNotificationsStore } from '../stores/appointmentNotifications';
import { useAppointmentRealtime } from '../composables/useAppointmentRealtime';
import { mergeVisitMessage, visitMessageSenderLabel } from '../lib/visitMessageThread';
import { markMessageAsSent, markMessageSending } from '../lib/sentMessageTracker';
import { splitAppointmentsByQueueState } from '../lib/appointmentTimeline';
import { clinicDateInput, formatDate, formatDateTime } from '../lib/datetime';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import ListSkeleton from '../components/ListSkeleton.vue';
import VisitMessageThread from '../components/VisitMessageThread.vue';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { DatePicker } from '../components/ui/date-picker';
import { TimePicker } from '../components/ui/time-picker';

// 這頁只服務醫生：只看候診中的病患，不做掛號行政操作（新增／報到／取消／編輯
// 掛號基本資料等一律在櫃台頁做）。發言身分固定，不需要切換——見 CLAUDE.md
// 「身分切換移除」的說明。
const SENDER = 'vet';
const toast = useToast();
const notifications = useAppointmentNotificationsStore();

// 醫生只關心「現在」，不需要選日期；即時連線固定 join 今天的房間。
const today = clinicDateInput();
const todayRef = ref(today);

const appointments = ref([]);
const formTemplates = ref([]);
const defaultTemplateId = ref('');
const loading = ref(false);
const error = ref('');
let refreshTimer;

const expandedIds = ref(new Set());
const simpleForms = reactive({});
const busyIds = ref(new Set());
const updatingIds = ref(new Set());
const sendingMessageIds = ref(new Set());

async function fetchAppointments({ silent = false } = {}) {
  if (!silent) {
    loading.value = true;
    error.value = '';
  }
  try {
    const { data } = await http.get('/appointments', { params: { date: today } });
    appointments.value = data.items ?? [];
  } catch {
    if (!silent) error.value = '掛號資料暫時無法載入，請稍後重試';
  } finally {
    if (!silent) loading.value = false;
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
    toast.error('表單選項暫時無法載入，請重新整理後再試', '無法載入表單');
  }
}

const waitingQueue = computed(() => splitAppointmentsByQueueState(appointments.value).waiting);

const VISIT_TYPE_META = {
  new: { label: '初診', classes: 'bg-brand-50 text-brand-700 ring-brand-300/80 dark:bg-brand-950/60 dark:text-brand-200 dark:ring-brand-500/40' },
  return: { label: '回診', classes: 'bg-petrol-50 text-petrol-700 ring-petrol-300/80 dark:bg-petrol-950/60 dark:text-petrol-300 dark:ring-petrol-500/40' },
  unknown: { label: '類型未記錄', classes: 'bg-muted text-muted-foreground ring-border' },
};
function visitTypeMeta(appointment) {
  return VISIT_TYPE_META[appointment?.visitType] ?? VISIT_TYPE_META.unknown;
}

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
    // 展開等於看到了這張卡片，卡片上的未讀紅點（見側邊欄「看診」徽章同一份資料）就不用留著。
    notifications.clearAppointment(appointment._id, 'doctor');
    if (!simpleForms[appointment._id]) {
      simpleForms[appointment._id] = {
        weightKg: appointment.weightKg ?? '',
        temperatureC: appointment.temperatureC ?? '',
        followUpDate: appointment.followUpDate ?? '',
        followUpTime: appointment.followUpTime ?? '',
        followUpReason: appointment.followUpReason ?? '',
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
function isUpdating(id) {
  return updatingIds.value.has(id);
}
function setUpdating(id, value) {
  const next = new Set(updatingIds.value);
  if (value) next.add(id);
  else next.delete(id);
  updatingIds.value = next;
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

function reportApiError(err, fallback) {
  toast.error(err.response?.data?.message || fallback, '操作失敗');
}

// 回診日期選填，但選了日期就要一併給時間，否則併進報告的時刻只會是沒有意義的午夜。
function followUpTimeMissing(draft) {
  return Boolean(draft?.followUpDate && !draft?.followUpTime);
}

// 按下「更新」把目前填的量測／回診資料存到後端並廣播，讓櫃台立刻看到——
// 這個動作不會改變掛號狀態，候診中可以隨時按；跟「完成看診」是兩件事。
async function updateVisitData(appointment) {
  const draft = simpleForms[appointment._id] || {};
  if (followUpTimeMissing(draft)) {
    toast.error('已選擇回診日期，請一併填寫時間', '看診資料未完成');
    return;
  }
  setUpdating(appointment._id, true);
  try {
    const { data } = await http.patch(`/appointments/${appointment._id}/visit-data`, {
      weightKg: draft.weightKg === '' || draft.weightKg == null ? null : Number(draft.weightKg),
      temperatureC: draft.temperatureC === '' || draft.temperatureC == null ? null : Number(draft.temperatureC),
      followUpDate: draft.followUpDate || '',
      followUpTime: draft.followUpTime || '',
      followUpReason: draft.followUpReason || '',
    });
    Object.assign(appointment, data);
    toast.success('櫃台已經能看到最新資料', '已更新');
  } catch (err) {
    reportApiError(err, '更新失敗，請稍後再試');
  } finally {
    setUpdating(appointment._id, false);
  }
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

function handleVisitMessage({ appointmentId, message }) {
  const appointment = appointments.value.find((item) => item._id === appointmentId);
  if (!appointment) return;
  appointment.visitMessages = mergeVisitMessage(appointment.visitMessages ?? [], message);
  if (message.sender === SENDER) return;
  toast.info(message.content, `${visitMessageSenderLabel(message.sender)}留言`);
}

// 掛號狀態變動（櫃台報到、取消報到等）也要即時反映，候診佇列才會準確。
function handleAppointmentUpdate(updated) {
  const index = appointments.value.findIndex((item) => item._id === updated._id);
  if (index === -1) {
    appointments.value.push(updated);
    return;
  }
  Object.assign(appointments.value[index], updated);
}

useAppointmentRealtime(todayRef, { onMessage: handleVisitMessage, onAppointmentUpdate: handleAppointmentUpdate });

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

onMounted(() => {
  fetchFormChoices();
  fetchAppointments();
  // 候診佇列會因為櫃台報到而變動，背景定期刷新一次。
  refreshTimer = setInterval(() => fetchAppointments({ silent: true }), 60_000);
});
onBeforeUnmount(() => {
  clearInterval(refreshTimer);
});
</script>

<template>
  <section class="mx-auto max-w-7xl space-y-4">
    <PageHeader title="看診" description="候診中的病患：填寫量測與回診資料、留言給櫃台，完成看診會直接建立健檢報告草稿。" />

    <ListSkeleton v-if="loading" :rows="4" />
    <Alert v-else-if="error" variant="destructive">
      <AlertDescription class="flex items-center justify-between gap-3">
        <span>{{ error }}</span>
        <Button type="button" variant="outline" size="sm" class="shrink-0" @click="fetchAppointments">重新載入</Button>
      </AlertDescription>
    </Alert>

    <Card v-else class="overflow-hidden p-0 shadow-sm dark:shadow-none">
      <div class="flex items-start justify-between gap-3 p-4 pb-3">
        <div>
          <h2 class="text-base font-semibold text-foreground">候診 <span class="inline-flex h-6.5 min-w-6.5 items-center justify-center rounded-full bg-accent px-2 text-xs font-bold text-accent-foreground ring-1 ring-primary/20">{{ waitingQueue.length }}</span> 位</h2>
          <p class="mt-0.5 text-xs text-muted-foreground">依報到時間排列</p>
        </div>
      </div>

      <ul v-if="waitingQueue.length" class="space-y-2.5 border-t border-border bg-field/30 p-3">
        <li
          v-for="appointment in waitingQueue"
          :key="appointment._id"
          class="relative rounded-xl border border-border/80 bg-card p-3 shadow-xs transition-all duration-150 hover:border-primary/40 hover:shadow-sm"
        >
          <span
            v-if="notifications.isUnread(appointment._id, 'doctor')"
            class="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-card"
            aria-label="有新留言"
          />
          <div class="grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-3">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold tabular-nums text-primary-foreground shadow-xs">
              {{ appointment.checkinNumber }}
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex min-w-0 items-center gap-1.5">
                <span class="inline-flex h-6 shrink-0 items-center rounded-md px-2 text-xs font-semibold ring-1 shadow-2xs" :class="visitTypeMeta(appointment).classes">{{ visitTypeMeta(appointment).label }}</span>
                <span class="truncate text-sm font-semibold text-foreground">{{ appointment.petName || '—' }}</span>
              </div>
              <div class="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span class="truncate">{{ appointment.ownerName || '—' }}</span>
                <span v-if="appointment.checkedInAt" class="inline-flex items-center gap-1 font-medium text-primary">
                  <Clock class="h-3 w-3 shrink-0" stroke-width="1.75" />{{ formatDateTime(appointment.checkedInAt, checkinTimeOptions) }} 報到
                </span>
              </div>
            </div>
          </div>

          <div class="mt-2.5 border-t border-border/60 pt-2.5">
            <Button
              type="button"
              variant="outline"
              size="xs"
              :aria-expanded="isExpanded(appointment._id)"
              :aria-label="isExpanded(appointment._id) ? '收合看診資料' : '展開看診資料'"
              @click="toggleExpanded(appointment)"
            >
              <component :is="isExpanded(appointment._id) ? ChevronUp : ChevronDown" class="h-4 w-4" stroke-width="1.75" />
              {{ isExpanded(appointment._id) ? '收合資料' : '看診資料' }}
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
            <div class="flex justify-end">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                :disabled="isUpdating(appointment._id) || followUpTimeMissing(simpleForms[appointment._id])"
                @click="updateVisitData(appointment)"
              >{{ isUpdating(appointment._id) ? '更新中…' : '更新（讓櫃台看到）' }}</Button>
            </div>

            <div>
              <p class="mb-1.5 text-xs font-medium text-foreground">看診留言</p>
              <VisitMessageThread
                :messages="appointment.visitMessages || []"
                identity="vet"
                :sending="isSendingMessage(appointment._id)"
                @send="(content) => postVisitMessage(appointment, content)"
              />
            </div>

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
      <EmptyState v-else inset :icon="Clock" title="目前沒有候診中的病患" description="病患在櫃台報到後會顯示在這裡" />
    </Card>
  </section>
</template>
