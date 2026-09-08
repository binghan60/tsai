<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { CalendarClock, ChevronDown, ChevronLeft, ChevronRight, Plus, RefreshCw, Stethoscope, Ticket, Undo2, X } from '@lucide/vue';
import { http } from '../api/http';
import { useToast } from '../composables/useToast';
import { useClinicSync } from '../composables/useClinicSync';
import { useSearchQueryParam } from '../composables/useSearchQueryParam';
import { useAppointmentNotifier } from '../composables/useAppointmentNotifier';
import { clinicDateInput, shiftDateInput, weekdayLabel } from '../lib/datetime';
import { workflowFilter } from '../../../shared/appointmentWorkflow.js';
import VisitWorkspace from '../components/VisitWorkspace.vue';
import NewAppointmentDialog from '../components/NewAppointmentDialog.vue';
import EmptyState from '../components/EmptyState.vue';
import ListSkeleton from '../components/ListSkeleton.vue';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription } from '../components/ui/alert';
import { DatePicker } from '../components/ui/date-picker';

// 醫師診療台：左欄常駐候診佇列，右欄是可以同時開好幾筆的就診工作區。
// 刻意不做成「點一筆就換頁」——醫師手上常常同時有好幾隻動物在跑（等一隻的檢驗結果
// 時先看下一隻），換頁或 Modal 都會擋住這種來回切換。
const router = useRouter();
const toast = useToast();
const notifyChat = useAppointmentNotifier();
const today = clinicDateInput();
const date = useSearchQueryParam('date', today);

const items = ref([]);
const loading = ref(true);
const error = ref('');
const busy = ref(false);
const templates = ref([]);
const defaultTemplate = ref('');
const newOpen = ref(false);
const newError = ref('');
// 同時開著的病患。順序就是分頁列的順序，各自的未儲存輸入留在各自的工作區元件裡。
//
// 存進 localStorage 是必要的：診間電腦被重新整理、當掉重開、或不小心關掉分頁時，
// 醫師手上那幾隻動物不能跟著消失——留在畫面上的工作區就是他的待辦清單。
// 綁 date 是因為換日期本來就會清空分頁，隔天開機也不該還原昨天的病患。
const TABS_STORAGE_KEY = 'clinic.vetConsoleTabs';
function restoreTabs(forDate) {
  try {
    const saved = JSON.parse(localStorage.getItem(TABS_STORAGE_KEY) || 'null');
    if (!saved || saved.date !== forDate) return { openIds: [], activeId: '', collapsedGroups: {} };
    return {
      openIds: Array.isArray(saved.openIds) ? saved.openIds.map(String) : [],
      activeId: String(saved.activeId || ''),
      collapsedGroups: saved.collapsedGroups && typeof saved.collapsedGroups === 'object' ? saved.collapsedGroups : {},
    };
  } catch { return { openIds: [], activeId: '', collapsedGroups: {} }; }
}
const restored = restoreTabs(date.value);
const openIds = ref(restored.openIds);
const activeId = ref(restored.activeId);
const now = ref(Date.now());
let clock;
let request = 0;

const byId = computed(() => new Map(items.value.map(item => [String(item._id), item])));
const openTabs = computed(() => openIds.value.map(id => byId.value.get(id)).filter(Boolean));
const active = computed(() => byId.value.get(activeId.value) || null);
const scheduled = computed(() => queue('scheduled'));
const waiting = computed(() => queue('waiting'));
const visiting = computed(() => queue('visiting'));
const handedOff = computed(() => queue('handoff'));
const finished = computed(() => queue('completed'));
const onsiteCount = computed(() => waiting.value.length + visiting.value.length + handedOff.value.length);
const collapsedGroups = ref(restored.collapsedGroups);

function toggleGroup(key) {
  collapsedGroups.value = { ...collapsedGroups.value, [key]: !collapsedGroups.value[key] };
}

function queue(filter) {
  return items.value
    .filter(item => workflowFilter(item, filter))
    .sort((a, b) => new Date(a.checkedInAt || a.scheduledAt) - new Date(b.checkedInAt || b.scheduledAt));
}

function waitedMinutes(appointment) {
  if (!appointment.checkedInAt) return null;
  return Math.max(0, Math.floor((now.value - new Date(appointment.checkedInAt).getTime()) / 60000));
}

async function refresh() {
  const token = ++request;
  const requested = date.value;
  try {
    const { data } = await http.get('/appointments', { params: { date: requested } });
    if (token !== request) return;
    items.value = data.items || [];
    error.value = '';
    // 佇列裡已經不存在的分頁（換日期、被取消）自動關掉，避免停在一筆看不到的病患上。
    openIds.value = openIds.value.filter(id => items.value.some(item => String(item._id) === id));
    if (!openIds.value.includes(activeId.value)) activeId.value = openIds.value.at(-1) || '';
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
  // __v 只會往前走；比目前手上的舊就是遲到的廣播，丟掉。
  else if ((item.__v ?? 0) >= (items.value[index].__v ?? 0)) items.value[index] = item;
}

const { connected } = useClinicSync(date, refresh, applyUpdate);

// 重新整理要回到原本開著的那幾筆，所以每次分頁增減／切換都寫回去。
watch([openIds, activeId, collapsedGroups, date], () => {
  try { localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({ date: date.value, openIds: openIds.value, activeId: activeId.value, collapsedGroups: collapsedGroups.value })); }
  catch { /* 無痕視窗或停用儲存時就只是不還原，不影響看診。 */ }
}, { deep: true });

watch(date, () => {
  loading.value = true;
  items.value = [];
  openIds.value = [];
  activeId.value = '';
  collapsedGroups.value = {};
  refresh();
});

// 選取病患只開啟工作區；真正開始看診必須由醫師明確按下按鈕。
function openPatient(appointment) {
  const id = String(appointment._id);
  if (!openIds.value.includes(id)) openIds.value.push(id);
  activeId.value = id;
}

async function startVisit(appointment) {
  if (busy.value || appointment.visitStartedAt || appointment.handoffAt || appointment.deskCompletedAt) return;
  busy.value = true;
  try {
    const { data } = await http.post(`/appointments/${appointment._id}/workflow/start`, { version: appointment.__v ?? 0 });
    applyUpdate(data);
    toast.success('已開始看診');
  } catch (err) {
    toast.error(err.response?.data?.message || '開始看診失敗，請稍後重試');
  } finally { busy.value = false; }
}

function closeTab(id) {
  openIds.value = openIds.value.filter(item => item !== id);
  if (activeId.value === id) activeId.value = openIds.value.at(-1) || '';
}

function onWorkspaceUpdate(appointment, action) {
  applyUpdate(appointment);
  if (action === 'handoff') {
    notifyChat(appointment, 'handoff');
    toast.success('已送交櫃台');
    closeTab(String(appointment._id));
  } else if (action === 'reclaim') {
    notifyChat(appointment, 'reclaim');
    toast.success('已取回，可以繼續修改');
  }
}

async function reclaim(appointment) {
  if (busy.value) return;
  busy.value = true;
  try {
    const { data } = await http.post(`/appointments/${appointment._id}/workflow/reclaim`, { version: appointment.__v ?? 0 });
    applyUpdate(data);
    notifyChat(data, 'reclaim');
    openPatient(data);
  } catch (err) { toast.error(err.response?.data?.message || '取回失敗，請稍後重試'); }
  finally { busy.value = false; }
}

async function submitNew(values) {
  if (busy.value) return;
  busy.value = true;
  newError.value = '';
  try {
    const { data } = await http.post('/appointments', values);
    applyUpdate(data);
    notifyChat(data, 'create');
    newOpen.value = false;
    toast.success('已新增掛號');
  } catch (err) { newError.value = err.response?.data?.message || '新增掛號失敗，請稍後重試'; }
  finally { busy.value = false; }
}

async function loadTemplates() {
  try {
    const [{ data: forms }, { data: settings }] = await Promise.all([
      http.get('/settings/form-templates'),
      http.get('/settings/appointment-settings'),
    ]);
    templates.value = forms;
    defaultTemplate.value = settings.defaultAppointmentTemplateId || '';
  } catch { /* 表單選項只影響「建立正式表單」，載不到不擋看診。 */ }
}

onMounted(() => {
  clock = setInterval(() => { now.value = Date.now(); }, 30000);
  loadTemplates();
  refresh();
});
onBeforeUnmount(() => { request += 1; clearInterval(clock); });
</script>

<template>
  <div class="mx-auto flex max-w-[110rem] flex-col gap-4 lg:h-[calc(100vh-2.5rem)]">
    <header class="flex flex-wrap items-center gap-4">
      <span class="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
        <Stethoscope class="h-5 w-5" stroke-width="1.75" />
      </span>
      <div>
        <h1 class="text-xl font-semibold">醫師診療台</h1>
        <p class="mt-0.5 text-xs text-muted-foreground">候診佇列與看診工作區</p>
      </div>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="icon-sm" aria-label="前一天" @click="date = shiftDateInput(date, -1)"><ChevronLeft class="h-4 w-4" /></Button>
        <DatePicker v-model="date" :clearable="false" aria-label="診務日期" class="w-40" />
        <Button variant="secondary" size="icon-sm" aria-label="後一天" @click="date = shiftDateInput(date, 1)"><ChevronRight class="h-4 w-4" /></Button>
        <span class="hidden text-xs text-muted-foreground sm:inline">{{ weekdayLabel(date) }}</span>
        <Button variant="secondary" size="sm" :disabled="date === today" @click="date = today">今天</Button>
        <span class="ml-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span class="h-1.5 w-1.5 rounded-full" :class="connected ? 'bg-success' : 'bg-warning'"></span>{{ connected ? '即時同步' : '重新連線中' }}
        </span>
      </div>
    </header>

    <Alert v-if="error" variant="destructive" class="flex items-center justify-between gap-3">
      <AlertDescription>{{ error }}</AlertDescription>
      <Button variant="secondary" size="sm" @click="refresh"><RefreshCw class="h-4 w-4" />重試</Button>
    </Alert>

    <div class="grid min-h-0 flex-1 gap-4 xl:grid-cols-[21.5rem_minmax(0,1fr)]">
      <section class="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card" aria-label="候診佇列">
        <div class="flex items-center gap-3 px-5 pb-3 pt-4">
          <h2 class="text-base font-semibold">候診佇列</h2>
          <span class="ml-auto inline-flex h-6 items-center rounded-full bg-accent px-3 text-xs font-medium leading-none text-accent-foreground">現場 {{ onsiteCount }} 位</span>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          <ListSkeleton v-if="loading" :rows="4" />
          <template v-else>
            <template v-for="group in [
              { key: 'scheduled', label: '已掛號', list: scheduled },
              { key: 'waiting', label: '候診中', list: waiting },
              { key: 'visiting', label: '看診中', list: visiting },
              { key: 'handoff', label: '已交櫃台', list: handedOff },
            ]" :key="group.key">
              <button type="button" class="flex w-full items-center gap-2 px-2 pb-1.5 pt-3 text-left text-xs font-semibold text-muted-foreground" @click="toggleGroup(group.key)">
                <ChevronDown class="h-3.5 w-3.5 transition-transform" :class="collapsedGroups[group.key] ? '-rotate-90' : ''" />
                {{ group.label }}<span class="font-normal">{{ group.list.length }}</span>
              </button>
              <template v-if="!collapsedGroups[group.key]">
              <p v-if="!group.list.length" class="px-2 pb-1 text-xs text-muted-foreground">目前沒有人</p>
              <div
                v-for="item in group.list"
                :key="item._id"
                  class="mb-1 flex items-center gap-2.5 rounded-xl border p-2 transition-colors"
                  :class="String(item._id) === activeId ? 'border-primary/40 bg-accent' : 'border-border bg-card hover:bg-field'"
              >
                <button type="button" class="flex min-w-0 flex-1 items-center gap-3 text-left" @click="openPatient(item)">
                  <span
                    v-if="item.checkinNumber != null"
                    class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums"
                    :class="String(item._id) === activeId ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'"
                  >{{ item.checkinNumber }}</span>
                  <span v-else class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-field text-muted-foreground" title="未取號" aria-label="未取號"><Ticket class="h-4 w-4" /><span class="sr-only">未取號</span></span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-semibold" :class="String(item._id) === activeId ? 'text-accent-foreground' : ''">{{ item.petName }}</span>
                    <span class="block truncate text-xs text-muted-foreground">
                      {{ item.species || '未填品種' }}<template v-if="item.visitType"> · {{ item.visitType === 'new' ? '初診' : '回診' }}</template>
                    </span>
                  </span>
                    <span v-if="group.key === 'scheduled'" class="shrink-0 text-xs tabular-nums text-muted-foreground">掛號 {{ item.time || '時間未指定' }}</span>
                    <span v-else-if="group.key === 'waiting' && waitedMinutes(item) !== null" class="shrink-0 text-xs tabular-nums text-muted-foreground">等候 {{ waitedMinutes(item) }} 分</span>
                  <span v-else-if="group.key === 'visiting' && openIds.includes(String(item._id))" class="shrink-0 text-xs text-muted-foreground">已開啟</span>
                </button>
                <Button v-if="group.key === 'waiting'" size="xs" :disabled="busy" @click="startVisit(item)"><Stethoscope class="h-4 w-4" />看診</Button>
                <Button v-else-if="group.key === 'handoff'" variant="secondary" size="xs" :disabled="busy" @click="reclaim(item)">
                  <Undo2 class="h-4 w-4" />取回
                </Button>
              </div>
              </template>
            </template>

            <button type="button" class="flex w-full items-center gap-2 px-2 pb-1.5 pt-4 text-left text-xs font-semibold text-muted-foreground" @click="toggleGroup('completed')">
              <ChevronDown class="h-3.5 w-3.5 transition-transform" :class="collapsedGroups.completed ? '-rotate-90' : ''" />
              今日已完成<span class="font-normal">{{ finished.length }}</span>
            </button>
            <template v-if="!collapsedGroups.completed">
            <button
              v-for="item in finished"
              :key="item._id"
              type="button"
              class="mb-1 flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-field"
              @click="openPatient(item)"
            >
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">✓</span>
              <span class="min-w-0 flex-1 truncate text-sm text-muted-foreground">{{ item.petName }}</span>
            </button>
            </template>
          </template>
        </div>

        <div class="border-t border-border p-3">
          <Button variant="secondary" size="sm" class="w-full" @click="newOpen = true"><Plus class="h-4 w-4" />現場掛號</Button>
        </div>
      </section>

      <section class="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card" aria-label="看診工作區">
        <div v-if="openTabs.length" class="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-field/40 px-4 py-2">
          <div
            v-for="tab in openTabs"
            :key="tab._id"
            class="flex h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium"
            :class="String(tab._id) === activeId ? 'bg-card text-foreground shadow-sm' : 'bg-secondary text-secondary-foreground'"
          >
            <button type="button" class="flex items-center gap-2" @click="activeId = String(tab._id)">
              <span v-if="String(tab._id) === activeId" class="h-2 w-2 rounded-full bg-primary"></span>{{ tab.petName }}
            </button>
            <button type="button" class="text-muted-foreground hover:text-foreground" :aria-label="`關閉 ${tab.petName}`" @click="closeTab(String(tab._id))">
              <X class="h-3.5 w-3.5" />
            </button>
          </div>
          <span class="ml-auto hidden shrink-0 text-xs text-muted-foreground lg:inline">切換病患不會清空已輸入的內容</span>
        </div>

        <!-- 每個開著的病患各自掛一個工作區並用 v-show 切換，不是共用一個再換 props——
             元件被銷毀重建就等於把還沒存檔的輸入丟掉，那正是要避免的事。 -->
        <VisitWorkspace
          v-for="tab in openTabs"
          v-show="String(tab._id) === activeId"
          :key="tab._id"
          :appointment="tab"
          :templates="templates"
          @updated="onWorkspaceUpdate"
          @open-record="appointment => router.push({ path: `/records/${appointment.recordId}/edit`, query: { visit: appointment._id, visitDate: appointment.date } })"
        />
        <EmptyState
          v-if="!active && !loading"
          :icon="CalendarClock"
          title="從左邊選一位病患開始看診"
          description="選取病患後，按「開始看診」才會記錄開始時間。可以同時開好幾位，切換不會清空已輸入的內容。"
          inset
        />
      </section>
    </div>

    <NewAppointmentDialog
      v-if="newOpen"
      :date="date"
      :is-today="date === today"
      :templates="templates"
      :default-template-id="defaultTemplate"
      :submitting="busy"
      :error-message="newError"
      @submit="submitNew"
      @close="newOpen = false"
    />
  </div>
</template>
