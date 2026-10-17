<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { GripVertical, Pencil, Pill, Plus, SearchX, Trash2, X } from '@lucide/vue';
import { useDragReorder } from '../composables/useDragReorder';
import { useGridDragReorder } from '../composables/useGridDragReorder';
import { useDrugCabinet } from '../composables/useDrugCabinet';
import { useToast } from '../composables/useToast';
import { apiErrorMessage } from '../lib/apiError';
import { groupDrugs } from '../lib/drugGroups';
import { stepBeforeId } from '../lib/dragReorder';
import { escapeRichText, richTextToPlain } from '../../../shared/richText.js';
import RichText from '../components/RichText.vue';
import RichTextEditor from '../components/RichTextEditor.vue';
import SettingsLayout from '../components/SettingsLayout.vue';
import EmptyState from '../components/EmptyState.vue';
import FilterBar from '../components/FilterBar.vue';
import ListSkeleton from '../components/ListSkeleton.vue';
import ModalDialog from '../components/ModalDialog.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { DialogFooter, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Switch } from '../components/ui/switch';

// 藥櫃：藥品分組、手動排序。打藥單時邊打邊跳的建議清單，以及藥單欄位旁的「藥櫃」視窗（分類＋勾選多選）都讀這裡。
// 一筆就是一行要插進去的文字；新增可以一次貼很多行，一行一筆，已經有的略過。一個藥品只屬於一個分類。
const toast = useToast();
const {
  drugs, groups, loadDrugs, createDrugs, updateDrug, deleteDrug, moveDrug,
  createGroup, renameGroup, moveGroup, deleteGroup,
} = useDrugCabinet();

const NONE = '__none__'; // 未分類在畫面與下拉裡的 key（資料上是 groupId null）
const loading = ref(true);
const error = ref('');
const queryInput = ref('');
const query = ref('');

const sections = computed(() => groupDrugs(groups.value, drugs.value));
const keyOf = (section) => section.id ?? NONE;
const activeKey = ref(NONE);
// 預設選第一個分類；選的分類被刪（另一台剛刪）時退回未分類。
watch(sections, (next) => {
  if (!next.some((section) => keyOf(section) === activeKey.value)) activeKey.value = NONE;
});
const activeSection = computed(() => sections.value.find((section) => keyOf(section) === activeKey.value) ?? sections.value.at(-1));
const realSections = computed(() => sections.value.filter((section) => section.id !== null));

const searching = computed(() => query.value.trim().length > 0);
const visibleDrugs = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  const rows = activeSection.value?.drugs ?? [];
  return keyword ? rows.filter((drug) => richTextToPlain(drug.name).toLowerCase().includes(keyword)) : rows;
});
function applyFilters() {
  query.value = queryInput.value;
}

// 拖拉排序（跟院內待辦同一套，useDragReorder）。搜尋中不能排：篩過的清單不是連續的一段。
const busy = ref(false);
async function run(task, fallback) {
  if (busy.value) return;
  busy.value = true;
  try {
    await task();
  } catch (err) {
    toast.error(apiErrorMessage(err, fallback));
    await loadDrugs({ force: true }).catch(() => {});
  } finally {
    busy.value = false;
  }
}

// 先在本機排好（不等伺服器），伺服器回來再整份重讀對齊。
function applyLocalOrder(items, orderedIds) {
  orderedIds.forEach((id, index) => {
    const entry = items.find((item) => item._id === id);
    if (entry) entry.sortOrder = index;
  });
}
function beforeIdAt(ids, from, to) {
  const rest = ids.filter((_, index) => index !== from);
  return rest[to] ?? null;
}
function reorder(ids, from, to) {
  const next = ids.filter((_, index) => index !== from);
  next.splice(to, 0, ids[from]);
  return next;
}

const groupList = ref(null);
const groupIds = computed(() => realSections.value.map((section) => section.id));
function dropGroup(from, to) {
  const ids = groupIds.value;
  const id = ids[from];
  const beforeId = beforeIdAt(ids, from, to);
  applyLocalOrder(groups.value, reorder(ids, from, to));
  run(() => moveGroup(id, beforeId), '排序失敗，請稍後再試');
}
const groupDrag = useDragReorder(groupList, { canStart: () => !busy.value, onDrop: dropGroup });

const drugList = ref(null);
const sortable = computed(() => !searching.value && visibleDrugs.value.length > 1);
const drugIds = computed(() => visibleDrugs.value.map((drug) => drug._id));
function dropDrug(from, to) {
  const ids = drugIds.value;
  const id = ids[from];
  const beforeId = beforeIdAt(ids, from, to);
  applyLocalOrder(drugs.value, reorder(ids, from, to));
  run(() => moveDrug(id, { groupId: activeSection.value?.id ?? null, beforeId }), '排序失敗，請稍後再試');
}
// 藥品是兩欄排列，拖拉用二維版（依左到右、上到下的順序）。
const drugDrag = useGridDragReorder(drugList, { canStart: () => !busy.value && sortable.value, onDrop: dropDrug });
watch(drugIds, (next, prev) => {
  if (drugDrag.dragging.value && next.join() !== prev.join()) drugDrag.cancel();
});
watch(groupIds, (next, prev) => {
  if (groupDrag.dragging.value && next.join() !== prev.join()) groupDrag.cancel();
});

// 鍵盤：把手上按上下鍵一格一格移，移完焦點留在同一筆。
async function stepDrug(drug, step) {
  const target = stepBeforeId(drugIds.value, drug._id, step);
  if (!target || busy.value) return;
  applyLocalOrder(drugs.value, reorder(drugIds.value, drugIds.value.indexOf(drug._id), drugIds.value.indexOf(drug._id) + step));
  await run(() => moveDrug(drug._id, { groupId: activeSection.value?.id ?? null, beforeId: target.beforeId }), '排序失敗，請稍後再試');
  await nextTick();
  drugList.value?.querySelector(`[data-drug-handle="${drug._id}"]`)?.focus();
}
async function stepGroup(section, step) {
  const target = stepBeforeId(groupIds.value, section.id, step);
  if (!target || busy.value) return;
  const index = groupIds.value.indexOf(section.id);
  applyLocalOrder(groups.value, reorder(groupIds.value, index, index + step));
  await run(() => moveGroup(section.id, target.beforeId), '排序失敗，請稍後再試');
  await nextTick();
  groupList.value?.querySelector(`[data-group-handle="${section.id}"]`)?.focus();
}

// 新增與修改共用一個視窗。新增是一列一個輸入框（像 Vercel 的環境變數）：
// 貼上多行文字自動拆成多列、Enter 在下面開新的一列、空的一列按 Backspace 收掉。
const editor = ref(null); // { mode: 'create', rows, groupKey } ｜ { mode: 'edit', drug, text, groupKey }
const saving = ref(false);
const editorError = ref('');
let rowSeq = 0;
const newRow = (text = '') => ({ id: ++rowSeq, text });
const rowInputId = (row) => `drug-row-${row.id}`;
const filledRows = computed(() => (editor.value?.mode === 'create' ? editor.value.rows.filter((row) => row.text.trim()) : []));
const canSave = computed(() => (editor.value?.mode === 'create' ? filledRows.value.length > 0 : Boolean(richTextToPlain(editor.value?.text ?? '').trim())));

function openCreate() {
  editor.value = { mode: 'create', rows: [newRow()], groupKey: activeKey.value };
  editorError.value = '';
}
function openEdit(drug) {
  editor.value = { mode: 'edit', drug, text: drug.name, groupKey: drug.groupId && realSections.value.some((s) => s.id === String(drug.groupId)) ? String(drug.groupId) : NONE };
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
    const targetGroupId = editor.value.groupKey === NONE ? null : editor.value.groupKey;
    if (editor.value.mode === 'create') {
      // 新增視窗打的是純文字：標記字元跳脫掉再送（要上色請新增後在編輯視窗設定）。
      const { created, skipped } = await createDrugs(filledRows.value.map((row) => escapeRichText(row.text)), targetGroupId);
      if (created.length) toast.success(skipped.length ? `已新增 ${created.length} 筆，${skipped.length} 筆已在藥櫃裡` : `已新增 ${created.length} 筆`);
      else toast.info(`${skipped.length} 筆都已在藥櫃裡`);
    } else {
      const { drug } = editor.value;
      const updated = await updateDrug(drug._id, { name: editor.value.text, enabled: drug.enabled !== false, expectedVersion: drug.__v });
      const currentGroupId = updated.groupId ? String(updated.groupId) : null;
      if (currentGroupId !== targetGroupId) await moveDrug(drug._id, { groupId: targetGroupId, beforeId: null });
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
    toast.success(`已刪除「${richTextToPlain(deleteTarget.value.name)}」`);
    deleteTarget.value = null;
  } catch (err) {
    toast.error(apiErrorMessage(err, '刪除失敗'));
  } finally {
    deleting.value = false;
  }
}

// 分類：新增與重新命名共用一個小視窗；刪除時組內藥品移到未分類。
const groupEditor = ref(null); // { group: null | group, name }
const groupError = ref('');
const groupSaving = ref(false);
function openGroupCreate() {
  groupEditor.value = { group: null, name: '' };
  groupError.value = '';
}
function openGroupRename(section) {
  groupEditor.value = { group: section.group, name: section.name };
  groupError.value = '';
}
async function saveGroup() {
  if (!groupEditor.value || groupSaving.value || !groupEditor.value.name.trim()) return;
  groupSaving.value = true;
  groupError.value = '';
  try {
    const { group, name } = groupEditor.value;
    if (group) {
      await renameGroup(group, name);
      toast.success('已更新');
    } else {
      const created = await createGroup(name);
      activeKey.value = String(created._id);
      toast.success(`已新增分類「${created.name}」`);
    }
    groupEditor.value = null;
  } catch (err) {
    groupError.value = apiErrorMessage(err, '儲存失敗');
    if (err.response?.status === 409) await loadDrugs({ force: true }).catch(() => {});
  } finally {
    groupSaving.value = false;
  }
}

const groupDeleteTarget = ref(null);
const groupDeleting = ref(false);
async function confirmDeleteGroup() {
  const target = groupDeleteTarget.value;
  if (!target || groupDeleting.value) return;
  groupDeleting.value = true;
  try {
    await deleteGroup(target.id);
    toast.success(`已刪除分類「${target.name}」`);
    groupDeleteTarget.value = null;
    activeKey.value = NONE;
  } catch (err) {
    toast.error(apiErrorMessage(err, '刪除失敗'));
  } finally {
    groupDeleting.value = false;
  }
}

onMounted(async () => {
  try {
    await loadDrugs({ force: true });
    const first = groups.value.length ? sections.value[0] : null;
    if (first) activeKey.value = keyOf(first);
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
      <Button type="button" variant="secondary" @click="openGroupCreate"><Plus stroke-width="1.75" />新增分類</Button>
      <Button type="button" @click="openCreate"><Plus stroke-width="1.75" />新增藥品</Button>
    </template>
    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
    <ListSkeleton v-if="loading" :rows="6" :avatar="false" />

    <div v-else class="grid items-start gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <!-- 左：分類（拖拉排序）；未分類固定在最後。 -->
      <nav class="rounded-xl border border-border bg-card p-3" aria-label="藥品分類">
        <ul ref="groupList" class="relative space-y-1">
          <li
            v-for="(section, index) in realSections"
            :key="section.id"
            data-drag-row
            class="flex h-12 items-center gap-1 rounded-lg pr-3"
            :class="[
              activeKey === section.id ? 'bg-accent ring-1 ring-primary' : 'hover:bg-hover',
              groupDrag.dragging.value?.from === index ? 'bg-card shadow-lg ring-1 ring-border-strong' : '',
            ]"
            :style="groupDrag.rowStyle(index)"
          >
            <button
              v-if="realSections.length > 1"
              type="button"
              :data-group-handle="section.id"
              class="flex size-8 shrink-0 touch-none items-center justify-center rounded-md text-subtle-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-border"
              :class="groupDrag.dragging.value ? 'cursor-grabbing' : 'cursor-grab'"
              :aria-label="`調整順序：${section.name}`"
              v-on="groupDrag.handleEvents(index)"
              @keydown.up.prevent="stepGroup(section, -1)"
              @keydown.down.prevent="stepGroup(section, 1)"
            ><GripVertical class="size-5" stroke-width="1.75" /></button>
            <button type="button" class="flex min-w-0 flex-1 items-center justify-between gap-2 text-left" :class="activeKey === section.id ? 'font-semibold text-primary' : 'text-foreground'" @click="activeKey = section.id">
              <span class="truncate">{{ section.name }}</span>
              <span class="num shrink-0 text-sm text-muted-foreground">{{ section.drugs.length || '' }}</span>
            </button>
          </li>
        </ul>
        <button
          v-for="section in sections.filter((entry) => entry.id === null)"
          :key="NONE"
          type="button"
          class="mt-1 flex h-12 w-full items-center justify-between gap-2 rounded-lg px-3 text-left"
          :class="[activeKey === NONE ? 'bg-accent font-semibold text-primary ring-1 ring-primary' : 'text-foreground hover:bg-hover', realSections.length ? 'border-t border-border' : '']"
          @click="activeKey = NONE"
        >
          <span>未分類</span>
          <span class="num shrink-0 text-sm text-muted-foreground">{{ section.drugs.length || '' }}</span>
        </button>
      </nav>

      <!-- 右：這個分類的藥品（拖拉排序） -->
      <section class="min-w-0 rounded-xl border border-border bg-card">
        <header class="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
          <h2 class="text-lg font-semibold">{{ activeSection?.name }}</h2>
          <span class="num text-sm text-muted-foreground">{{ activeSection?.drugs.length ? `${activeSection.drugs.length} 項` : '' }}</span>
          <FilterBar id="drug-search" v-model="queryInput" label="搜尋藥品" class="ml-auto w-full min-w-0 md:w-72" @submit="applyFilters" />
          <template v-if="activeSection?.id">
            <Button type="button" variant="secondary" size="sm" @click="openGroupRename(activeSection)">重新命名</Button>
            <Button type="button" variant="destructive" size="sm" @click="groupDeleteTarget = activeSection">刪除分類</Button>
          </template>
        </header>

        <EmptyState v-if="!visibleDrugs.length" :icon="drugs.length ? SearchX : Pill" :title="searching ? '找不到符合條件的藥品' : drugs.length ? '這個分類還沒有藥品' : '藥櫃是空的'" inset>
          <Button v-if="!searching" type="button" class="mt-4" @click="openCreate">新增藥品</Button>
        </EmptyState>
        <ul v-else ref="drugList" class="relative grid grid-cols-1 gap-2 p-3 lg:grid-cols-2">
          <li
            v-for="(drug, index) in visibleDrugs"
            :key="drug._id"
            data-drag-row
            class="flex min-h-14 items-center gap-2 rounded-lg border border-border bg-card px-2 py-2"
            :class="drugDrag.dragging.value?.from === index ? 'shadow-lg ring-1 ring-border-strong' : 'hover:bg-hover'"
            :style="drugDrag.rowStyle(index)"
          >
            <button
              v-if="sortable"
              type="button"
              :data-drug-handle="drug._id"
              class="flex size-8 shrink-0 touch-none items-center justify-center rounded-md text-subtle-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-border"
              :class="drugDrag.dragging.value ? 'cursor-grabbing' : 'cursor-grab'"
              :aria-label="`調整順序：${richTextToPlain(drug.name)}`"
              v-on="drugDrag.handleEvents(index)"
              @keydown.up.prevent="stepDrug(drug, -1)"
              @keydown.down.prevent="stepDrug(drug, 1)"
            ><GripVertical class="size-5" stroke-width="1.75" /></button>
            <button type="button" class="min-w-0 flex-1 text-left font-medium text-foreground hover:text-primary" :class="drug.enabled === false ? 'text-muted-foreground' : ''" @click="openEdit(drug)"><RichText :text="drug.name" tag="span" class="block" /></button>
            <Switch :model-value="drug.enabled !== false" :aria-label="`啟用${richTextToPlain(drug.name)}`" @update:model-value="toggleEnabled(drug, $event)" />
            <Button type="button" variant="secondary" size="icon-sm" :aria-label="`編輯${richTextToPlain(drug.name)}`" v-tip="'編輯'" @click="openEdit(drug)"><Pencil stroke-width="1.75" /></Button>
            <Button type="button" variant="destructive" size="icon-sm" :aria-label="`刪除${richTextToPlain(drug.name)}`" v-tip="'刪除'" @click="deleteTarget = drug"><Trash2 stroke-width="1.75" /></Button>
          </li>
        </ul>
      </section>
    </div>

    <ModalDialog v-if="editor" @close="editor = null">
      <div class="p-6 pb-4 pr-16"><DialogTitle>{{ editor.mode === 'create' ? '新增藥品' : '編輯藥品' }}</DialogTitle></div>
      <form @submit.prevent="save">
        <div class="space-y-4 px-6 pb-6">
          <Alert v-if="editorError" variant="destructive"><AlertDescription>{{ editorError }}</AlertDescription></Alert>
          <div class="space-y-1.5">
            <Label for="drug-group">分類</Label>
            <Select v-model="editor.groupKey">
              <SelectTrigger id="drug-group" class="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="section in realSections" :key="section.id" :value="section.id">{{ section.name }}</SelectItem>
                <SelectItem :value="NONE">未分類</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
            <RichTextEditor id="drug-name" v-model="editor.text" aria-label="藥品" single-line :maxlength="200" />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" @click="editor = null">取消</Button>
          <Button type="submit" :disabled="saving || !canSave">{{ saving ? '儲存中…' : editor.mode === 'create' && filledRows.length > 1 ? `儲存 ${filledRows.length} 筆` : '儲存' }}</Button>
        </DialogFooter>
      </form>
    </ModalDialog>

    <ModalDialog v-if="groupEditor" size="sm" @close="groupEditor = null">
      <div class="p-6 pb-4 pr-16"><DialogTitle>{{ groupEditor.group ? '重新命名分類' : '新增分類' }}</DialogTitle></div>
      <form @submit.prevent="saveGroup">
        <div class="space-y-4 px-6 pb-6">
          <Alert v-if="groupError" variant="destructive"><AlertDescription>{{ groupError }}</AlertDescription></Alert>
          <div class="space-y-1.5">
            <Label for="drug-group-name">分類名稱</Label>
            <Input id="drug-group-name" v-model="groupEditor.name" maxlength="200" autofocus />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" @click="groupEditor = null">取消</Button>
          <Button type="submit" :disabled="groupSaving || !groupEditor.name.trim()">{{ groupSaving ? '儲存中…' : '儲存' }}</Button>
        </DialogFooter>
      </form>
    </ModalDialog>

    <ConfirmDialog :open="Boolean(deleteTarget)" title="刪除藥品" :description="`確定要從藥櫃刪除「${richTextToPlain(deleteTarget?.name || '')}」嗎？已經寫進藥單的文字不受影響。`" confirm-label="刪除" :loading="deleting" destructive @update:open="(value) => !value && (deleteTarget = null)" @confirm="confirmDelete" />
    <ConfirmDialog :open="Boolean(groupDeleteTarget)" title="刪除分類" :description="`確定要刪除分類「${groupDeleteTarget?.name || ''}」嗎？裡面的藥品會移到「未分類」，不會被刪除。`" confirm-label="刪除" :loading="groupDeleting" destructive @update:open="(value) => !value && (groupDeleteTarget = null)" @confirm="confirmDeleteGroup" />
  </SettingsLayout>
</template>
