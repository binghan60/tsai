<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { Pill, Plus, SearchX, X } from '@lucide/vue';
import { useClientPagination } from '../composables/useClientPagination';
import { useDrugCabinet } from '../composables/useDrugCabinet';
import { useToast } from '../composables/useToast';
import { apiErrorMessage } from '../lib/apiError';
import SettingsLayout from '../components/SettingsLayout.vue';
import DataCard from '../components/DataCard.vue';
import EmptyState from '../components/EmptyState.vue';
import FilterBar from '../components/FilterBar.vue';
import ListFooter from '../components/ListFooter.vue';
import ListSkeleton from '../components/ListSkeleton.vue';
import ModalDialog from '../components/ModalDialog.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import RowActions from '../components/RowActions.vue';
import SegmentedControl from '../components/SegmentedControl.vue';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { DialogFooter, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';

// 藥櫃：打藥單時邊打邊跳的建議清單（診療台、藥單、病歷日誌的藥單欄位，以及開了「藥櫃建議」的健檢報告欄位）。
// 一筆就是一行要插進去的文字；新增可以一次貼很多行，一行一筆，已經有的略過。
const toast = useToast();
const { drugs, loadDrugs, createDrugs, updateDrug, deleteDrug } = useDrugCabinet();

const loading = ref(true);
const error = ref('');
const queryInput = ref('');
const query = ref('');
const status = ref('all');
const STATUS_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'enabled', label: '使用中' },
  { value: 'disabled', label: '已停用' },
];

const sortedDrugs = computed(() => [...drugs.value].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')));
const visibleDrugs = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  return sortedDrugs.value.filter((drug) => {
    if (status.value === 'enabled' && drug.enabled === false) return false;
    if (status.value === 'disabled' && drug.enabled !== false) return false;
    return !keyword || drug.name.toLowerCase().includes(keyword);
  });
});
const PAGE_SIZE = 20;
const { page, totalPages, pageItems } = useClientPagination(visibleDrugs, { pageSize: PAGE_SIZE });
watch(status, () => { page.value = 1; });
function applyFilters() {
  query.value = queryInput.value;
  page.value = 1;
}

// 新增與修改共用一個視窗。新增是一列一個輸入框（像 Vercel 的環境變數）：
// 貼上多行文字自動拆成多列、Enter 在下面開新的一列、空的一列按 Backspace 收掉。
const editor = ref(null); // { mode: 'create', rows: [{ id, text }] } ｜ { mode: 'edit', drug, text }
const saving = ref(false);
const editorError = ref('');
let rowSeq = 0;
const newRow = (text = '') => ({ id: ++rowSeq, text });
const rowInputId = (row) => `drug-row-${row.id}`;
const filledRows = computed(() => (editor.value?.mode === 'create' ? editor.value.rows.filter((row) => row.text.trim()) : []));
const canSave = computed(() => (editor.value?.mode === 'create' ? filledRows.value.length > 0 : Boolean(editor.value?.text.trim())));

function openCreate() {
  editor.value = { mode: 'create', rows: [newRow()] };
  editorError.value = '';
}
function openEdit(drug) {
  editor.value = { mode: 'edit', drug, text: drug.name };
  editorError.value = '';
}

async function focusRow(row) {
  await nextTick();
  document.getElementById(rowInputId(row))?.focus();
}
function addRow(after = editor.value.rows.at(-1)) {
  const rows = editor.value.rows;
  const row = newRow();
  rows.splice(rows.indexOf(after) + 1, 0, row);
  focusRow(row);
}
function removeRow(row) {
  const rows = editor.value.rows;
  const index = rows.indexOf(row);
  if (rows.length === 1) {
    row.text = '';
    focusRow(row);
    return;
  }
  rows.splice(index, 1);
  focusRow(rows[Math.max(0, index - 1)]);
}
// 貼上多行：游標所在那一列接第一行，其餘每行一列插在後面；空行略過。
function onRowPaste(row, event) {
  const pasted = event.clipboardData?.getData('text') ?? '';
  if (!/\r?\n/.test(pasted)) return;
  event.preventDefault();
  const lines = pasted.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return;
  const input = event.target;
  const before = row.text.slice(0, input.selectionStart ?? row.text.length);
  const after = row.text.slice(input.selectionEnd ?? row.text.length);
  const rows = editor.value.rows;
  row.text = before + lines[0];
  const added = lines.slice(1).map((line) => newRow(line));
  rows.splice(rows.indexOf(row) + 1, 0, ...added);
  const last = added.at(-1) ?? row;
  last.text += after;
  focusRow(last);
}
function onRowKeydown(row, event) {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    addRow(row);
  } else if (event.key === 'Backspace' && !row.text && editor.value.rows.length > 1) {
    event.preventDefault();
    removeRow(row);
  }
}

async function save() {
  if (!editor.value || saving.value || !canSave.value) return;
  saving.value = true;
  editorError.value = '';
  try {
    if (editor.value.mode === 'create') {
      const { created, skipped } = await createDrugs(filledRows.value.map((row) => row.text));
      if (created.length) toast.success(skipped.length ? `已新增 ${created.length} 筆，${skipped.length} 筆已在藥櫃裡` : `已新增 ${created.length} 筆`);
      else toast.info(`${skipped.length} 筆都已在藥櫃裡`);
    } else {
      const { drug } = editor.value;
      await updateDrug(drug._id, { name: editor.value.text, enabled: drug.enabled !== false, expectedVersion: drug.__v });
      toast.success('已更新');
    }
    editor.value = null;
  } catch (err) {
    editorError.value = apiErrorMessage(err, '儲存失敗');
    if (err.response?.status === 409) await loadDrugs({ force: true }).catch(() => {});
  } finally {
    saving.value = false;
  }
}

async function toggleEnabled(drug, enabled) {
  try {
    await updateDrug(drug._id, { name: drug.name, enabled, expectedVersion: drug.__v });
  } catch (err) {
    toast.error(apiErrorMessage(err, '更新失敗'));
    await loadDrugs({ force: true }).catch(() => {});
  }
}

const deleteTarget = ref(null);
const deleting = ref(false);
async function confirmDelete() {
  if (!deleteTarget.value || deleting.value) return;
  deleting.value = true;
  try {
    await deleteDrug(deleteTarget.value._id);
    toast.success(`已刪除「${deleteTarget.value.name}」`);
    deleteTarget.value = null;
  } catch (err) {
    toast.error(apiErrorMessage(err, '刪除失敗'));
  } finally {
    deleting.value = false;
  }
}

const ROW_ACTIONS = [{ key: 'delete', label: '刪除', danger: true }];

onMounted(async () => {
  try {
    await loadDrugs({ force: true });
  } catch {
    error.value = '藥櫃暫時無法載入，請稍後重試';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <SettingsLayout title="藥櫃">
    <template #actions>
      <Button type="button" @click="openCreate"><Plus stroke-width="1.75" />新增藥品</Button>
    </template>
    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
    <ListSkeleton v-if="loading" :rows="6" :avatar="false" />

    <DataCard v-else title="藥品" :count="visibleDrugs.length" style="--data-columns: minmax(18rem, 2fr) minmax(7rem, 1fr) 6rem 9rem">
      <template #filters>
        <SegmentedControl v-model="status" aria-label="依使用狀態篩選" :options="STATUS_FILTERS" />
        <FilterBar id="drug-search" v-model="queryInput" label="搜尋藥品" class="w-full min-w-0 md:w-80" @submit="applyFilters" />
      </template>
      <EmptyState v-if="!visibleDrugs.length" :icon="drugs.length ? SearchX : Pill" :title="drugs.length ? '找不到符合條件的藥品' : '藥櫃是空的'" inset>
        <Button v-if="!drugs.length" type="button" class="mt-4" @click="openCreate">新增藥品</Button>
      </EmptyState>
      <template v-else>
        <div class="hidden xl:block">
          <div class="desktop-data-header"><span>藥品</span><span>使用次數</span><span>啟用</span><span></span></div>
          <div v-for="drug in pageItems" :key="drug._id" class="desktop-data-row hover:bg-hover">
            <button type="button" class="desktop-data-cell min-w-0 text-left font-medium text-foreground hover:text-primary" @click="openEdit(drug)"><span class="block truncate" v-tip.overflow="drug.name">{{ drug.name }}</span></button>
            <span class="desktop-data-cell num text-sm text-muted-foreground">{{ drug.usageCount || '' }}</span>
            <span class="desktop-data-cell"><Switch :model-value="drug.enabled !== false" :aria-label="`啟用${drug.name}`" @update:model-value="toggleEnabled(drug, $event)" /></span>
            <span class="desktop-data-cell flex items-center justify-end gap-1">
              <Button type="button" variant="soft" size="sm" @click="openEdit(drug)">編輯</Button>
              <RowActions :actions="ROW_ACTIONS" :label="`${drug.name}的更多操作`" @select="deleteTarget = drug" />
            </span>
          </div>
        </div>
        <ul class="divide-y divide-border xl:hidden">
          <li v-for="drug in pageItems" :key="drug._id" class="flex items-center gap-3 px-4 py-3">
            <button type="button" class="min-w-0 flex-1 text-left font-medium text-foreground wrap-break-word" @click="openEdit(drug)">{{ drug.name }}</button>
            <Switch :model-value="drug.enabled !== false" :aria-label="`啟用${drug.name}`" @update:model-value="toggleEnabled(drug, $event)" />
            <RowActions :actions="ROW_ACTIONS" :label="`${drug.name}的更多操作`" @select="deleteTarget = drug" />
          </li>
        </ul>
      </template>
      <template v-if="visibleDrugs.length" #footer>
        <ListFooter :page="page" :total-pages="totalPages" :total="visibleDrugs.length" :page-size="PAGE_SIZE" @update:page="page = $event" />
      </template>
    </DataCard>

    <ModalDialog v-if="editor" @close="editor = null">
      <div class="p-6 pb-4 pr-16"><DialogTitle>{{ editor.mode === 'create' ? '新增藥品' : '編輯藥品' }}</DialogTitle></div>
      <form @submit.prevent="save">
        <div class="space-y-4 px-6 pb-6">
          <Alert v-if="editorError" variant="destructive"><AlertDescription>{{ editorError }}</AlertDescription></Alert>
          <div v-if="editor.mode === 'create'" class="space-y-2">
            <Label :for="rowInputId(editor.rows[0])">藥品</Label>
            <ul class="max-h-[50vh] space-y-2 overflow-y-auto p-0.5">
              <li v-for="(row, index) in editor.rows" :key="row.id" class="flex items-center gap-2">
                <Input
                  :id="rowInputId(row)"
                  v-model="row.text"
                  maxlength="200"
                  :aria-label="`藥品第 ${index + 1} 筆`"
                  :autofocus="index === 0"
                  @paste="onRowPaste(row, $event)"
                  @keydown="onRowKeydown(row, $event)"
                />
                <Button type="button" variant="secondary" size="icon" :aria-label="`移除第 ${index + 1} 筆`" v-tip="'移除'" @click="removeRow(row)"><X stroke-width="1.75" /></Button>
              </li>
            </ul>
            <Button type="button" variant="secondary" size="sm" @click="addRow()"><Plus stroke-width="1.75" />新增一列</Button>
          </div>
          <div v-else class="space-y-1.5">
            <Label for="drug-name">藥品</Label>
            <Input id="drug-name" v-model="editor.text" maxlength="200" autofocus />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" @click="editor = null">取消</Button>
          <Button type="submit" :disabled="saving || !canSave">{{ saving ? '儲存中…' : editor.mode === 'create' && filledRows.length > 1 ? `儲存 ${filledRows.length} 筆` : '儲存' }}</Button>
        </DialogFooter>
      </form>
    </ModalDialog>

    <ConfirmDialog :open="Boolean(deleteTarget)" title="刪除藥品" :description="`確定要從藥櫃刪除「${deleteTarget?.name || ''}」嗎？已經寫進藥單的文字不受影響。`" confirm-label="刪除" :loading="deleting" destructive @update:open="(value) => !value && (deleteTarget = null)" @confirm="confirmDelete" />
  </SettingsLayout>
</template>
