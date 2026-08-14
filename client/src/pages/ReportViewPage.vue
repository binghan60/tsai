<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, CheckCircle2, Copy, Download, FilePenLine, Mail, Printer, Share2 } from '@lucide/vue';
import { http } from '../api/http';
import { extractErrorMessage } from '../lib/downloadFile';
import { getDeliveryStatus, isFinalizedRecord } from '../lib/recordStatus';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import RevisionDialog from '../components/RevisionDialog.vue';
import { Button } from '../components/ui/button';

const route = useRoute();
const router = useRouter();
const record = ref(null);
const error = ref('');
const sharing = ref(false);
const emailing = ref(false);
const finalizing = ref(false);
const downloading = ref(false);
const revising = ref(false);
const revisionError = ref('');
const shareNotice = ref(null);
const showFinalizeConfirm = ref(false);
const showEmailConfirm = ref(false);
const showRevisionDialog = ref(false);
const isPreview = computed(() => route.name === 'record-preview');
const isDraft = computed(() => record.value?.status === 'draft');
const isFinalized = computed(() => isFinalizedRecord(record.value));
const deliveryStatus = computed(() => getDeliveryStatus(record.value));
const isSent = computed(() => deliveryStatus.value === 'sent');
const deliveryFailed = computed(() => deliveryStatus.value === 'failed');
const deliverySending = computed(() => deliveryStatus.value === 'sending');
const shareIsActive = computed(() => Boolean(record.value?.shareEnabled));
const shareActionLabel = computed(() => {
  if (sharing.value) return '處理中…';
  if (shareIsActive.value) return '取得飼主分享連結';
  return '建立飼主分享連結';
});
const ownerEmail = computed(() => record.value?.owner?.email?.trim() ?? '');

function normalizePreview(data) {
  const pet = data.petId && typeof data.petId === 'object' ? data.petId : null;
  return {
    ...data,
    reportNumber: data.reportNumber || `HC-${data._id?.slice(-8).toUpperCase()}`,
    status: data.status === 'sent' ? 'finalized' : data.status,
    deliveryStatus: getDeliveryStatus(data),
    pet,
    owner: pet?.ownerId ?? null,
  };
}

async function fetchReport() {
  error.value = '';
  try {
    if (isPreview.value) {
      const { data } = await http.get(`/records/${route.params.id}`);
      record.value = normalizePreview(data);
    } else {
      const params = route.query.renderKey ? { renderKey: route.query.renderKey } : {};
      const { data } = await http.get(`/public/reports/${route.params.token}`, { params });
      record.value = data;
    }
  } catch (err) {
    error.value = err.response?.data?.message ?? '找不到這份報告，連結可能已失效';
  }
}

function formatDate(date) {
  return date ? new Date(date).toLocaleDateString('zh-TW') : '—';
}

function formatDateTime(date) {
  return date ? new Date(date).toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

function sexLabel(sex) {
  return { male: '公', female: '母', unknown: '未記錄' }[sex] ?? '未記錄';
}

function ageLabel(date, referenceDate = new Date()) {
  if (!date) return '未記錄';
  const birth = new Date(date);
  const today = referenceDate ? new Date(referenceDate) : new Date();
  let years = today.getFullYear() - birth.getFullYear();
  let months = today.getMonth() - birth.getMonth();
  if (today.getDate() < birth.getDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return years > 0 ? `${years} 歲 ${months} 個月` : `${Math.max(months, 0)} 個月`;
}

const checkedFindings = computed(() => record.value?.examinationFindings?.filter((item) => item.status !== 'not_checked') ?? []);
const abnormalFindings = computed(() => [
  ...checkedFindings.value.filter((item) => item.status === 'abnormal'),
  ...(record.value?.labFindings ?? []).filter((item) => item.status === 'abnormal'),
]);
const checkedLabGroups = computed(() => {
  const groups = new Map();
  for (const item of record.value?.labFindings ?? []) {
    if (item.status === 'not_checked' && !item.value && !item.note) continue;
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group).push(item);
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }));
});

function labValueLabel(finding) {
  if (!finding.value) return '—';
  return `${finding.value}${finding.unit ? ` ${finding.unit}` : ''}`;
}

function labReferenceLabel(finding) {
  const hasMin = finding.referenceMin != null;
  const hasMax = finding.referenceMax != null;
  if (!hasMin && !hasMax) return '';
  const bounds = hasMin && hasMax
    ? `${finding.referenceMin}–${finding.referenceMax}`
    : hasMin
      ? `≥ ${finding.referenceMin}`
      : `≤ ${finding.referenceMax}`;
  return `${bounds}${finding.unit ? ` ${finding.unit}` : ''}`;
}
const vitals = computed(() => {
  const assessments = new Map((record.value?.measurementAssessments ?? []).map((item) => [item.key, item]));
  return [
    { key: 'weightKg', label: '體重', value: record.value?.weightKg != null ? `${record.value.weightKg} kg` : null },
    { key: 'temperatureC', label: '體溫', value: record.value?.temperatureC != null ? `${record.value.temperatureC} °C` : null },
    { key: 'heartRate', label: '心率', value: record.value?.heartRate != null ? `${record.value.heartRate} 次/分` : null },
    { key: 'respiratoryRate', label: '呼吸率', value: record.value?.respiratoryRate != null ? `${record.value.respiratoryRate} 次/分` : null },
    { key: 'bodyConditionScore', label: '體態評分', value: record.value?.bodyConditionScore != null ? `${record.value.bodyConditionScore} / 9` : null },
  ].filter((item) => item.value).map((item) => ({ ...item, assessment: assessments.get(item.key) }));
});

async function finalizeReport() {
  if (!record.value || !isDraft.value) return;
  finalizing.value = true;
  error.value = '';
  try {
    const { data } = await http.post(`/records/${route.params.id}/finalize`);
    record.value.status = 'finalized';
    record.value.finalizedAt = data.finalizedAt;
    record.value.pdfGeneratedAt = data.pdfGeneratedAt;
    record.value.reportVersion = data.reportVersion;
    record.value.deliveryStatus = data.deliveryStatus || 'not_sent';
    showFinalizeConfirm.value = false;
  } catch (err) {
    error.value = err.response?.data?.message ?? '結案失敗，報告仍維持草稿';
    showFinalizeConfirm.value = false;
  } finally {
    finalizing.value = false;
  }
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

async function createShareLink() {
  if (!record.value || isDraft.value) return;
  sharing.value = true;
  error.value = '';
  try {
    let url;
    if (shareIsActive.value && record.value.shareToken) {
      url = `${window.location.origin}/report/${record.value.shareToken}`;
    } else {
      const { data } = await http.post(`/records/${route.params.id}/share`);
      ({ url } = data);
      record.value.shareEnabled = true;
    }
    const copied = await copyText(url);
    shareNotice.value = { url, copied };
  } catch (err) {
    error.value = err.response?.data?.message ?? '建立分享連結失敗';
  } finally {
    sharing.value = false;
  }
}

async function downloadPdf() {
  if (!record.value || !isFinalized.value) return;
  downloading.value = true;
  error.value = '';
  try {
    const response = await http.get(`/records/${route.params.id}/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(response.data);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${record.value.reportNumber || 'health-report'}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    record.value.pdfGeneratedAt = new Date().toISOString();
  } catch (err) {
    error.value = await extractErrorMessage(err, 'PDF 下載失敗，請稍後再試');
  } finally {
    downloading.value = false;
  }
}

async function createRevision(reason) {
  if (!record.value || !isFinalized.value) return;
  revising.value = true;
  revisionError.value = '';
  try {
    const { data } = await http.post(`/records/${route.params.id}/revisions`, { reason });
    showRevisionDialog.value = false;
    await router.push(`/records/${data._id}/edit`);
  } catch (err) {
    if (err.response?.data?.newerRecordId) {
      showRevisionDialog.value = false;
      await router.push(`/records/${err.response.data.newerRecordId}/preview`);
      return;
    }
    if (err.response?.data?.revisionId) {
      showRevisionDialog.value = false;
      await router.push(`/records/${err.response.data.revisionId}/edit`);
      return;
    }
    revisionError.value = err.response?.data?.message ?? '建立修訂草稿失敗';
  } finally {
    revising.value = false;
  }
}

async function copyShareLink() {
  if (!shareNotice.value?.url) return;
  shareNotice.value.copied = await copyText(shareNotice.value.url);
}

async function sendEmail() {
  if (!record.value || !ownerEmail.value) return;
  const wasDraft = isDraft.value;
  emailing.value = true;
  error.value = '';
  try {
    const { data } = await http.post(`/records/${route.params.id}/send-email`);
    record.value.status = 'finalized';
    record.value.deliveryStatus = data.deliveryStatus || 'sent';
    record.value.deliveryError = '';
    record.value.sentAt = data.sentAt;
    record.value.sentTo = data.sentTo;
    record.value.emailMessageId = data.messageId;
    record.value.shareEnabled = true;
    shareNotice.value = {
      url: data.shareUrl,
      copied: false,
      emailed: true,
    };
    showFinalizeConfirm.value = false;
    showEmailConfirm.value = false;
  } catch (err) {
    record.value.deliveryStatus = 'failed';
    const message = err.response?.data?.message ?? `寄送 Email 失敗，${wasDraft ? '請先確認報告已結案' : '已結案報告不受影響，可稍後重試'}`;
    record.value.deliveryError = message;
    error.value = message;
    showFinalizeConfirm.value = false;
    showEmailConfirm.value = false;
  } finally {
    emailing.value = false;
  }
}

function printReport() {
  window.print();
}

onMounted(fetchReport);
</script>

<template>
  <div class="min-h-screen bg-stone-100 px-4 py-6 print:bg-white print:p-0 sm:px-6 sm:py-10">
    <section v-if="record" class="mx-auto max-w-[210mm] space-y-4 print:max-w-none print:space-y-0">
      <div class="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Button v-if="isPreview" type="button" variant="outline" class="border-stone-300 bg-white text-stone-700 hover:border-stone-400 hover:bg-stone-50 hover:text-stone-900" @click="router.push(isDraft ? `/records/${route.params.id}/edit` : `/pets/${record.pet?._id}`)"><ArrowLeft class="h-4 w-4" />{{ isDraft ? '返回編輯' : '回寵物資料' }}</Button>
        <div v-else></div>
        <div class="flex flex-wrap justify-end gap-2">
          <Button v-if="isPreview && isDraft" type="button" :disabled="finalizing" @click="showFinalizeConfirm = true"><CheckCircle2 class="h-4 w-4" />{{ finalizing ? '結案中…' : '確認結案' }}</Button>
          <Button v-else-if="isPreview" type="button" :disabled="downloading" @click="downloadPdf"><Download class="h-4 w-4" />{{ downloading ? '產生中…' : '下載正式 PDF' }}</Button>
          <Button v-else type="button" @click="printReport"><Printer class="h-4 w-4" />列印／下載 PDF</Button>
        </div>
      </div>

      <div v-if="isDraft" class="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 print:hidden"><p class="font-semibold">結案前預覽</p><p class="mt-1">目前仍是草稿。確認結案後會產生正式 PDF 並鎖定此版本；Email 可在結案後另外寄送。</p><p v-if="!ownerEmail" class="mt-2">飼主尚未填寫 Email，但不影響結案。<router-link v-if="record.owner?._id" :to="`/owners/${record.owner._id}?edit=1`" class="font-medium underline">前往補填飼主資料</router-link></p></div>
      <div v-if="isPreview && record.supersededBy" class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 print:hidden"><span><strong>此報告已有後續修訂版本</strong><span class="block">這份舊版仍完整保留，請以後續版本為準。</span></span><router-link :to="`/records/${record.supersededBy}/preview`" class="inline-flex min-h-10 items-center font-medium underline">查看下一版</router-link></div>
      <div v-else-if="!isPreview && record.hasNewerVersion" class="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 print:hidden"><strong>此報告已有更新版本</strong><span class="mt-1 block">請聯絡院方取得最新版健檢報告。</span></div>
      <div
        v-if="isPreview && isFinalized"
        class="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm print:hidden"
        :class="deliveryFailed ? 'border-red-200 bg-red-50 text-red-800' : isSent ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : deliverySending ? 'border-sky-200 bg-sky-50 text-sky-800' : 'border-brand-200 bg-brand-50 text-brand-800'"
      >
        <span class="flex items-start gap-2"><CheckCircle2 class="mt-0.5 h-5 w-5 shrink-0" /><span><strong>報告已結案 · 第 {{ record.reportVersion || 1 }} 版</strong><span class="block">{{ isSent ? `已寄送至 ${record.sentTo || ownerEmail}` : deliveryFailed ? (record.deliveryError || '上次寄送失敗，可重新寄送') : deliverySending ? '正在寄送 Email，請稍候' : '尚未寄送，可下載 PDF 或選擇寄送' }}<template v-if="record.sentAt && isSent">，時間：{{ formatDateTime(record.sentAt) }}</template></span></span></span>
        <div class="flex flex-wrap items-center gap-2">
          <Button v-if="ownerEmail" type="button" variant="secondary" size="sm" class="border-current/25 bg-white/85 text-current hover:border-current/40 hover:bg-white" :disabled="emailing || deliverySending" @click="showEmailConfirm = true"><Mail class="h-4 w-4" />{{ emailing || deliverySending ? '寄送中…' : isSent ? '重新寄送 Email' : deliveryFailed ? '重試寄送' : '寄送 Email' }}</Button>
          <Button v-else-if="record.owner?._id" as-child variant="secondary" size="sm" class="border-current/25 bg-white/85 text-current hover:border-current/40 hover:bg-white"><router-link :to="`/owners/${record.owner._id}?edit=1`">補填 Email</router-link></Button>
          <Button type="button" variant="secondary" size="sm" class="border-current/25 bg-white/85 text-current hover:border-current/40 hover:bg-white" :disabled="sharing" @click="createShareLink"><Share2 class="h-4 w-4" />{{ shareActionLabel }}</Button>
          <Button v-if="!record.supersededBy" type="button" variant="secondary" size="sm" class="border-current/25 bg-white/85 text-current hover:border-current/40 hover:bg-white" @click="showRevisionDialog = true"><FilePenLine class="h-4 w-4" />建立修訂版</Button>
        </div>
      </div>
      <div v-if="shareNotice" class="rounded-xl border border-emerald-200 bg-white px-4 py-4 text-sm text-stone-700 print:hidden">
        <p class="font-semibold text-emerald-800">{{ shareNotice.emailed ? `郵件伺服器已接受寄送至 ${record.sentTo}` : shareNotice.copied ? '分享連結已建立並複製' : '分享連結已建立' }}</p>
        <p class="mt-2 break-all rounded-lg bg-stone-100 px-3 py-2 font-mono text-xs">{{ shareNotice.url }}</p>
        <p class="mt-2 text-xs text-stone-500">連結無使用期限，手動撤銷前皆可開啟</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" class="border-stone-300 bg-white text-stone-700 hover:border-stone-400 hover:bg-stone-50" @click="copyShareLink"><Copy class="h-4 w-4" />複製連結</Button>
        </div>
        <p v-if="!ownerEmail" class="mt-3 text-xs text-amber-700">這位飼主尚未填寫 Email，請先複製連結，再透過其他方式傳送。</p>
      </div>
      <p v-if="error" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 print:hidden">{{ error }}</p>

      <article class="report-sheet rounded-2xl border border-stone-200 bg-white p-6 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none sm:p-[12mm]">
        <div v-if="record.supersededBy || record.hasNewerVersion" class="mb-5 hidden border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950 print:block">此版本已有後續修訂報告，請以最新版為準。</div>
        <header class="flex flex-col gap-5 border-b border-brand-100 pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div class="flex items-center gap-3">
              <img src="/chien-hua-logo-mark-v2.png" alt="" aria-hidden="true" class="h-12 w-14 object-contain" />
              <div>
                <div class="text-xl font-semibold text-brand-700">謙華動物醫院</div>
                <div class="mt-0.5 text-sm font-medium text-stone-600">寵物健康檢查報告</div>
              </div>
            </div>
            <p class="mt-2 font-mono text-xs text-stone-500">報告編號：{{ record.reportNumber }} · 第 {{ record.reportVersion || 1 }} 版</p>
          </div>
          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm text-stone-600 sm:text-right">
            <dt class="font-medium">獸醫師</dt><dd>{{ record.vet || '—' }}</dd>
            <dt class="font-medium">健檢日期</dt><dd>{{ formatDate(record.visitDate) }}</dd>
            <dt class="font-medium">健檢類型</dt><dd>{{ record.examType || '例行健檢' }}</dd>
          </dl>
        </header>

        <section class="mt-6 rounded-xl bg-stone-50 p-5">
          <div class="flex flex-wrap items-baseline justify-between gap-2"><h1 class="text-2xl font-semibold text-stone-900">{{ record.pet?.name || '寵物姓名未記錄' }}</h1><span class="font-mono text-xs text-stone-500">病歷號：{{ record.pet?.medicalRecordNumber || '—' }}</span></div>
          <dl class="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div><dt class="text-xs font-medium text-stone-500">飼主</dt><dd class="mt-1 text-stone-800">{{ record.owner?.name || '—' }}</dd></div>
            <div><dt class="text-xs font-medium text-stone-500">物種／品種</dt><dd class="mt-1 text-stone-800">{{ record.pet?.species || '—' }}<template v-if="record.pet?.breed">／{{ record.pet.breed }}</template></dd></div>
            <div><dt class="text-xs font-medium text-stone-500">性別／健檢時年齡</dt><dd class="mt-1 text-stone-800">{{ sexLabel(record.pet?.sex) }}／{{ ageLabel(record.pet?.birthDate, record.visitDate) }}</dd></div>
            <div><dt class="text-xs font-medium text-stone-500">晶片號碼</dt><dd class="mt-1 text-stone-800">{{ record.pet?.microchipNumber || '未記錄' }}</dd></div>
          </dl>
        </section>

        <section v-if="record.pet?.allergies || record.pet?.chronicConditions || record.pet?.currentMedications" class="mt-6 border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p v-if="record.pet.allergies"><strong>過敏：</strong>{{ record.pet.allergies }}</p>
          <p v-if="record.pet.chronicConditions"><strong>慢性病／重要病史：</strong>{{ record.pet.chronicConditions }}</p>
          <p v-if="record.pet.currentMedications"><strong>目前用藥：</strong>{{ record.pet.currentMedications }}</p>
        </section>

        <section v-if="record.conclusion || record.treatmentPlan || abnormalFindings.length" class="mt-6 rounded-xl border border-brand-100 bg-brand-50/60 p-5 break-inside-avoid">
          <div class="flex flex-wrap items-center justify-between gap-2"><h2 class="text-sm font-semibold text-brand-700">本次重點與下一步</h2><span v-if="abnormalFindings.length" class="rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">{{ abnormalFindings.length }} 項異常</span></div>
          <p v-if="record.conclusion" class="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-stone-800">{{ record.conclusion }}</p>
          <div v-if="record.treatmentPlan" class="mt-3"><h3 class="text-xs font-semibold text-stone-500">照護與追蹤建議</h3><p class="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-stone-800">{{ record.treatmentPlan }}</p></div>
        </section>

        <section v-if="record.chiefComplaint || record.history" class="mt-8 break-inside-avoid">
          <h2 class="mb-3 text-sm font-semibold text-brand-700">主訴與病史</h2>
          <div class="grid gap-5 rounded-xl border border-stone-200 p-4 sm:grid-cols-2"><div><h3 class="text-xs font-semibold text-stone-500">主訴</h3><p class="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-stone-700">{{ record.chiefComplaint || '—' }}</p></div><div><h3 class="text-xs font-semibold text-stone-500">病史</h3><p class="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-stone-700">{{ record.history || '—' }}</p></div></div>
        </section>

        <section v-if="vitals.length" class="mt-8 break-inside-avoid">
          <h2 class="mb-3 text-sm font-semibold text-brand-700">基本量測</h2>
          <dl class="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-stone-200 bg-stone-200 sm:grid-cols-5"><div v-for="item in vitals" :key="item.label" class="bg-white p-3 text-center"><dt class="text-xs text-stone-500">{{ item.label }}</dt><dd class="mt-1 text-sm font-semibold text-stone-900">{{ item.value }}</dd><dd v-if="item.assessment && item.assessment.status !== 'not_checked'" class="mt-1 text-[11px] font-medium" :class="item.assessment.status === 'abnormal' ? 'text-red-700' : 'text-emerald-700'">{{ item.assessment.status === 'abnormal' ? '異常' : '正常' }}・自動</dd><dd v-if="labReferenceLabel(item.assessment || {})" class="mt-0.5 text-[10px] text-stone-500">參考 {{ labReferenceLabel(item.assessment) }}</dd></div></dl>
        </section>

        <section v-if="checkedFindings.length" class="mt-8">
          <h2 class="mb-3 text-sm font-semibold text-brand-700">理學檢查</h2>
          <div class="overflow-hidden rounded-xl border border-stone-200"><div v-for="finding in checkedFindings" :key="finding.key" class="grid break-inside-avoid grid-cols-[1fr_auto] gap-3 border-b border-stone-200 px-4 py-3 text-sm last:border-0 sm:grid-cols-[190px_90px_1fr]"><span class="font-medium text-stone-800">{{ finding.label }}</span><span :class="finding.status === 'abnormal' ? 'text-red-700' : 'text-emerald-700'">{{ finding.status === 'abnormal' ? '異常' : '正常' }}</span><span class="col-span-2 whitespace-pre-wrap text-stone-600 sm:col-span-1">{{ finding.note || '—' }}</span></div></div>
        </section>

        <section v-if="checkedLabGroups.length || record.labSummary" class="mt-8 space-y-5">
          <h2 class="text-sm font-semibold text-brand-700">血液與尿液檢查</h2>
          <div v-for="group in checkedLabGroups" :key="group.label" class="break-inside-avoid"><h3 class="mb-2 text-xs font-semibold text-stone-500">{{ group.label }}</h3><div class="overflow-hidden rounded-xl border border-stone-200"><div v-for="finding in group.items" :key="finding.key" class="grid grid-cols-[1fr_auto] gap-2 border-b border-stone-200 px-4 py-3 text-sm last:border-0 sm:grid-cols-[220px_95px_170px_1fr]"><span class="font-medium text-stone-800">{{ finding.label }}</span><span :class="finding.status === 'abnormal' ? 'text-red-700' : finding.status === 'normal' ? 'text-emerald-700' : 'text-stone-500'">{{ finding.status === 'abnormal' ? '異常' : finding.status === 'normal' ? '正常' : '未標示' }}<small v-if="finding.statusSource === 'auto'" class="ml-1 text-[10px] text-stone-500">自動</small></span><span class="text-stone-700"><strong class="font-medium">{{ labValueLabel(finding) }}</strong><small v-if="labReferenceLabel(finding)" class="mt-0.5 block text-[11px] text-stone-500">參考 {{ labReferenceLabel(finding) }}</small></span><span class="col-span-2 whitespace-pre-wrap text-stone-600 sm:col-span-1">{{ finding.note || '—' }}</span></div></div></div>
          <div v-if="record.labSummary"><h3 class="text-xs font-semibold text-stone-500">檢驗補充摘要</h3><p class="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-stone-700">{{ record.labSummary }}</p></div>
        </section>

        <section class="mt-8 space-y-5 break-inside-avoid">
          <h2 class="text-sm font-semibold text-brand-700">結論與診斷</h2>
          <div v-if="record.conclusion"><h3 class="text-xs font-semibold text-stone-500">結論</h3><p class="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-stone-700">{{ record.conclusion }}</p></div>
          <div v-if="record.diagnosis"><h3 class="text-xs font-semibold text-stone-500">診斷</h3><p class="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-stone-700">{{ record.diagnosis }}</p></div>
          <div v-if="record.treatmentPlan"><h3 class="text-xs font-semibold text-stone-500">照護與追蹤建議</h3><p class="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-stone-700">{{ record.treatmentPlan }}</p></div>
          <div v-if="record.other"><h3 class="text-xs font-semibold text-stone-500">其他備註</h3><p class="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-stone-700">{{ record.other }}</p></div>
        </section>

        <footer class="mt-10 border-t border-brand-100 pt-4 text-center text-xs text-stone-500">本報告由謙華動物醫院製作 · 第 {{ record.reportVersion || 1 }} 版 · {{ isDraft ? '草稿更新時間' : 'PDF 產生時間' }} {{ formatDateTime(isDraft ? (record.updatedAt || record.createdAt) : (record.pdfGeneratedAt || record.finalizedAt || record.updatedAt || record.createdAt)) }}</footer>
      </article>
    </section>

    <p v-else-if="error" class="mx-auto max-w-3xl rounded-xl border border-red-200 bg-red-50 px-6 py-4 text-center text-sm text-red-700">{{ error }}</p>
    <p v-else class="mx-auto max-w-3xl px-6 text-center text-sm text-stone-500" role="status">載入健檢報告…</p>

    <ConfirmDialog
      :open="showFinalizeConfirm"
      title="確認結案"
      description="系統會驗證內容、產生正式 PDF 並鎖定此版本。結案後若需修改，請建立修訂版；Email 可稍後另外寄送。"
      confirm-label="確認結案並產生 PDF"
      cancel-label="取消結案"
      :loading="finalizing"
      :destructive="false"
      @update:open="showFinalizeConfirm = $event"
      @confirm="finalizeReport"
    />
    <ConfirmDialog
      :open="showEmailConfirm"
      :title="isSent ? '重新寄送健檢報告' : '寄送健檢報告'"
      :description="`系統會將 PDF 附件及無期限查看連結寄到 ${ownerEmail}。若寄送失敗，已結案的正式報告不會受到影響。`"
      :confirm-label="isSent ? '重新寄送' : '確認寄送'"
      cancel-label="取消"
      :loading="emailing"
      :destructive="false"
      @update:open="showEmailConfirm = $event"
      @confirm="sendEmail"
    />
    <RevisionDialog
      v-if="showRevisionDialog"
      :submitting="revising"
      :error-message="revisionError"
      @close="showRevisionDialog = false"
      @submit="createRevision"
    />
  </div>
</template>
