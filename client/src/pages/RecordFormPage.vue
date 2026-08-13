<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { Activity, AlertTriangle, Clock3, FileText, LockKeyhole, PawPrint, Save, Trash2, User } from '@lucide/vue';
import { http } from '../api/http';
import { extractErrorMessage } from '../lib/downloadFile';
import { BASIC_MEASUREMENTS, LAB_GROUPS, LAB_TESTS } from '../lib/labTests';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { useToast } from '../composables/useToast';

const EXAM_TYPE_OPTIONS = ['例行健檢', '幼年健檢', '熟齡健檢', '術前評估', '追蹤檢查', '其他'];

const route = useRoute();
const router = useRouter();
const toast = useToast();
const petId = ref(route.params.petId ?? null);
const recordId = ref(route.params.id ?? null);
const isEdit = computed(() => Boolean(recordId.value));
const recordStatus = ref('draft');
const isLocked = computed(() => recordStatus.value !== 'draft');
const showDiscardConfirm = ref(false);
const discarding = ref(false);

const EXAMINATION_ITEMS = [
  { key: 'auscultation', label: '聽診' },
  { key: 'palpation', label: '觸診' },
  { key: 'general', label: '整體外觀與精神' },
  { key: 'oral', label: '口腔與牙齦' },
  { key: 'skin_coat', label: '皮膚與被毛' },
  { key: 'eyes', label: '眼睛' },
  { key: 'ears', label: '耳朵' },
  { key: 'cardiovascular', label: '心血管' },
  { key: 'respiratory', label: '呼吸系統' },
  { key: 'digestive', label: '腹部與消化系統' },
  { key: 'musculoskeletal', label: '肌肉骨骼' },
  { key: 'neurological', label: '神經與行為' },
  { key: 'urogenital', label: '泌尿生殖系統' },
];

const pet = ref(null);
const labRanges = ref({});
const labRangesLoading = ref(false);
const vet = ref('');
const visitDate = ref(new Date().toISOString().slice(0, 10));
const record = reactive({
  examType: '例行健檢',
  weightKg: null,
  temperatureC: null,
  heartRate: null,
  respiratoryRate: null,
  bodyConditionScore: null,
  measurementAssessments: BASIC_MEASUREMENTS.map((item) => ({ ...item, status: 'not_checked', statusSource: 'auto', referenceMin: null, referenceMax: null })),
  examinationFindings: EXAMINATION_ITEMS.map((item) => ({ ...item, status: 'not_checked', note: '' })),
  labFindings: LAB_TESTS.map((item) => ({ ...item, status: 'not_checked', statusSource: 'manual', value: '', unit: '', referenceMin: null, referenceMax: null, note: '' })),
  chiefComplaint: '',
  history: '',
  conclusion: '',
  diagnosis: '',
  labSummary: '',
  treatmentPlan: '',
  other: '',
});

const loading = ref(true);
const loadError = ref('');
const saveError = ref('');
const saving = ref(false);
const saveState = ref('saved');
const lastSavedAt = ref(null);
const validationErrors = ref([]);
const hydrated = ref(false);
const isDirty = ref(false);
const leavingAfterAction = ref(false);
const pendingLeavePath = ref('');
let autosaveTimer;

const completionSections = computed(() => [
  Boolean(record.chiefComplaint.trim() || record.history.trim()),
  [record.weightKg, record.temperatureC, record.heartRate, record.respiratoryRate, record.bodyConditionScore].some((value) => value !== null && value !== ''),
  record.examinationFindings.some((item) => item.status !== 'not_checked'),
  record.labFindings.some((item) => item.status !== 'not_checked' || item.value.trim() || item.note.trim()),
  Boolean(record.conclusion.trim() || record.diagnosis.trim()),
]);
const completedCount = computed(() => completionSections.value.filter(Boolean).length);
const completionPercent = computed(() => completedCount.value * 20);
const saveLabel = computed(() => {
  if (saveState.value === 'saving') return '自動儲存中…';
  if (saveState.value === 'error') return '自動儲存失敗';
  if (isDirty.value) return '有尚未儲存的變更';
  if (lastSavedAt.value) return `已儲存 ${lastSavedAt.value.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
  return '尚未開始填寫';
});

function mergeFindings(definitions, savedItems, extraFields, defaults = {}) {
  const saved = new Map((savedItems ?? []).map((item) => [item.key, item]));
  const knownKeys = new Set(definitions.map((item) => item.key));
  const merged = definitions.map((item) => ({
    ...item,
    status: saved.get(item.key)?.status ?? 'not_checked',
    ...Object.fromEntries(extraFields.map((field) => [field, saved.get(item.key)?.[field] ?? defaults[field] ?? (field === 'statusSource' ? 'manual' : field.startsWith('reference') ? null : '')])),
  }));
  const legacyItems = (savedItems ?? []).filter((item) => !knownKeys.has(item.key));
  return [...merged, ...legacyItems];
}

function applyRecord(data) {
  recordStatus.value = data.status ?? 'draft';
  vet.value = data.vet ?? '';
  visitDate.value = data.visitDate ? data.visitDate.slice(0, 10) : '';
  for (const key of ['examType', 'weightKg', 'temperatureC', 'heartRate', 'respiratoryRate', 'bodyConditionScore', 'chiefComplaint', 'history', 'conclusion', 'diagnosis', 'labSummary', 'treatmentPlan', 'other']) {
    if (data[key] !== undefined && data[key] !== null) record[key] = data[key];
  }
  record.examinationFindings = mergeFindings(EXAMINATION_ITEMS, data.examinationFindings, ['note']);
  record.measurementAssessments = mergeFindings(BASIC_MEASUREMENTS, data.measurementAssessments, ['statusSource', 'unit', 'referenceMin', 'referenceMax'], { statusSource: 'auto' });
  record.labFindings = mergeFindings(LAB_TESTS, data.labFindings, ['statusSource', 'value', 'unit', 'referenceMin', 'referenceMax', 'note']);
}

async function loadPetContext(id) {
  const { data } = await http.get(`/pets/${id}`);
  pet.value = data;
}

async function loadLabRanges() {
  labRangesLoading.value = true;
  try {
    const { data } = await http.get('/settings/lab-ranges', {
      params: { species: pet.value?.species || 'all', effective: 1 },
    });
    labRanges.value = Object.fromEntries(data.ranges.filter((item) => item.configured && item.enabled).map((item) => [item.key, item]));
  } catch (err) {
    labRanges.value = {};
  } finally {
    labRangesLoading.value = false;
  }
}

async function init() {
  loading.value = true;
  loadError.value = '';
  try {
    if (recordId.value) {
      const { data } = await http.get(`/records/${recordId.value}`);
      applyRecord(data);
      if (typeof data.petId === 'object') {
        pet.value = data.petId;
        petId.value = data.petId._id;
      } else {
        petId.value = data.petId;
      }
    }
    if (!pet.value) await loadPetContext(petId.value);
    await loadLabRanges();
  } catch (err) {
    loadError.value = '健檢資料暫時無法載入，請稍後重試';
  } finally {
    loading.value = false;
    // 等一個 tick，確保載入資料造成的 reactive 變更已經跑完 watcher，
    // 避免 hydrated 設為 true 之後才補跑，誤判成使用者的變更。
    await nextTick();
    isDirty.value = false;
    saveState.value = 'saved';
    hydrated.value = true;
  }
}

function setLabStatus(finding, status) {
  finding.status = status;
  finding.statusSource = 'manual';
}

function clearAutomaticStatus(finding) {
  if (finding.statusSource === 'auto') finding.status = 'not_checked';
}

function applyAutomaticJudgement(finding, rawValue) {
  const range = labRanges.value[finding.key];
  const text = String(rawValue ?? '').trim();
  if (!range || !text) {
    clearAutomaticStatus(finding);
    return;
  }
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) {
    clearAutomaticStatus(finding);
    return;
  }
  const below = range.min != null && numeric < Number(range.min);
  const above = range.max != null && numeric > Number(range.max);
  finding.status = below || above ? 'abnormal' : 'normal';
  finding.statusSource = 'auto';
  finding.unit = range.unit || '';
  finding.referenceMin = range.min;
  finding.referenceMax = range.max;
}

function autoJudgeMeasurement(metric, rawValue) {
  const assessment = record.measurementAssessments.find((item) => item.key === metric.key);
  if (assessment) applyAutomaticJudgement(assessment, rawValue);
}

function autoJudgeLab(finding, rawValue) {
  finding.value = rawValue;
  applyAutomaticJudgement(finding, rawValue);
}

function labRangeLabel(finding) {
  const range = labRanges.value[finding.key];
  if (!range) return '';
  const bounds = range.min != null && range.max != null ? `${range.min}–${range.max}` : range.min != null ? `≥ ${range.min}` : `≤ ${range.max}`;
  return `${bounds}${range.unit ? ` ${range.unit}` : ''}`;
}

function measurementAssessment(metric) {
  return record.measurementAssessments.find((item) => item.key === metric.key);
}

function optionalNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildPayload() {
  return {
    ...record,
    vet: vet.value,
    visitDate: visitDate.value || null,
    weightKg: optionalNumber(record.weightKg),
    temperatureC: optionalNumber(record.temperatureC),
    heartRate: optionalNumber(record.heartRate),
    respiratoryRate: optionalNumber(record.respiratoryRate),
    bodyConditionScore: optionalNumber(record.bodyConditionScore),
  };
}

async function saveRecord({ silent = false } = {}) {
  if (saving.value || !petId.value || isLocked.value) return false;
  saving.value = true;
  saveState.value = 'saving';
  if (!silent) saveError.value = '';
  clearTimeout(autosaveTimer);
  try {
    const payload = buildPayload();
    const savedSnapshot = JSON.stringify(payload);
    let saved;
    if (recordId.value) {
      ({ data: saved } = await http.put(`/records/${recordId.value}`, payload));
    } else {
      ({ data: saved } = await http.post(`/pets/${petId.value}/records`, payload));
      recordId.value = saved._id;
      const wasLeavingAfterAction = leavingAfterAction.value;
      leavingAfterAction.value = true;
      await router.replace(`/records/${saved._id}/edit`);
      leavingAfterAction.value = wasLeavingAfterAction;
    }
    lastSavedAt.value = new Date();
    const hasNewChanges = JSON.stringify(buildPayload()) !== savedSnapshot;
    isDirty.value = hasNewChanges;
    saveState.value = hasNewChanges ? 'unsaved' : 'saved';
    if (!silent) toast.success('已成功儲存病歷草稿', '儲存成功');
    if (hasNewChanges) scheduleAutosave();
    return true;
  } catch (err) {
    saveState.value = 'error';
    if (!silent) saveError.value = await extractErrorMessage(err, '儲存草稿失敗');
    return false;
  } finally {
    saving.value = false;
  }
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => saveRecord({ silent: true }), 1500);
}

function validateForPreview() {
  const errors = [];
  const addError = (message, targetId, focusId = targetId) => errors.push({ message, targetId, focusId });
  if (!vet.value.trim()) addError('請填寫獸醫師', 'record-vet');
  if (!visitDate.value) addError('請填寫健檢日期', 'record-visit-date');
  const hasClinicalContent = record.conclusion.trim() || record.diagnosis.trim() || record.treatmentPlan.trim() || BASIC_MEASUREMENTS.some((item) => record[item.key] !== null && record[item.key] !== '') || record.examinationFindings.some((item) => item.status !== 'not_checked') || record.labFindings.some((item) => item.status !== 'not_checked');
  if (!hasClinicalContent) addError('請至少填寫基本量測、結論、診斷、理學檢查或檢驗結果', 'record-section-measurements');
  if (!record.conclusion.trim() && !record.treatmentPlan.trim()) addError('請填寫結論或照護與追蹤建議', 'record-section-conclusion');
  if (record.bodyConditionScore != null && record.bodyConditionScore !== '' && (Number(record.bodyConditionScore) < 1 || Number(record.bodyConditionScore) > 9)) addError('體態評分須介於 1 到 9', 'record-bodyConditionScore');

  const examinationWithoutNote = record.examinationFindings.filter((item) => item.status === 'abnormal' && !item.note.trim());
  for (const item of examinationWithoutNote) addError(`請補充理學檢查異常說明：${item.label}`, `record-exam-row-${item.key}`, `record-exam-note-${item.key}`);

  const labsWithoutNote = record.labFindings.filter((item) => item.status === 'abnormal' && !item.note.trim());
  for (const item of labsWithoutNote) addError(`請補充檢驗異常說明：${item.label}`, `record-lab-row-${item.key}`, `record-lab-note-${item.key}`);

  const invalidLabValues = record.labFindings.filter((item) => item.numeric !== false && item.value.trim() && !Number.isFinite(Number(item.value)));
  for (const item of invalidLabValues) addError(`檢驗數值必須是數字：${item.label}`, `record-lab-row-${item.key}`, `record-lab-value-${item.key}`);
  validationErrors.value = errors;
  return errors.length === 0;
}

async function goToValidationIssue(issue) {
  // 驗證區塊剛顯示時先等 Vue 與瀏覽器完成排版，避免第一次點擊取得舊座標。
  await nextTick();
  await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));

  const target = document.getElementById(issue.targetId);
  if (!target) return;

  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const appHeaderRect = document.getElementById('app-header')?.getBoundingClientRect();
  const actionRect = document.getElementById('record-action-bar')?.getBoundingClientRect();
  const visibleTop = Math.max(appHeaderRect?.bottom ?? 0, 0) + 12;
  const visibleBottom = Math.min(actionRect?.top ?? viewportHeight, viewportHeight) - 12;
  const targetRect = target.getBoundingClientRect();
  const availableHeight = Math.max(visibleBottom - visibleTop, 1);
  const desiredTop = targetRect.height < availableHeight
    ? visibleTop + (availableHeight - targetRect.height) / 2
    : visibleTop;

  window.scrollTo({
    top: Math.max(0, window.scrollY + targetRect.top - desiredTop),
    behavior: 'auto',
  });

  const focusTarget = document.getElementById(issue.focusId)
    || (target.matches('input, textarea, button') ? target : target.querySelector('input, textarea, button'));
  const isTouchLayout = window.matchMedia('(max-width: 767px), (pointer: coarse)').matches;
  if (!isTouchLayout) focusTarget?.focus({ preventScroll: true });
}

async function submitDraft() {
  const saved = await saveRecord();
  if (saved) {
    leavingAfterAction.value = true;
    await router.push(`/pets/${petId.value}`);
  }
}

async function openPreview() {
  if (!validateForPreview()) {
    await nextTick();
    document.getElementById('form-errors')?.scrollIntoView({ behavior: 'auto', block: 'center' });
    return;
  }
  const saved = await saveRecord();
  if (saved) {
    leavingAfterAction.value = true;
    await router.push(`/records/${recordId.value}/preview`);
  }
}

watch(
  () => JSON.stringify({ vet: vet.value, visitDate: visitDate.value, record }),
  () => {
    if (!hydrated.value) return;
    validationErrors.value = [];
    isDirty.value = true;
    saveState.value = 'unsaved';
    scheduleAutosave();
  }
);

onBeforeRouteLeave((to) => {
  if (leavingAfterAction.value || !isDirty.value) return true;
  pendingLeavePath.value = to.fullPath;
  return false;
});

async function confirmLeave() {
  if (!pendingLeavePath.value) return;
  const target = pendingLeavePath.value;
  pendingLeavePath.value = '';
  leavingAfterAction.value = true;
  await router.push(target);
}

async function confirmDiscard() {
  discarding.value = true;
  try {
    if (recordId.value) {
      await http.delete(`/records/${recordId.value}`);
    }
    toast.success('已成功捨棄健檢紀錄草稿', '已捨棄草稿');
    leavingAfterAction.value = true;
    showDiscardConfirm.value = false;
    await router.push(petId.value ? `/pets/${petId.value}` : '/pets');
  } catch (err) {
    const msg = err.response?.data?.message || '捨棄草稿失敗';
    toast.error(msg, '捨棄失敗');
  } finally {
    discarding.value = false;
  }
}
onMounted(() => {
  init();
});
onBeforeUnmount(() => {
  clearTimeout(autosaveTimer);
});
</script>

<template>
  <section class="mx-auto max-w-6xl space-y-5 pb-28">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div><router-link v-if="petId" :to="`/pets/${petId}`" class="mb-2 inline-flex min-h-11 items-center text-sm font-medium text-belle-600 dark:text-brand-400">← 回寵物資料</router-link><h1 class="text-xl font-semibold text-ink-900 dark:text-white">{{ isLocked ? '已結案健檢紀錄' : isEdit ? '編輯健檢紀錄' : '新增健檢紀錄' }}</h1><p class="mt-1 text-sm text-ink-500 dark:text-zinc-400">{{ isLocked ? '此報告已結案，為保留正式版本而無法直接修改。' : '依健檢流程分段填寫，未執行的檢查維持「未檢查」即可。' }}</p></div>
      <div v-if="!isLocked" class="flex items-center gap-2 text-xs" :class="saveState === 'error' ? 'text-red-600 dark:text-red-300' : 'text-ink-500 dark:text-zinc-400'"><Clock3 class="h-4 w-4" />{{ saveLabel }}</div>
    </div>

    <p v-if="loadError" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">{{ loadError }}</p>
    <p v-else-if="loading" class="text-sm text-ink-500 dark:text-zinc-400" role="status">載入健檢資料…</p>

    <template v-else>
      <div v-if="isLocked" class="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950 shadow-sm dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200">
        <div class="flex items-start gap-3">
          <LockKeyhole class="mt-0.5 h-5 w-5 shrink-0" />
          <div class="min-w-0 flex-1">
            <h2 class="text-base font-semibold">正式報告已鎖定</h2>
            <p class="mt-1 text-sm">為避免已結案的內容與 PDF 不一致，此版本不再開放直接編輯。</p>
            <div class="mt-4 flex flex-wrap gap-2">
              <router-link :to="`/records/${recordId}/preview`" class="inline-flex min-h-11 items-center gap-2 rounded-xl bg-belle-600 px-4 text-sm font-medium text-white hover:bg-belle-700 dark:bg-brand-500 dark:hover:bg-brand-600"><FileText class="h-4 w-4" />查看正式報告</router-link>
              <router-link :to="`/pets/${petId}`" class="inline-flex min-h-11 items-center rounded-xl border border-amber-300 px-4 text-sm font-medium hover:bg-amber-100 dark:border-brand-500/40 dark:hover:bg-brand-500/10">回寵物資料</router-link>
            </div>
          </div>
        </div>
      </div>

      <div v-if="!isLocked" id="record-context-bar" class="rounded-2xl border border-cream-300 bg-cream-50 px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div class="flex flex-wrap items-center justify-between gap-3"><div class="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2"><div class="flex min-w-0 items-center gap-2"><PawPrint class="h-5 w-5 shrink-0 text-belle-600 dark:text-brand-400" /><span class="font-semibold text-ink-900 dark:text-white">{{ pet?.name ?? '—' }}</span><span class="font-mono text-xs text-ink-400 dark:text-zinc-400">{{ pet?.medicalRecordNumber || (pet?._id ? `PET-${pet._id.slice(-8).toUpperCase()}` : '') }}</span></div><div class="flex items-center gap-2 text-sm text-ink-600 dark:text-zinc-300"><User class="h-4 w-4 text-ink-400 dark:text-zinc-400" />{{ pet?.ownerId?.name ?? '—' }}</div></div><div class="w-full sm:w-52"><div class="mb-1 flex justify-between text-xs text-ink-500 dark:text-zinc-400"><span>完成區段</span><span>{{ completedCount }}/5</span></div><div class="h-2 overflow-hidden rounded-full bg-cream-200 dark:bg-zinc-800"><div class="h-full rounded-full bg-belle-600 dark:bg-brand-500" :style="{ width: `${completionPercent}%` }"></div></div></div></div>
        <div v-if="pet?.allergies" class="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"><AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" /><span><strong>過敏提醒：</strong>{{ pet.allergies }}</span></div>
      </div>

      <div id="form-errors" v-if="!isLocked && validationErrors.length" class="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200" role="alert"><p class="font-semibold">正式報告尚缺少以下內容：</p><ul class="mt-2 list-disc space-y-1 pl-5"><li v-for="issue in validationErrors" :key="`${issue.targetId}-${issue.message}`"><button type="button" class="text-left font-medium underline decoration-red-300 underline-offset-2 hover:text-red-950 dark:hover:text-white" @click="goToValidationIssue(issue)">{{ issue.message }}</button></li></ul><p class="mt-3 text-xs">點擊任一項可前往對應欄位。</p></div>

      <form v-if="!isLocked" class="space-y-5" @submit.prevent>
        <section id="record-section-info" class="scroll-mt-40 rounded-2xl border border-cream-300 bg-cream-50 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-6">
          <div class="mb-5 flex items-center gap-3"><span class="flex h-8 w-8 items-center justify-center rounded-full bg-belle-50 text-sm font-semibold text-belle-600 dark:bg-brand-500/10 dark:text-brand-400">1</span><div><h2 class="font-semibold text-ink-900 dark:text-white">健檢資訊與健康背景</h2><p class="text-xs text-ink-400 dark:text-zinc-400">記錄本次健檢基本資訊、主訴與病史</p></div></div>
          <div class="grid gap-x-4 gap-y-4 sm:grid-cols-3">
            <div class="space-y-1.5"><Label for="record-vet" class="text-xs font-medium text-ink-500 dark:text-zinc-400">獸醫師 <span class="text-red-600 dark:text-red-400" aria-hidden="true">*</span><span class="sr-only">必填</span></Label><Input id="record-vet" v-model="vet" class="min-h-11" autocomplete="name" required /></div>
            <div class="space-y-1.5"><Label for="record-visit-date" class="text-xs font-medium text-ink-500 dark:text-zinc-400">健檢日期 <span class="text-red-600 dark:text-red-400" aria-hidden="true">*</span><span class="sr-only">必填</span></Label><Input id="record-visit-date" v-model="visitDate" type="date" class="min-h-11" required /></div>
            <div class="space-y-1.5">
              <Label class="text-xs font-medium text-ink-500 dark:text-zinc-400">健檢類型</Label>
              <Select v-model="record.examType">
                <SelectTrigger class="min-h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="option in EXAM_TYPE_OPTIONS" :key="option" :value="option">{{ option }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div class="mt-4 grid gap-x-4 gap-y-4 lg:grid-cols-2">
            <div class="space-y-1.5"><Label class="text-xs font-medium text-ink-500 dark:text-zinc-400">主訴</Label><Textarea v-model="record.chiefComplaint" rows="3" /></div>
            <div class="space-y-1.5"><Label class="text-xs font-medium text-ink-500 dark:text-zinc-400">病史</Label><Textarea v-model="record.history" rows="3" /></div>
          </div>
        </section>

        <section id="record-section-measurements" class="scroll-mt-40 rounded-2xl border border-cream-300 bg-cream-50 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-6">
          <div class="mb-5 flex items-center gap-3"><span class="flex h-8 w-8 items-center justify-center rounded-full bg-belle-50 text-sm font-semibold text-belle-600 dark:bg-brand-500/10 dark:text-brand-400">2</span><div><h2 class="font-semibold text-ink-900 dark:text-white">基本量測</h2><p class="text-xs text-ink-400 dark:text-zinc-400">包含範例中的體重與體溫</p></div></div>
          <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
            <div v-for="metric in BASIC_MEASUREMENTS" :key="metric.key">
              <Label class="text-xs font-medium text-ink-500 dark:text-zinc-400">{{ metric.label }}<span v-if="metric.unit" class="text-ink-400 dark:text-zinc-500"> ({{ metric.unit }})</span></Label>
              <Input
                v-model="record[metric.key]"
                :id="`record-${metric.key}`"
                class="measurement-field mt-1.5 min-h-11"
                type="number"
                :min="metric.inputMin"
                :max="metric.inputMax"
                :step="metric.step"
                @update:model-value="autoJudgeMeasurement(metric, $event)"
              />
              <div class="mt-2 flex min-h-5 flex-wrap items-center gap-1.5 text-[11px]">
                <span v-if="labRangeLabel(metric)" class="text-ink-500 dark:text-zinc-400">參考 {{ labRangeLabel(metric) }}</span>
                <span v-else class="text-ink-400 dark:text-zinc-500">尚未設定標準值</span>
                <span v-if="measurementAssessment(metric)?.status !== 'not_checked'" class="rounded-full px-2 py-0.5 font-medium" :class="measurementAssessment(metric)?.status === 'abnormal' ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'">{{ measurementAssessment(metric)?.status === 'abnormal' ? '異常' : '正常' }}・自動</span>
              </div>
            </div>
          </div>
        </section>

        <section id="record-section-examination" class="scroll-mt-40 rounded-2xl border border-cream-300 bg-cream-50 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-6">
          <div class="mb-5 flex items-center gap-3"><span class="flex h-8 w-8 items-center justify-center rounded-full bg-belle-50 text-sm font-semibold text-belle-600 dark:bg-brand-500/10 dark:text-brand-400">3</span><div><h2 class="font-semibold text-ink-900 dark:text-white">理學檢查</h2><p class="text-xs text-ink-400 dark:text-zinc-400">整合聽診、觸診、口腔牙齦與各身體系統</p></div></div>
          <div class="divide-y divide-cream-300 dark:divide-zinc-800">
            <div v-for="finding in record.examinationFindings" :id="`record-exam-row-${finding.key}`" :key="finding.key" class="scroll-mt-40 grid gap-3 py-4 first:pt-0 last:pb-0 lg:grid-cols-[190px_280px_1fr] lg:items-center">
              <p class="text-sm font-medium text-ink-800 dark:text-zinc-200">{{ finding.label }}</p>
              <div class="grid grid-cols-3 gap-1 rounded-xl bg-cream-100 p-1 dark:bg-zinc-950" role="group" :aria-label="`${finding.label}檢查結果`"><button v-for="option in [{ value: 'not_checked', label: '未檢查' }, { value: 'normal', label: '正常' }, { value: 'abnormal', label: '異常' }]" :key="option.value" type="button" class="min-h-10 rounded-lg px-2 text-xs font-medium" :class="finding.status === option.value ? (option.value === 'abnormal' ? 'bg-red-600 text-white' : option.value === 'normal' ? 'bg-emerald-600 text-white' : 'bg-white text-ink-700 shadow-sm dark:bg-zinc-800 dark:text-zinc-200') : 'text-ink-500 hover:bg-white/70 dark:text-zinc-400 dark:hover:bg-zinc-800/70'" @click="finding.status = option.value">{{ option.label }}</button></div>
              <div class="space-y-1.5">
                <Label :for="`record-exam-note-${finding.key}`" class="text-xs font-medium text-ink-500 dark:text-zinc-400">備註<span v-if="finding.status === 'abnormal'" class="text-red-600 dark:text-red-400"> 異常說明 *</span></Label>
                <input :id="`record-exam-note-${finding.key}`" v-model="finding.note" type="text" :aria-label="`${finding.label}備註`" :aria-invalid="finding.status === 'abnormal' && !finding.note.trim()" :required="finding.status === 'abnormal'" :placeholder="finding.status === 'abnormal' ? '請描述異常，例如：輕微牙齦紅' : '選填'" class="min-h-11 w-full scroll-mt-40 rounded-xl border bg-white px-3 text-sm text-ink-900 placeholder:text-ink-400 focus:border-belle-500 focus:outline-none focus:ring-2 focus:ring-belle-100 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:ring-brand-500/20" :class="finding.status === 'abnormal' && !finding.note.trim() ? 'border-red-400 dark:border-red-700' : 'border-cream-300 dark:border-zinc-700'" />
              </div>
            </div>
          </div>
        </section>

        <section id="record-section-labs" class="scroll-mt-40 rounded-2xl border border-cream-300 bg-cream-50 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-6">
          <div class="mb-5 flex flex-wrap items-center justify-between gap-3"><div class="flex items-center gap-3"><span class="flex h-8 w-8 items-center justify-center rounded-full bg-belle-50 text-sm font-semibold text-belle-600 dark:bg-brand-500/10 dark:text-brand-400">4</span><div><h2 class="font-semibold text-ink-900 dark:text-white">血液與尿液檢查</h2><p class="text-xs text-ink-400 dark:text-zinc-400">輸入數值後，已設定範圍的項目會自動判斷</p></div></div><router-link to="/settings" class="text-xs font-medium text-belle-600 hover:underline dark:text-brand-400">管理標準值</router-link></div>
          <div v-for="group in LAB_GROUPS" :key="group" class="mb-7 last:mb-0">
            <h3 class="mb-3 text-sm font-semibold text-belle-600 dark:text-brand-400">{{ group }}</h3>
            <div class="divide-y divide-cream-300 rounded-xl border border-cream-300 dark:divide-zinc-800 dark:border-zinc-800">
              <div v-for="finding in record.labFindings.filter((item) => item.group === group)" :id="`record-lab-row-${finding.key}`" :key="finding.key" class="scroll-mt-40 grid gap-3 p-4 lg:grid-cols-[220px_260px_170px_1fr] lg:items-center">
                <div><p class="text-sm font-medium text-ink-800 dark:text-zinc-200">{{ finding.label }}</p><p v-if="labRangeLabel(finding)" class="mt-0.5 text-xs text-emerald-700 dark:text-emerald-300">參考 {{ labRangeLabel(finding) }}</p><p v-else-if="finding.numeric !== false" class="mt-0.5 text-xs text-ink-400 dark:text-zinc-500">{{ labRangesLoading ? '載入標準值…' : '尚未設定標準值' }}</p></div>
                <div class="grid grid-cols-3 gap-1 rounded-xl bg-cream-100 p-1 dark:bg-zinc-950" role="group" :aria-label="`${finding.label}檢驗結果`"><button v-for="option in [{ value: 'not_checked', label: '未檢查' }, { value: 'normal', label: '正常' }, { value: 'abnormal', label: '異常' }]" :key="option.value" type="button" class="relative min-h-10 rounded-lg px-2 text-xs font-medium" :class="finding.status === option.value ? (option.value === 'abnormal' ? 'bg-red-600 text-white' : option.value === 'normal' ? 'bg-emerald-600 text-white' : 'bg-white text-ink-700 shadow-sm dark:bg-zinc-800 dark:text-zinc-200') : 'text-ink-500 hover:bg-white/70 dark:text-zinc-400 dark:hover:bg-zinc-800/70'" @click="setLabStatus(finding, option.value)">{{ option.label }}<span v-if="finding.status === option.value && finding.statusSource === 'auto'" class="ml-1 text-[10px] opacity-80">自動</span></button></div>
                <div class="space-y-1.5">
                  <Label :for="`record-lab-value-${finding.key}`" class="text-xs font-medium text-ink-500 dark:text-zinc-400">{{ finding.numeric === false ? '結果描述' : '檢驗數值' }}</Label>
                  <input :id="`record-lab-value-${finding.key}`" v-model="finding.value" type="text" inputmode="decimal" :aria-label="`${finding.label}數值`" :placeholder="finding.numeric === false ? '選填' : labRanges[finding.key]?.unit ? `輸入數值（${labRanges[finding.key].unit}）` : '選填'" class="min-h-11 w-full scroll-mt-40 rounded-xl border border-cream-300 bg-white px-3 text-sm text-ink-900 placeholder:text-ink-400 focus:border-belle-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500" @input="finding.numeric !== false && autoJudgeLab(finding, $event.target.value)" />
                </div>
                <div class="space-y-1.5">
                  <Label :for="`record-lab-note-${finding.key}`" class="text-xs font-medium text-ink-500 dark:text-zinc-400">備註<span v-if="finding.status === 'abnormal'" class="text-red-600 dark:text-red-400"> 異常說明 *</span></Label>
                  <input :id="`record-lab-note-${finding.key}`" v-model="finding.note" type="text" :aria-label="`${finding.label}備註`" :aria-invalid="finding.status === 'abnormal' && !finding.note.trim()" :required="finding.status === 'abnormal'" :placeholder="finding.status === 'abnormal' ? '請描述異常' : '選填'" class="min-h-11 w-full scroll-mt-40 rounded-xl border bg-white px-3 text-sm text-ink-900 placeholder:text-ink-400 focus:border-belle-500 focus:outline-none dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500" :class="finding.status === 'abnormal' && !finding.note.trim() ? 'border-red-400 dark:border-red-700' : 'border-cream-300 dark:border-zinc-700'" />
                </div>
              </div>
            </div>
          </div>
          <div class="mt-5 space-y-1.5"><Label class="text-xs font-medium text-ink-500 dark:text-zinc-400">檢驗補充摘要</Label><Textarea v-model="record.labSummary" rows="3" /></div>
        </section>

        <section id="record-section-conclusion" class="scroll-mt-40 rounded-2xl border border-cream-300 bg-cream-50 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-6">
          <div class="mb-5 flex items-center gap-3"><span class="flex h-8 w-8 items-center justify-center rounded-full bg-belle-50 text-sm font-semibold text-belle-600 dark:bg-brand-500/10 dark:text-brand-400">5</span><div><h2 class="font-semibold text-ink-900 dark:text-white">結論與診斷</h2><p class="text-xs text-ink-400 dark:text-zinc-400">統整檢查發現並記錄診斷與後續方向</p></div></div>
          <div class="space-y-1.5"><Label for="record-conclusion" class="text-xs font-medium text-ink-500 dark:text-zinc-400">結論 <span v-if="!record.conclusion.trim() && !record.treatmentPlan.trim()" class="text-red-600 dark:text-red-400">*（與照護建議擇一必填）</span></Label><Textarea id="record-conclusion" v-model="record.conclusion" rows="8" :required="!record.treatmentPlan.trim()" /></div>
          <div class="mt-4 space-y-1.5"><Label class="text-xs font-medium text-ink-500 dark:text-zinc-400">診斷</Label><Textarea v-model="record.diagnosis" rows="5" /></div>
          <div class="mt-4 grid gap-x-4 gap-y-4 lg:grid-cols-2">
            <div class="space-y-1.5"><Label for="record-treatment-plan" class="text-xs font-medium text-ink-500 dark:text-zinc-400">照護與追蹤建議 <span v-if="!record.conclusion.trim() && !record.treatmentPlan.trim()" class="text-red-600 dark:text-red-400">*（與結論擇一必填）</span></Label><Textarea id="record-treatment-plan" v-model="record.treatmentPlan" rows="3" :required="!record.conclusion.trim()" /></div>
            <div class="space-y-1.5"><Label class="text-xs font-medium text-ink-500 dark:text-zinc-400">其他備註</Label><Textarea v-model="record.other" rows="3" /></div>
          </div>
        </section>
      </form>

      <p v-if="!isLocked && saveError" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">{{ saveError }}</p>
      <div v-if="!isLocked" id="record-action-bar" class="fixed inset-x-0 bottom-0 z-30 border-t border-cream-300 bg-cream-50/95 px-4 py-3 shadow-[0_-10px_30px_-20px_rgba(0,0,0,0.35)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95 lg:left-64">
        <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <p class="hidden items-center gap-2 text-xs text-ink-500 dark:text-zinc-400 sm:flex"><Activity class="h-4 w-4" />已完成 {{ completedCount }}/5 個區段</p>
          <div class="ml-auto flex flex-wrap items-center gap-2">
            <Button type="button" variant="destructive-outline" class="min-h-11" :disabled="saving || discarding" @click="showDiscardConfirm = true">
              <Trash2 class="h-4 w-4" />捨棄草稿
            </Button>
            <Button type="button" variant="outline" class="min-h-11" :disabled="saving || discarding" @click="submitDraft"><Save class="h-4 w-4" />{{ saving ? '儲存中…' : '儲存並離開' }}</Button>
            <Button type="button" class="min-h-11" :disabled="saving || discarding" @click="openPreview"><FileText class="h-4 w-4" />結案前預覽</Button>
          </div>
        </div>
      </div>
    </template>
    <ConfirmDialog
      :open="showDiscardConfirm"
      title="捨棄健檢草稿"
      description="確定要捨棄此筆健檢紀錄草稿嗎？此操作將刪除此草稿且無法復原。"
      confirm-label="捨棄草稿"
      cancel-label="取消"
      :loading="discarding"
      :destructive="true"
      @update:open="(value) => !value && (showDiscardConfirm = false)"
      @confirm="confirmDiscard"
    />
    <ConfirmDialog
      :open="Boolean(pendingLeavePath)"
      title="離開編輯頁"
      description="尚有變更未儲存，確定要離開嗎？"
      confirm-label="離開"
      cancel-label="繼續編輯"
      :destructive="false"
      @update:open="(value) => !value && (pendingLeavePath = '')"
      @confirm="confirmLeave"
    />
  </section>
</template>
