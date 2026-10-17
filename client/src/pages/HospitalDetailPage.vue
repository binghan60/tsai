<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { BedDouble, Check, ChevronDown, FlaskConical, LogOut, Pencil, Plus } from '@lucide/vue';
import { http } from '../api/http';
import { apiErrorMessage } from '../lib/apiError';
import { clinicDateInput, clinicTimeInput, shortDate } from '../lib/datetime';
import { breedText } from '../lib/petDisplay';
import { instrumentLabel } from '../lib/labResults';
import { effectiveAssays, labFlag } from '../../../shared/labValues.js';
import {
  STAFF_LABELS,
  canCancelHospitalization,
  daySections,
  entryDraft,
  entryPatch,
  entryPayload,
  filledFields,
  newEntryTime,
  shortDateTime,
  stayDays,
  weightTrend,
} from '../lib/hospitalization';
import { useLiveReload } from '../composables/useLiveReload';
import { canRequestLab, labRequestDelivered, useLabRequest } from '../composables/useLabRequest';
import { useStaffIdentity } from '../composables/useStaffIdentity';
import { useToast } from '../composables/useToast';
import PageHeader from '../components/PageHeader.vue';
import FilterTabs from '../components/FilterTabs.vue';
import PatientLink from '../components/PatientLink.vue';
import StrayBadge from '../components/StrayBadge.vue';
import PetSex from '../components/PetSex.vue';
import RichText from '../components/RichText.vue';
import RowActions from '../components/RowActions.vue';
import ListSkeleton from '../components/ListSkeleton.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import ModalDialog from '../components/ModalDialog.vue';
import HospitalTimelineRow from '../components/HospitalTimelineRow.vue';
import HospitalEntryForm from '../components/HospitalEntryForm.vue';
import DischargeDialog from '../components/DischargeDialog.vue';
import LabImportDialog from '../components/LabImportDialog.vue';
import LabResultGroups from '../components/LabResultGroups.vue';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Label } from '../components/ui/label';
import { DialogFooter } from '../components/ui/dialog';

// 住院專區：一次住院的照護時間軸＋住院概況。
//   · 時間軸：最新的一天在上面，一天之內照時間先後（跟紙本一樣往下寫）；每天的標題列右邊是當天體重。
//     每筆只列有填的欄位。新增是那一天最後的「記一筆」、修改是那筆的筆形鈕，都在原地展開同一張表單，
//     按「新增」「儲存」才送出（不會留下空紀錄）。一次只開一張表單。
//   · 住院概況（寬的時候在右側欄，窄的時候疊在時間軸上面）：住院原因、入院、入院評估（入院那次看診，只讀引用）；
//     體重變化與檢驗結果在時間軸旁邊（窄的時候接在時間軸後面）。
// 規則見 CLAUDE.md 第三節 hospitalizations。
const route = useRoute();
const router = useRouter();
const toast = useToast();
const { identity } = useStaffIdentity();
const id = computed(() => String(route.params.id));

const detail = ref(null);
const loading = ref(true);
const loadError = ref('');
const labResults = ref([]);
let loadSequence = 0;
// 本機寫入成功的次數：重讀送出之後本機又寫入過，回來的就是寫入之前的舊資料，丟掉再讀一次
// （不然剛新增的那筆會閃一下消失、剛改好的又變回去）。
let writeSeq = 0;

const pet = computed(() => detail.value?.pet ?? null);
const status = computed(() => detail.value?.status ?? '');
const admitted = computed(() => status.value === 'admitted');
const cancelled = computed(() => status.value === 'cancelled');
const dates = computed(() => detail.value?.dates ?? []);
const sections = computed(() => daySections(dates.value, detail.value?.entries));

// ---- 天數頁籤：一次只看一天，住很久時頁面不會變長 ----
// 頁籤由左到右是第 1 天到最後一天；住院中預設今天，已出院預設最後一天。數字是那天的紀錄筆數（沒有就不寫）。
const activeDate = ref('');
const dayTabs = computed(() => [...sections.value].reverse().map((day) => ({ key: day.date, label: `第 ${day.dayNumber} 天　${shortDate(day.date)}` })));
const dayCounts = computed(() => Object.fromEntries(sections.value.filter((day) => day.entries.length).map((day) => [day.date, day.entries.length])));
const visibleSections = computed(() => sections.value.filter((day) => day.date === activeDate.value));
function defaultDate() {
  const list = dates.value;
  if (!list.length) return '';
  const today = clinicDateInput();
  return admitted.value && list.includes(today) ? today : list.at(-1);
}
watch(dates, (list) => {
  if (!activeDate.value || !list.includes(activeDate.value)) activeDate.value = defaultDate();
}, { immediate: true });
// 住很久時頁籤列要橫向捲動：選中的那一格捲進視野裡。
watch([activeDate, dayTabs], async () => {
  await nextTick();
  document.querySelector('[aria-label="住院天數"] [aria-selected="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
});
const dayNumber = computed(() => stayDays(detail.value?.admittedAt, detail.value?.dischargedAt ?? new Date()));
const assessment = computed(() => detail.value?.admittingAppointment ?? null);
const visitLink = computed(() => (assessment.value ? { path: '/appointments', query: { date: assessment.value.date, open: assessment.value._id } } : null));
const weights = computed(() => weightTrend(assessment.value?.weightKg, detail.value?.entries));
const ownerName = computed(() => pet.value?.ownerId?.name ?? '');
const hasValue = (value) => value !== null && value !== undefined && value !== '';

// ---- 讀取與即時同步 ----

async function load({ silent = false } = {}) {
  const sequence = ++loadSequence;
  const seenWrites = writeSeq;
  if (!silent) {
    loading.value = true;
    loadError.value = '';
  }
  try {
    const { data } = await http.get(`/hospitalizations/${id.value}`);
    if (sequence !== loadSequence) return;
    if (writeSeq !== seenWrites) {
      load({ silent: true });
      return;
    }
    applyDetail(data);
    loadError.value = '';
  } catch (err) {
    if (sequence === loadSequence && !silent) loadError.value = apiErrorMessage(err, '住院紀錄暫時無法載入，請稍後重試');
  } finally {
    if (sequence === loadSequence && !silent) loading.value = false;
  }
}

function applyDetail(data) {
  detail.value = data;
  // 正在修改的那筆被別台刪掉了：收起表單。別台改了它就留著表單，儲存時版本不符會跳提示並載入最新內容。
  if (form.value?.mode === 'edit' && !data.entries?.some((entry) => entry._id === form.value.entry._id)) {
    form.value = null;
    toast.info('正在修改的這筆紀錄已被其他裝置刪除', '紀錄已刪除');
  }
}

async function loadLabs() {
  try {
    const { data } = await http.get('/lab-results', { params: { hospitalizationId: id.value } });
    labResults.value = data.items ?? [];
  } catch {
    // 讀不到就維持原樣；下一次有結果進來會再讀。
  }
}

useLiveReload(() => load({ silent: true }), {
  events: ['hospitalization:updated', 'patients:updated', 'clinical-note:updated'],
  match: (event, payload) => {
    if (event === 'hospitalization:updated') return String(payload?._id ?? '') === id.value;
    if (event === 'clinical-note:updated') return String(payload?.petId ?? '') === String(pet.value?._id ?? '');
    return true;
  },
});
useLiveReload(loadLabs, { events: ['lab-results:updated'] });

function replaceEntry(entry) {
  if (!detail.value) return;
  const entries = detail.value.entries ?? [];
  const index = entries.findIndex((item) => item._id === entry._id);
  detail.value.entries = index === -1 ? [...entries, entry] : entries.map((item, i) => (i === index ? entry : item));
}

// ---- 新增／修改照護紀錄（一次只開一張表單） ----

const form = ref(null); // { mode: 'create' | 'edit', date, entry?, defaultTime?, key }
const formRef = ref(null);
const formSubmitting = ref(false);
const formError = ref('');
// 表單在 v-for 裡（哪一天、哪一筆），一般的 ref 會變成陣列；用函式 ref 接住目前那一張。
function setFormRef(el) {
  formRef.value = el;
}
const formDirty = () => Boolean(formRef.value?.isDirty);

function guardOpenForm() {
  if (form.value && formDirty()) {
    toast.info('先把正在填的那筆新增或取消', '還有一筆沒存');
    document.getElementById('hospital-entry-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }
  return true;
}

// 換一天：正在填的表單還沒存就留在原本那天（先存或取消），沒有改動的表單直接收起來。
function selectDay(date) {
  if (date === activeDate.value) return;
  if (!guardOpenForm()) return;
  closeForm();
  activeDate.value = date;
}

async function openCreate(date) {
  if (cancelled.value || !guardOpenForm()) return;
  formError.value = '';
  activeDate.value = date;
  form.value = { mode: 'create', date, defaultTime: clinicTimeInput(newEntryTime(date)), key: `new-${date}-${Date.now()}` };
  await nextTick();
  document.getElementById('hospital-entry-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function openEdit(entry) {
  if (form.value?.entry?._id === entry._id || !guardOpenForm()) return;
  formError.value = '';
  form.value = { mode: 'edit', date: clinicDateInput(entry.recordedAt), entry, key: `${entry._id}-${entry.__v}` };
}

function closeForm() {
  form.value = null;
  formError.value = '';
}

async function submitForm(draft) {
  const current = form.value;
  if (!current || formSubmitting.value) return;
  formSubmitting.value = true;
  formError.value = '';
  try {
    if (current.mode === 'create') {
      const { data } = await http.post(`/hospitalizations/${id.value}/entries`, { ...entryPayload(draft, current.date), staff: identity.value });
      writeSeq += 1;
      replaceEntry(data);
    } else {
      const patch = entryPatch(draft, entryDraft(current.entry), current.date);
      if (Object.keys(patch).length) {
        const { data } = await http.put(`/hospitalizations/${id.value}/entries/${current.entry._id}`, { version: current.entry.__v ?? 0, ...patch });
        writeSeq += 1;
        replaceEntry(data);
      }
    }
    closeForm();
  } catch (err) {
    const latest = err.response?.data?.current;
    if (err.response?.status === 409 && latest) {
      // 別台剛改過這筆：換上最新內容重新開表單，請使用者確認後再存，不默默蓋掉別人的修改。
      writeSeq += 1;
      replaceEntry(latest);
      form.value = { ...current, entry: latest, key: `${latest._id}-${latest.__v}` };
      formError.value = '這筆紀錄剛被其他裝置修改，已載入最新內容';
    } else if (err.response?.status === 404) {
      closeForm();
      toast.info('這筆紀錄已被其他裝置刪除', '紀錄已刪除');
      load({ silent: true });
    } else {
      formError.value = apiErrorMessage(err, '照護紀錄儲存失敗，請重試');
    }
  } finally {
    formSubmitting.value = false;
  }
}

const entryToDelete = ref(null);
const deleting = ref(false);
async function deleteEntry() {
  const entry = entryToDelete.value;
  if (!entry) return;
  deleting.value = true;
  try {
    await http.delete(`/hospitalizations/${id.value}/entries/${entry._id}`);
    writeSeq += 1;
    if (form.value?.entry?._id === entry._id) closeForm();
    if (detail.value) detail.value.entries = detail.value.entries.filter((item) => item._id !== entry._id);
    entryToDelete.value = null;
    toast.success('已刪除這筆照護紀錄');
  } catch (err) {
    toast.error(apiErrorMessage(err, '刪除失敗，請重試'));
  } finally {
    deleting.value = false;
  }
}

// ---- 住院單本身：出院、取消住院、改住院原因／出院備註 ----

function takeHospitalization(data) {
  if (!detail.value || !data) return;
  writeSeq += 1;
  Object.assign(detail.value, {
    status: data.status,
    reason: data.reason,
    dischargeNote: data.dischargeNote,
    dischargeSpecialCareNote: data.dischargeSpecialCareNote,
    dischargeFollowUpRecommendation: data.dischargeFollowUpRecommendation,
    dischargedAt: data.dischargedAt,
    __v: data.__v,
  });
}

// 出院時間不能早於最後一筆照護紀錄，不然那幾天會從時間軸上消失。
const lastRecordAt = computed(() => {
  const entryTimes = (detail.value?.entries ?? []).map((entry) => new Date(entry.recordedAt).getTime());
  return entryTimes.length ? new Date(Math.max(...entryTimes)) : null;
});

const dischargeOpen = ref(false);
const discharging = ref(false);
const dischargeError = ref('');
function openDischarge() {
  if (!guardOpenForm()) return;
  closeForm();
  dischargeError.value = '';
  dischargeOpen.value = true;
}
async function discharge(payload) {
  discharging.value = true;
  dischargeError.value = '';
  try {
    const { data } = await http.post(`/hospitalizations/${id.value}/discharge`, { version: detail.value.__v ?? 0, ...payload });
    takeHospitalization(data.hospitalization);
    dischargeOpen.value = false;
    toast.success([data.medicationOrder && '帶回家的藥已開成待包藥', data.followUp && `已約回診 ${shortDate(data.followUp.date)} ${data.followUp.time}`].filter(Boolean).join('，') || `${pet.value?.name ?? ''}已出院`, '已出院');
    await load({ silent: true });
  } catch (err) {
    dischargeError.value = apiErrorMessage(err, '出院失敗，請重試');
  } finally {
    discharging.value = false;
  }
}

const cancelOpen = ref(false);
const cancelling = ref(false);
async function cancelHospitalization() {
  cancelling.value = true;
  try {
    await http.post(`/hospitalizations/${id.value}/cancel`, { version: detail.value.__v ?? 0 });
    cancelOpen.value = false;
    toast.success('已取消住院');
    closeForm();
    router.replace(visitLink.value ?? '/hospital');
  } catch (err) {
    toast.error(apiErrorMessage(err, '取消住院失敗'));
    cancelOpen.value = false;
    load({ silent: true });
  } finally {
    cancelling.value = false;
  }
}

// 改住院原因（住院中、已出院都能改）：概況卡上就地編輯，Enter 存、Esc 取消。
const reasonEditing = ref(false);
const reasonDraft = ref('');
const reasonSaving = ref(false);
const reasonError = ref('');
const reasonInput = ref(null);
async function startReasonEdit() {
  reasonDraft.value = detail.value?.reason ?? '';
  reasonError.value = '';
  reasonEditing.value = true;
  await nextTick();
  reasonInput.value?.$el?.focus?.();
}
function cancelReasonEdit() {
  reasonEditing.value = false;
  reasonError.value = '';
}
async function saveReason() {
  const reason = reasonDraft.value.trim();
  if (reason === (detail.value.reason ?? '')) return cancelReasonEdit();
  reasonSaving.value = true;
  reasonError.value = '';
  try {
    const { data } = await http.put(`/hospitalizations/${id.value}`, { version: detail.value.__v ?? 0, reason });
    takeHospitalization(data);
    reasonEditing.value = false;
  } catch (err) {
    reasonError.value = apiErrorMessage(err, '儲存失敗，請重試');
    if (err.response?.status === 409) load({ silent: true });
  } finally {
    reasonSaving.value = false;
  }
}

// 改出院內容（已出院：出院備註、請轉告飼主、回診建議）：小視窗。
const textEdit = ref(null); // { title, fields: [{ key, label, value, max, labelClass }] }
const textSaving = ref(false);
const textError = ref('');
function openTextEdit() {
  textError.value = '';
  const field = (key, label, max, labelClass = '') => ({ key, label, value: detail.value[key] ?? '', max, labelClass });
  textEdit.value = {
    title: '修改出院內容',
    fields: [
      field('dischargeNote', '出院備註', 2000),
      field('dischargeSpecialCareNote', '請轉告飼主', 500, 'text-warning'),
      field('dischargeFollowUpRecommendation', '回診建議', 500),
    ],
  };
}
async function saveTextEdit() {
  textSaving.value = true;
  textError.value = '';
  try {
    const values = Object.fromEntries(textEdit.value.fields.map((item) => [item.key, item.value.trim()]));
    const { data } = await http.put(`/hospitalizations/${id.value}`, { version: detail.value.__v ?? 0, ...values });
    takeHospitalization(data);
    textEdit.value = null;
  } catch (err) {
    textError.value = apiErrorMessage(err, '儲存失敗，請重試');
    if (err.response?.status === 409) load({ silent: true });
  } finally {
    textSaving.value = false;
  }
}

const moreActions = computed(() => {
  if (cancelled.value || !detail.value) return [];
  const actions = [];
  if (status.value === 'discharged') actions.push({ key: 'discharge', label: '修改出院內容' });
  if (labRequestable.value && assessment.value?.labRequestedAt) actions.push({ key: 'cancel-lab', label: '取消送 IDEXX', icon: FlaskConical, disabled: labRequest.busy.value });
  if (canCancelHospitalization(detail.value)) actions.push({ key: 'cancel', label: '取消住院', danger: true });
  return actions;
});
function onMoreAction(key) {
  if (key === 'cancel') cancelOpen.value = true;
  else if (key === 'cancel-lab') toggleLabRequest(false);
  else openTextEdit();
}

// ---- 送 IDEXX：住院中的貓，單號是入院那次看診的（診所測過的做法），結果回來連到這次住院、顯示在下面的檢驗結果 ----

const labRequest = useLabRequest();
const labAppointment = computed(() => (assessment.value && detail.value ? { ...assessment.value, petId: detail.value.petId } : null));
const labRequestable = computed(() => labRequest.enabled.value && admitted.value && canRequestLab(labAppointment.value, { hospitalized: true }));
// 上一張單驗完了（有結果在這張單送出之後回來）：可以再送一次。
const labOrderDone = computed(() => Boolean(assessment.value?.labRequestedAt)
  && labResults.value.some((result) => new Date(result.runAt) >= new Date(assessment.value.labRequestedAt)));
async function toggleLabRequest(requested) {
  if (!labAppointment.value) return;
  const before = assessment.value?.labRequestedAt ?? null;
  const data = await labRequest.setLabRequest(labAppointment.value, requested);
  if (!data || !detail.value) return;
  // 再送卻沒換時間：伺服器認為上一張單還沒驗完，沒有重送。
  if (requested && before && data.labRequestedAt === before) toast.info('上一張單還沒有檢驗結果', '還不能再送');
  writeSeq += 1;
  Object.assign(detail.value.admittingAppointment, { labRequestedAt: data.labRequestedAt, labDeliveredAt: data.labDeliveredAt });
}

// ---- 檢驗結果（側欄）：新到舊，點一列展開數值 ----

const labImportOpen = ref(false);
const expandedLab = ref('');
const labRows = computed(() => [...labResults.value].reverse().map((result) => {
  const { purpose, name } = instrumentLabel(result.instrument);
  return {
    id: String(result._id),
    result,
    time: shortDateTime(result.runAt),
    title: purpose || name,
    abnormal: effectiveAssays(result).filter((assay) => labFlag(assay)).length,
  };
}));

// ---- 清單的「新增紀錄」（?new=1）：打開今天的「記一筆」表單（不先建立紀錄），然後把參數拿掉 ----

let newHandled = false;
watch(detail, (value) => {
  if (!value || newHandled || route.query.new !== '1') return;
  newHandled = true;
  const query = { ...route.query };
  delete query.new;
  router.replace({ path: route.path, query });
  if (value.status !== 'admitted' || !value.dates?.length) return;
  const today = clinicDateInput();
  openCreate(value.dates.includes(today) ? today : value.dates.at(-1));
});

// ---- 還沒存的表單：離開前提醒 ----

const pendingLeavePath = ref('');
let leaving = false;
onBeforeRouteLeave((to) => {
  if (leaving || !form.value || !formDirty()) return true;
  pendingLeavePath.value = to.fullPath;
  return false;
});
async function confirmLeave() {
  if (!pendingLeavePath.value) return;
  leaving = true;
  await router.push(pendingLeavePath.value);
}
function beforeUnload(event) {
  if (form.value && formDirty()) event.preventDefault();
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload));
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeUnload);
  loadSequence += 1;
});

watch(id, () => {
  form.value = null;
  detail.value = null;
  labResults.value = [];
  expandedLab.value = '';
  newHandled = false;
  load();
  loadLabs();
}, { immediate: true });
</script>

<template>
  <section class="flex flex-col gap-5">
    <PageHeader :title="pet?.name || '住院'" back-to="/hospital" back-label="返回住院清單">
      <template v-if="pet" #title><PatientLink :pet-id="pet._id" quiet>{{ pet.name }}</PatientLink></template>
      <template v-if="detail" #meta>
        <span class="flex flex-wrap items-center gap-x-3 gap-y-1 self-center">
          <StrayBadge v-if="pet?.isStray" />
          <Badge v-if="admitted" variant="status" class="bg-info-surface text-info">住院中　第 <span class="num">{{ dayNumber }}</span> 天</Badge>
          <span v-else-if="status === 'discharged'" class="inline-flex items-center gap-1 text-sm font-medium text-success"><Check class="size-4" stroke-width="2.25" aria-hidden="true" />已出院</span>
          <Badge v-else-if="cancelled" variant="secondary">已取消</Badge>
          <span class="inline-flex items-center gap-1.5 text-base text-muted-foreground">
            <PatientLink v-if="ownerName" :pet-id="pet?._id" quiet>{{ ownerName }}</PatientLink>
            <span class="ml-2">{{ breedText(pet) }}</span><PetSex :sex="pet?.sex" />
          </span>
        </span>
      </template>
      <template v-if="detail && !cancelled" #actions>
        <template v-if="labRequestable">
          <template v-if="assessment.labRequestedAt">
            <Badge v-if="labRequestDelivered(labAppointment)" variant="status" class="bg-info-surface text-info"><FlaskConical class="size-4" stroke-width="1.75" aria-hidden="true" />已送 IDEXX <span class="num">{{ clinicTimeInput(assessment.labRequestedAt) }}</span></Badge>
            <Badge v-else variant="status" class="bg-warning-surface text-warning"><FlaskConical class="size-4" stroke-width="1.75" aria-hidden="true" />尚未送到 IDEXX</Badge>
            <Button v-if="labOrderDone" type="button" variant="soft" :disabled="labRequest.busy.value" @click="toggleLabRequest(true)"><FlaskConical stroke-width="1.75" />再送 IDEXX</Button>
          </template>
          <Button v-else type="button" variant="soft" :disabled="labRequest.busy.value" @click="toggleLabRequest(true)"><FlaskConical stroke-width="1.75" />送 IDEXX</Button>
        </template>
        <Button type="button" variant="soft" @click="labImportOpen = true"><FlaskConical stroke-width="1.75" />匯入檢驗結果</Button>
        <Button v-if="admitted" type="button" @click="openDischarge"><LogOut stroke-width="1.75" />出院</Button>
        <RowActions v-if="moreActions.length" size="default" :actions="moreActions" label="住院的更多操作" @select="onMoreAction" />
      </template>
    </PageHeader>

    <Alert v-if="loadError" variant="destructive"><AlertDescription>{{ loadError }}</AlertDescription></Alert>
    <ListSkeleton v-if="loading && !detail" :rows="5" />

    <!-- 寬的時候：左邊時間軸、右邊住院概況＋體重＋檢驗；窄的時候（含側滑面板擠窄）：概況、時間軸、體重與檢驗依序往下。 -->
    <div v-else-if="detail" class="@container">
      <div class="grid items-start gap-6 @5xl:grid-cols-[minmax(0,1fr)_22.5rem] @5xl:grid-rows-[auto_1fr]">

        <!-- 住院概況 -->
        <div class="flex flex-col gap-3.5 rounded-xl border border-border bg-card px-5 py-4 shadow-card @5xl:col-start-2 @5xl:row-start-1">
          <div class="space-y-1">
            <div class="flex min-h-8 items-center gap-2">
              <span id="hospital-reason-label" class="spec-label">住院原因</span>
              <Button v-if="!cancelled && !reasonEditing" type="button" variant="secondary" size="icon-xs" class="ml-auto" aria-label="修改住院原因" v-tip="'修改'" @click="startReasonEdit"><Pencil stroke-width="1.75" /></Button>
            </div>
            <form v-if="reasonEditing" class="space-y-2" @submit.prevent="saveReason">
              <div class="flex items-center gap-2">
                <Input
                  ref="reasonInput"
                  v-model="reasonDraft"
                  aria-labelledby="hospital-reason-label"
                  maxlength="200"
                  class="flex-1"
                  :disabled="reasonSaving"
                  @keydown.esc.prevent="cancelReasonEdit"
                />
                <Button type="button" variant="secondary" class="shrink-0" :disabled="reasonSaving" @click="cancelReasonEdit">取消</Button>
                <Button type="submit" class="shrink-0" :disabled="reasonSaving">{{ reasonSaving ? '儲存中…' : '儲存' }}</Button>
              </div>
              <Alert v-if="reasonError" variant="destructive"><AlertDescription>{{ reasonError }}</AlertDescription></Alert>
            </form>
            <p v-else class="min-h-lh text-base font-semibold wrap-anywhere">{{ detail.reason }}</p>
          </div>
          <div class="flex flex-wrap gap-x-6 gap-y-2">
            <div class="space-y-0.5"><span class="spec-label block">入院</span><span class="num text-base">{{ shortDateTime(detail.admittedAt) }}</span></div>
            <div class="space-y-0.5"><span class="spec-label block">入院看診</span><router-link v-if="visitLink" :to="visitLink" class="num text-base text-primary underline-offset-4 hover:underline">{{ shortDate(assessment.date) }}</router-link></div>
            <div v-if="status === 'discharged'" class="space-y-0.5"><span class="spec-label block">出院</span><span class="num text-base">{{ shortDateTime(detail.dischargedAt) }}</span></div>
          </div>
          <div v-if="status === 'discharged' && detail.dischargeNote" class="space-y-0.5">
            <span class="spec-label">出院備註</span>
            <p class="text-base whitespace-pre-wrap">{{ detail.dischargeNote }}</p>
          </div>
          <div v-if="status === 'discharged' && detail.dischargeSpecialCareNote" class="space-y-0.5">
            <span class="spec-label text-warning">請轉告飼主</span>
            <p class="text-base whitespace-pre-wrap">{{ detail.dischargeSpecialCareNote }}</p>
          </div>
          <div v-if="status === 'discharged' && detail.dischargeFollowUpRecommendation" class="space-y-0.5">
            <span class="spec-label">回診建議</span>
            <p class="text-base whitespace-pre-wrap">{{ detail.dischargeFollowUpRecommendation }}</p>
          </div>
          <div v-if="assessment?.followUpAppointmentId" class="space-y-0.5">
            <span class="spec-label">已約回診</span>
            <p class="num text-base">{{ shortDate(assessment.followUpDate) }} {{ assessment.followUpTime }}</p>
          </div>
          <div v-if="assessment" class="space-y-1.5 border-t border-border pt-3">
            <h2 class="text-base font-semibold">入院評估</h2>
            <p v-if="hasValue(assessment.weightKg) || hasValue(assessment.temperatureC)" class="flex gap-4 text-sm text-muted-foreground">
              <span v-if="hasValue(assessment.weightKg)">體重 <span class="num text-base text-foreground">{{ assessment.weightKg }} kg</span></span>
              <span v-if="hasValue(assessment.temperatureC)">體溫 <span class="num text-base text-foreground">{{ assessment.temperatureC }} °C</span></span>
            </p>
            <RichText v-if="assessment.visitNote" :text="assessment.visitNote" class="text-sm leading-relaxed whitespace-pre-wrap" />
          </div>
        </div>

        <!-- 照護時間軸 -->
        <div v-if="!cancelled" class="@container flex min-w-0 flex-col gap-7 @5xl:col-start-1 @5xl:row-span-2 @5xl:row-start-1" aria-label="照護紀錄">
          <FilterTabs v-if="dayTabs.length > 1" :model-value="activeDate" :items="dayTabs" :counts="dayCounts" aria-label="住院天數" @update:model-value="selectDay" />
          <section v-for="day in visibleSections" :key="day.date" class="flex flex-col gap-3" :aria-labelledby="`hospital-day-${day.date}`">
            <h2 :id="`hospital-day-${day.date}`" class="sr-only">{{ shortDate(day.date) }} 第 {{ day.dayNumber }} 天</h2>

            <div class="flex flex-col">
              <template v-for="entry in day.entries" :key="entry._id">
                <HospitalTimelineRow v-if="form?.mode === 'edit' && form.entry._id === entry._id" :time="clinicTimeInput(entry.recordedAt)" hollow>
                  <div id="hospital-entry-form">
                    <HospitalEntryForm
                      :ref="setFormRef"
                      :key="form.key"
                      :entry="form.entry"
                      :submitting="formSubmitting"
                      :error-message="formError"
                      @submit="submitForm"
                      @cancel="closeForm"
                      @delete="entryToDelete = form.entry"
                    />
                  </div>
                </HospitalTimelineRow>
                <HospitalTimelineRow v-else :time="clinicTimeInput(entry.recordedAt)" :staff="STAFF_LABELS[entry.staff] ?? ''">
                  <div class="flex items-start gap-3 rounded-xl border border-border bg-card py-2.5 pr-2.5 pl-4 shadow-card">
                    <!-- 窄的時候（手機、側滑面板擠窄）欄位名稱放在值上面，值才有整行的寬度。 -->
                    <dl class="grid min-w-0 flex-1 grid-cols-1 gap-x-2 gap-y-1 py-0.5 @md:grid-cols-[4.75rem_minmax(0,1fr)] @md:gap-y-1.5">
                      <template v-for="field in filledFields(entry)" :key="field.key">
                        <dt class="text-xs text-muted-foreground @md:pt-0.5 @md:text-sm">{{ field.label }}</dt>
                        <dd class="min-w-0 text-base wrap-break-word whitespace-pre-wrap" :class="field.mono ? 'num' : ''">
                          <RichText v-if="field.rich" :text="field.value" />
                          <template v-else>{{ field.value }}</template>
                        </dd>
                      </template>
                    </dl>
                    <Button type="button" variant="secondary" size="icon-sm" class="shrink-0" :aria-label="`修改 ${clinicTimeInput(entry.recordedAt)} 這筆紀錄`" v-tip="'修改'" @click="openEdit(entry)"><Pencil stroke-width="1.75" /></Button>
                  </div>
                </HospitalTimelineRow>
              </template>

              <HospitalTimelineRow v-if="form?.mode === 'create' && form.date === day.date" :time="form.defaultTime" hollow>
                <div id="hospital-entry-form">
                  <HospitalEntryForm
                    :ref="setFormRef"
                    :key="form.key"
                    :default-time="form.defaultTime"
                    :submitting="formSubmitting"
                    :error-message="formError"
                    @submit="submitForm"
                    @cancel="closeForm"
                  />
                </div>
              </HospitalTimelineRow>
              <HospitalTimelineRow v-else hollow>
                <button
                  type="button"
                  class="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border-strong text-base font-medium text-primary transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus-ring"
                  @click="openCreate(day.date)"
                >
                  <Plus class="size-4.5" stroke-width="1.75" aria-hidden="true" />記一筆
                </button>
              </HospitalTimelineRow>
            </div>
          </section>
        </div>

        <!-- 體重變化與檢驗結果 -->
        <div class="flex flex-col gap-4 @5xl:col-start-2 @5xl:row-start-2">
          <section v-if="weights.length" class="flex flex-col gap-2.5 rounded-xl border border-border bg-card px-5 py-4 shadow-card" aria-labelledby="hospital-weight-heading">
            <h2 id="hospital-weight-heading" class="text-base font-semibold">體重</h2>
            <div v-for="row in weights" :key="row.key" class="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-baseline gap-3 text-sm">
              <span class="num text-muted-foreground">{{ row.label }}</span>
              <span class="num text-base">{{ row.kg }} kg</span>
              <span class="num text-subtle-foreground">{{ row.delta }}</span>
            </div>
          </section>

          <section class="flex flex-col gap-2.5 rounded-xl border border-border bg-card px-5 py-4 shadow-card" aria-labelledby="hospital-lab-heading">
            <h2 id="hospital-lab-heading" class="text-base font-semibold">檢驗結果</h2>
            <div v-for="row in labRows" :key="row.id" class="overflow-hidden rounded-lg bg-sunken">
              <button
                type="button"
                class="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus-ring"
                :aria-expanded="expandedLab === row.id"
                @click="expandedLab = expandedLab === row.id ? '' : row.id"
              >
                <span class="num">{{ row.time }}</span>
                <span class="min-w-0 truncate">{{ row.title }}</span>
                <Badge v-if="row.abnormal" variant="status" class="ml-auto bg-danger-surface text-danger">異常 <span class="num">{{ row.abnormal }}</span> 項</Badge>
                <ChevronDown class="size-4 shrink-0 text-muted-foreground transition-transform" :class="[row.abnormal ? '' : 'ml-auto', expandedLab === row.id ? 'rotate-180' : '']" stroke-width="1.75" aria-hidden="true" />
              </button>
              <div v-if="expandedLab === row.id" class="border-t border-border px-3 py-2">
                <LabResultGroups :results="[row.result]" dense />
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  </section>

  <DischargeDialog
    v-if="dischargeOpen && detail"
    :hospitalization="detail"
    :pet-name="pet?.name ?? ''"
    :last-record-at="lastRecordAt"
    :appointment="labAppointment"
    :submitting="discharging"
    :error-message="dischargeError"
    @submit="discharge"
    @close="dischargeOpen = false"
  />
  <LabImportDialog
    v-if="labImportOpen && pet"
    :appointment="{ petId: pet._id, petName: pet.name, date: clinicDateInput() }"
    :hospitalization-id="id"
    @imported="loadLabs"
    @close="labImportOpen = false"
  />
  <ConfirmDialog
    :open="Boolean(entryToDelete)"
    title="刪除照護紀錄"
    :description="entryToDelete ? `確定要刪除 ${clinicTimeInput(entryToDelete.recordedAt)} 這筆照護紀錄嗎？${entryToDelete.medicationOrderId ? '開藥開出的藥單還沒領走的會一併取消。' : ''}此操作無法復原。` : ''"
    confirm-label="刪除"
    destructive
    :loading="deleting"
    @update:open="(value) => !value && (entryToDelete = null)"
    @confirm="deleteEntry"
  />
  <ConfirmDialog
    :open="cancelOpen"
    title="取消住院"
    description="從看診搬來的用藥會搬回看診的藥單。"
    confirm-label="取消住院"
    cancel-label="返回"
    destructive
    :loading="cancelling"
    @update:open="(value) => !value && (cancelOpen = false)"
    @confirm="cancelHospitalization"
  />
  <ConfirmDialog
    :open="Boolean(pendingLeavePath)"
    title="還有一筆照護紀錄沒存"
    description="離開後填到一半的內容會不見。"
    confirm-label="確認離開"
    cancel-label="繼續填寫"
    destructive
    @update:open="(value) => !value && (pendingLeavePath = '')"
    @confirm="confirmLeave"
  />
  <ModalDialog v-if="textEdit" size="md" :title="textEdit.title" :icon="BedDouble" @close="textEdit = null">
    <form class="flex flex-col" @submit.prevent="saveTextEdit">
      <div class="space-y-4 px-6 py-5">
        <div v-for="item in textEdit.fields" :key="item.key" class="space-y-1.5">
          <Label :for="`hospital-edit-${item.key}`" class="text-xs font-medium" :class="item.labelClass">{{ item.label }}</Label>
          <Textarea :id="`hospital-edit-${item.key}`" v-model="item.value" :maxlength="item.max" class="min-h-20" />
        </div>
        <Alert v-if="textError" variant="destructive"><AlertDescription>{{ textError }}</AlertDescription></Alert>
      </div>
      <DialogFooter>
        <Button type="button" variant="secondary" @click="textEdit = null">取消</Button>
        <Button type="submit" :disabled="textSaving">{{ textSaving ? '儲存中…' : '儲存' }}</Button>
      </DialogFooter>
    </form>
  </ModalDialog>
</template>
