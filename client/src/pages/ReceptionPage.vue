<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { CalendarPlus, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Plus, RefreshCw, Search, UserCheck } from '@lucide/vue';
import { http } from '../api/http';
import { useToast } from '../composables/useToast';
import { useClinicSync } from '../composables/useClinicSync';
import { useSearchQueryParam } from '../composables/useSearchQueryParam';
import { useAppointmentNotifier } from '../composables/useAppointmentNotifier';
import { clinicDateInput, clinicTimeInput, shiftDateInput, weekdayLabel } from '../lib/datetime';
import { appointmentsForTimeline, groupBySession, SURGERY_BLOCK } from '../lib/appointmentTimeline';
import { workflowFilter, workflowState, visitLabel } from '../../../shared/appointmentWorkflow.js';
import HandoffSheet from '../components/HandoffSheet.vue';
import RowActions from '../components/RowActions.vue';
import NewAppointmentDialog from '../components/NewAppointmentDialog.vue';
import EditAppointmentDialog from '../components/EditAppointmentDialog.vue';
import CheckInDialog from '../components/CheckInDialog.vue';
import CancelAppointmentDialog from '../components/CancelAppointmentDialog.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import ListSkeleton from '../components/ListSkeleton.vue';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Alert, AlertDescription } from '../components/ui/alert';
import { DatePicker } from '../components/ui/date-picker';

// 櫃台工作台：以「現在該做什麼」分匣，時間軸退到右欄當參考。
// 三個匣子由上而下就是櫃台的優先順序——醫師已交辦的人正站在櫃台前面等，排最上面。
const toast = useToast();
const notifyChat = useAppointmentNotifier();
const today = clinicDateInput();
const date = useSearchQueryParam('date', today);
const search = useSearchQueryParam('q', '');
const selected = useSearchQueryParam('selected', '');

const items = ref([]);
const loading = ref(true);
const error = ref('');
const busy = ref(false);
const dialog = ref('');
const dialogError = ref('');
const target = ref(null);
const lateCheckIn = ref(false);
const confirmation = ref(null);
const templates = ref([]);
const defaultTemplate = ref('');
const showFinished = ref(false);
const now = ref(Date.now());
let clock;
let request = 0;

const keyword = computed(() => search.value.trim().toLowerCase());
function matches(appointment) {
  if (!keyword.value) return true;
  return `${appointment.petName} ${appointment.ownerName} ${appointment.ownerPhone} ${appointment.reason}`.toLowerCase().includes(keyword.value);
}
function tray(filter, sortKey) {
  return items.value.filter(item => workflowFilter(item, filter) && matches(item))
    .sort((a, b) => new Date(a[sortKey] || a.scheduledAt) - new Date(b[sortKey] || b.scheduledAt));
}

const handoffs = computed(() => tray('handoff', 'handoffAt'));
const upcoming = computed(() => tray('scheduled', 'scheduledAt'));
const followUps = computed(() => tray('followup', 'handoffAt').filter(item => workflowState(item).completed));
const finished = computed(() => tray('completed', 'deskCompletedAt'));
const onsite = computed(() => items.value.filter(item => workflowFilter(item, 'onsite')));
const waitingCount = computed(() => items.value.filter(item => workflowFilter(item, 'waiting')).length);
const visitingCount = computed(() => items.value.filter(item => workflowFilter(item, 'visiting')).length);
const activePatient = computed(() => items.value.find(item => String(item._id) === selected.value) || null);
const currentTime = computed(() => clinicTimeInput(new Date(now.value)));
const timeline = computed(() => groupBySession(appointmentsForTimeline(items.value)));

function dotClass(appointment) {
  const state = workflowState(appointment);
  if (state.handedOff) return 'bg-warning';
  if (state.started) return 'bg-info';
  if (appointment.status === 'arrived') return 'bg-primary';
  return 'bg-border';
}
function nowPosition(group) {
  if (date.value !== today || currentTime.value < group.session.start || currentTime.value > group.session.end) return -1;
  const index = group.items.findIndex(item => item.time && item.time > currentTime.value);
  return index < 0 ? group.items.length : index;
}
function excerpt(appointment) {
  return appointment.handoffNote || '醫師沒有留下交辦事項';
}

async function refresh() {
  const token = ++request;
  const requested = date.value;
  try {
    const { data } = await http.get('/appointments', { params: { date: requested } });
    if (token !== request) return;
    items.value = data.items || [];
    error.value = '';
  } catch { if (token === request) error.value = '資料更新失敗，請重新載入；目前顯示的可能不是最新進度。'; }
  finally { if (token === request) loading.value = false; }
}

function applyUpdate(item) {
  if (item.date !== date.value) {
    items.value = items.value.filter(p => String(p._id) !== String(item._id));
    return;
  }
  const index = items.value.findIndex(p => String(p._id) === String(item._id));
  if (index < 0) items.value.push(item);
  else if ((item.__v ?? 0) >= (items.value[index].__v ?? 0)) items.value[index] = item;
}

const { connected } = useClinicSync(date, refresh, applyUpdate);
watch(date, () => { loading.value = true; items.value = []; selected.value = ''; refresh(); });

function openSheet(appointment) { selected.value = String(appointment._id); }

function onSheetUpdate(appointment, action) {
  applyUpdate(appointment);
  if (action === 'complete') { notifyChat(appointment, 'desk_complete'); toast.success('已完成處理'); }
  else if (action === 'followup') { notifyChat(appointment, 'follow_up'); toast.success('回診已預約'); }
}

// 行政操作（新增／編輯／報到／取消／未到／恢復）共用同一條送出路徑，
// 差別只在打哪一支端點與事後要送哪一則聊天室通知。
function admin(kind, appointment = null) {
  target.value = appointment;
  dialogError.value = '';
  if (kind === 'new') { dialog.value = 'new'; return; }
  if (kind === 'edit' || kind === 'cancel') { dialog.value = kind; return; }
  if (kind === 'check-in' || kind === 'check-in-late') { lateCheckIn.value = kind === 'check-in-late'; dialog.value = 'check-in'; return; }
  confirmation.value = {
    kind,
    title: kind === 'no-show' ? '標記這筆預約未到？' : '恢復為待報到？',
  };
}

const NOTIFICATIONS = { 'check-in': 'check_in', cancel: 'cancel', 'no-show': 'no_show', edit: 'edit' };
async function submit(values, kind = dialog.value) {
  if (busy.value) return;
  busy.value = true;
  dialogError.value = '';
  try {
    let data;
    if (kind === 'new') ({ data } = await http.post('/appointments', values));
    else if (kind === 'edit') ({ data } = await http.put(`/appointments/${target.value._id}`, { version: target.value.__v ?? 0, ...values }));
    else ({ data } = await http.post(`/appointments/${target.value._id}/${kind}`, { version: target.value.__v ?? 0, ...values }));
    applyUpdate(data);
    // 恢復是兩種動作共用一支端點：從候診退回待報到叫「取消報到」，
    // 從已取消／未到回來叫「恢復掛號」，聊天室要講得出差別。
    const action = kind === 'new' ? 'create'
      : kind === 'restore' ? (target.value?.status === 'arrived' ? 'undo_check_in' : 'restore')
        : NOTIFICATIONS[kind];
    if (action) notifyChat(data, action);
    dialog.value = '';
    confirmation.value = null;
    lateCheckIn.value = false;
    toast.success('診務資料已更新');
  } catch (err) {
    dialogError.value = err.response?.data?.message || '操作失敗，請稍後重試';
    if (!dialog.value) toast.error(dialogError.value);
  } finally { busy.value = false; }
}

async function loadTemplates() {
  try {
    const [{ data: forms }, { data: settings }] = await Promise.all([
      http.get('/settings/form-templates'),
      http.get('/settings/appointment-settings'),
    ]);
    templates.value = forms;
    defaultTemplate.value = settings.defaultAppointmentTemplateId || '';
  } catch { toast.error('無法載入表單選項，請稍後再試'); }
}

onMounted(() => {
  clock = setInterval(() => { now.value = Date.now(); }, 30000);
  loadTemplates();
  refresh();
});
onBeforeUnmount(() => { request += 1; clearInterval(clock); });
</script>

<template>
  <div class="mx-auto max-w-[110rem] space-y-4 pb-8">
    <header class="flex flex-wrap items-center gap-4">
      <span class="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
        <ClipboardList class="h-5 w-5" stroke-width="1.75" />
      </span>
      <div>
        <h1 class="text-xl font-semibold">櫃台工作台</h1>
        <p class="mt-0.5 text-xs text-muted-foreground">報到、交辦處理與回診安排</p>
      </div>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <div class="relative w-56">
          <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input v-model="search" class="pl-9" placeholder="病患、飼主、電話" aria-label="搜尋診務" />
        </div>
        <Button variant="secondary" size="icon-sm" aria-label="前一天" @click="date = shiftDateInput(date, -1)"><ChevronLeft class="h-4 w-4" /></Button>
        <DatePicker v-model="date" :clearable="false" aria-label="診務日期" class="w-40" />
        <Button variant="secondary" size="icon-sm" aria-label="後一天" @click="date = shiftDateInput(date, 1)"><ChevronRight class="h-4 w-4" /></Button>
        <Button variant="secondary" size="sm" :disabled="date === today" @click="date = today">今天</Button>
        <Button size="sm" @click="admin('new')"><Plus class="h-4 w-4" />新增掛號</Button>
      </div>
    </header>

    <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <p>{{ date }} · {{ weekdayLabel(date) }} · 共 {{ items.length }} 筆</p>
      <span class="inline-flex items-center gap-1.5">
        <span class="h-1.5 w-1.5 rounded-full" :class="connected ? 'bg-success' : 'bg-warning'"></span>{{ connected ? '即時同步' : '重新連線中' }}
      </span>
    </div>

    <Alert v-if="error" variant="destructive" class="flex items-center justify-between gap-3">
      <AlertDescription>{{ error }}</AlertDescription>
      <Button variant="secondary" size="sm" @click="refresh"><RefreshCw class="h-4 w-4" />重試</Button>
    </Alert>

    <ListSkeleton v-if="loading" :rows="5" />

    <div v-else class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div class="space-y-4">
        <section class="overflow-hidden rounded-xl border border-primary/35 bg-card" aria-label="醫師已交辦">
          <div class="flex flex-wrap items-center gap-3 border-b border-primary/25 bg-accent px-5 py-3">
            <h2 class="text-base font-semibold text-accent-foreground">醫師已交辦 · 待處理</h2>
            <span class="inline-flex h-6 items-center rounded-full bg-card px-3 text-xs font-medium leading-none text-accent-foreground">{{ handoffs.length }} 位</span>
            <p class="ml-auto text-xs text-accent-foreground/80">飼主正在櫃台等，優先處理</p>
          </div>
          <p v-if="!handoffs.length" class="px-5 py-6 text-center text-sm text-muted-foreground">目前沒有等待處理的交辦。</p>
          <div v-for="item in handoffs" :key="item._id" class="flex flex-wrap items-center gap-4 border-b border-border px-5 py-3.5 last:border-b-0">
            <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-base font-semibold tabular-nums text-primary-foreground">{{ item.checkinNumber ?? '—' }}</span>
            <div class="w-40 shrink-0">
              <p class="truncate text-sm font-semibold">{{ item.petName }}</p>
              <p class="truncate text-xs text-muted-foreground">{{ item.ownerName || '飼主待確認' }}<template v-if="item.ownerPhone"> · {{ item.ownerPhone }}</template></p>
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm">{{ excerpt(item) }}</p>
              <div class="mt-1 flex flex-wrap gap-2">
                <span v-if="item.specialCareNote" class="inline-flex h-6 items-center rounded-full bg-warning-surface px-2.5 text-xs font-medium leading-none text-warning">有飼主提醒</span>
                <span v-if="item.followUpRecommendation" class="inline-flex h-6 items-center rounded-full bg-muted px-2.5 text-xs font-medium leading-none text-muted-foreground">建議回診</span>
              </div>
            </div>
            <Button size="sm" class="shrink-0" @click="openSheet(item)">處理</Button>
          </div>
        </section>

        <section class="overflow-hidden rounded-xl border border-border bg-card" aria-label="待報到">
          <div class="flex items-center gap-3 border-b border-border px-5 py-3">
            <h2 class="text-base font-semibold">待報到</h2>
            <span class="inline-flex h-6 items-center rounded-full bg-muted px-3 text-xs font-medium leading-none">{{ upcoming.length }} 位</span>
            <p class="ml-auto text-xs text-muted-foreground">依預約時段</p>
          </div>
          <p v-if="!upcoming.length" class="px-5 py-6 text-center text-sm text-muted-foreground">今天沒有等待報到的預約。</p>
          <div v-for="item in upcoming" :key="item._id" class="flex flex-wrap items-center gap-4 border-b border-border px-5 py-3.5 last:border-b-0">
            <span class="w-14 shrink-0 text-sm font-semibold tabular-nums">{{ item.time || '未定' }}</span>
            <div class="w-40 shrink-0">
              <p class="truncate text-sm font-semibold">{{ item.petName }}</p>
              <p class="truncate text-xs text-muted-foreground">{{ item.species || '未填品種' }}<template v-if="item.visitType"> · {{ item.visitType === 'new' ? '初診' : '回診' }}</template></p>
            </div>
            <p class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {{ item.ownerName || '未留飼主姓名' }}<template v-if="item.ownerPhone"> · {{ item.ownerPhone }}</template><template v-if="item.reason">　{{ item.reason }}</template>
            </p>
            <div class="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" :disabled="busy" @click="admin('check-in', item)"><UserCheck class="h-4 w-4" />報到</Button>
              <RowActions
                :actions="[
                  { key: 'check-in-late', label: '遲到報到' },
                  { key: 'edit', label: '修改預約' },
                  { key: 'no-show', label: '標記未到' },
                  { key: 'cancel', label: '取消掛號', danger: true },
                ]"
                :label="`${item.petName}的更多操作`"
                @select="key => admin(key, item)"
              />
            </div>
          </div>
        </section>

        <section v-if="followUps.length" class="overflow-hidden rounded-xl border border-border bg-card" aria-label="待安排回診">
          <div class="flex items-center gap-3 border-b border-border px-5 py-3">
            <h2 class="text-base font-semibold">待安排回診</h2>
            <span class="inline-flex h-6 items-center rounded-full bg-muted px-3 text-xs font-medium leading-none">{{ followUps.length }} 位</span>
          </div>
          <div v-for="item in followUps" :key="item._id" class="flex flex-wrap items-center gap-4 border-b border-border px-5 py-3.5 last:border-b-0">
            <div class="w-40 shrink-0">
              <p class="truncate text-sm font-semibold">{{ item.petName }}</p>
              <p class="truncate text-xs text-muted-foreground">{{ item.ownerName || '飼主待確認' }}<template v-if="item.ownerPhone"> · {{ item.ownerPhone }}</template></p>
            </div>
            <p class="min-w-0 flex-1 truncate text-sm">醫師建議：{{ item.followUpRecommendation || item.followUpReason }}</p>
            <Button variant="secondary" size="sm" class="shrink-0" @click="openSheet(item)"><CalendarPlus class="h-4 w-4" />安排回診</Button>
          </div>
        </section>

        <section class="overflow-hidden rounded-xl border border-border bg-card">
          <button type="button" class="flex w-full items-center gap-3 bg-field/40 px-5 py-3 text-left" :aria-expanded="showFinished" @click="showFinished = !showFinished">
            <h2 class="text-base font-semibold text-muted-foreground">今日已完成</h2>
            <span class="inline-flex h-6 items-center rounded-full bg-muted px-3 text-xs font-medium leading-none">{{ finished.length }} 位</span>
            <ChevronDown class="ml-auto h-4 w-4 text-muted-foreground transition-transform" :class="{ '-rotate-90': !showFinished }" />
          </button>
          <div v-show="showFinished">
            <p v-if="!finished.length" class="px-5 py-5 text-center text-sm text-muted-foreground">今天還沒有完成的就診。</p>
            <button
              v-for="item in finished"
              :key="item._id"
              type="button"
              class="flex w-full items-center gap-4 border-t border-border px-5 py-3 text-left hover:bg-field"
              @click="openSheet(item)"
            >
              <span class="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">{{ item.time || '未定' }}</span>
              <span class="w-40 shrink-0 truncate text-sm font-semibold">{{ item.petName }}</span>
              <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{{ item.ownerName }}<template v-if="item.followUpAppointmentId"> · 已約回診 {{ item.followUpDate }} {{ item.followUpTime }}</template></span>
            </button>
          </div>
        </section>
      </div>

      <aside class="space-y-4">
        <section class="rounded-xl border border-border bg-card p-5">
          <p class="text-xs text-muted-foreground">現在 {{ currentTime }} · 現場人數</p>
          <p class="mt-1 flex items-baseline gap-2">
            <span class="text-4xl font-semibold tabular-nums">{{ onsite.length }}</span>
            <span class="text-sm text-muted-foreground">位在院</span>
          </p>
          <div class="mt-4 grid grid-cols-3 gap-2 text-center">
            <div class="rounded-lg bg-field p-3"><p class="text-base font-semibold">{{ waitingCount }}</p><p class="text-xs text-muted-foreground">候診中</p></div>
            <div class="rounded-lg bg-field p-3"><p class="text-base font-semibold">{{ visitingCount }}</p><p class="text-xs text-muted-foreground">看診中</p></div>
            <div class="rounded-lg bg-accent p-3"><p class="text-base font-semibold text-accent-foreground">{{ handoffs.length }}</p><p class="text-xs text-accent-foreground">待處理</p></div>
          </div>
        </section>

        <section class="overflow-hidden rounded-xl border border-border bg-card" aria-label="看診時間軸">
          <div class="border-b border-border px-5 py-3"><h2 class="text-base font-semibold">看診時間軸</h2></div>
          <div v-for="(group, groupIndex) in timeline" :key="group.session.id" class="py-2">
            <p v-if="groupIndex === 1" class="px-5 py-2 text-xs text-muted-foreground">{{ SURGERY_BLOCK.start }}–{{ SURGERY_BLOCK.end }} · {{ SURGERY_BLOCK.label }}</p>
            <p class="flex items-center gap-2 px-5 py-1.5 text-xs font-semibold text-muted-foreground">
              {{ group.session.label }}<span class="font-normal">{{ group.session.start }}–{{ group.session.end }}</span>
            </p>
            <template v-for="(item, index) in group.items" :key="item._id">
              <div v-if="nowPosition(group) === index" class="flex items-center gap-2 px-5 py-1.5">
                <span class="text-xs text-primary">現在 {{ currentTime }}</span><span class="h-px flex-1 border-t border-dashed border-primary"></span>
              </div>
              <div class="flex items-center gap-3 px-5 py-1.5">
                <span class="w-11 shrink-0 text-xs tabular-nums text-muted-foreground">{{ item.time || '未定' }}</span>
                <span class="h-2 w-2 shrink-0 rounded-full" :class="dotClass(item)"></span>
                <span class="min-w-0 flex-1 truncate text-sm">{{ item.petName }}</span>
                <!-- 報錯人、報錯時間的修正入口。候診中的人不在左邊任何一個匣子裡，
                     這裡是他們唯一的行政操作出口，所以只在還沒開始看診時才出現。 -->
                <RowActions
                  v-if="item.status === 'arrived' && !item.visitStartedAt"
                  :actions="[{ key: 'edit', label: '修改掛號' }, { key: 'restore', label: '取消報到', danger: true }]"
                  :label="`${item.petName}的更多操作`"
                  @select="key => admin(key, item)"
                />
                <span v-else class="shrink-0 text-xs text-muted-foreground">{{ visitLabel(item) }}</span>
              </div>
            </template>
            <div v-if="nowPosition(group) === group.items.length" class="flex items-center gap-2 px-5 py-1.5">
              <span class="text-xs text-primary">現在 {{ currentTime }}</span><span class="h-px flex-1 border-t border-dashed border-primary"></span>
            </div>
            <p v-if="!group.items.length" class="px-5 py-2 text-xs text-muted-foreground">此時段尚無預約</p>
          </div>
        </section>
      </aside>
    </div>

    <HandoffSheet v-if="activePatient" :key="activePatient._id" :appointment="activePatient" @updated="onSheetUpdate" @close="selected = ''" />
    <NewAppointmentDialog v-if="dialog === 'new'" :date="date" :is-today="date === today" :templates="templates" :default-template-id="defaultTemplate" :submitting="busy" :error-message="dialogError" @submit="submit" @close="dialog = ''" />
    <EditAppointmentDialog v-if="dialog === 'edit'" :appointment="target" :templates="templates" :submitting="busy" :error-message="dialogError" @submit="submit" @close="dialog = ''" />
    <CheckInDialog v-if="dialog === 'check-in'" :appointment="target" :late="lateCheckIn" :submitting="busy" :error-message="dialogError" @submit="submit" @close="dialog = ''" />
    <CancelAppointmentDialog v-if="dialog === 'cancel'" :appointment="target" :submitting="busy" :error-message="dialogError" @submit="reason => submit({ cancelReason: reason })" @close="dialog = ''" />
    <ConfirmDialog v-if="confirmation" :open="true" :title="confirmation.title" :description="`病患：${target.petName}`" :loading="busy" @confirm="submit({}, confirmation.kind)" @cancel="confirmation = null" />
  </div>
</template>
