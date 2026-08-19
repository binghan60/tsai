<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { Activity, AlertTriangle, Check, Clock3, FileText, LockKeyhole, PawPrint, Save, Trash2, User } from '@lucide/vue';
import { http } from '../api/http';
import { extractErrorMessage } from '../lib/downloadFile';
import { examinationDefs, labDefs, measurementDefs, referenceRanges, sectionDomId, sectionKeyForItem } from '../lib/formTemplate';
import { useFormTemplate } from '../composables/useFormTemplate';
import { useQuickPhrases } from '../composables/useQuickPhrases';
import { useBackTarget } from '../composables/useBackTarget';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import FormSection from '../components/formfields/FormSection.vue';
import QuickPhraseDeleteDialog from '../components/formfields/QuickPhraseDeleteDialog.vue';
import QuickPhrasePickerDialog from '../components/formfields/QuickPhrasePickerDialog.vue';
import { provideRecordForm } from '../components/formfields/context';
import { useToast } from '../composables/useToast';

const { template, loadTemplate, listTemplates } = useFormTemplate();
const { loadPhrases } = useQuickPhrases();

// 區塊與項目定義全部來自範本，不再寫死在頁面裡。
const TEMPLATE_SECTIONS = computed(() =>
  (template.value?.sections ?? []).map((section) => ({
    ...section,
    id: sectionDomId(section.key),
    label: section.title,
  }))
);

// 範本已刪除、但草稿仍留著作答的「孤兒項目」。後端 appendOrphans() 把它們補在最後一個
// 同型別區塊，都沒有就另開「其他紀錄」；表單這邊必須一致 —— 不一致的話同一筆紀錄在
// 表單與報告上會落在不同區塊，而完全渲染不出來時更糟：結案驗證仍會要求補異常說明，
// 使用者卻在畫面上找不到那個欄位可以補，報告就此結不了案。
// 兩種型別各自收容 —— 理學檢查與檢驗表格版式只畫得出自己的型別，混在同一個區塊
// 會有一半渲染不出來。報告頁的容器沒有這個限制，不必跟著拆成兩個。
const ORPHAN_SECTIONS = [
  { type: 'finding', key: 'orphan_findings', title: '其他紀錄（理學檢查）', presentation: 'findings' },
  { type: 'lab', key: 'orphan_labs', title: '其他紀錄（檢驗）', presentation: 'table' },
];
const ORPHAN_DESCRIPTION = '目前表單範本已不包含這些項目，仍保留原始紀錄以便補充或修正。';

const entriesOfType = (type) => (type === 'finding' ? record.examinationFindings : record.labFindings) ?? [];

function templateKeysOf(type) {
  return new Set(
    TEMPLATE_SECTIONS.value.flatMap((section) => (section.items ?? []).filter((item) => item.type === type).map((item) => item.key))
  );
}

function orphansOfType(type) {
  const known = templateKeysOf(type);
  return entriesOfType(type).filter((entry) => !known.has(entry.key));
}

// 孤兒的落腳區塊：最後一個同型別的範本區塊，都沒有才用收容區塊。
function orphanHostKey(type) {
  const host = [...TEMPLATE_SECTIONS.value].reverse().find((section) => (section.items ?? []).some((item) => item.type === type));
  return host?.key ?? ORPHAN_SECTIONS.find((spec) => spec.type === type).key;
}

const FORM_SECTIONS = computed(() => {
  const collectors = ORPHAN_SECTIONS
    .filter((spec) => orphanHostKey(spec.type) === spec.key)
    .map((spec) => ({ spec, orphans: orphansOfType(spec.type) }))
    .filter(({ orphans }) => orphans.length)
    .map(({ spec, orphans }, index) => ({
      key: spec.key,
      id: sectionDomId(spec.key),
      title: spec.title,
      label: spec.title,
      description: ORPHAN_DESCRIPTION,
      presentation: spec.presentation,
      order: TEMPLATE_SECTIONS.value.length + index,
      items: orphans.map((entry) => ({ key: entry.key, label: entry.label, type: spec.type, span: 'auto' })),
    }));
  return [...TEMPLATE_SECTIONS.value, ...collectors];
});
const BASIC_MEASUREMENTS = computed(() => measurementDefs(template.value));
const EXAMINATION_ITEMS = computed(() => examinationDefs(template.value));
const LAB_TESTS = computed(() => labDefs(template.value));

const activeSectionId = ref('');
const activeSectionIndex = computed(() => FORM_SECTIONS.value.findIndex((section) => section.id === activeSectionId.value));
// 超過這個數量就只顯示目前所在區塊的文字，其餘收成編號圓圈，
// 否則導覽列會長到必須大幅橫捲才找得到自己在哪。
const COMPACT_STEP_THRESHOLD = 6;
const compactSteps = computed(() => FORM_SECTIONS.value.length > COMPACT_STEP_THRESHOLD);

const route = useRoute();
const router = useRouter();
const toast = useToast();
const petId = ref(route.params.petId ?? null);
const recordId = ref(route.params.id ?? null);
const isEdit = computed(() => Boolean(recordId.value));
const recordStatus = ref('draft');
const reportVersion = ref(1);
const revisionReason = ref('');
const isLocked = computed(() => recordStatus.value !== 'draft');
const showDiscardConfirm = ref(false);
const discarding = ref(false);

// 健檢類型 = 用哪一份範本，只在建立報告時決定；建立後不可更改，
// 否則已填的作答會對不上表單結構。
const examTypes = ref([]);
const SPECIES_LABELS = { cat: '貓', dog: '犬', all: '不限物種' };
const chosenTemplateId = ref('');
const examTypeName = ref('');
// 建立報告一律先選類型 —— 類型決定整份表單且建立後不可更改，
// 所以做成「選擇 → 確認」兩步，避免誤點就定案。
const pendingTemplateId = ref('');
const needsTypeChoice = computed(() => !recordId.value && !chosenTemplateId.value);
const confirmingExamType = ref(false);
const typeChoiceError = ref('');

const pet = ref(null);
const { to: backTo, label: backLabel } = useBackTarget(() => (petId.value ? `/pets/${petId.value}` : '/pets'), '回寵物資料');
// 參考範圍就存在範本項目上，不必另外請求。
const labRanges = computed(() => referenceRanges(template.value));
const vet = ref('');
const visitDate = ref(new Date().toISOString().slice(0, 10));
// 三個 findings 陣列在範本載入後才建立（見 applyTemplateDefaults）。
const record = reactive({
  weightKg: null,
  temperatureC: null,
  heartRate: null,
  respiratoryRate: null,
  bodyConditionScore: null,
  measurementAssessments: [],
  examinationFindings: [],
  labFindings: [],
  // 使用者自訂項目的作答；內建項目仍存在上面的具名欄位。
  customValues: {},
  chiefComplaint: '',
  history: '',
  conclusion: '',
  diagnosis: '',
  labSummary: '',
  treatmentPlan: '',
  other: '',
});

// 以範本定義建立空白的作答結構；建立新報告與載入既有草稿前都會先跑這一段。
function applyTemplateDefaults() {
  record.measurementAssessments = BASIC_MEASUREMENTS.value.map((item) => ({ ...item, status: 'not_checked', statusSource: 'auto', referenceMin: null, referenceMax: null }));
  record.examinationFindings = EXAMINATION_ITEMS.value.map((item) => ({ ...item, status: 'not_checked', note: '' }));
  record.labFindings = LAB_TESTS.value.map((item) => ({ ...item, status: 'not_checked', statusSource: 'manual', value: '', unit: '', referenceMin: null, referenceMax: null, note: '' }));
  if (!activeSectionId.value) activeSectionId.value = FORM_SECTIONS.value[0]?.id ?? '';
}

// 將選定的健檢類型載入成真正的表單結構。
// 範本被刪除時退回報告自己的 sections 快照，已結案報告仍可正常查看。
async function applyTemplate(templateId, fallback = {}) {
  const normalizedId = typeof templateId === 'object' ? templateId?._id : templateId;
  let loadedTemplate;

  const snapshot = Array.isArray(fallback.sections) && fallback.sections.length ? fallback.sections : null;

  if (normalizedId) {
    try {
      loadedTemplate = await loadTemplate(String(normalizedId));
    } catch (err) {
      // 範本被刪除時仍要能開啟報告 —— 已結案的報告有自己的結構快照。
      if (!snapshot) throw err;
      loadedTemplate = { _id: null, name: fallback.name || '已刪除的健檢表單', species: 'all', sections: snapshot };
      template.value = loadedTemplate;
    }
  } else {
    throw new Error('找不到這份報告使用的健檢表單');
  }

  chosenTemplateId.value = loadedTemplate._id ? String(loadedTemplate._id) : '';
  examTypeName.value = loadedTemplate.name || fallback.name || '';
  activeSectionId.value = '';
  applyTemplateDefaults();
  return loadedTemplate;
}

async function confirmExamType() {
  if (!pendingTemplateId.value || confirmingExamType.value) return;
  confirmingExamType.value = true;
  typeChoiceError.value = '';
  hydrated.value = false;
  try {
    await applyTemplate(pendingTemplateId.value);
    await nextTick();
    isDirty.value = false;
    saveState.value = 'saved';
  } catch (err) {
    typeChoiceError.value = err.response?.data?.message || '健檢表單載入失敗，請稍後再試';
  } finally {
    hydrated.value = true;
    confirmingExamType.value = false;
  }
}

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

// 這兩個角色的欄位有預設值（日期帶今天、類型帶第一個選項），
// 不能拿來當「使用者已填寫此區塊」的訊號。
const PREFILLED_ROLES = new Set(['visitDate']);

function itemHasContent(item) {
  if (PREFILLED_ROLES.has(item.role)) return false;
  if (item.type === 'finding') {
    return record.examinationFindings.some((finding) => finding.key === item.key && finding.status !== 'not_checked');
  }
  if (item.type === 'lab') {
    return record.labFindings.some(
      (finding) => finding.key === item.key
        && (finding.status !== 'not_checked' || finding.value?.trim() || finding.note?.trim())
    );
  }
  // 一律走 valueFor：自訂項目存在 customValues，直接讀 record[key] 會永遠是空的。
  const value = valueFor(item);
  if (item.type === 'measurement' || item.type === 'number') return value !== null && value !== undefined && value !== '';
  return Boolean(String(value ?? '').trim());
}

// 導覽列圓圈是照 FORM_SECTIONS 排的，這裡要用同一份清單，否則收容區塊會對不上索引。
const completionSections = computed(() =>
  FORM_SECTIONS.value.map((section) => (section.items ?? []).some(itemHasContent))
);
const completedCount = computed(() => completionSections.value.filter(Boolean).length);
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
  reportVersion.value = data.reportVersion ?? 1;
  revisionReason.value = data.revisionReason ?? '';
  vet.value = data.vet ?? '';
  visitDate.value = data.visitDate ? data.visitDate.slice(0, 10) : '';
  for (const key of ['weightKg', 'temperatureC', 'heartRate', 'respiratoryRate', 'bodyConditionScore', 'chiefComplaint', 'history', 'conclusion', 'diagnosis', 'labSummary', 'treatmentPlan', 'other']) {
    if (data[key] !== undefined && data[key] !== null) record[key] = data[key];
  }
  record.customValues = { ...(data.customValues ?? {}) };
  record.examinationFindings = mergeFindings(EXAMINATION_ITEMS.value, data.examinationFindings, ['note']);
  record.measurementAssessments = mergeFindings(BASIC_MEASUREMENTS.value, data.measurementAssessments, ['statusSource', 'unit', 'referenceMin', 'referenceMax'], { statusSource: 'auto' });
  record.labFindings = mergeFindings(LAB_TESTS.value, data.labFindings, ['statusSource', 'value', 'unit', 'referenceMin', 'referenceMax', 'note']);
  lastSavedAt.value = data.updatedAt ? new Date(data.updatedAt) : null;
}

async function scrollToSection(id) {
  activeSectionId.value = id;
  await nextTick();
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// 區塊可以由使用者自訂數量，導覽列會橫向捲動。不論從哪條路徑切換
//（點導覽、上下一區、點驗證錯誤跳轉），都要把目前這一步帶進視野。
watch(activeSectionId, async (id) => {
  if (!id) return;
  await nextTick();
  document.querySelector(`[data-form-section="${id}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
});

function adjacentSection(offset) {
  const target = FORM_SECTIONS.value[activeSectionIndex.value + offset];
  if (target) scrollToSection(target.id);
}

// 驗證錯誤的錨點 id 反查所屬區塊；區塊由範本決定，不再硬對應。
function sectionIdForTarget(targetId) {
  const known = FORM_SECTIONS.value.find((section) => section.id === targetId);
  if (known) return known.id;

  // 依項目 key 反查所屬區塊，例如 record-exam-row-oral / record-lab-value-bun。
  const itemKey = targetId.replace(/^record-(exam|lab)-(row|note|value)-/, '').replace(/^record-/, '');
  const sectionKey = sectionKeyForItem(template.value, itemKey);
  if (sectionKey) return sectionDomId(sectionKey);

  // 孤兒項目不在範本裡，要問它現在掛在哪個區塊，否則點驗證錯誤只會跳回第一區。
  const orphanType = targetId.startsWith('record-lab-') ? 'lab' : targetId.startsWith('record-exam-') ? 'finding' : null;
  if (orphanType && orphansOfType(orphanType).some((entry) => entry.key === itemKey)) {
    return sectionDomId(orphanHostKey(orphanType));
  }
  return FORM_SECTIONS.value[0]?.id ?? '';
}

// ── 提供給版式元件的作答存取 ──
// vet／visitDate 存在獨立的 ref，自訂項目存在 customValues，其餘存在 record 具名欄位。
function valueFor(item) {
  // storage 要先判斷：這兩個欄位一旦被改成別的型別就會改存 customValues，
  // 再走專用 ref 會把值寫進型別對不上的具名欄位。
  if (item.storage === 'custom') return record.customValues[item.key] ?? '';
  if (item.role === 'vet') return vet.value;
  if (item.role === 'visitDate') return visitDate.value;
  return record[item.key] ?? '';
}

function setValue(item, next) {
  if (item.storage === 'custom') record.customValues[item.key] = next;
  else if (item.role === 'vet') vet.value = next ?? '';
  else if (item.role === 'visitDate') visitDate.value = next ?? '';
  else record[item.key] = next;
}

// 依區塊挑出對應的作答列；孤兒項目跟著 orphanHostKey() 走，與後端落點一致。
function entriesFor(section, entries, type) {
  const keys = new Set((section.items ?? []).filter((item) => item.type === type).map((item) => item.key));
  const known = templateKeysOf(type);
  const isHost = orphanHostKey(type) === section.key;
  return entries.filter((entry) => keys.has(entry.key) || (isHost && !known.has(entry.key)));
}

const findingsFor = (section) => entriesFor(section, record.examinationFindings, 'finding');
const labsFor = (section) => entriesFor(section, record.labFindings, 'lab');

function itemByRoleInTemplate(role) {
  return FORM_SECTIONS.value.flatMap((section) => section.items ?? []).find((item) => item.role === role) ?? null;
}

// 結論與照護建議「擇一必填」：兩邊都空時要顯示提醒。
function eitherOrPending() {
  const conclusion = itemByRoleInTemplate('conclusion');
  const treatmentPlan = itemByRoleInTemplate('treatmentPlan');
  if (!conclusion && !treatmentPlan) return false;
  return !String(valueFor(conclusion ?? {}) ?? '').trim() && !String(valueFor(treatmentPlan ?? {}) ?? '').trim();
}

// 分段導覽的圓圈有三種狀態：目前所在、已有內容、尚未填寫。
function stepBadgeClass(index, sectionId) {
  if (activeSectionId.value === sectionId) return 'bg-primary text-primary-foreground';
  if (completionSections.value[index]) return 'bg-primary/15 text-primary dark:bg-brand-500/20 dark:text-brand-300';
  return 'border border-cream-300 bg-white text-ink-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-500';
}

function markUncheckedFindingsNormal(section) {
  for (const finding of findingsFor(section)) {
    if (finding.status === 'not_checked') finding.status = 'normal';
  }
}

// 只處理按鈕所在區塊的項目 —— 兩個區塊用同一個分組名（或都沒填分組）時，
// 掃整份 labFindings 會把別的區塊與孤兒項目一起標成正常，並印進飼主看到的報告。
function markEmptyLabGroupNormal(section, group) {
  for (const finding of labsFor(section).filter((item) => (item.group ?? '') === group)) {
    if (finding.status !== 'not_checked' || finding.value.trim() || finding.note.trim()) continue;
    finding.status = 'normal';
    finding.statusSource = 'manual';
  }
}

async function loadPetContext(id) {
  const { data } = await http.get(`/pets/${id}`);
  pet.value = data;
}

async function init() {
  loading.value = true;
  loadError.value = '';
  try {
    if (recordId.value) {
      // 編輯既有報告：一定要用它自己的健檢類型，不能用目前的預設類型。
      const { data } = await http.get(`/records/${recordId.value}`);
      if (typeof data.petId === 'object') {
        pet.value = data.petId;
        petId.value = data.petId._id;
      } else {
        petId.value = data.petId;
      }
      await applyTemplate(data.templateId, { sections: data.sections, name: data.examType });
      examTypeName.value = data.examType || examTypeName.value;
      applyRecord(data);
      await loadPreviousValues();
    } else {
      // 新報告：先知道是哪隻寵物，才能只列出適用該物種的表單。
      // 這個階段「不」載入任何表單結構，等使用者確認類型後才載入。
      await loadPetContext(petId.value);
      await loadPreviousValues();
      examTypes.value = await listTemplates({ species: pet.value?.species });
      if (!examTypes.value.length) {
        loadError.value = `目前沒有適用於「${pet.value?.species || '這個物種'}」的健檢表單，請先到設定新增。`;
        return;
      }
      // 只有一種可選時先幫忙選起來，仍需按下確認。
      if (examTypes.value.length === 1) pendingTemplateId.value = examTypes.value[0]._id;
      return;
    }
    if (!pet.value) await loadPetContext(petId.value);
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

// 上次數值：這隻寵物過去每個項目最近一次的紀錄，填表時拿來對照。
// 純輔助資訊 —— 載入失敗就當作沒有歷史紀錄，不擋填表。
const previousValues = ref({ byKey: {}, byLabel: {} });

async function loadPreviousValues() {
  if (!petId.value) return;
  try {
    const { data } = await http.get(`/pets/${petId.value}/records/previous-values`, {
      params: recordId.value ? { excludeRecordId: recordId.value } : {},
    });
    previousValues.value = data;
  } catch (err) {
    previousValues.value = { byKey: {}, byLabel: {} };
  }
}

// key 對得上就用 key；自訂項目的 key 是各表單各自產生的，跨健檢類型對不起來，
// 所以再退一步用「型別＋名稱」比對，換一種健檢也看得到上次的值。
function previousFor(item, type = item?.type) {
  if (!item?.key) return null;
  const label = String(item.label ?? '').trim();
  return previousValues.value.byKey?.[item.key]
    ?? (label ? previousValues.value.byLabel?.[`${type}:${label}`] : null)
    ?? null;
}

provideRecordForm({
  valueFor,
  setValue,
  previousFor,
  findingsFor,
  labsFor,
  eitherOrPending,
  labRanges,
  labRangeLabel,
  measurementAssessment,
  autoJudgeMeasurement,
  autoJudgeLab,
  setLabStatus,
  markEmptyLabGroupNormal,
});

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
      ({ data: saved } = await http.post(`/pets/${petId.value}/records`, { ...payload, templateId: chosenTemplateId.value }));
      recordId.value = saved._id;
      const wasLeavingAfterAction = leavingAfterAction.value;
      leavingAfterAction.value = true;
      await router.replace(`/records/${saved._id}/edit`);
      leavingAfterAction.value = wasLeavingAfterAction;
    }
    lastSavedAt.value = new Date();
    saveError.value = '';
    const hasNewChanges = JSON.stringify(buildPayload()) !== savedSnapshot;
    isDirty.value = hasNewChanges;
    saveState.value = hasNewChanges ? 'unsaved' : 'saved';
    if (!silent) toast.success('已成功儲存病歷草稿', '儲存成功');
    if (hasNewChanges) scheduleAutosave();
    return true;
  } catch (err) {
    saveState.value = 'error';
    saveError.value = await extractErrorMessage(err, silent ? '自動儲存失敗，請檢查網路後手動儲存' : '儲存草稿失敗');
    return false;
  } finally {
    saving.value = false;
  }
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => saveRecord({ silent: true }), 1500);
}

// 這裡的規則要跟後端 validateFinalRecord 對齊，否則會出現
// 「前端說不行、後端說可以」或反過來的矛盾。欄位一律從範本取，不寫死名稱。
function validateForPreview() {
  const errors = [];
  const addError = (message, targetId, focusId = targetId) => errors.push({ message, targetId, focusId });
  const items = FORM_SECTIONS.value.flatMap((section) => section.items ?? []);
  const byRole = (role) => items.find((item) => item.role === role) ?? null;

  // 錨點要用實際渲染出來的 DOM id，不同型別的版式元件命名規則不同。
  const anchorFor = (item) => {
    if (!item) return FORM_SECTIONS.value[0]?.id ?? '';
    if (item.type === 'finding') return `record-exam-row-${item.key}`;
    if (item.type === 'lab') return `record-lab-row-${item.key}`;
    return `record-${item.key}`;
  };
  const filled = (item) => {
    if (!item) return false;
    if (item.type === 'finding') return record.examinationFindings.some((f) => f.key === item.key && f.status !== 'not_checked');
    if (item.type === 'lab') return record.labFindings.some((f) => f.key === item.key && (f.status !== 'not_checked' || f.value?.trim()));
    return Boolean(String(valueFor(item) ?? '').trim());
  };

  for (const item of items.filter((entry) => entry.required)) {
    if (!filled(item)) addError(`請填寫${item.label}`, anchorFor(item));
  }

  // 與後端相同：visitDate 有預設值、vet 是行政欄位，都不算臨床內容。
  const ADMIN_ROLES = new Set(['visitDate', 'vet']);
  if (!items.some((item) => !ADMIN_ROLES.has(item.role) && filled(item))) {
    addError('請至少填寫一個區塊的檢查內容', FORM_SECTIONS.value[0]?.id ?? '');
  }

  const conclusion = byRole('conclusion');
  const treatmentPlan = byRole('treatmentPlan');
  if ((conclusion || treatmentPlan) && !filled(conclusion) && !filled(treatmentPlan)) {
    const label = [conclusion?.label, treatmentPlan?.label].filter(Boolean).join('或');
    addError(`請填寫${label}`, anchorFor(conclusion ?? treatmentPlan));
  }

  // 數值範圍取自範本項目，不再寫死「體態評分 1–9」。
  for (const item of items.filter((entry) => entry.type === 'measurement' || entry.type === 'number')) {
    const raw = valueFor(item);
    if (raw === null || raw === undefined || String(raw).trim() === '') continue;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) {
      addError(`${item.label}必須是數字`, anchorFor(item));
      continue;
    }
    if (item.min != null && numeric < item.min) addError(`${item.label}不可小於 ${item.min}`, anchorFor(item));
    if (item.max != null && numeric > item.max) addError(`${item.label}不可大於 ${item.max}`, anchorFor(item));
  }

  for (const finding of record.examinationFindings.filter((f) => f.status === 'abnormal' && !f.note?.trim())) {
    addError(`請補充理學檢查異常說明：${finding.label}`, `record-exam-row-${finding.key}`, `record-exam-note-${finding.key}`);
  }
  for (const finding of record.labFindings.filter((f) => f.status === 'abnormal' && !f.note?.trim())) {
    addError(`請補充檢驗異常說明：${finding.label}`, `record-lab-row-${finding.key}`, `record-lab-note-${finding.key}`);
  }
  for (const finding of record.labFindings.filter((f) => f.numeric !== false && f.value?.trim() && !Number.isFinite(Number(f.value)))) {
    addError(`檢驗數值必須是數字：${finding.label}`, `record-lab-row-${finding.key}`, `record-lab-value-${finding.key}`);
  }

  validationErrors.value = errors;
  return errors.length === 0;
}

async function goToValidationIssue(issue) {
  activeSectionId.value = sectionIdForTarget(issue.targetId);
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
  const saved = await saveRecord();
  if (!saved) return;
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
  // 常用語清單只在模組層級抓一次，之後各欄位都從記憶體篩；
  // 失敗不影響填表，composable 內部已經吞掉錯誤。
  loadPhrases();
  window.addEventListener('beforeunload', handleBeforeUnload);
});
onBeforeUnmount(() => {
  clearTimeout(autosaveTimer);
  window.removeEventListener('beforeunload', handleBeforeUnload);
});

function handleBeforeUnload(event) {
  if (!isDirty.value) return;
  event.preventDefault();
  event.returnValue = '';
}
</script>

<template>
  <section class="mx-auto max-w-6xl space-y-5 pb-28">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div><router-link :to="backTo" class="mb-2 inline-flex min-h-11 items-center text-sm font-medium text-belle-600 dark:text-brand-400">← {{ backLabel }}</router-link><h1 class="text-xl font-semibold text-ink-900 dark:text-white">{{ isLocked ? '已結案健檢紀錄' : isEdit && reportVersion > 1 ? `編輯第 ${reportVersion} 版修訂草稿` : isEdit ? '編輯健檢紀錄' : '新增健檢紀錄' }}</h1><p class="mt-1 text-sm text-ink-500 dark:text-zinc-400"><span v-if="examTypeName" class="mr-2 inline-flex items-center rounded-full bg-belle-50 px-2.5 py-0.5 text-xs font-medium text-belle-700 dark:bg-brand-500/10 dark:text-brand-300">{{ examTypeName }}</span>{{ isLocked ? '此報告已結案，為保留正式版本而無法直接修改。' : '依健檢流程分段填寫，未執行的檢查維持「未檢查」即可。' }}</p><p v-if="revisionReason" class="mt-1 text-xs text-ink-500 dark:text-zinc-400">修訂原因：{{ revisionReason }}</p></div>
      <div v-if="!isLocked" class="flex items-center gap-2 text-xs" :class="saveState === 'error' ? 'text-red-600 dark:text-red-300' : 'text-ink-500 dark:text-zinc-400'"><Clock3 class="h-4 w-4" />{{ saveLabel }}</div>
    </div>

    <p v-if="loadError" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">{{ loadError }}</p>
    <p v-else-if="loading" class="text-sm text-ink-500 dark:text-zinc-400" role="status">載入健檢資料…</p>

    <!-- 建立報告的第一步：選健檢類型，決定要套用哪一份表單 -->
    <div v-else-if="needsTypeChoice" class="rounded-2xl border border-cream-300 bg-cream-50 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-6">
      <h2 class="text-base font-semibold text-ink-900 dark:text-white">選擇健檢類型</h2>
      <p class="mt-1 text-sm text-ink-500 dark:text-zinc-400">
        每種類型有各自的健檢表單。<strong class="font-medium text-ink-700 dark:text-zinc-200">建立後就不能更改</strong>，請確認後再開始填寫。
      </p>
      <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <button
          v-for="type in examTypes"
          :key="type._id"
          type="button"
          class="rounded-xl border p-4 text-left transition-colors"
          :class="pendingTemplateId === type._id
            ? 'border-primary bg-belle-50 ring-1 ring-primary dark:bg-brand-500/10'
            : 'border-cream-300 bg-white hover:border-belle-500 hover:bg-belle-50 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-brand-500/50 dark:hover:bg-brand-500/5'"
          :aria-pressed="pendingTemplateId === type._id"
          @click="pendingTemplateId = type._id"
        >
          <span class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-medium text-ink-900 dark:text-white">{{ type.name }}</span>
            <span v-if="type.species !== 'all'" class="rounded-full bg-cream-200 px-2 py-0.5 text-xs font-medium text-ink-600 dark:bg-zinc-800 dark:text-zinc-300">{{ SPECIES_LABELS[type.species] }}用</span>
            <Check v-if="pendingTemplateId === type._id" class="h-4 w-4 text-primary" stroke-width="1.75" />
          </span>
          <span class="mt-1 block text-xs text-ink-400 dark:text-zinc-500">{{ type.description || `${type.sectionCount} 個區塊・${type.itemCount} 個項目` }}</span>
        </button>
      </div>
      <div class="mt-5 flex flex-wrap items-center gap-3 border-t border-cream-300 pt-4 dark:border-zinc-800">
        <p v-if="typeChoiceError" class="w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">{{ typeChoiceError }}</p>
        <Button type="button" class="min-h-11" :disabled="!pendingTemplateId || confirmingExamType" @click="confirmExamType">
          {{ confirmingExamType ? '載入表單中…' : `開始填寫${pendingTemplateId ? `「${examTypes.find((type) => type._id === pendingTemplateId)?.name}」` : ''}` }}
        </Button>
        <Button as-child variant="outline" class="min-h-11">
          <router-link :to="backTo">取消</router-link>
        </Button>
      </div>
    </div>

    <template v-else>
      <div v-if="isLocked" class="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950 shadow-sm dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200">
        <div class="flex items-start gap-3">
          <LockKeyhole class="mt-0.5 h-5 w-5 shrink-0" />
          <div class="min-w-0 flex-1">
            <h2 class="text-base font-semibold">正式報告已鎖定</h2>
            <p class="mt-1 text-sm">為避免已結案的內容與 PDF 不一致，此版本不再開放直接編輯。</p>
            <div class="mt-4 flex flex-wrap gap-2">
              <Button as-child><router-link :to="`/records/${recordId}/preview`"><FileText class="h-4 w-4" />查看正式報告</router-link></Button>
              <Button as-child variant="outline"><router-link :to="`/pets/${petId}`">回寵物資料</router-link></Button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="!isLocked" id="record-context-bar" class="rounded-2xl border border-cream-300 bg-cream-50 px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div class="flex flex-wrap items-center justify-between gap-3"><div class="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2"><div class="flex min-w-0 items-center gap-2"><PawPrint class="h-5 w-5 shrink-0 text-belle-600 dark:text-brand-400" /><span class="font-semibold text-ink-900 dark:text-white">{{ pet?.name ?? '—' }}</span></div><div class="flex items-center gap-2 text-sm text-ink-600 dark:text-zinc-300"><User class="h-4 w-4 text-ink-400 dark:text-zinc-400" />{{ pet?.ownerId?.name ?? '—' }}</div></div></div>
        <div v-if="pet?.allergies" class="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"><AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" /><span><strong>過敏提醒：</strong>{{ pet.allergies }}</span></div>
      </div>

      <!-- 分段導覽同時是進度指示：圓圈顯示該區塊是否已有內容，連接線串起順序 -->
      <nav
        v-if="!isLocked"
        aria-label="健檢表單區段"
        class="sticky top-16 z-20 overflow-x-auto lg:top-0 rounded-2xl border border-cream-300 bg-cream-50 px-2 py-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <ol class="flex min-w-max items-center">
          <li v-for="(section, index) in FORM_SECTIONS" :key="section.id" class="flex items-center">
            <button
              type="button"
              :data-form-section="section.id"
              :title="section.label"
              class="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              :class="[
                compactSteps && activeSectionId !== section.id ? 'px-1' : 'px-2.5',
                activeSectionId === section.id
                  ? 'font-semibold text-ink-900 dark:text-white'
                  : 'font-medium text-ink-500 hover:text-ink-800 dark:text-zinc-400 dark:hover:text-zinc-100',
              ]"
              :aria-current="activeSectionId === section.id ? 'step' : undefined"
              @click="scrollToSection(section.id)"
            >
              <span
                class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors"
                :class="stepBadgeClass(index, section.id)"
              >
                <Check v-if="completionSections[index] && activeSectionId !== section.id" class="h-3.5 w-3.5" stroke-width="2.5" />
                <template v-else>{{ index + 1 }}</template>
              </span>
              <span v-if="!compactSteps || activeSectionId === section.id" class="whitespace-nowrap">{{ section.label }}</span>
              <span class="sr-only">{{ section.label }}{{ completionSections[index] ? '（已有內容）' : '（尚未填寫）' }}</span>
            </button>
            <span
              v-if="index < FORM_SECTIONS.length - 1"
              aria-hidden="true"
              class="mx-0.5 h-px w-4 shrink-0 rounded-full transition-colors"
              :class="completionSections[index] ? 'bg-primary/40' : 'bg-cream-300 dark:bg-zinc-700'"
            />
          </li>
        </ol>
      </nav>

      <div id="form-errors" v-if="!isLocked && validationErrors.length" class="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200" role="alert"><p class="font-semibold">正式報告尚缺少以下內容：</p><ul class="mt-2 list-disc space-y-1 pl-5"><li v-for="issue in validationErrors" :key="`${issue.targetId}-${issue.message}`"><button type="button" class="text-left font-medium underline decoration-red-300 underline-offset-2 hover:text-red-950 dark:hover:text-white" @click="goToValidationIssue(issue)">{{ issue.message }}</button></li></ul><p class="mt-3 text-xs">點擊任一項可前往對應欄位。</p></div>

      <form v-if="!isLocked" class="space-y-5" @submit.prevent>
        <section
          v-for="(section, index) in FORM_SECTIONS"
          v-show="activeSectionId === section.id"
          :id="section.id"
          :key="section.key"
          class="scroll-mt-40 rounded-2xl border border-cream-300 bg-cream-50 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-6"
        >
          <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <span class="flex h-8 w-8 items-center justify-center rounded-full bg-belle-50 text-sm font-semibold text-belle-600 dark:bg-brand-500/10 dark:text-brand-400">{{ index + 1 }}</span>
              <div>
                <h2 class="text-base font-semibold text-ink-900 dark:text-white">{{ section.label }}</h2>
                <p v-if="section.description" class="text-xs text-ink-400 dark:text-zinc-400">{{ section.description }}</p>
              </div>
            </div>
            <Button v-if="section.presentation === 'findings'" type="button" variant="outline" size="sm" class="min-h-10" @click="markUncheckedFindingsNormal(section)">未標示項目全部正常</Button>
            <!-- 參考範圍現在存在表單項目上，直接連到這份報告所用的表單 -->
            <Button v-else-if="section.presentation === 'table' && template?._id" as-child variant="secondary" size="sm">
              <router-link :to="`/settings/forms/${template._id}`">設定參考範圍</router-link>
            </Button>
          </div>
          <FormSection :section="section" />
        </section>

        <div class="flex items-center justify-between gap-3">
          <Button type="button" variant="outline" class="min-h-11" :disabled="activeSectionIndex === 0" @click="adjacentSection(-1)">← 上一區</Button>
          <span class="text-xs text-ink-500 dark:text-zinc-400">{{ activeSectionIndex + 1 }} / {{ FORM_SECTIONS.length }}</span>
          <Button type="button" variant="outline" class="min-h-11" :disabled="activeSectionIndex === FORM_SECTIONS.length - 1" @click="adjacentSection(1)">下一區 →</Button>
        </div>
      </form>

      <div v-if="!isLocked" class="flex justify-end">
        <Button type="button" variant="destructive-outline" class="min-h-11" :disabled="saving || discarding" @click="showDiscardConfirm = true"><Trash2 class="h-4 w-4" />捨棄這份草稿</Button>
      </div>
      <p v-if="!isLocked && saveError" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">{{ saveError }}</p>
      <div v-if="!isLocked" id="record-action-bar" class="fixed inset-x-0 bottom-0 z-30 border-t border-cream-300 bg-cream-50 px-4 py-3 shadow-[0_-10px_30px_-20px_rgba(0,0,0,0.35)] dark:border-zinc-800 dark:bg-zinc-950 lg:left-64">
        <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <p class="hidden items-center gap-2 text-xs text-ink-500 dark:text-zinc-400 sm:flex"><Activity class="h-4 w-4" />已有內容 {{ completedCount }}/{{ FORM_SECTIONS.length }} 個區段</p>
          <div class="ml-auto flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" class="min-h-11" :disabled="saving || discarding" @click="submitDraft"><Save class="h-4 w-4" />{{ saving ? '儲存中…' : '儲存草稿並返回' }}</Button>
            <Button type="button" class="min-h-11" :disabled="saving || discarding" @click="openPreview"><FileText class="h-4 w-4" />預覽並準備結案</Button>
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
      title="儲存草稿後離開"
      description="尚有變更未儲存。系統會先儲存草稿，再前往下一頁。"
      confirm-label="儲存並離開"
      cancel-label="繼續編輯"
      :loading="saving"
      :destructive="false"
      @update:open="(value) => !value && (pendingLeavePath = '')"
      @confirm="confirmLeave"
    />
    <QuickPhraseDeleteDialog />
    <QuickPhrasePickerDialog />
  </section>
</template>
