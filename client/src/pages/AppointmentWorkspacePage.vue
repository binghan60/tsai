<script setup>
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CalendarClock, ChevronDown, ChevronLeft, ChevronRight, Clock, List, Plus, RefreshCw, Search, Sun, Sunset } from '@lucide/vue';
import { http } from '../api/http';
import { useToast } from '../composables/useToast';
import { useClinicSync } from '../composables/useClinicSync';
import { useSearchQueryParam } from '../composables/useSearchQueryParam';
import { clinicDateInput, clinicTimeInput, shiftDateInput, formatDate, weekdayLabel } from '../lib/datetime';
import { groupBySession, SURGERY_BLOCK } from '../lib/appointmentTimeline';
import { workflowFilter, workflowState } from '../../../shared/appointmentWorkflow.js';
import AppointmentMilestones from '../components/AppointmentMilestones.vue';
import AppointmentDeskPanel from '../components/AppointmentDeskPanel.vue';
import AppointmentListRow from '../components/AppointmentListRow.vue';
import AppointmentRowActions from '../components/AppointmentRowActions.vue';
import SegmentedControl from '../components/SegmentedControl.vue';
import NewAppointmentDialog from '../components/NewAppointmentDialog.vue';
import EditAppointmentDialog from '../components/EditAppointmentDialog.vue';
import CheckInDialog from '../components/CheckInDialog.vue';
import CancelAppointmentDialog from '../components/CancelAppointmentDialog.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { DatePicker } from '../components/ui/date-picker';

const props = defineProps({ workspaceRole: { type: String, default: 'vet' } });
const desk = computed(() => props.workspaceRole === 'front_desk');
const route = useRoute();
const router = useRouter();
const toast = useToast();
const date = useSearchQueryParam('date', clinicDateInput());
let preferredView = 'timeline';
try { preferredView = localStorage.getItem(`clinic.view.${props.workspaceRole}`) || preferredView; } catch { /* Storage may be unavailable. */ }
const view = useSearchQueryParam('layout', preferredView);
if (!['timeline', 'table'].includes(view.value)) view.value = 'timeline';
const filter = useSearchQueryParam('filter', 'all');
const search = useSearchQueryParam('q', '');
const selected = useSearchQueryParam('selected', '');
const detailSection = ref('payment');
const collapsedSessions = ref(new Set());
let detailTrigger = null;
async function closeDetails() {
  selected.value = '';
  await nextTick();
  requestAnimationFrame(() => {
    if (detailTrigger?.isConnected) detailTrigger.focus({ preventScroll: true });
    else document.querySelector('[data-filter="all"]')?.focus({ preventScroll: true });
  });
}
const items = ref([]);
const loading = ref(true);
const error = ref('');
const lastLoaded = ref(null);
const now = ref(Date.now());
const templates = ref([]);
const defaultTemplate = ref('');
const dialog = ref(null);
const target = ref(null);
const lateCheckIn = ref(false);
const busy = ref(false);
const dialogError = ref('');
const confirmation = ref(null);
let request = 0;
let updateGeneration = 0;
let clockTimer;
const activePatient = computed(() => items.value.find(p => p._id === selected.value));
const filters = computed(() => desk.value ? [['all', '當日預約'], ['scheduled', '待報到'], ['payment', '待收款'], ['followup', '待安排回診'], ['completed', '已完成'], ['cancelled', '取消／未到']] : [['all', '當日預約'], ['waiting', '候診中'], ['visiting', '看診中'], ['billing', '待批價'], ['completed', '已完成'], ['cancelled', '取消／未到']]);
const counts = computed(() => Object.fromEntries(filters.value.map(([key]) => [key, items.value.filter(p => workflowFilter(p, key)).length])));
const currentTime = computed(() => clinicTimeInput(new Date(now.value)));
function toggleSession(id) {
  const next = new Set(collapsedSessions.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  collapsedSessions.value = next;
}
function nowPosition(group) {
  if (date.value !== clinicDateInput() || currentTime.value < group.session.start || currentTime.value > group.session.end) return -1;
  const index = group.items.findIndex(p => p.time && p.time > currentTime.value);
  return index < 0 ? group.items.length : index;
}
function rowClick(event, p) {
  if (!event.target.closest('button, a, input, select, [data-row-actions]')) selectPatient(p);
}
const shown = computed(() => items.value.filter(p => workflowFilter(p, filter.value) && `${p.petName} ${p.ownerName} ${p.ownerPhone} ${p.reason}`.toLowerCase().includes(search.value.toLowerCase())));
const timeline = computed(() => groupBySession([...shown.value].sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))));
const rows = computed(() => [...shown.value].sort((a, b) => {
  const rank = p => workflowFilter(p, 'waiting') ? 0 : workflowFilter(p, 'visiting') ? 1 : workflowFilter(p, 'payment') ? 2 : p.status === 'scheduled' ? 3 : 4;
  return rank(a) - rank(b) || new Date(a.checkedInAt || a.scheduledAt) - new Date(b.checkedInAt || b.scheduledAt);
}));
const revenue = computed(() => items.value.filter(p => workflowState(p).paid).reduce((sum, p) => sum + Number(p.checkoutTotal || 0), 0));
function waitLabel(p) {
  if (!workflowFilter(p, 'waiting') || !p.checkedInAt) return '';
  return `等待 ${Math.max(0, Math.floor((now.value - new Date(p.checkedInAt).getTime()) / 60000))} 分鐘`;
}
async function refresh() {
  const token = ++request;
  const generation = updateGeneration;
  const requestedDate = date.value;
  try {
    const { data } = await http.get('/appointments', { params: { date: requestedDate } });
    if (token !== request) return;
    if (generation !== updateGeneration) return refresh();
    items.value = data.items || [];
    error.value = '';
    lastLoaded.value = new Date();
  } catch { if (token === request) error.value = '資料更新失敗，請重新載入；目前顯示的可能不是最新進度。'; }
  finally { if (token === request) loading.value = false; }
}
function updated(item) {
  ++updateGeneration;
  if (item.date !== date.value) { items.value = items.value.filter(p => p._id !== item._id); return; }
  const index = items.value.findIndex(p => p._id === item._id);
  if (index < 0) items.value.push(item);
  else if ((item.__v ?? 0) >= (items.value[index].__v ?? 0)) items.value[index] = item;
}
const { connected } = useClinicSync(date, refresh, updated);
watch(date, () => { selected.value = ''; loading.value = true; items.value = []; refresh(); });
watch(view, value => { try { localStorage.setItem(`clinic.view.${props.workspaceRole}`, value); } catch { /* Optional preference. */ } });
function selectPatient(p, section = 'payment') {
  if (desk.value) {
    detailTrigger = [...document.querySelectorAll(`[data-appointment-id="${p._id}"] button`)].find(element => element.getBoundingClientRect().height);
    detailSection.value = section || 'payment';
    selected.value = p._id;
    return;
  }
  if (!desk.value) {
    const returnTo = router.resolve({ path: route.path, query: { ...route.query, selected: p._id, layout: view.value, date: date.value, filter: filter.value } }).fullPath;
    sessionStorage.setItem('clinic.appointmentScroll', JSON.stringify({ path: route.path, top: window.scrollY }));
    router.push({ path: `/appointments/${p._id}/visit`, query: { returnTo } });
  }
}
async function choices() {
  try {
    const [{ data: forms }, { data: settings }] = await Promise.all([http.get('/settings/form-templates'), http.get('/settings/appointment-settings')]);
    templates.value = forms;
    defaultTemplate.value = settings.defaultAppointmentTemplateId || '';
  } catch { toast.error('無法載入表單選項，請稍後再試'); }
}
function admin(kind, p = activePatient.value) {
  target.value = p;
  dialogError.value = '';
  if (['new', 'edit', 'cancel'].includes(kind)) { dialog.value = kind; return; }
  if (['check-in', 'check-in-late'].includes(kind)) { lateCheckIn.value = kind === 'check-in-late'; dialog.value = 'check-in'; return; }
  confirmation.value = { kind, title: kind === 'no-show' ? '標記這筆預約未到？' : '恢復為待報到？' };
}
async function submit(values, kind = dialog.value) {
  if (busy.value) return;
  busy.value = true;
  dialogError.value = '';
  try {
    if (kind !== 'new') values = { version: target.value.__v ?? 0, ...values };
    let response;
    if (kind === 'new') response = await http.post('/appointments', values);
    else if (kind === 'edit') response = await http.put(`/appointments/${target.value._id}`, values);
    else response = await http.post(`/appointments/${target.value._id}/${kind}`, values);
    updated(response.data);
    dialog.value = null;
    lateCheckIn.value = false;
    confirmation.value = null;
    toast.success('診務資料已更新');
  } catch (err) {
    dialogError.value = err.response?.data?.message || '操作失敗，請稍後重試';
    if (!dialog.value) toast.error(dialogError.value);
  } finally { busy.value = false; }
}
onMounted(async () => {
  clockTimer = setInterval(() => now.value = Date.now(), 30000);
  choices();
  await refresh();
  await nextTick();
  try {
    const saved = JSON.parse(sessionStorage.getItem('clinic.appointmentScroll') || 'null');
    if (saved?.path === route.path) { window.scrollTo(0, saved.top); sessionStorage.removeItem('clinic.appointmentScroll'); }
  } catch { /* No saved position. */ }
});
onBeforeUnmount(() => { ++request; clearInterval(clockTimer); });
</script>

<template>
  <div class="mx-auto max-w-7xl space-y-5 pb-8">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <span class="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground"><CalendarClock class="h-5 w-5" stroke-width="1.6" /></span>
        <div><h1 class="text-xl font-semibold">{{ desk ? '櫃台工作台' : '醫師診療台' }}</h1><p class="mt-0.5 text-xs text-muted-foreground">{{ desk ? '報到、收款與回診安排' : '全天安排與診療進度' }}</p></div>
      </div>
      <Button v-if="desk" size="sm" @click="admin('new', null)"><Plus class="h-4 w-4" />新增掛號</Button>
    </header>

    <section class="overflow-hidden rounded-2xl border border-border bg-card" aria-label="診務篩選">
      <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <div class="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="icon-sm" aria-label="前一天" @click="date = shiftDateInput(date, -1)"><ChevronLeft class="h-4 w-4" /></Button>
          <DatePicker v-model="date" :clearable="false" aria-label="診務日期" class="w-36 sm:w-40" />
          <Button variant="secondary" size="icon-sm" aria-label="後一天" @click="date = shiftDateInput(date, 1)"><ChevronRight class="h-4 w-4" /></Button>
          <span class="hidden text-xs text-muted-foreground sm:inline">{{ weekdayLabel(date) }}</span>
          <Button variant="secondary" size="sm" :disabled="date === clinicDateInput()" @click="date = clinicDateInput()">今天</Button>
        </div>
        <SegmentedControl v-model="view" size="sm" :options="[{ value: 'timeline', label: '時間軸', icon: CalendarClock }, { value: 'table', label: '候診表格', icon: List }]" aria-label="診務呈現方式" />
      </div>
      <div class="workspace-filter-bar border-t border-border">
        <nav class="workspace-filters" aria-label="診務狀態篩選">
          <button v-for="[key, label] in filters" :key="key" type="button" class="workspace-filter" :class="{ 'is-active': filter === key }" :data-filter="key" :aria-pressed="filter === key" @click="filter = key">
            <span>{{ label }}</span><span class="filter-count">{{ loading ? '—' : counts[key] }}</span>
          </button>
        </nav>
        <div class="relative mx-4 mb-3 sm:mx-5 xl:ml-3 xl:mb-0 xl:mr-4 xl:w-52">
          <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input v-model="search" class="pl-9" placeholder="病患、飼主、電話" aria-label="搜尋診務" />
        </div>
      </div>
    </section>

    <div v-if="error" role="alert" class="flex items-center justify-between gap-3 rounded-lg bg-danger-surface p-3 text-sm text-danger">{{ error }}<Button variant="secondary" @click="refresh"><RefreshCw class="h-4 w-4" />重試</Button></div>
    <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <p>{{ formatDate(date) }} · {{ weekdayLabel(date) }}<span class="mx-2 text-border">/</span>{{ shown.length }} 位<template v-if="view === 'table'"> · 候診優先，依報到順序</template><template v-else> · 依預約時段</template></p>
      <div class="flex items-center gap-4"><span v-if="!desk" class="tabular-nums">已收款 NT$ {{ revenue.toLocaleString() }}</span><span class="inline-flex items-center gap-1.5" :title="lastLoaded ? `最近更新 ${lastLoaded.toLocaleTimeString('zh-TW')}` : ''"><span class="h-1.5 w-1.5 rounded-full" :class="connected ? 'bg-success' : 'bg-warning'"></span>{{ connected ? '即時同步' : '重新連線中' }}</span></div>
    </div>
    <div v-if="loading" class="space-y-4 rounded-2xl border border-border bg-card p-5" role="status" aria-label="載入診務中"><div v-for="n in 4" :key="n" class="h-16 animate-pulse rounded-lg bg-muted"></div></div>
    <section v-else-if="view === 'timeline'" class="overflow-hidden rounded-2xl border border-border bg-card px-3 py-4 sm:px-5" aria-label="全天時間軸">
      <template v-for="(group, groupIndex) in timeline" :key="group.session.id">
        <div v-if="groupIndex === 1" class="my-5 flex items-center gap-3 px-3 text-xs text-muted-foreground"><span class="h-px flex-1 bg-border"></span><span>{{ SURGERY_BLOCK.start }}–{{ SURGERY_BLOCK.end }} · {{ SURGERY_BLOCK.label }}</span><span class="h-px flex-1 bg-border"></span></div>
        <button type="button" class="session-heading" :aria-expanded="!collapsedSessions.has(group.session.id)" :aria-controls="`session-${group.session.id}`" @click="toggleSession(group.session.id)">
          <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-card text-muted-foreground"><component :is="groupIndex ? Sunset : Sun" class="h-4 w-4" stroke-width="1.6" /></span>
          <span class="font-semibold">{{ group.session.label }}</span><span class="text-xs font-normal tabular-nums text-muted-foreground">{{ group.session.start }}–{{ group.session.end }}</span>
          <span class="ml-auto text-xs font-normal text-muted-foreground">{{ group.items.length }} 位</span><ChevronDown class="h-4 w-4 text-muted-foreground transition-transform" :class="{ '-rotate-90': collapsedSessions.has(group.session.id) }" />
        </button>
        <div v-show="!collapsedSessions.has(group.session.id)" :id="`session-${group.session.id}`" class="timeline-session">
          <template v-for="(p, index) in group.items" :key="p._id">
            <div v-if="nowPosition(group) === index" class="timeline-now"><span>現在 {{ currentTime }}</span><i></i></div>
            <div class="timeline-entry">
              <div class="timeline-time" :class="{ 'text-foreground': !['completed', 'cancelled', 'no_show'].includes(p.status) }"><span v-if="index === 0 || p.time !== group.items[index - 1].time">{{ p.time || '未定' }}</span></div>
              <div class="timeline-node" aria-hidden="true"><span :class="workflowFilter(p, 'payment') ? 'bg-warning' : workflowFilter(p, 'visiting') ? 'bg-info' : workflowFilter(p, 'waiting') ? 'bg-primary' : 'bg-border'"></span></div>
              <AppointmentListRow :appointment="p" :desk="desk" :selected="selected === p._id" :busy="busy" :waiting-label="waitLabel(p)" @open="section => selectPatient(p, section)" @admin="action => admin(action, p)" />
            </div>
          </template>
          <div v-if="nowPosition(group) === group.items.length" class="timeline-now"><span>現在 {{ currentTime }}</span><i></i></div>
          <div v-if="!group.items.length" class="timeline-empty"><Clock class="h-5 w-5 text-muted-foreground/60" /><p>{{ search || filter !== 'all' ? '此時段沒有符合條件的病患' : '此時段尚無預約' }}</p><Button v-if="search || filter !== 'all'" size="sm" variant="secondary" @click="search = ''; filter = 'all'">清除篩選</Button></div>
        </div>
      </template>
    </section>
    <section v-else class="overflow-hidden rounded-2xl border border-border bg-card" aria-label="候診表格">
      <p class="border-b border-border px-4 py-2 text-xs text-muted-foreground md:hidden">左右滑動查看進度與快捷操作</p>
      <div class="queue-table-scroll overflow-x-auto" role="region" aria-label="候診清單，可左右捲動" tabindex="0">
        <table class="workspace-table w-full text-left text-sm">
          <caption class="sr-only">候診優先，依報到順序排列；點病患或整列開啟詳情</caption>
          <thead><tr><th scope="col">號碼／預約</th><th scope="col">病患</th><th scope="col">進度</th><th scope="col" class="text-right">{{ desk ? '金額（元）' : '等候' }}</th><th scope="col" class="text-right">操作</th></tr></thead>
          <tbody><tr v-for="p in rows" :key="p._id" :data-appointment-id="p._id" :class="{ 'is-selected': selected === p._id }" @click="rowClick($event, p)">
            <td class="tabular-nums"><span class="inline-block min-w-9 font-medium" :title="p.checkinNumber ? '報到號碼' : '尚無報到號碼'">{{ p.checkinNumber ? `${p.checkinNumber} 號` : '—' }}</span><span class="ml-2 text-xs text-muted-foreground">{{ p.time || '未定' }}</span></td>
            <td><div class="flex items-center gap-2"><button type="button" class="queue-patient-name text-left font-semibold text-primary focus-visible:outline-2 focus-visible:outline-ring" :aria-label="`${desk ? '查看就診詳情' : '進入看診'}：${p.petName}`" @click.stop="selectPatient(p)">{{ p.petName }}</button><span class="text-xs text-muted-foreground">{{ p.species }}</span><span class="queue-patient-context truncate text-xs text-muted-foreground" :title="desk ? p.ownerName : p.reason">{{ desk ? p.ownerName : p.reason }}</span></div></td>
            <td><AppointmentMilestones :appointment="p" compact /></td>
            <td class="text-right tabular-nums"><template v-if="desk"><template v-if="workflowState(p).billed"><span class="mr-1.5 text-xs text-muted-foreground">{{ workflowState(p).paid ? '已收' : '應收' }}</span><span class="font-medium">{{ Number(workflowState(p).paid ? p.checkoutTotal : p.billingSubtotal).toLocaleString() }}</span></template><span v-else class="text-muted-foreground">—</span></template><span v-else class="text-xs text-muted-foreground">{{ waitLabel(p) || '—' }}</span></td>
            <td><AppointmentRowActions dense :appointment="p" :desk="desk" :busy="busy" @open="section => selectPatient(p, section)" @admin="action => admin(action, p)" /></td>
          </tr></tbody>
        </table>
      </div>
      <div v-if="!rows.length" class="timeline-empty"><Search class="h-5 w-5 text-muted-foreground" /><p>沒有符合條件的病患</p><Button v-if="filter !== 'all' || search" variant="secondary" size="sm" @click="filter = 'all'; search = ''">清除篩選</Button></div>
    </section>
    <AppointmentDeskPanel v-if="desk && activePatient" :key="activePatient._id" :appointment="activePatient" :initial-section="detailSection" @updated="updated" @admin="admin" @close="closeDetails" />
    <NewAppointmentDialog v-if="dialog === 'new'" :date="date" :is-today="date === clinicDateInput()" :templates="templates" :default-template-id="defaultTemplate" :submitting="busy" :error-message="dialogError" @submit="submit" @close="dialog = null" />
    <EditAppointmentDialog v-if="dialog === 'edit'" :appointment="target" :templates="templates" :submitting="busy" :error-message="dialogError" @submit="submit" @close="dialog = null" />
    <CheckInDialog v-if="dialog === 'check-in'" :appointment="target" :late="lateCheckIn" :submitting="busy" :error-message="dialogError" @submit="submit" @close="dialog = null" />
    <CancelAppointmentDialog v-if="dialog === 'cancel'" :appointment="target" :submitting="busy" :error-message="dialogError" @submit="reason => submit({ cancelReason: reason })" @close="dialog = null" />
    <ConfirmDialog v-if="confirmation" :open="true" :title="confirmation.title" :description="`病患：${target.petName}`" :loading="busy" @confirm="submit({}, confirmation.kind)" @cancel="confirmation = null" />
  </div>
</template>

<style scoped>
.workspace-filter-bar { display: flex; flex-direction: column; }
.workspace-filters { display: flex; align-items: stretch; gap: .25rem; overflow-x: auto; padding: .5rem .75rem; scrollbar-width: thin; }
.workspace-filter { display: flex; align-items: center; gap: .5rem; flex-shrink: 0; min-height: 2.75rem; padding: .5rem .75rem; border-radius: .625rem; background: var(--card); color: var(--muted-foreground); font-size: var(--text-xs); transition: background .15s; }
.workspace-filter:hover { background: var(--field); color: var(--foreground); }
.workspace-filter.is-active { background: var(--accent); color: var(--accent-foreground); font-weight: 600; }
.filter-count { min-width: 1.25rem; text-align: center; font-size: var(--text-xs); font-variant-numeric: tabular-nums; opacity: .8; }
.session-heading { display: flex; align-items: center; gap: .75rem; width: 100%; padding: .625rem .75rem; border-radius: .75rem; background: var(--field); text-align: left; font-size: var(--text-sm); }
.timeline-session { padding: .5rem 0; }
.timeline-entry { display: grid; grid-template-columns: 4rem 1.5rem minmax(0, 1fr); align-items: stretch; }
.timeline-time { padding-top: 1.125rem; text-align: right; font-size: var(--text-xs); font-weight: 500; font-variant-numeric: tabular-nums; color: var(--muted-foreground); }
.timeline-node { position: relative; display: flex; justify-content: center; }
.timeline-node::before { content: ''; position: absolute; top: 0; bottom: 0; width: 1px; background: var(--border); }
.timeline-node > span { position: relative; margin-top: 1.4rem; width: .5rem; height: .5rem; border-radius: 50%; box-shadow: 0 0 0 4px var(--card); }
.timeline-now { display: flex; align-items: center; gap: .75rem; padding: .5rem 0; font-size: var(--text-xs); color: var(--primary); }
.timeline-now i { height: 1px; flex: 1; border-top: 1px dashed var(--primary); }
.timeline-empty { display: flex; flex-direction: column; align-items: center; gap: .75rem; padding: 2rem 1rem; font-size: var(--text-xs); color: var(--muted-foreground); }
.workspace-table { min-width: 760px; }
.queue-table-scroll:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px; }
.queue-patient-name { min-height: 2.5rem; border-radius: .25rem; }
.queue-patient-context { max-width: 10rem; }
.workspace-table th { height: 2.25rem; padding: 0 1rem; background: var(--field); font-size: var(--text-xs); font-weight: 500; color: var(--muted-foreground); white-space: nowrap; }
.workspace-table td { height: 3.25rem; padding: .25rem 1rem; border-top: 1px solid var(--border); white-space: nowrap; }
.workspace-table td:first-child { width: 8rem; }
.workspace-table td:last-child { width: 1%; }
.workspace-table :deep(td > div.flex.flex-wrap) { flex-wrap: nowrap; }
.workspace-table :deep(td > div > span.inline-flex) { background: none; padding: 0; }
@media(max-width: 767px) { .workspace-table { min-width: 690px; } .workspace-table td, .workspace-table th { padding-left: .75rem; padding-right: .75rem; } .queue-patient-context { display: none; } }
.workspace-table tbody tr { cursor: pointer; transition: background .15s; }
.workspace-table tbody tr:hover { background: var(--field); }
.workspace-table tr.is-selected { background: var(--accent); }
@media(min-width: 1280px) { .workspace-filter-bar { flex-direction: row; align-items: center; justify-content: space-between; } }
@media(max-width: 540px) { .timeline-entry { grid-template-columns: 2.75rem 1rem minmax(0, 1fr); } .timeline-time { font-size: var(--text-xs); } .session-heading { gap: .5rem; } }
</style>
