<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import PatientLink from './PatientLink.vue';
import { onBeforeRouteLeave } from 'vue-router';
import { http } from '../api/http';
import { getSocket } from '../api/socket';
import { formatDateTime, relativeTimeLabel } from '../lib/datetime';
import { MEDICATION_ACTIVE, MEDICATION_STAGES, medicationLabel } from '../../../shared/medicationWorkflow.js';
import ClinicalNotesPanel from './ClinicalNotesPanel.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import DataCard from './DataCard.vue';
import EmptyState from './EmptyState.vue';
import ListFooter from './ListFooter.vue';
import ListSkeleton from './ListSkeleton.vue';
import RowActions from './RowActions.vue';
import SpecGrid from './SpecGrid.vue';
import SpecCell from './SpecCell.vue';
import FilterTabs from './FilterTabs.vue';
import FilterBar from './FilterBar.vue';
import Pagination from './Pagination.vue';
import { Button } from './ui/button';
import { Input } from './ui/input';
import RichText from './RichText.vue';
import RichTextEditor from './RichTextEditor.vue';
import { richTextToPlain } from '../../../shared/richText.js';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Alert, AlertDescription } from './ui/alert';
import { ArrowLeft, Cat, ChevronDown, ChevronRight, ClipboardPlus, Copy, Pill, Plus, Search } from '@lucide/vue';
import { useToast } from '../composables/useToast';

// 藥單工作區。清單與單筆詳情是同一個容器內的兩個檢視（opened 切換），不是兩層 Modal——
// 舊版在 xl 的面板裡再開一個 xl 的 Modal，同尺寸疊同尺寸畫面幾乎不變、看起來像沒反應，
// 而詳情是有未儲存內容的表單，兩層遮罩疊著時按 Esc 會關掉哪一層沒有任何線索。
// 包藥本來就是「處理一筆、回清單、接下一筆」的批次工作，同容器切換正好是這個節奏。
const props = defineProps({
  mode: { type: String, required: true },
  initialFilter: { type: String, default: '' },
  stages: { type: Array, default: null },
  // 只開建立表單、不顯示清單：藥單面板推入的「新增藥單」那一層用它。
  // 標題與返回交給外層，建立成功或使用者離開時 emit('close') 讓外層退回清單。
  createOnly: { type: Boolean, default: false },
  // 右側面板（460px）：清單改成一張張卡片、詳情改成單欄，病歷日誌排在欄位下面。
  compact: { type: Boolean, default: false },
});
const emit = defineEmits(['counts', 'close', 'create']);
const doctor = computed(() => props.mode === 'doctor');
// 全頁版（/medications）：跟健檢報告清單同一種寫法——滿版清單（DataCard 分欄），點一筆整頁切換成詳情卡片，
// 左上返回鈕回清單。曾經試過左清單、右詳情並排，使用者要的是跟健檢報告一樣的清單。
// 已確認的藥單在詳情是唯讀檢視（藥單內容放大，方便拿藥包逐項對照），要改才切成編輯框。
const fullPage = computed(() => !props.compact && !props.createOnly);
const editing = ref(false);
const showNotes = ref(false);
const toast = useToast();
const filter = ref(props.initialFilter || (doctor.value ? 'review' : 'active'));
const queryInput = ref('');
const query = ref('');
const page = ref(1);
const totalPages = ref(1);
const pageSize = ref(25);
// 面板版是一張張高卡片，一頁 25 張要捲很久、頁碼形同虛設；每頁少一點，翻頁才有意義。全頁版照後端預設 25 筆。
const COMPACT_PAGE_SIZE = 8;
const compactList = ref(null);
const total = ref(0);
const items = ref([]);
const counts = ref({});
const loading = ref(true);
const error = ref('');
const busy = ref(false);
const opened = ref(props.createOnly);
const selected = ref(null);
const pet = ref(null);
const form = reactive({ condition: '', prescription: '', note: '' });
const initial = ref('');
const modalError = ref('');
const stale = ref(false);
const confirmation = ref(null);
const returning = ref(false);
const returnReason = ref('');
const notes = ref([]);
const notesLoading = ref(false);
const notesError = ref('');
const notePage = ref(1);
const noteTotalPages = ref(1);
const petQuery = ref('');
const petResults = ref([]);
const petLoading = ref(false);
const petError = ref('');
let listSequence = 0;
let searchSequence = 0;
let detailSequence = 0;
let notesSequence = 0;
let searchTimer;
const socket = getSocket();
// 「全部」含已取消，是查歷史用的總覽；各階段筆數加總就是它的筆數。
const allCount = computed(() => Object.values(counts.value).reduce((sum, count) => sum + count, 0));
const activeCount = computed(() => MEDICATION_ACTIVE.reduce((sum, key) => sum + (counts.value[key] || 0), 0));
const displayedStages = computed(() => props.stages?.length ? MEDICATION_STAGES.filter(stage => props.stages.includes(stage.key)) : MEDICATION_STAGES);
const terminal = computed(() => ['collected', 'cancelled'].includes(selected.value?.status));
const dirty = computed(() => opened.value && JSON.stringify(form) !== initial.value);
const clinicalEditable = computed(() => !terminal.value && (!selected.value || doctor.value || selected.value.status === 'review'));
// 右欄顯示編輯框的時機：新增藥單、按了「修改藥單」，或醫師正在審核（全頁版目前只有櫃台在用，保留給醫師的路徑）。
const showEditor = computed(() => !fullPage.value || !selected.value || editing.value || (doctor.value && clinicalEditable.value));
const changedClinical = computed(() => selected.value && ['condition', 'prescription', 'note'].some(key => form[key].trim() !== selected.value[key]));
function tone(status) {
  return { review: 'bg-warning-surface text-warning', approved: 'bg-info-surface text-info', ready: 'bg-accent text-accent-foreground', collected: 'bg-success-surface text-success' }[status] || 'bg-sunken text-muted-foreground';
}
const filterItems = computed(() => [
  { key: 'all', label: '全部' },
  ...(props.stages?.length ? [] : [{ key: 'active', label: '未完成' }]),
  // 側滑面板裡頁籤平分一列（FilterTabs 的 fit），長標籤給一個短的。
  ...displayedStages.value.map(stage => ({ key: stage.key, label: stage.label, ...(stage.key === 'review' ? { short: '待確認' } : {}) })),
]);
const filterCounts = computed(() => ({ all: allCount.value, active: activeCount.value, ...Object.fromEntries(displayedStages.value.map(stage => [stage.key, counts.value[stage.key] || 0])) }));

async function refresh() {
  const sequence = ++listSequence;
  try {
    const { data } = await http.get('/medications', { params: { status: filter.value, q: query.value, page: page.value, ...(props.compact ? { limit: COMPACT_PAGE_SIZE } : {}) } });
    if (sequence !== listSequence) return;
    items.value = data.items;
    counts.value = data.counts;
    total.value = data.total;
    totalPages.value = data.totalPages;
    pageSize.value = data.limit || pageSize.value;
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
// 面板版翻頁後捲回清單頂端，不然會停在上一頁的底部。
function goToPage(value) {
  page.value = value;
  compactList.value?.scrollIntoView({ block: 'start' });
}
function setFilter(value) { page.value = 1; filter.value = value; }
// 全頁版清單列上的 ⋯：列上的主要動作是確認領藥／完成包藥時，「查看藥單」收在這裡；取消藥單放最後。
function rowActions(item) {
  return [
    ...(nextAction(item) ? [{ key: 'open', label: '查看藥單' }] : []),
    ...(!['collected', 'cancelled'].includes(item.status) ? [{ key: 'cancel', label: '取消藥單', danger: true }] : []),
  ];
}
function runRowAction(key, item) {
  if (key === 'open') openOrder(item);
  else cancelFromList(item);
}
// 清單列上的 ⋯「取消藥單」：不必先點進去。
function cancelFromList(item) {
  selected.value = item;
  resetForm(item);
  confirmation.value = {
    title: `取消 ${item.petName} 的藥單？`,
    description: '取消後不再包藥或交付。',
    run: () => execute('cancel'),
    cancel: () => { selected.value = null; },
  };
}
async function copyPhone(phone) {
  try {
    await navigator.clipboard.writeText(phone);
    toast.success(phone, '已複製電話');
  } catch {
    toast.error('無法複製，請手動選取電話');
  }
}
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
  editing.value = false;
}
function create() {
  // 面板版的新增是推入另一層（有自己的返回鈕），交給外層處理。
  if (props.compact && !props.createOnly) { emit('create'); return; }
  selected.value = null;
  pet.value = null;
  petQuery.value = '';
  clearNotes();
  resetForm(null);
  opened.value = true;
}
function clearNotes() {
  notesSequence += 1;
  notes.value = [];
  notesLoading.value = false;
  notesError.value = '';
  notePage.value = 1;
  noteTotalPages.value = 1;
}
// 病歷日誌面板的翻頁與重新整理都走這支，永遠讀目前選定的貓咪；換貓咪或清空時 notesSequence 會讓還在路上的回應作廢。
async function loadNotes(nextPage = 1) {
  const petId = pet.value?._id;
  if (!petId) return;
  const sequence = ++notesSequence;
  notesLoading.value = true;
  notesError.value = '';
  try {
    const { data } = await http.get(`/pets/${petId}/clinical-notes`, { params: { page: nextPage, limit: 5 } });
    if (sequence !== notesSequence) return;
    const pages = data.totalPages || 1;
    if (nextPage > pages) return await loadNotes(pages);
    notes.value = data.items || [];
    notePage.value = nextPage;
    noteTotalPages.value = pages;
  } catch { if (sequence === notesSequence) notesError.value = '病歷日誌未能載入，請重試。'; }
  finally { if (sequence === notesSequence) notesLoading.value = false; }
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
    clearNotes();
    loadNotes();
  } catch (err) { error.value = err.response?.data?.message || '無法開啟藥單'; }
  finally { busy.value = false; }
}
function pickPet(value) {
  pet.value = value;
  petQuery.value = '';
  clearNotes();
  loadNotes();
}
function changePet() {
  const clear = () => { pet.value = null; resetForm(null); clearNotes(); detailSequence += 1; };
  if (dirty.value) confirmation.value = { title: '重新選擇貓咪？', description: '為避免混用藥單，會清除目前的近況、藥單和備註。', run: clear };
  else clear();
}
function leave() {
  opened.value = false;
  if (props.createOnly) emit('close');
}
// 全頁版：新增表單按「取消」、或修改到一半按「取消修改」。
function cancelEditing() {
  const run = () => {
    if (selected.value) resetForm(selected.value);
    else leave();
  };
  if (dirty.value) confirmation.value = { title: '捨棄未儲存的內容？', description: '本次尚未儲存的輸入會清除。', run };
  else run();
}
function close() {
  if (busy.value) return;
  if (dirty.value) confirmation.value = { title: '捨棄未儲存的內容？', description: props.createOnly ? '關閉後，本次尚未儲存的輸入會清除。' : '返回清單後，本次尚未儲存的輸入會清除。', run: leave };
  else leave();
}
defineExpose({ close, create });
function reload() {
  confirmation.value = { title: '載入最新藥單？', description: '會以最新藥單取代目前輸入，請先保留需要的文字。', run: () => openOrder(selected.value) };
}
async function execute(action, extra = {}) {
  if (busy.value || stale.value) return;
  if (!selected.value && !pet.value) { modalError.value = '請先選擇貓咪'; return; }
  busy.value = true;
  modalError.value = '';
  try {
    if (!selected.value) await http.post('/medications', { ...form, petId: pet.value._id });
    else await http.post(`/medications/${selected.value._id}/actions/${action}`, { ...form, version: selected.value.__v, ...extra });
    leave();
    selected.value = null;
    await refresh();
  } catch (err) {
    modalError.value = err.response?.data?.message || '儲存失敗，請重試';
    if (err.response?.status === 409) stale.value = true;
    // 從清單直接操作時沒有開著的詳情可以顯示 modalError，要改報在清單上，並放掉暫存的 selected，
    // 否則它會留著跟後續列表更新比對版本、把之後每一次操作都擋成「已過期」。
    if (!opened.value) { error.value = modalError.value; selected.value = null; stale.value = false; refresh(); }
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
// 清單上的「完成」：跟詳情裡的「完成包藥」「確認領藥」是同一個動作，只是不必先點進去。
// 待醫師確認（還在等醫師）與已結束的藥單沒有下一步，所以不出現。
function nextAction(item) { return { approved: 'ready', ready: 'collect' }[item.status] || ''; }
function completeLabel(item) { return nextAction(item) === 'ready' ? `完成 ${item.petName} 的包藥` : `確認 ${item.petName} 已領藥`; }
function completeFromList(item) {
  const action = nextAction(item);
  if (!action || busy.value) return;
  selected.value = item;
  resetForm(item);
  const cancel = () => { selected.value = null; };
  // 清單上一鍵就送出，比在詳情裡多一道確認；重新包藥與領藥本來就有確認，直接沿用。
  if (action === 'ready' && !item.needsRepack) confirmation.value = { title: `確認 ${item.petName} 的藥已包好？`, description: '確認後藥單進入待領藥，飼主即可領取。', run: () => execute('ready'), cancel };
  else {
    requestAction(action);
    if (confirmation.value) confirmation.value.cancel = cancel;
  }
}
// 全頁版右欄底部：一顆主要動作（依階段），其餘收進 ⋯ 選單，取消藥單放最後、紅字。
const primaryAction = computed(() => {
  const order = selected.value;
  if (!order || terminal.value || returning.value || editing.value) return null;
  if (doctor.value) return order.status === 'review' ? { key: 'approve', label: '確認藥單並送交包藥', disabled: !richTextToPlain(form.prescription).trim() } : null;
  if (order.status === 'approved') return { key: 'ready', label: order.needsRepack ? '完成重新包藥' : '完成包藥' };
  if (order.status === 'ready') return { key: 'collect', label: '確認領藥', disabled: dirty.value };
  return null;
});
const moreActions = computed(() => {
  const order = selected.value;
  if (!order || terminal.value || returning.value || editing.value || doctor.value) return [];
  return [
    ...(clinicalEditable.value ? [{ key: 'edit', label: '修改藥單' }] : []),
    ...(order.status === 'approved' ? [{ key: 'return', label: '提出意見' }] : []),
    { key: 'cancel', label: '取消藥單', danger: true },
  ];
});
function runMoreAction(key) {
  if (key === 'edit') editing.value = true;
  else if (key === 'return') returning.value = true;
  else requestAction(key);
}
function runConfirmation() { const run = confirmation.value?.run; confirmation.value = null; run?.(); }
function cancelConfirmation() { confirmation.value?.cancel?.(); confirmation.value = null; }
if (props.createOnly) create();
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
  listSequence += 1; searchSequence += 1; detailSequence += 1; notesSequence += 1;
  socket.off('medication:updated', sync); socket.off('connect', sync);
});
</script>

<template>
  <section
    aria-label="藥單工作區"
    class="flex min-h-0 flex-1 flex-col gap-3"
  >
    <!-- 全頁版清單：跟健檢報告清單同一個模板（DataCard 分欄、列上一顆主要動作＋⋯）。點貓咪整頁切到詳情。 -->
    <DataCard v-if="fullPage && !opened" title="藥單" :count="loading && !total ? null : total" style="--data-columns: minmax(13rem, 1.3fr) minmax(16rem, 2.4fr) 9rem 10rem 13rem">
      <template #filters>
        <FilterBar id="medication-search" v-model="queryInput" label="搜尋藥單" placeholder="貓咪、飼主或電話" class="w-full min-w-0 md:w-[26rem]" @submit="applySearch" />
      </template>
      <template #tabs>
        <FilterTabs :model-value="filter" :items="filterItems" :counts="filterCounts" aria-label="藥單狀態篩選" @update:model-value="setFilter" />
      </template>
      <Alert v-if="error" variant="destructive" class="m-4"><AlertDescription>{{ error }}</AlertDescription></Alert>
      <ListSkeleton v-if="loading && !items.length" :rows="5" inset />
      <EmptyState v-else-if="!items.length" :icon="Pill" :title="error ? '暫時無法載入藥單' : '目前沒有符合條件的藥單'" description="飼主來電續藥時，按右上角「新增藥單」登記。" inset />
      <template v-else>
      <!-- 桌機：一列一張藥單。需重新包藥的列左側一條紅線。 -->
      <div class="hidden xl:block">
        <div class="desktop-data-header">
          <span>貓咪</span><span>藥單內容</span><span>登記</span><span>狀態</span><span></span>
        </div>
        <div v-for="item in items" :key="item._id" data-medication-row class="desktop-data-row hover:bg-hover" :class="item.needsRepack ? 'shadow-[inset_3px_0_0_var(--danger)]' : ''">
          <span class="desktop-data-cell flex min-w-0 items-center gap-3">
            <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground"><Cat class="size-5" stroke-width="1.75" /></span>
            <span class="min-w-0">
              <span class="block truncate font-semibold"><PatientLink :pet-id="item.petId">{{ item.petName }}</PatientLink></span>
              <span class="flex gap-2 text-sm text-muted-foreground"><span class="truncate"><PatientLink v-if="item.ownerName" :pet-id="item.petId" quiet>{{ item.ownerName }}</PatientLink><template v-else>飼主未記錄</template></span><span class="num shrink-0">{{ item.ownerPhone }}</span></span>
            </span>
          </span>
          <!-- 貓咪名、飼主名連到貓咪詳情；點藥單內容才是開這張藥單。 -->
          <button type="button" class="desktop-data-cell truncate text-left text-sm hover:text-primary" :disabled="busy" :aria-label="`開啟 ${item.petName} 的藥單`" v-tip.overflow="richTextToPlain(item.prescription)" @click="openOrder(item)">{{ richTextToPlain(item.prescription).replace(/\n+/g, '；') || '—' }}</button>
          <span class="desktop-data-cell">
            <span class="num block text-sm">{{ formatDateTime(item.createdAt, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) }}</span>
            <span class="block text-xs text-subtle-foreground">{{ relativeTimeLabel(item.createdAt) }}</span>
          </span>
          <span class="desktop-data-cell flex flex-wrap items-center gap-1.5">
            <Badge variant="status" :class="tone(item.status)">{{ medicationLabel(item.status) }}</Badge>
            <Badge v-if="item.needsRepack" variant="status" class="bg-danger-surface text-danger">需重新包藥</Badge>
          </span>
          <span class="desktop-data-cell flex items-center justify-end gap-1">
            <Button v-if="nextAction(item)" variant="soft" size="sm" :disabled="busy" :aria-label="completeLabel(item)" @click="completeFromList(item)">{{ nextAction(item) === 'ready' ? '完成包藥' : '確認領藥' }}</Button>
            <Button v-else variant="soft" size="sm" :disabled="busy" @click="openOrder(item)">查看</Button>
            <RowActions v-if="nextAction(item) || !['collected', 'cancelled'].includes(item.status)" :actions="rowActions(item)" :label="`${item.petName} 藥單的更多操作`" @select="(key) => runRowAction(key, item)" />
            <span v-else class="size-9 shrink-0" aria-hidden="true" />
          </span>
        </div>
      </div>

      <!-- 窄螢幕：一張藥單一張小卡。 -->
      <ul class="divide-y divide-border xl:hidden">
        <li v-for="item in items" :key="item._id" class="space-y-2 px-4 py-3" :class="item.needsRepack ? 'shadow-[inset_3px_0_0_var(--danger)]' : ''">
          <div class="flex items-start gap-3">
            <div class="min-w-0 flex-1">
              <span class="block truncate font-semibold"><PatientLink :pet-id="item.petId">{{ item.petName }}</PatientLink></span>
              <span class="flex gap-3 text-sm text-muted-foreground"><span class="truncate"><PatientLink v-if="item.ownerName" :pet-id="item.petId" quiet>{{ item.ownerName }}</PatientLink></span><span class="num shrink-0">{{ relativeTimeLabel(item.createdAt) }}</span></span>
            </div>
            <RowActions v-if="nextAction(item) || !['collected', 'cancelled'].includes(item.status)" :actions="rowActions(item)" :label="`${item.petName} 藥單的更多操作`" @select="(key) => runRowAction(key, item)" />
          </div>
          <p class="line-clamp-2 text-sm">{{ richTextToPlain(item.prescription) || '—' }}</p>
          <div class="flex flex-wrap items-center gap-1.5">
            <Badge variant="status" :class="tone(item.status)">{{ medicationLabel(item.status) }}</Badge>
            <Badge v-if="item.needsRepack" variant="status" class="bg-danger-surface text-danger">需重新包藥</Badge>
            <Button v-if="nextAction(item)" variant="soft" size="sm" class="ml-auto" :disabled="busy" @click="completeFromList(item)">{{ nextAction(item) === 'ready' ? '完成包藥' : '確認領藥' }}</Button>
            <Button v-else variant="soft" size="sm" class="ml-auto" :disabled="busy" @click="openOrder(item)">查看</Button>
          </div>
        </li>
      </ul>
      </template>
      <template v-if="!loading && items.length" #footer>
        <ListFooter :page="page" :total-pages="totalPages" :total="total" :page-size="pageSize" @update:page="page = $event" />
      </template>
    </DataCard>

    <!-- 面板版：清單與詳情在同一個容器內切換。 -->
    <template v-else-if="!opened">
    <div class="flex flex-wrap items-center gap-2">
      <FilterBar id="medication-search" v-model="queryInput" label="搜尋藥單" placeholder="貓咪、飼主或電話" class="min-w-0 flex-1" @submit="applySearch" />
      <Button v-if="!doctor" class="ml-auto" @click="create"><Plus stroke-width="1.75" />新增藥單</Button>
    </div>
    <FilterTabs :model-value="filter" :items="filterItems" :counts="filterCounts" aria-label="藥單狀態篩選" fit @update:model-value="setFilter" />
    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
    <ul v-if="compact" ref="compactList" class="-mx-5 divide-y divide-border border-y border-border">
      <li v-if="loading && !items.length" class="px-5 py-10 text-center text-muted-foreground">載入藥單中…</li>
      <li v-else-if="!items.length" class="px-5 py-10 text-center text-muted-foreground">{{ error ? '暫時無法載入藥單' : '目前沒有符合條件的藥單' }}</li>
      <li v-for="item in items" :key="item._id" data-medication-row class="space-y-2 px-5 py-3.5">
        <div class="flex items-start gap-3">
          <div class="min-w-0 flex-1">
            <span class="block truncate text-base font-semibold"><PatientLink :pet-id="item.petId">{{ item.petName }}</PatientLink></span>
            <span class="flex items-baseline gap-3 text-sm"><span class="truncate"><PatientLink v-if="item.ownerName" :pet-id="item.petId" quiet>{{ item.ownerName }}</PatientLink></span><span class="num shrink-0 text-muted-foreground">{{ item.ownerPhone }}</span></span>
          </div>
          <Badge variant="status" :class="tone(item.status)">{{ medicationLabel(item.status) }}</Badge>
        </div>
        <RichText v-if="item.prescription" tag="p" :text="item.prescription" class="line-clamp-3 rounded-lg bg-sunken px-3 py-2 text-sm" />
        <p v-if="item.needsRepack" class="text-sm font-semibold text-danger">暫停處理，需重新包藥</p>
        <div class="flex items-center gap-2">
          <span class="num text-xs text-subtle-foreground">{{ formatDateTime(item.createdAt) }}</span>
          <span class="ml-auto flex gap-1.5">
            <Button v-if="!doctor && nextAction(item)" size="xs" :disabled="busy" :aria-label="completeLabel(item)" @click="completeFromList(item)">{{ nextAction(item) === 'ready' ? '完成包藥' : '確認領藥' }}</Button>
            <Button size="xs" variant="soft" :disabled="busy" :aria-label="`開啟 ${item.petName} 的藥單`" @click="openOrder(item)">{{ doctor && item.status === 'review' ? '審核' : '開啟' }}</Button>
          </span>
        </div>
      </li>
    </ul>
    <Pagination :page="page" :total-pages="totalPages" @update:page="goToPage" />
    </template>

    <!-- 詳情。全頁版是一張卡片（取代清單）；面板版直接排在容器裡（contents，不多一層）。 -->
    <div v-if="opened" :class="fullPage ? 'flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card' : 'contents'">
      <template v-if="opened">
      <!-- 全頁版標頭：貓咪與狀態，下面規格欄（飼主、電話、登記時間），跟看診工作區、櫃台處理視窗同一種寫法。 -->
      <header v-if="fullPage && selected" class="flex flex-col gap-3 border-b border-border px-6 py-4">
        <div class="flex flex-wrap items-center gap-2.5">
          <Button variant="secondary" size="icon-sm" :disabled="busy" aria-label="返回清單" @click="close"><ArrowLeft stroke-width="1.75" /></Button>
          <h2 class="text-xl font-semibold"><PatientLink :pet-id="selected.petId">{{ selected.petName }}</PatientLink></h2>
          <Badge variant="status" :class="tone(selected.status)">{{ medicationLabel(selected.status) }}</Badge>
          <Badge v-if="dirty" variant="status" class="ml-auto bg-warning-surface text-warning">有未儲存內容</Badge>
        </div>
        <SpecGrid>
          <SpecCell label="飼主"><PatientLink v-if="selected.ownerName" :pet-id="selected.petId" quiet>{{ selected.ownerName }}</PatientLink><template v-else>未記錄</template></SpecCell>
          <SpecCell label="電話" mono>
            <span class="flex items-center gap-1.5">{{ selected.ownerPhone || '—' }}<Button v-if="selected.ownerPhone" type="button" variant="secondary" size="icon-xs" :aria-label="`複製 ${selected.ownerName || selected.petName} 的電話`" @click="copyPhone(selected.ownerPhone)"><Copy stroke-width="1.75" /></Button></span>
          </SpecCell>
          <SpecCell label="登記" mono>{{ formatDateTime(selected.createdAt, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) }}</SpecCell>
        </SpecGrid>
      </header>
      <header v-else-if="fullPage" class="flex items-center gap-2.5 border-b border-border px-6 py-4">
        <Button variant="secondary" size="icon-sm" :disabled="busy" aria-label="返回清單" @click="close"><ArrowLeft stroke-width="1.75" /></Button>
        <ClipboardPlus class="size-5 text-primary" stroke-width="1.75" aria-hidden="true" />
        <div class="min-w-0">
          <h2 class="text-xl font-semibold">新增藥單</h2>
          <p class="text-sm text-muted-foreground">記錄飼主需求並建立藥單，送交醫師確認後再包藥。</p>
        </div>
        <Badge v-if="dirty" variant="status" class="ml-auto bg-warning-surface text-warning">有未儲存內容</Badge>
      </header>
      <div v-if="!createOnly && !fullPage" class="flex shrink-0 flex-wrap items-center gap-3 border-b border-border pb-3">
        <Button v-if="!compact" variant="secondary" :disabled="busy" @click="close"><ArrowLeft stroke-width="1.75" />返回清單</Button>
        <Button v-else variant="secondary" size="icon-sm" :disabled="busy" aria-label="返回清單" @click="close"><ArrowLeft stroke-width="1.75" /></Button>
        <div class="min-w-0">
          <p class="flex items-center gap-2 text-base font-semibold">
            <ClipboardPlus v-if="!selected" class="h-5 w-5 text-primary" stroke-width="1.75" aria-hidden="true" />
            <template v-if="selected"><PatientLink :pet-id="selected.petId">{{ selected.petName }}</PatientLink> 的藥單</template><template v-else>新增藥單</template>
            <Badge v-if="selected" variant="status" :class="tone(selected.status)">{{ medicationLabel(selected.status) }}</Badge>
          </p>
          <p v-if="selected" class="flex gap-3 text-sm"><PatientLink v-if="selected.ownerName" :pet-id="selected.petId" quiet>{{ selected.ownerName }}</PatientLink><span class="num text-muted-foreground">{{ selected.ownerPhone }}</span></p>
          <p v-else class="text-sm text-muted-foreground">記錄飼主需求並建立藥單，送交醫師確認後再包藥。</p>
        </div>
        <Badge v-if="dirty" variant="status" class="ml-auto bg-warning-surface text-warning">有未儲存內容</Badge>
      </div>
      <!-- 排版跟診療台的看診工作區一致：左欄是要填的欄位，右欄是歷次病歷日誌（可分頁、可捲動）。
           xl 以上兩欄各自捲動、整個面板不捲；較窄時上下堆疊、整個容器一起捲。 -->
      <div class="flex min-h-0 flex-1 flex-col gap-4" :class="fullPage ? 'px-6 py-5' : compact ? 'overflow-y-auto pr-1' : 'overflow-y-auto pr-1 xl:overflow-hidden'">
        <Alert v-if="stale" class="shrink-0" variant="destructive"><AlertDescription>藥單已被其他工作台更新，目前輸入已保留。請載入最新內容後再操作。<Button size="sm" variant="secondary" class="ml-2" @click="reload">載入最新藥單</Button></AlertDescription></Alert>
        <Alert v-if="selected?.needsRepack" class="shrink-0" variant="destructive"><AlertDescription>藥單在包藥完成後曾修改，請停止使用原藥包。待醫師重新確認後，請依最新藥單重新包藥。</AlertDescription></Alert>
        <Alert v-if="modalError" class="shrink-0" variant="destructive"><AlertDescription>{{ modalError }}</AlertDescription></Alert>


        <!-- 全頁版的唯讀檢視：藥單內容是主角（櫃台拿藥包逐項對照），其餘是「標籤｜內容」列，跟病歷日誌卡片同一種寫法。 -->
        <template v-if="!showEditor">
          <section class="space-y-2" aria-labelledby="med-prescription-title">
            <h3 id="med-prescription-title" class="text-sm font-semibold text-muted-foreground">藥單內容</h3>
            <div class="rounded-xl border border-border-strong bg-sunken px-5 py-4 text-lg leading-relaxed">
              <RichText v-if="richTextToPlain(selected.prescription).trim()" tag="div" :text="selected.prescription" class="whitespace-pre-line" />
              <p v-else class="text-base text-subtle-foreground">尚未填寫藥單內容</p>
            </div>
          </section>
          <dl class="divide-y divide-border rounded-xl border border-border">
            <div class="grid gap-1 px-4 py-3 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-4">
              <dt class="text-sm font-medium text-muted-foreground">飼主回報</dt>
              <dd><RichText v-if="richTextToPlain(selected.condition).trim()" tag="div" :text="selected.condition" class="whitespace-pre-line" /><span v-else class="text-subtle-foreground">—</span></dd>
            </div>
            <div class="grid gap-1 px-4 py-3 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-4">
              <dt class="text-sm font-medium text-muted-foreground">處理備註</dt>
              <dd><RichText v-if="richTextToPlain(selected.note).trim()" tag="div" :text="selected.note" class="whitespace-pre-line" /><span v-else class="text-subtle-foreground">—</span></dd>
            </div>
          </dl>
          <div v-if="returning" class="space-y-2"><Label for="med-return">給醫師的意見</Label><Input id="med-return" v-model="returnReason" maxlength="500" :disabled="busy" placeholder="請說明需要重新確認的內容" /><p class="text-xs text-muted-foreground">送出後狀態會回到待醫師確認。</p></div>
          <!-- 交藥時用不太到，預設收合。 -->
          <section class="rounded-xl border border-border">
            <button type="button" class="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold hover:bg-hover" :aria-expanded="showNotes" @click="showNotes = !showNotes">
              <component :is="showNotes ? ChevronDown : ChevronRight" class="size-4" stroke-width="1.75" />歷次病歷日誌
            </button>
            <div v-if="showNotes" class="h-[28rem] border-t border-border p-3">
              <ClinicalNotesPanel :notes="notes" :loading="notesLoading" :error="notesError" :page="notePage" :total-pages="noteTotalPages" :pet-id="pet?._id || ''" unlinked-text="選擇貓咪後顯示歷次病歷日誌。" fill class="h-full" @load="loadNotes" @saved="loadNotes(notePage)" />
            </div>
          </section>
        </template>

        <div v-else class="grid gap-5" :class="compact ? '' : 'xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_26rem] xl:grid-rows-[minmax(0,1fr)]'">
          <div class="space-y-5" :class="compact ? '' : 'xl:min-h-0 xl:overflow-y-auto xl:pr-1'">
            <template v-if="!selected">
              <section class="space-y-3" aria-labelledby="med-pet-section-title">
                <div class="flex items-center gap-2">
                  <span class="num flex size-6 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">1</span>
                  <h3 id="med-pet-section-title" class="text-base font-semibold">選擇貓咪</h3>
                </div>
    
                <div v-if="pet" class="flex items-center gap-3 rounded-xl bg-accent px-4 py-3">
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-semibold text-accent-foreground">{{ pet.name }}<span v-if="pet.breed || pet.species" class="ml-2 text-sm font-normal text-accent-foreground/75">{{ pet.breed || pet.species }}</span></p>
                    <p class="mt-0.5 flex gap-3 truncate text-sm text-accent-foreground/80"><span>{{ pet.ownerId?.name || '飼主資料未填' }}</span><span v-if="pet.ownerId?.phone" class="num">{{ pet.ownerId.phone }}</span></p>
                  </div>
                  <Button size="sm" variant="secondary" :disabled="busy" @click="changePet">更換</Button>
                </div>
                <template v-else>
                  <div class="relative">
                    <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" stroke-width="1.75" aria-hidden="true" />
                    <Input id="med-pet-search" v-model="petQuery" inputmode="search" autocomplete="off" autofocus class="h-11 pl-9" placeholder="搜尋貓咪名字、飼主姓名或電話" />
                  </div>
                  <div v-if="petQuery.trim()" class="overflow-hidden rounded-xl border border-border" aria-live="polite">
                    <p v-if="petLoading" class="px-4 py-3 text-sm text-muted-foreground">搜尋中…</p>
                    <p v-else-if="petError" class="px-4 py-3 text-sm text-danger">{{ petError }}</p>
                    <p v-else-if="!petResults.length" class="px-4 py-3 text-sm text-muted-foreground">找不到符合的貓咪，請確認是否已建檔。</p>
                    <button v-for="candidate in petResults" v-else :key="candidate._id" type="button" class="flex w-full items-center gap-3 border-b border-border bg-card px-4 py-3 text-left last:border-b-0 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none" @click="pickPet(candidate)">
                      <span class="min-w-0 flex-1"><span class="flex items-baseline gap-2"><span class="truncate font-semibold text-primary">{{ candidate.name }}</span><span class="truncate text-sm text-subtle-foreground">{{ candidate.breed || candidate.species }}</span></span><span class="flex gap-3 text-sm text-muted-foreground"><span class="truncate">{{ candidate.ownerId?.name }}</span><span class="num shrink-0">{{ candidate.ownerId?.phone }}</span></span></span>
                    </button>
                  </div>
                  <p v-else class="text-sm text-muted-foreground">建立藥單前要選定已建檔的貓咪；下方欄位可以先填。</p>
                </template>
              </section>

              <!-- 欄位一開始就全部展開，不等選好貓咪才冒出來：櫃台電話講到一半可以先打需求、
                   再回頭找貓咪；只有右欄病歷日誌要等選好貓咪才有內容。
                   藥單內容不是必填：電話續藥常常已經知道要開什麼，先寫上去，醫師確認時會再核對、修改。 -->
              <section class="space-y-4 border-t border-border pt-5" aria-labelledby="med-request-section-title">
                <div class="flex items-center gap-2">
                  <span class="num flex size-6 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">2</span>
                  <h3 id="med-request-section-title" class="text-base font-semibold">填寫本次需求</h3>
                </div>
                <div class="space-y-1.5">
                  <Label for="med-condition" class="text-xs font-medium">本次續藥需求／飼主回報</Label>
                  <RichTextEditor id="med-condition" v-model="form.condition" aria-label="本次續藥需求／飼主回報" :min-rows="5" :maxlength="5000" :disabled="busy" placeholder="例如：原藥即將用完，近期食慾正常；希望續開一個月份量。" />
                </div>
                <div class="space-y-1.5">
                  <Label for="med-prescription" class="text-xs font-medium">藥單內容（選填）</Label>
                  <RichTextEditor id="med-prescription" v-model="form.prescription" aria-label="藥單內容" :min-rows="8" :maxlength="10000" :disabled="busy" placeholder="請輸入藥品名稱、劑量、頻次、天數及用藥指示" />
                  <p class="text-xs text-muted-foreground">送出後由醫師核對，內容可以由醫師再修改；還不確定可以先留白。</p>
                </div>
                <div class="space-y-1.5">
                  <Label for="med-note" class="text-xs font-medium">預計領藥／櫃台備註（選填）</Label>
                  <RichTextEditor id="med-note" v-model="form.note" aria-label="備註" :min-rows="3" :maxlength="3000" :disabled="busy" placeholder="例如：今天 17:00 後領取" />
                </div>
              </section>
            </template>

            <template v-else>
              <div class="space-y-1.5"><Label for="med-condition">飼主回報</Label><RichTextEditor id="med-condition" v-model="form.condition" aria-label="飼主回報" :min-rows="5" :maxlength="5000" :disabled="busy || !clinicalEditable" placeholder="食慾、精神、症狀變化…" /></div>
              <div class="space-y-1.5"><Label for="med-prescription">藥單內容</Label><RichTextEditor id="med-prescription" v-model="form.prescription" aria-label="藥單內容" :min-rows="10" :maxlength="10000" :disabled="busy || !clinicalEditable" placeholder="請輸入藥品名稱、劑量、頻次、天數及用藥指示" /><p v-if="!terminal" class="text-xs text-muted-foreground">{{ doctor ? '請核對藥單內容後送交包藥。後續若修改內容，須重新進行醫師確認。' : '藥單經醫師確認後，包藥人員即可開始處理。' }}</p></div>
              <div class="space-y-1.5"><Label for="med-note">處理備註</Label><RichTextEditor id="med-note" v-model="form.note" aria-label="處理備註" :min-rows="3" :maxlength="3000" :disabled="busy || !clinicalEditable" placeholder="預計領藥時間、需向飼主確認的事項…" /></div>
            </template>

            <div v-if="returning" class="space-y-2"><Label for="med-return">給醫師的意見</Label><Input id="med-return" v-model="returnReason" maxlength="500" :disabled="busy" placeholder="請說明需要重新確認的內容" /><p class="text-xs text-muted-foreground">送出後狀態會回到待醫師確認。</p></div>
          </div>

          <div class="h-[28rem]" :class="compact ? '' : 'xl:h-auto xl:min-h-0'">
            <ClinicalNotesPanel :notes="notes" :loading="notesLoading" :error="notesError" :page="notePage" :total-pages="noteTotalPages" :pet-id="pet?._id || ''" unlinked-text="選擇貓咪後顯示歷次病歷日誌。" fill class="h-full" @load="loadNotes" @saved="loadNotes(notePage)" />
          </div>
        </div>
      </div>

      <!-- 全頁版底部：一顆主要動作，其餘收進 ⋯。 -->
      <footer v-if="fullPage" class="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-3.5">
        <p v-if="terminal" class="mr-auto text-sm text-muted-foreground">這筆藥單已結束，內容唯讀。</p>
        <template v-else-if="returning">
          <Button variant="secondary" :disabled="busy" @click="returning = false">返回</Button>
          <Button :disabled="busy || stale || !returnReason.trim()" @click="execute('return', { reason: returnReason })">送回醫師重審</Button>
        </template>
        <template v-else-if="!selected">
          <Button variant="secondary" :disabled="busy" @click="cancelEditing">取消</Button>
          <Button :disabled="busy || !pet" @click="execute('create')">建立並送醫師確認</Button>
        </template>
        <template v-else-if="editing">
          <Button variant="secondary" :disabled="busy" @click="cancelEditing">取消修改</Button>
          <Button :disabled="busy || stale || !dirty" @click="requestAction('edit')">{{ changedClinical && selected.status !== 'review' ? '修改並重新送審' : '儲存修改' }}</Button>
        </template>
        <template v-else>
          <RowActions v-if="moreActions.length" :actions="moreActions" :label="`${selected.petName} 藥單的更多操作`" @select="runMoreAction" />
          <Button v-if="primaryAction" :disabled="busy || stale || primaryAction.disabled" @click="requestAction(primaryAction.key)">{{ primaryAction.label }}</Button>
        </template>
      </footer>
      <div v-else class="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        <template v-if="!terminal">
          <Button v-if="selected && !doctor && !returning" variant="secondary" :disabled="busy || stale" @click="requestAction('cancel')">取消藥單</Button>
          <template v-if="returning"><Button variant="secondary" :disabled="busy" @click="returning = false">返回</Button><Button :disabled="busy || stale || !returnReason.trim()" @click="execute('return', { reason: returnReason })">送回醫師重審</Button></template>
          <template v-else>
            <Button v-if="!selected" :disabled="busy || !pet" @click="execute('create')">建立並送醫師確認</Button>
            <Button v-if="selected && (clinicalEditable || (!doctor && selected.status === 'ready'))" variant="secondary" :disabled="busy || stale || !dirty" @click="requestAction('edit')">{{ changedClinical && selected.status !== 'review' ? '修改並重新送審' : '儲存修改' }}</Button>
            <Button v-if="doctor && selected?.status === 'review'" :disabled="busy || stale || !richTextToPlain(form.prescription).trim()" @click="requestAction('approve')">確認藥單並送交包藥</Button>
            <Button v-if="!doctor && selected?.status === 'approved'" variant="secondary" :disabled="busy || stale" @click="returning = true">提出意見</Button>
            <Button v-if="!doctor && selected?.status === 'approved'" :disabled="busy || stale" @click="requestAction('ready')">{{ selected.needsRepack ? '完成重新包藥' : '完成包藥' }}</Button>
            <Button v-if="!doctor && selected?.status === 'ready'" :disabled="busy || stale || dirty" @click="requestAction('collect')">確認領藥</Button>
          </template>
        </template>
        <p v-else class="text-xs text-muted-foreground">這筆藥單已結束，內容唯讀。</p>
      </div>
      </template>
    </div>
  </section>

  <ConfirmDialog v-if="confirmation" :open="true" :title="confirmation.title" :description="confirmation.description" @confirm="runConfirmation" @cancel="cancelConfirmation" />
</template>
