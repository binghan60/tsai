<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { http } from '../api/http';
import { getSocket } from '../api/socket';
import { formatDateTime } from '../lib/datetime';
import { MEDICATION_ACTIVE, MEDICATION_STAGES, medicationLabel } from '../../../shared/medicationWorkflow.js';
import ModalDialog from './ModalDialog.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import FilterBar from './FilterBar.vue';
import Pagination from './Pagination.vue';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Alert, AlertDescription } from './ui/alert';
import { DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { ClipboardPlus, Search } from '@lucide/vue';

const props = defineProps({
  mode: { type: String, required: true },
  appointments: { type: Array, default: () => [] },
  initialFilter: { type: String, default: '' },
  stages: { type: Array, default: null },
  showList: { type: Boolean, default: true },
});
const emit = defineEmits(['counts']);
const doctor = computed(() => props.mode === 'doctor');
const filter = ref(props.initialFilter || (doctor.value ? 'review' : 'active'));
const queryInput = ref('');
const query = ref('');
const page = ref(1);
const totalPages = ref(1);
const total = ref(0);
const items = ref([]);
const counts = ref({});
const loading = ref(true);
const error = ref('');
const busy = ref(false);
const opened = ref(false);
const selected = ref(null);
const pet = ref(null);
const form = reactive({ condition: '', prescription: '', note: '', storageLocation: '', appointmentId: '' });
const initial = ref('');
const modalError = ref('');
const stale = ref(false);
const confirmation = ref(null);
const returning = ref(false);
const returnReason = ref('');
const clinicalNotes = ref([]);
const notesError = ref('');
const petQuery = ref('');
const petResults = ref([]);
const petLoading = ref(false);
const petError = ref('');
const previousLoading = ref(false);
let listSequence = 0;
let searchSequence = 0;
let detailSequence = 0;
let searchTimer;
const socket = getSocket();
const activeCount = computed(() => MEDICATION_ACTIVE.reduce((sum, key) => sum + (counts.value[key] || 0), 0));
const displayedStages = computed(() => props.stages?.length ? MEDICATION_STAGES.filter(stage => props.stages.includes(stage.key)) : MEDICATION_STAGES);
const terminal = computed(() => ['collected', 'cancelled'].includes(selected.value?.status));
const dirty = computed(() => opened.value && JSON.stringify(form) !== initial.value);
const clinicalEditable = computed(() => !terminal.value && (!selected.value || doctor.value || selected.value.status === 'review'));
const matchingAppointments = computed(() => props.appointments.filter(item => String(item.petId) === String(pet.value?._id)));
const changedClinical = computed(() => selected.value && ['condition', 'prescription', 'note'].some(key => form[key].trim() !== selected.value[key]));
function tone(status) {
  return { review: 'bg-warning-surface text-warning', approved: 'bg-success-surface text-success', ready: 'bg-accent text-accent-foreground' }[status] || 'bg-muted text-muted-foreground';
}

async function refresh() {
  const sequence = ++listSequence;
  try {
    const { data } = await http.get('/medications', { params: { status: filter.value, q: query.value, page: page.value } });
    if (sequence !== listSequence) return;
    items.value = data.items;
    counts.value = data.counts;
    total.value = data.total;
    totalPages.value = data.totalPages;
    emit('counts', data.counts);
    const current = items.value.find(item => item._id === selected.value?._id);
    if (current && current.__v !== selected.value.__v) stale.value = true;
    error.value = '';
    if (page.value > totalPages.value) page.value = totalPages.value;
  } catch (err) {
    if (sequence === listSequence) error.value = err.response?.data?.message || '藥單更新失敗，請重試。';
  } finally {
    if (sequence === listSequence) loading.value = false;
  }
}
async function sync(payload) {
  if (selected.value && (!payload?._id || payload._id === selected.value._id)) {
    try {
      const { data } = await http.get(`/medications/${selected.value._id}`);
      if (selected.value?._id === data._id && selected.value.__v !== data.__v) stale.value = true;
    } catch { /* 列表更新會顯示連線錯誤；不清除使用者輸入。 */ }
  }
  return refresh();
}
watch([filter, page], () => { loading.value = true; refresh(); });
function applySearch() {
  query.value = queryInput.value.trim();
  if (page.value !== 1) page.value = 1;
  else refresh();
}
function setFilter(value) { page.value = 1; filter.value = value; }
watch(petQuery, value => {
  clearTimeout(searchTimer);
  const sequence = ++searchSequence;
  petResults.value = [];
  petError.value = '';
  petLoading.value = !!value.trim();
  if (!value.trim()) return;
  searchTimer = setTimeout(async () => {
    try {
      const { data } = await http.get('/pets', { params: { q: value.trim(), limit: 8 } });
      if (sequence === searchSequence) petResults.value = data.items || [];
    } catch { if (sequence === searchSequence) petError.value = '搜尋失敗，請重新輸入關鍵字。'; }
    finally { if (sequence === searchSequence) petLoading.value = false; }
  }, 250);
});

function resetForm(order) {
  for (const key of Object.keys(form)) form[key] = order?.[key] || '';
  initial.value = JSON.stringify(form);
  stale.value = false;
  modalError.value = '';
  returning.value = false;
  returnReason.value = '';
}
function create() {
  selected.value = null;
  pet.value = null;
  petQuery.value = '';
  clinicalNotes.value = [];
  notesError.value = '';
  resetForm(null);
  opened.value = true;
}
defineExpose({ create });
async function loadNotes(petId, sequence) {
  notesError.value = '';
  clinicalNotes.value = [];
  try {
    const { data } = await http.get(`/pets/${petId}/clinical-notes`, { params: { limit: 1 } });
    if (sequence === detailSequence) clinicalNotes.value = data.items || [];
  } catch { if (sequence === detailSequence) notesError.value = '病歷讀取失敗，可重新開啟藥單重試。'; }
}
async function openOrder(item) {
  const sequence = ++detailSequence;
  busy.value = true;
  error.value = '';
  try {
    const { data } = await http.get(`/medications/${item._id}`);
    if (sequence !== detailSequence) return;
    selected.value = data;
    pet.value = { _id: data.petId, name: data.petName };
    resetForm(data);
    opened.value = true;
    loadNotes(data.petId, sequence);
  } catch (err) { error.value = err.response?.data?.message || '無法開啟藥單'; }
  finally { busy.value = false; }
}
function openCancel(item) {
  selected.value = item;
  resetForm(item);
  confirmation.value = {
    title: `取消 ${item.petName} 的藥單？`,
    description: '取消後不再包藥或交付。',
    run: () => execute('cancel'),
    cancel: () => { selected.value = null; },
  };
}
function pickPet(value) {
  pet.value = value;
  form.appointmentId = '';
  petQuery.value = '';
  loadNotes(value._id, ++detailSequence);
}
function changePet() {
  const clear = () => { pet.value = null; resetForm(null); clinicalNotes.value = []; detailSequence += 1; };
  if (dirty.value) confirmation.value = { title: '重新選擇寵物？', description: '為避免混用藥單，會清除目前的近況、藥單和備註。', run: clear };
  else clear();
}
async function usePrevious() {
  previousLoading.value = true;
  modalError.value = '';
  const petId = pet.value._id;
  try {
    const { data } = await http.get('/medications', { params: { petId, status: 'all', limit: 100 } });
    if (pet.value?._id !== petId) return;
    const previous = data.items.find(item => item.status !== 'cancelled' && item.prescription);
    if (!previous) { modalError.value = '此寵物尚無可帶入的藥單紀錄。'; return; }
    const apply = () => { form.prescription = previous.prescription; };
    if (form.prescription.trim()) confirmation.value = { title: '取代目前藥單內容？', description: '會帶入上一筆藥單，仍需醫師重新確認。', run: apply };
    else apply();
  } catch { modalError.value = '無法讀取上一筆藥單'; }
  finally { previousLoading.value = false; }
}
function close() {
  if (busy.value || previousLoading.value) return;
  if (dirty.value) confirmation.value = { title: '捨棄未儲存的內容？', description: '關閉後，本次尚未儲存的輸入會清除。', run: () => { opened.value = false; } };
  else opened.value = false;
}
function reload() {
  confirmation.value = { title: '載入最新藥單？', description: '會以最新藥單取代目前輸入，請先保留需要的文字。', run: () => openOrder(selected.value) };
}
async function execute(action, extra = {}) {
  if (busy.value || stale.value) return;
  if (!selected.value && !pet.value) { modalError.value = '請先選擇寵物'; return; }
  busy.value = true;
  modalError.value = '';
  try {
    if (!selected.value) await http.post('/medications', { ...form, petId: pet.value._id });
    else await http.post(`/medications/${selected.value._id}/actions/${action}`, { ...form, version: selected.value.__v, ...extra });
    opened.value = false;
    selected.value = null;
    await refresh();
  } catch (err) {
    modalError.value = err.response?.data?.message || '儲存失敗，請重試';
    if (err.response?.status === 409) stale.value = true;
  } finally { busy.value = false; }
}
function requestAction(action) {
  if (action === 'edit' && changedClinical.value && selected.value.status !== 'review') {
    confirmation.value = { title: '修改並重新送交醫師確認？', description: '修改後須由醫師重新確認。若已完成包藥，將暫停交付並標示需要重新包藥。', run: () => execute(action) };
  } else if (action === 'ready' && selected.value.needsRepack) {
    confirmation.value = { title: '確認依新藥單重新包藥', description: '請先停止使用並分開放置舊藥包，再依最新確認的藥單重包。', run: () => execute(action, { acknowledgeRepack: true }) };
  } else if (action === 'collect') {
    confirmation.value = { title: `確認 ${selected.value.petName} 已領藥？`, description: `請核對飼主 ${selected.value.ownerName}（${selected.value.ownerPhone}）與藥包，確認已交付。`, run: () => execute(action) };
  } else if (action === 'cancel') {
    confirmation.value = { title: `取消 ${selected.value.petName} 的藥單？`, description: '取消後不再包藥或交付。', run: () => execute(action) };
  } else execute(action);
}
function runConfirmation() { const run = confirmation.value?.run; confirmation.value = null; run?.(); }
function cancelConfirmation() { confirmation.value?.cancel?.(); confirmation.value = null; }
onBeforeRouteLeave(() => {
  if (busy.value) return false;
  if (!dirty.value) return true;
  return new Promise(resolve => { confirmation.value = { title: '離開並捨棄未儲存的藥單？', description: '本次尚未儲存的輸入會清除。', run: () => resolve(true), cancel: () => resolve(false) }; });
});
onMounted(() => {
  refresh();
  socket.on('medication:updated', sync);
  socket.on('connect', sync);
});
onBeforeUnmount(() => {
  clearTimeout(searchTimer);
  listSequence += 1; searchSequence += 1; detailSequence += 1;
  socket.off('medication:updated', sync); socket.off('connect', sync);
});
</script>

<template>
  <section v-if="showList" class="flex min-h-0 flex-1 flex-col gap-3" aria-label="領藥工作區">
    <div class="flex flex-wrap items-center gap-2">
      <FilterBar id="medication-search" v-model="queryInput" label="搜尋藥單" placeholder="寵物、飼主、電話或病歷號" class="min-w-56 flex-1 sm:max-w-80" @submit="applySearch" />
      <p class="text-xs text-muted-foreground sm:ml-auto">未完成的藥單持續保留，不受診務日期篩選影響</p>
    </div>
    <div class="flex flex-wrap gap-1.5" role="group" aria-label="藥單狀態篩選">
      <Button v-if="!stages?.length" size="sm" :variant="filter === 'active' ? 'default' : 'secondary'" :aria-pressed="filter === 'active'" @click="setFilter('active')">未完成 {{ activeCount }}</Button>
      <Button v-for="stage in displayedStages" :key="stage.key" size="sm" :variant="filter === stage.key ? 'default' : 'secondary'" :aria-pressed="filter === stage.key" @click="setFilter(stage.key)">{{ stage.label }} {{ counts[stage.key] || 0 }}</Button>
    </div>
    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
    <div class="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-card">
      <table class="w-full min-w-240 text-left text-sm">
        <thead class="sticky top-0 z-10 bg-muted text-xs text-muted-foreground"><tr>
          <th class="p-3">狀態／登記時間</th><th class="p-3">寵物／飼主</th><th class="w-1/5 p-3">近況回報</th><th class="w-1/3 p-3">藥單內容</th><th class="p-3">備註／放置位置</th><th class="p-3">操作</th>
        </tr></thead>
        <tbody>
          <tr v-if="loading && !items.length"><td colspan="6" class="p-10 text-center text-muted-foreground">載入藥單中…</td></tr>
          <tr v-else-if="!items.length"><td colspan="6" class="p-10 text-center text-muted-foreground">{{ error ? '暫時無法載入藥單' : '目前沒有符合條件的藥單' }}</td></tr>
          <tr v-for="item in items" :key="item._id" class="border-t border-border align-top hover:bg-muted/30">
            <td class="space-y-2 p-3"><Badge variant="status" :class="tone(item.status)">{{ medicationLabel(item.status) }}</Badge><p v-if="item.needsRepack" class="text-xs font-semibold text-danger">暫停處理・需重新包藥</p><p class="text-xs text-muted-foreground">{{ formatDateTime(item.createdAt) }}</p></td>
            <td class="p-3"><p class="font-semibold">{{ item.petName }}</p><p>{{ item.ownerName }}</p><p class="text-xs text-muted-foreground">{{ item.ownerPhone }}</p></td>
            <td class="whitespace-pre-wrap break-words p-3">{{ item.condition || '—' }}</td>
            <td class="whitespace-pre-wrap break-words p-3 font-medium">{{ item.prescription }}</td>
            <td class="whitespace-pre-wrap break-words p-3"><p>{{ item.note || '—' }}</p><p v-if="item.storageLocation" class="mt-2 font-semibold text-primary">放置：{{ item.storageLocation }}</p></td>
            <td class="p-3">
              <div v-if="!doctor && !['collected', 'cancelled'].includes(item.status)" class="flex flex-nowrap gap-2 whitespace-nowrap">
                <Button class="shrink-0" size="sm" variant="secondary" :disabled="busy" :aria-label="`修改 ${item.petName} 的藥單`" @click="openOrder(item)">修改</Button>
                <Button class="shrink-0" size="sm" variant="destructive" :disabled="busy" :aria-label="`取消 ${item.petName} 的藥單`" @click="openCancel(item)">取消</Button>
              </div>
              <Button v-else size="sm" variant="secondary" :disabled="busy" :aria-label="`開啟 ${item.petName} 的藥單`" @click="openOrder(item)">{{ doctor && item.status === 'review' ? '審核藥單' : '查看' }}</Button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <Pagination :page="page" :total-pages="totalPages" @update:page="page = $event" />
  </section>

  <ModalDialog v-if="opened" :size="selected ? 'xl' : 'wide'" @close="close">
      <div class="sticky top-0 z-10 border-b border-border bg-card p-5 pr-16 sm:px-6">
        <DialogTitle class="flex items-center gap-2">
          <ClipboardPlus v-if="!selected" class="h-5 w-5 text-primary" stroke-width="1.75" aria-hidden="true" />
          {{ selected ? `${selected.petName} 的藥單` : '登記續藥' }}
          <Badge v-if="selected" variant="status" :class="tone(selected.status)">{{ medicationLabel(selected.status) }}</Badge>
        </DialogTitle>
        <DialogDescription class="mt-1 text-xs">{{ selected ? `${selected.ownerName} · ${selected.ownerPhone}` : '記錄飼主需求並建立藥單，送交醫師確認後再進行包藥。' }}</DialogDescription>
      </div>
      <div class="space-y-5 p-5 sm:p-6">
        <Alert v-if="stale" variant="destructive"><AlertDescription>藥單已被其他工作台更新，目前輸入已保留。請載入最新內容後再操作。<Button size="sm" variant="secondary" class="ml-2" @click="reload">載入最新藥單</Button></AlertDescription></Alert>
        <Alert v-if="selected?.needsRepack" variant="destructive"><AlertDescription>藥單在包藥完成後曾修改，請停止使用原藥包。待醫師重新確認後，請依最新藥單重新包藥。</AlertDescription></Alert>
        <Alert v-if="modalError" variant="destructive"><AlertDescription>{{ modalError }}</AlertDescription></Alert>

        <template v-if="!selected">
          <section class="space-y-3" aria-labelledby="med-pet-section-title">
            <div class="flex items-center gap-2">
              <span class="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">1</span>
              <h3 id="med-pet-section-title" class="text-sm font-semibold">選擇寵物</h3>
            </div>

            <div v-if="pet" class="flex items-center gap-3 rounded-xl border border-primary/35 bg-accent px-4 py-3">
              <div class="min-w-0 flex-1">
                <p class="truncate font-semibold text-accent-foreground">{{ pet.name }}<span v-if="pet.species || pet.breed" class="ml-2 text-xs font-normal text-accent-foreground/75">{{ [pet.species, pet.breed].filter(Boolean).join(' · ') }}</span></p>
                <p class="mt-0.5 truncate text-xs text-accent-foreground/80">{{ pet.ownerId?.name || '飼主資料未填' }}<template v-if="pet.ownerId?.phone"> · {{ pet.ownerId.phone }}</template></p>
              </div>
              <Button size="sm" variant="secondary" :disabled="busy || previousLoading" @click="changePet">更換</Button>
            </div>
            <template v-else>
              <div class="relative">
                <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" stroke-width="1.75" aria-hidden="true" />
                <Input id="med-pet-search" v-model="petQuery" inputmode="search" autocomplete="off" autofocus class="h-11 pl-9" placeholder="搜尋寵物名、飼主姓名、電話或病歷號" />
              </div>
              <div v-if="petQuery.trim()" class="overflow-hidden rounded-xl border border-border" aria-live="polite">
                <p v-if="petLoading" class="px-4 py-3 text-sm text-muted-foreground">搜尋中…</p>
                <p v-else-if="petError" class="px-4 py-3 text-sm text-danger">{{ petError }}</p>
                <p v-else-if="!petResults.length" class="px-4 py-3 text-sm text-muted-foreground">找不到符合的寵物，請確認是否已建檔。</p>
                <button v-for="candidate in petResults" v-else :key="candidate._id" type="button" class="flex w-full items-center gap-3 border-b border-border bg-card px-4 py-3 text-left last:border-b-0 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none" @click="pickPet(candidate)">
                  <span class="min-w-0 flex-1 truncate text-sm"><span class="font-semibold text-primary">{{ candidate.name }}</span><span class="ml-2 text-xs text-muted-foreground">{{ [candidate.species, candidate.breed, candidate.ownerId?.name, candidate.ownerId?.phone].filter(Boolean).join(' · ') }}</span></span>
                </button>
              </div>
              <p v-else class="text-xs text-muted-foreground">先找到已建檔的寵物，再填寫本次續藥需求。</p>
            </template>
          </section>

          <section v-if="pet" class="space-y-4 border-t border-border pt-5" aria-labelledby="med-request-section-title">
            <div class="flex items-center gap-2">
              <span class="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">2</span>
              <h3 id="med-request-section-title" class="text-sm font-semibold">填寫本次需求</h3>
            </div>
            <div class="space-y-1.5">
              <Label for="med-condition" class="text-xs font-medium">本次續藥需求／飼主回報</Label>
              <Textarea id="med-condition" v-model="form.condition" rows="5" maxlength="5000" :disabled="busy" placeholder="例如：原藥即將用完，近期食慾正常；希望續開一個月份量。" />
            </div>
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="space-y-1.5">
                <Label for="med-appointment" class="text-xs font-medium">關聯就診（選填）</Label>
                <select id="med-appointment" v-model="form.appointmentId" class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">未關聯就診／電話續藥</option>
                  <option v-for="appointment in matchingAppointments" :key="appointment._id" :value="appointment._id">{{ appointment.date }} {{ appointment.time }} · {{ appointment.reason || '本次就診' }}</option>
                </select>
              </div>
              <div class="space-y-1.5">
                <Label for="med-note" class="text-xs font-medium">預計領藥／櫃檯備註（選填）</Label>
                <Input id="med-note" v-model="form.note" maxlength="3000" :disabled="busy" placeholder="例如：今天 17:00 後領取" />
              </div>
            </div>
            <details class="group rounded-xl border border-border bg-muted/20">
              <summary class="cursor-pointer list-none px-4 py-3 text-sm font-medium marker:hidden">最近一次病歷<span class="ml-2 text-xs font-normal text-muted-foreground">點擊查看參考內容</span></summary>
              <div class="border-t border-border px-4 py-3 text-sm">
                <p v-if="notesError" class="text-danger">{{ notesError }}</p>
                <p v-else-if="!clinicalNotes.length" class="text-muted-foreground">目前沒有可顯示的紀錄</p>
                <article v-else><p class="text-xs text-muted-foreground">{{ formatDateTime(clinicalNotes[0].entryDate) }}</p><p class="mt-1 whitespace-pre-wrap">{{ clinicalNotes[0].content }}</p></article>
              </div>
            </details>
          </section>
        </template>

        <div v-else class="grid gap-5 lg:grid-cols-2">
          <div class="space-y-4">
            <div class="space-y-1.5"><Label for="med-condition">飼主回報</Label><Textarea id="med-condition" v-model="form.condition" rows="5" maxlength="5000" :disabled="busy || !clinicalEditable" placeholder="食慾、精神、症狀變化…" /></div>
            <div class="space-y-1.5"><Label for="med-note">處理備註</Label><Textarea id="med-note" v-model="form.note" rows="3" maxlength="3000" :disabled="busy || !clinicalEditable" placeholder="預計領藥時間、需向飼主確認的事項…" /></div>
            <div v-if="selected && !doctor" class="space-y-1.5"><Label for="med-storage">放置位置</Label><Input id="med-storage" v-model="form.storageLocation" maxlength="200" :disabled="busy || terminal || !['approved', 'ready'].includes(selected.status)" placeholder="例如 A 櫃第 2 格" /></div>
          </div>
          <div class="space-y-4">
            <div v-if="selected || doctor" class="space-y-1.5"><div class="flex items-center justify-between gap-2"><Label for="med-prescription">藥單內容</Label><Button v-if="!selected && pet" size="sm" variant="secondary" :disabled="busy || previousLoading" @click="usePrevious">{{ previousLoading ? '讀取中…' : '帶入上一筆藥單' }}</Button></div><Textarea id="med-prescription" v-model="form.prescription" rows="14" maxlength="10000" :disabled="busy || !clinicalEditable" placeholder="請輸入藥品名稱、劑量、頻次、天數及用藥指示" /><p v-if="!terminal" class="text-xs text-muted-foreground">{{ doctor ? '請核對藥單內容後送交包藥。後續若修改內容，須重新進行醫師確認。' : '藥單經醫師確認後，包藥人員即可開始處理。' }}</p></div>
            <section v-if="pet" class="rounded-lg border border-border p-3" aria-labelledby="recent-clinical-note-title"><h3 id="recent-clinical-note-title" class="text-sm font-medium">最近病歷</h3><p v-if="notesError" class="mt-2 text-sm text-danger">{{ notesError }}</p><p v-else-if="!clinicalNotes.length" class="mt-2 text-sm text-muted-foreground">目前沒有可顯示的紀錄</p><article v-else class="mt-3 border-t border-border pt-3 text-sm"><p class="text-xs text-muted-foreground">{{ formatDateTime(clinicalNotes[0].entryDate) }}</p><p class="mt-1 whitespace-pre-wrap">{{ clinicalNotes[0].content }}</p></article></section>
          </div>
        </div>
        <div v-if="returning" class="space-y-2"><Label for="med-return">給醫師的意見</Label><Input id="med-return" v-model="returnReason" maxlength="500" :disabled="busy" placeholder="請說明需要重新確認的內容" /><p class="text-xs text-muted-foreground">送出後狀態會回到待醫師確認。</p></div>
      </div>
      <DialogFooter class="sticky bottom-0 z-10 flex-wrap">
        <Button variant="secondary" :disabled="busy" @click="close">關閉</Button>
        <template v-if="!terminal">
          <Button v-if="selected && !doctor && !returning" variant="secondary" :disabled="busy || stale" @click="requestAction('cancel')">取消藥單</Button>
          <template v-if="returning"><Button variant="secondary" :disabled="busy" @click="returning = false">返回</Button><Button :disabled="busy || stale || !returnReason.trim()" @click="execute('return', { reason: returnReason })">送回醫師重審</Button></template>
          <template v-else>
            <Button v-if="!selected" :disabled="busy || previousLoading || !pet" @click="execute('create')">建立並送醫師確認</Button>
            <Button v-if="selected && (clinicalEditable || (!doctor && selected.status === 'ready'))" variant="secondary" :disabled="busy || stale || !dirty" @click="requestAction('edit')">{{ changedClinical && selected.status !== 'review' ? '修改並重新送審' : '儲存修改' }}</Button>
            <Button v-if="doctor && selected?.status === 'review'" :disabled="busy || stale || !form.prescription.trim()" @click="requestAction('approve')">確認藥單並送交包藥</Button>
            <Button v-if="!doctor && selected?.status === 'approved'" variant="secondary" :disabled="busy || stale" @click="returning = true">提出意見</Button>
            <Button v-if="!doctor && selected?.status === 'approved'" :disabled="busy || stale" @click="requestAction('ready')">{{ selected.needsRepack ? '完成重新包藥' : '完成包藥' }}</Button>
            <Button v-if="!doctor && selected?.status === 'ready'" :disabled="busy || stale || dirty" @click="requestAction('collect')">確認領藥</Button>
          </template>
        </template>
      </DialogFooter>
    </ModalDialog>
  <ConfirmDialog v-if="confirmation" :open="true" :title="confirmation.title" :description="confirmation.description" @confirm="runConfirmation" @cancel="cancelConfirmation" />
</template>
