<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { AlertTriangle, CalendarDays, ChevronDown, ClipboardPlus, Copy, FileText, Link2Off, NotebookPen, PawPrint, Pencil, Share2, Trash2 } from '@lucide/vue';
import PetFormDialog from '../components/PetFormDialog.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import DeleteRecordDialog from '../components/DeleteRecordDialog.vue';
import { http } from '../api/http';
import { ageLabel as calcAgeLabel, clinicDateInput, formatDate as formatClinicDate, formatDateTime } from '../lib/datetime';
import { DELIVERY_STATUS_META, RECORD_STATUS_META, getDeliveryStatus, isFinalizedRecord } from '../lib/recordStatus';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import Breadcrumbs from '../components/Breadcrumbs.vue';
import { Badge } from '../components/ui/badge';
import { Textarea } from '../components/ui/textarea';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import EmptyState from '../components/EmptyState.vue';
import RowActions from '../components/RowActions.vue';
import Pagination from '../components/Pagination.vue';
import { Alert, AlertDescription } from '../components/ui/alert';
import ListSkeleton from '../components/ListSkeleton.vue';

import { useToast } from '../composables/useToast';

const route = useRoute();
const toast = useToast();
const pet = ref(null);
const recordPage = ref(1);
const recordPagination = ref({ total: 0, page: 1, limit: 10, totalPages: 1 });
const error = ref('');
const sharingId = ref(null);
const revokingId = ref(null);
const shareToRevoke = ref(null);
const shareNotice = ref(null);
const editOpen = ref(false);
const editSaving = ref(false);
const editError = ref('');

const recordToRemove = ref(null);
const deletingRecordId = ref(null);
const removeError = ref('');
let fetchSequence = 0;

const clinicalNotes = ref([]);
const notePage = ref(1);
const notePagination = ref({ total: 0, page: 1, limit: 10, totalPages: 1 });
const newNoteContent = ref('');
const newNoteDate = ref(clinicDateInput());
const noteSaving = ref(false);
const noteError = ref('');
const editingNoteId = ref(null);
const editingNoteContent = ref('');
const editingNoteDate = ref('');
const noteToRemove = ref(null);
const deletingNoteId = ref(null);
const expandedNoteIds = ref([]);
const collapsibleNoteIds = ref([]);
const noteContentElements = new Map();
let noteResizeFrame = null;

const sexLabel = computed(() => ({ male: '公', female: '母' })[pet.value?.sex] ?? '');
const neuteredLabel = computed(() => ({ yes: '已絕育', no: '未絕育' })[pet.value?.neutered] ?? '');
const ageLabel = computed(() => calcAgeLabel(pet.value?.birthDate, new Date(), ''));

function filledFields(fields) {
  return fields.filter((field) => String(field.value).trim());
}

// 身分類欄位（物種／品種／性別／絕育／年齡）一句話就能唸完，用一行 chip 呈現比逐格 dt/dd 更好掃視。
const identityFields = computed(() => filledFields([
  { label: '物種', value: pet.value?.species ?? '' },
  { label: '品種', value: pet.value?.breed ?? '' },
  { label: '性別', value: sexLabel.value },
  { label: '絕育狀態', value: neuteredLabel.value },
  { label: '年齡', value: ageLabel.value },
]));
const secondaryFields = computed(() => filledFields([
  { label: '最近體重', value: pet.value?.weightKg != null ? `${pet.value.weightKg} kg` : '' },
]));
// 過敏／慢性病／用藥是看診前必須先看到的臨床提醒，獨立成一塊警示樣式，不跟品種、體重這類一般資料混在同一個灰階列表裡。
const alertFields = computed(() => filledFields([
  { label: '過敏紀錄', value: pet.value?.allergies ?? '' },
  { label: '慢性病／重要病史', value: pet.value?.chronicConditions ?? '' },
  { label: '目前用藥', value: pet.value?.currentMedications ?? '' },
]));
const hasAnyPetDetail = computed(() => Boolean(
  identityFields.value.length || pet.value?.ownerId?.name || secondaryFields.value.length || alertFields.value.length || pet.value?.notes
));

// 列上只留一個主要操作，其餘走「更多」選單。這裡集中決定「這一列現在有哪些次要操作」，
// 條件跟原本並排按鈕的 v-if 完全一樣，只是換成資料而不是模板分支。
function rowActions(record) {
  const actions = [];
  if (isFinalizedRecord(record) && !isShareActive(record)) {
    actions.push({ key: 'share', label: sharingId.value === record._id ? '處理中…' : '建立分享連結', icon: Share2, disabled: sharingId.value === record._id });
  }
  if (isShareActive(record)) {
    actions.push({ key: 'copy', label: '複製分享連結', icon: Copy });
    actions.push({ key: 'revoke', label: revokingId.value === record._id ? '撤銷中…' : '撤銷分享', icon: Link2Off, danger: true, disabled: revokingId.value === record._id });
  }
  if (!['sent', 'sending', 'uncertain'].includes(getDeliveryStatus(record))) {
    actions.push({ key: 'delete', label: '刪除報告', icon: Trash2, danger: true, disabled: deletingRecordId.value === record._id });
  }
  return actions;
}

function handleRowAction(record, action) {
  if (action === 'share') return shareRecord(record);
  if (action === 'copy') return copyExistingShare(record);
  if (action === 'revoke') return openRevokeShare(record);
  if (action === 'delete') return openRemoveRecord(record);
}
function formatDate(value) {
  return formatClinicDate(value, '—');
}

function isShareActive(record) {
  return Boolean(record?.shareEnabled && record.shareExpiresAt && new Date(record.shareExpiresAt) > new Date());
}

async function fetchPet(petId = route.params.id) {
  const currentRequest = ++fetchSequence;
  error.value = '';
  try {
    const { data } = await http.get(`/pets/${petId}`, { params: { recordPage: recordPage.value, notePage: notePage.value } });
    if (currentRequest !== fetchSequence || String(route.params.id) !== String(petId)) return;
    pet.value = data;
    recordPagination.value = data.recordPagination ?? recordPagination.value;
    if (!data.medicalRecords?.length && data.recordPagination?.total > 0 && recordPage.value > data.recordPagination.totalPages) {
      recordPage.value = data.recordPagination.totalPages;
    }
    clinicalNotes.value = data.clinicalNotes ?? [];
    notePagination.value = data.notePagination ?? notePagination.value;
    if (!data.clinicalNotes?.length && data.notePagination?.total > 0 && notePage.value > data.notePagination.totalPages) {
      notePage.value = data.notePagination.totalPages;
    }
    await nextTick();
    measureNoteOverflow();
  } catch (err) {
    if (currentRequest === fetchSequence) error.value = '寵物資料暫時無法載入，請稍後重試';
  }
}

async function savePet(values) {
  editSaving.value = true;
  editError.value = '';
  try {
    await http.put(`/pets/${pet.value._id}`, { ...values, expectedVersion: pet.value.__v });
    editOpen.value = false;
    toast.success(`已成功更新「${values.name || pet.value.name}」的資料`, '修改資料成功');
    await fetchPet();
  } catch (err) {
    editError.value = err.response?.data?.message ?? '寵物資料儲存失敗';
    toast.error(editError.value, '修改資料失敗');
    if (err.response?.status === 409) {
      editOpen.value = false;
      await fetchPet();
    }
  } finally {
    editSaving.value = false;
  }
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (err) {
    return false;
  }
}

async function shareRecord(record) {
  sharingId.value = record._id;
  error.value = '';
  try {
    const { data } = await http.post(`/records/${record._id}/share`);
    const copied = await copyText(data.url);
    shareNotice.value = { url: data.url, copied, expiresAt: data.expiresAt };
    toast.success(
      copied ? '分享連結已產生並複製到剪貼簿' : '分享連結已產生',
      '建立分享成功'
    );
    await fetchPet();
  } catch (err) {
    error.value = err.response?.data?.message ?? '建立分享連結失敗';
    toast.error(error.value, '建立分享失敗');
  } finally {
    sharingId.value = null;
  }
}

async function copyExistingShare(record) {
  if (!isShareActive(record)) {
    toast.error('分享連結尚未啟用', '無法複製連結');
    return;
  }
  const url = `${window.location.origin}/report/${record.shareToken}`;
  const copied = await copyText(url);
  shareNotice.value = { url, copied, expiresAt: record.shareExpiresAt };
  toast.success(copied ? '分享連結已複製到剪貼簿' : '已取得分享連結', '複製成功');
}

async function revokeShare(record) {
  if (!record) return;
  revokingId.value = record._id;
  try {
    await http.post(`/records/${record._id}/revoke-share`);
    shareToRevoke.value = null;
    shareNotice.value = null;
    toast.success('已成功撤銷分享連結', '撤銷成功');
    await fetchPet();
  } catch (err) {
    error.value = err.response?.data?.message ?? '撤銷分享失敗';
    toast.error(error.value, '撤銷失敗');
  } finally {
    revokingId.value = null;
  }
}

function openRevokeShare(record) {
  if (revokingId.value) return;
  shareToRevoke.value = record;
}

function openRemoveRecord(record) {
  if (deletingRecordId.value) return;
  removeError.value = '';
  recordToRemove.value = record;
}

async function removeRecord(confirmText) {
  const record = recordToRemove.value;
  if (!record) return;
  deletingRecordId.value = record._id;
  removeError.value = '';
  try {
    await http.delete(`/records/${record._id}`, { data: { confirmText } });
    recordToRemove.value = null;
    toast.success(`已成功刪除「${formatDate(record.visitDate)}」的就診紀錄`, '刪除紀錄成功');
    await fetchPet();
  } catch (err) {
    const msg = err.response?.data?.message ?? '刪除就診紀錄失敗';
    removeError.value = msg;
    toast.error(msg, '刪除失敗');
  } finally {
    deletingRecordId.value = null;
  }
}

const totalRecordPages = computed(() => recordPagination.value.totalPages ?? 1);

function goToRecordPage(next) {
  const target = Math.min(Math.max(next, 1), totalRecordPages.value);
  if (target !== recordPage.value) recordPage.value = target;
}

async function addNote() {
  const content = newNoteContent.value.trim();
  if (!content || !pet.value) return;
  noteSaving.value = true;
  noteError.value = '';
  try {
    const { data: createdNote } = await http.post(`/pets/${pet.value._id}/clinical-notes`, { content, entryDate: newNoteDate.value || undefined });
    expandNote(createdNote._id);
    newNoteContent.value = '';
    newNoteDate.value = clinicDateInput();
    toast.success('已新增病歷日誌', '新增成功');
    await fetchPet();
  } catch (err) {
    const msg = err.response?.data?.message ?? '新增病歷日誌失敗';
    noteError.value = msg;
    toast.error(msg, '新增失敗');
  } finally {
    noteSaving.value = false;
  }
}

function startEditNote(note) {
  expandNote(note._id);
  editingNoteId.value = note._id;
  editingNoteContent.value = note.content;
  editingNoteDate.value = clinicDateInput(note.entryDate);
}

function expandNote(noteId) {
  if (!expandedNoteIds.value.includes(noteId)) {
    expandedNoteIds.value = [...expandedNoteIds.value, noteId];
  }
}

function isNoteCollapsible(noteId) {
  return collapsibleNoteIds.value.includes(noteId);
}

function setNoteContentElement(noteId, element) {
  if (element) noteContentElements.set(noteId, element);
  else noteContentElements.delete(noteId);
}

function measureNoteOverflow() {
  const nextIds = [];
  for (const [noteId, element] of noteContentElements) {
    if (!element.clientWidth) continue;
    const clone = element.cloneNode(true);
    clone.removeAttribute('class');
    Object.assign(clone.style, {
      position: 'absolute',
      left: '-99999px',
      top: '0',
      width: `${element.clientWidth}px`,
      height: 'auto',
      visibility: 'hidden',
      whiteSpace: 'pre-wrap',
      overflow: 'visible',
      overflowWrap: 'anywhere',
      textOverflow: 'clip',
    });
    const computedStyle = window.getComputedStyle(element);
    clone.style.font = computedStyle.font;
    clone.style.letterSpacing = computedStyle.letterSpacing;
    clone.style.lineHeight = computedStyle.lineHeight;
    document.body.appendChild(clone);
    const lineHeight = Number.parseFloat(computedStyle.lineHeight) || Number.parseFloat(computedStyle.fontSize) * 1.5;
    if (clone.scrollHeight > lineHeight * 1.5) nextIds.push(noteId);
    clone.remove();
  }
  if (editingNoteId.value && collapsibleNoteIds.value.includes(editingNoteId.value)) {
    nextIds.push(editingNoteId.value);
  }
  collapsibleNoteIds.value = [...new Set(nextIds)];
  expandedNoteIds.value = expandedNoteIds.value.filter((id) => collapsibleNoteIds.value.includes(id));
}

function scheduleNoteOverflowMeasurement() {
  if (noteResizeFrame) cancelAnimationFrame(noteResizeFrame);
  noteResizeFrame = requestAnimationFrame(() => {
    noteResizeFrame = null;
    measureNoteOverflow();
  });
}

function toggleNote(noteId) {
  if (editingNoteId.value === noteId || !isNoteCollapsible(noteId)) return;
  expandedNoteIds.value = expandedNoteIds.value.includes(noteId)
    ? expandedNoteIds.value.filter((id) => id !== noteId)
    : [...expandedNoteIds.value, noteId];
}

onMounted(() => window.addEventListener('resize', scheduleNoteOverflowMeasurement));
onBeforeUnmount(() => {
  window.removeEventListener('resize', scheduleNoteOverflowMeasurement);
  if (noteResizeFrame) cancelAnimationFrame(noteResizeFrame);
});

function cancelEditNote() {
  editingNoteId.value = null;
}

async function saveEditNote(note) {
  const content = editingNoteContent.value.trim();
  if (!content) return;
  noteSaving.value = true;
  try {
    await http.put(`/clinical-notes/${note._id}`, { content, entryDate: editingNoteDate.value || undefined });
    editingNoteId.value = null;
    toast.success('已更新病歷日誌', '更新成功');
    await fetchPet();
  } catch (err) {
    toast.error(err.response?.data?.message ?? '更新病歷日誌失敗', '更新失敗');
  } finally {
    noteSaving.value = false;
  }
}

function openRemoveNote(note) {
  if (deletingNoteId.value) return;
  noteToRemove.value = note;
}

async function removeNote() {
  const note = noteToRemove.value;
  if (!note) return;
  deletingNoteId.value = note._id;
  try {
    await http.delete(`/clinical-notes/${note._id}`);
    noteToRemove.value = null;
    toast.success('已刪除病歷日誌', '刪除成功');
    await fetchPet();
  } catch (err) {
    toast.error(err.response?.data?.message ?? '刪除病歷日誌失敗', '刪除失敗');
  } finally {
    deletingNoteId.value = null;
  }
}

const totalNotePages = computed(() => notePagination.value.totalPages ?? 1);

function goToNotePage(next) {
  const target = Math.min(Math.max(next, 1), totalNotePages.value);
  if (target !== notePage.value) {
    expandedNoteIds.value = [];
    notePage.value = target;
  }
}

watch(recordPage, () => {
  if (pet.value) fetchPet();
});

watch(notePage, () => {
  if (pet.value) fetchPet();
});

watch(
  () => route.params.id,
  (petId) => {
    pet.value = null;
    recordPage.value = 1;
    notePage.value = 1;
    editOpen.value = false;
    shareNotice.value = null;
    shareToRevoke.value = null;
    recordToRemove.value = null;
    noteToRemove.value = null;
    editingNoteId.value = null;
    expandedNoteIds.value = [];
    fetchPet(petId);
  },
  { immediate: true }
);
</script>

<template>
  <div class="mx-auto max-w-7xl">
  <section v-if="pet" class="space-y-5">
    <Breadcrumbs :items="[
      { label: '飼主', to: '/owners' },
      ...(pet.ownerId?._id ? [{ label: pet.ownerId.name || '飼主資料', to: `/owners/${pet.ownerId._id}` }] : []),
      { label: pet.name },
    ]" />

    <Card class="p-4 shadow-sm dark:shadow-none sm:p-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"><PawPrint class="h-5 w-5" stroke-width="1.75" /></div>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="text-xl font-semibold text-foreground">{{ pet.name }}</h1>
              <span v-if="pet.medicalRecordNumber" class="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">{{ pet.medicalRecordNumber }}</span>
            </div>
            <p class="mt-0.5 text-xs text-muted-foreground">寵物資料<span v-if="pet.legacyMedicalRecordNumber"> · 舊病歷號：{{ pet.legacyMedicalRecordNumber }}</span></p>
          </div>
        </div>
        <Button variant="secondary" @click="editOpen = true"><Pencil class="h-4 w-4" />編輯資料</Button>
      </div>

      <div v-if="hasAnyPetDetail" class="mt-4 space-y-4 border-t border-border pt-3 text-sm">
        <dl v-if="identityFields.length || pet.ownerId?.name || secondaryFields.length" class="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
          <div v-for="field in identityFields" :key="field.label" class="min-w-0">
            <dt class="text-xs font-medium text-muted-foreground">{{ field.label }}</dt>
            <dd class="mt-1 text-foreground">{{ field.value }}</dd>
          </div>
          <div v-if="pet.ownerId?.name" class="min-w-0">
            <dt class="text-xs font-medium text-muted-foreground">飼主</dt>
            <dd class="mt-1 truncate">
              <router-link v-if="pet.ownerId._id" :to="`/owners/${pet.ownerId._id}`" class="font-medium text-primary">{{ pet.ownerId.name }}</router-link>
              <span v-else class="text-foreground">{{ pet.ownerId.name }}</span>
            </dd>
          </div>
          <div v-if="pet.ownerId?.phone" class="min-w-0">
            <dt class="text-xs font-medium text-muted-foreground">飼主電話</dt>
            <dd class="mt-1 tabular-nums text-foreground">{{ pet.ownerId.phone }}</dd>
          </div>
          <div v-for="field in secondaryFields" :key="field.label" class="min-w-0">
            <dt class="text-xs font-medium text-muted-foreground">{{ field.label }}</dt>
            <dd class="mt-1 text-foreground">{{ field.value }}</dd>
          </div>
        </dl>

        <div v-if="alertFields.length" class="rounded-xl bg-warning-surface px-3 py-2.5 text-warning">
          <div class="flex items-center gap-1.5 text-xs font-semibold"><AlertTriangle class="h-3.5 w-3.5 shrink-0" />臨床提醒</div>
          <dl class="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-3">
            <div v-for="field in alertFields" :key="field.label" class="min-w-0">
              <dt class="text-xs font-medium opacity-80">{{ field.label }}</dt>
              <dd class="mt-0.5 whitespace-pre-wrap text-xs text-warning">{{ field.value }}</dd>
            </div>
          </dl>
        </div>

        <dl v-if="pet.notes">
          <dt class="text-xs font-medium text-muted-foreground">其他備註</dt>
          <dd class="mt-1 whitespace-pre-wrap text-foreground">{{ pet.notes }}</dd>
        </dl>
      </div>
    </Card>

    <div class="space-y-4">
      <div>
        <h2 class="text-base font-semibold text-foreground">病歷日誌</h2>
        <p class="mt-1 text-xs text-muted-foreground">看診或拿藥時的隨手記事，不需要結案即可直接新增。</p>
      </div>

      <Card class="space-y-3 p-4 shadow-sm dark:shadow-none">
        <Textarea v-model="newNoteContent" rows="3" placeholder="輸入看診記事…" />
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <Label for="new-note-date" class="text-xs font-medium text-muted-foreground">日期</Label>
            <Input id="new-note-date" v-model="newNoteDate" type="date" class="w-40 border-border" />
          </div>
          <Button :disabled="noteSaving || !newNoteContent.trim()" @click="addNote">新增紀錄</Button>
        </div>
        <Alert v-if="noteError" variant="destructive"><AlertDescription>{{ noteError }}</AlertDescription></Alert>
      </Card>

      <ul v-if="clinicalNotes.length" class="space-y-3">
        <li v-for="note in clinicalNotes" :key="note._id">
          <Card class="p-4 shadow-sm dark:shadow-none">
            <div class="flex items-start gap-3">
              <button
                v-if="isNoteCollapsible(note._id)"
                type="button"
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :aria-expanded="expandedNoteIds.includes(note._id) || editingNoteId === note._id"
                :aria-label="expandedNoteIds.includes(note._id) ? '收合日誌內容' : '展開日誌內容'"
                @click="toggleNote(note._id)"
              >
                <ChevronDown
                  class="h-4 w-4 transition-transform"
                  :class="expandedNoteIds.includes(note._id) || editingNoteId === note._id ? 'rotate-180' : ''"
                  stroke-width="1.75"
                />
              </button>
              <span v-else aria-hidden="true" class="h-7 w-7 shrink-0"></span>
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span class="flex items-center gap-1.5"><CalendarDays class="h-3.5 w-3.5 shrink-0" />{{ formatDate(note.entryDate) }}</span>
                  <Badge v-if="note.source === 'legacy_import'" class="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">舊系統匯入</Badge>
                </div>
                <p
                  v-if="editingNoteId !== note._id"
                  :ref="(element) => setNoteContentElement(note._id, element)"
                  class="mt-2 min-w-0 text-sm text-foreground"
                  :class="isNoteCollapsible(note._id) && !expandedNoteIds.includes(note._id) ? 'truncate' : 'whitespace-pre-wrap [overflow-wrap:anywhere]'"
                >{{ note.content }}</p>
              </div>
              <div class="flex shrink-0 gap-1">
                <Button variant="secondary" size="icon-sm" aria-label="編輯日誌" @click="startEditNote(note)"><Pencil class="h-3.5 w-3.5" /></Button>
                <Button variant="destructive" size="icon-sm" aria-label="刪除日誌" @click="openRemoveNote(note)"><Trash2 class="h-3.5 w-3.5" /></Button>
              </div>
            </div>
            <div v-if="editingNoteId === note._id" class="mt-3">
              <Textarea v-model="editingNoteContent" rows="3" />
              <div class="mt-2 flex flex-wrap items-center justify-between gap-3">
                <Input v-model="editingNoteDate" type="date" class="w-40 border-border" />
                <div class="flex gap-2">
                  <Button variant="outline" size="sm" @click="cancelEditNote">取消</Button>
                  <Button size="sm" :disabled="noteSaving" @click="saveEditNote(note)">儲存</Button>
                </div>
              </div>
            </div>
          </Card>
        </li>
      </ul>
      <EmptyState v-else :icon="NotebookPen" title="尚無病歷日誌" description="在上方輸入框新增第一則記事。" />

      <Pagination v-if="clinicalNotes.length" :page="notePage" :total-pages="totalNotePages" @update:page="goToNotePage" />
    </div>

    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>

    <Card v-if="shareNotice" class="border-success/35 bg-success-surface p-4 text-sm text-success shadow-none">
      <p class="font-medium">{{ shareNotice.copied ? '分享連結已複製' : '分享連結已建立' }}</p>
      <p class="mt-1 break-all">{{ shareNotice.url }}</p>
      <p class="mt-1 text-xs opacity-80">連結有效至 {{ formatDate(shareNotice.expiresAt) }}，到期或手動撤銷後即無法開啟</p>
    </Card>

    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div><h2 class="text-base font-semibold text-foreground">歷次健檢</h2><p class="mt-1 text-xs text-muted-foreground">依健檢日期排序，草稿可繼續編輯。</p></div>
        <Button as-child><router-link :to="`/pets/${pet._id}/records/new`"><ClipboardPlus class="h-4 w-4" />新增健檢</router-link></Button>
      </div>

      <Card v-if="pet.medicalRecords.length" class="hidden overflow-hidden p-0 shadow-sm lg:block dark:shadow-none" style="--data-columns: minmax(9rem, 1.15fr) minmax(8rem, 1fr) minmax(10rem, 1fr) 10.5rem">
        <div class="desktop-data-header">
          <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">看診日期</span>
          <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">健檢類型</span>
          <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">狀態</span>
          <span class="desktop-data-cell"></span>
        </div>
        <div v-for="record in pet.medicalRecords" :key="record._id" class="desktop-data-row">
          <span class="desktop-data-cell flex items-center gap-2 text-sm text-foreground"><CalendarDays class="h-4 w-4 shrink-0 text-muted-foreground" />{{ formatDate(record.visitDate) }}</span>
          <span class="desktop-data-cell min-w-0 truncate text-sm text-foreground" :title="record.examType || '—'">{{ record.examType || '—' }}<span v-if="record.reportVersion > 1" class="text-xs text-muted-foreground"> · 第 {{ record.reportVersion }} 版</span></span>
          <span class="desktop-data-cell flex items-center gap-1.5 whitespace-nowrap"><Badge variant="status" :class="RECORD_STATUS_META[record.status]?.class">{{ RECORD_STATUS_META[record.status]?.label ?? record.status }}</Badge><Badge v-if="isFinalizedRecord(record)" variant="status" :class="DELIVERY_STATUS_META[getDeliveryStatus(record)]?.class">{{ DELIVERY_STATUS_META[getDeliveryStatus(record)]?.label }}</Badge></span>
          <span class="desktop-data-cell flex justify-end gap-1.5"><Button v-if="record.status === 'draft'" as-child variant="outline" size="sm"><router-link :to="`/records/${record._id}/edit`">繼續填寫</router-link></Button><Button v-else as-child variant="outline" size="sm"><router-link :to="`/records/${record._id}/preview`"><FileText class="h-4 w-4" />查看報告</router-link></Button><RowActions v-if="rowActions(record).length" :actions="rowActions(record)" :label="`${formatDate(record.visitDate)} 的就診紀錄`" @select="(action) => handleRowAction(record, action)" /></span>
        </div>
      </Card>

      <ul v-if="pet.medicalRecords.length" class="space-y-3 lg:hidden">
        <li v-for="record in pet.medicalRecords" :key="record._id">
          <Card class="p-4 shadow-sm dark:shadow-none">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="flex min-w-0 items-start gap-3"><CalendarDays class="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" /><div><div class="flex flex-wrap items-center gap-2"><span class="font-medium text-foreground">{{ formatDate(record.visitDate) }}</span><Badge variant="status" :class="RECORD_STATUS_META[record.status]?.class">{{ RECORD_STATUS_META[record.status]?.label ?? record.status }}</Badge><Badge v-if="isFinalizedRecord(record)" variant="status" :class="DELIVERY_STATUS_META[getDeliveryStatus(record)]?.class">{{ DELIVERY_STATUS_META[getDeliveryStatus(record)]?.label }}</Badge><Badge v-if="record.supersededBy" class="rounded-full bg-warning-surface px-3 py-1 text-xs font-medium text-warning">已有新版</Badge><Badge v-if="isShareActive(record)" class="rounded-full bg-success-surface px-3 py-1 text-xs font-medium text-success">分享中</Badge></div><p class="mt-1 text-xs text-muted-foreground">第 {{ record.reportVersion || 1 }} 版<template v-if="record.vet"> · {{ record.vet }}</template> · 更新於 {{ formatDateTime(record.updatedAt) }}<template v-if="record.sentTo"> · 寄至 {{ record.sentTo }}</template></p></div></div>
            <div class="flex shrink-0 items-center gap-1.5 text-sm">
              <Button v-if="record.status === 'draft'" as-child variant="outline" size="sm"><router-link :to="`/records/${record._id}/edit`">繼續填寫</router-link></Button>
              <Button v-else as-child variant="outline" size="sm"><router-link :to="`/records/${record._id}/preview`"><FileText class="h-4 w-4" />查看報告</router-link></Button>
              <RowActions
                v-if="rowActions(record).length"
                :actions="rowActions(record)"
                :label="`${formatDate(record.visitDate)} 的更多操作`"
                @select="(action) => handleRowAction(record, action)"
              />
            </div>
          </div>
          </Card>
        </li>
      </ul>
      <EmptyState v-else :icon="PawPrint" title="尚無就診紀錄" description="點右上角「新增健檢」建立第一份報告。" />

      <Pagination v-if="pet.medicalRecords.length" :page="recordPage" :total-pages="totalRecordPages" @update:page="goToRecordPage" />
    </div>

    <PetFormDialog v-if="editOpen" title="編輯寵物資料" submit-label="儲存" :initial-value="{ ...pet, birthDate: clinicDateInput(pet.birthDate) }" :submitting="editSaving" :error-message="editError" @submit="savePet" @close="editOpen = false" />
    <ConfirmDialog
      :open="Boolean(noteToRemove)"
      title="刪除病歷日誌"
      description="確定要刪除這則記事嗎？此操作無法復原。"
      confirm-label="刪除"
      destructive
      :loading="Boolean(deletingNoteId)"
      @update:open="(value) => !value && (noteToRemove = null)"
      @confirm="removeNote"
    />
    <ConfirmDialog
      :open="Boolean(shareToRevoke)"
      title="撤銷分享連結"
      description="確定要撤銷這份報告的分享連結嗎？已取得連結的人將無法再開啟。"
      confirm-label="撤銷"
      destructive
      :loading="Boolean(revokingId)"
      @update:open="(value) => !value && (shareToRevoke = null)"
      @confirm="revokeShare(shareToRevoke)"
    />
    <!-- 草稿只要一般確認，已結案報告才要打字。判準與後端刪除端點一致：
         打字確認防的是誤刪正式報告，草稿是工作中狀態，多一道抄名字只會讓人學會無視確認。 -->
    <ConfirmDialog
      :open="Boolean(recordToRemove) && !isFinalizedRecord(recordToRemove)"
      title="捨棄健檢草稿"
      :description="`確定要捨棄「${formatDate(recordToRemove?.visitDate)}」這筆草稿嗎？此操作無法復原。`"
      confirm-label="捨棄草稿"
      destructive
      :loading="Boolean(deletingRecordId)"
      @update:open="(value) => !value && (recordToRemove = null)"
      @confirm="removeRecord()"
    />
    <DeleteRecordDialog
      v-if="recordToRemove && isFinalizedRecord(recordToRemove)"
      :record="recordToRemove"
      :confirm-word="pet?.name ?? ''"
      :submitting="Boolean(deletingRecordId)"
      :error-message="removeError"
      @close="recordToRemove = null"
      @submit="removeRecord"
    />
  </section>

  <Alert v-else-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
  <ListSkeleton v-else :rows="5" />
  </div>
</template>
