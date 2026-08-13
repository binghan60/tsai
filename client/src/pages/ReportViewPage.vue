<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, CheckCircle2, Copy, Download, Mail, PawPrint, Printer, Share2 } from '@lucide/vue';
import { http } from '../api/http';
import { downloadBlob, extractErrorMessage } from '../lib/downloadFile';
import ConfirmDialog from '../components/ConfirmDialog.vue';

const route = useRoute();
const router = useRouter();
const record = ref(null);
const error = ref('');
const generating = ref(false);
const generated = ref(false);
const sharing = ref(false);
const shareNotice = ref(null);
const showFinalizeConfirm = ref(false);
const isPreview = computed(() => route.name === 'record-preview');
const isDraft = computed(() => record.value?.status === 'draft');
const ownerEmail = computed(() => record.value?.owner?.email?.trim() ?? '');
const emailHref = computed(() => {
  if (!ownerEmail.value || !shareNotice.value?.url) return '';
  const petName = record.value?.pet?.name || '您的寵物';
  const ownerName = record.value?.owner?.name;
  const subject = `${petName}的健檢報告`;
  const body = `${ownerName ? `${ownerName} 您好：\n\n` : ''}${petName}的健檢報告已完成，請透過以下連結查看：\n${shareNotice.value.url}\n\n此連結將於 ${formatDateTime(shareNotice.value.expiresAt)} 到期。`;
  return `mailto:${ownerEmail.value}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
});

function normalizePreview(data) {
  const pet = data.petId && typeof data.petId === 'object' ? data.petId : null;
  return {
    ...data,
    reportNumber: data.reportNumber || `HC-${data._id?.slice(-8).toUpperCase()}`,
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

function ageLabel(date) {
  if (!date) return '未記錄';
  const birth = new Date(date);
  const today = new Date();
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

async function generatePdf() {
  generating.value = true;
  error.value = '';
  try {
    const response = await http.post(`/records/${route.params.id}/generate-pdf`, null, { responseType: 'blob' });
    downloadBlob(response.data, `${record.value.reportNumber || 'health-check'}.pdf`);
    if (record.value.status === 'draft') record.value.status = 'generated';
    generated.value = true;
  } catch (err) {
    error.value = await extractErrorMessage(err, '產生 PDF 失敗');
  } finally {
    generating.value = false;
  }
}

async function confirmFinalize() {
  showFinalizeConfirm.value = false;
  await generatePdf();
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
    let expiresAt;
    if (record.value.shareEnabled && record.value.shareToken) {
      url = `${window.location.origin}/report/${record.value.shareToken}`;
      expiresAt = record.value.shareExpiresAt;
    } else {
      const { data } = await http.post(`/records/${route.params.id}/share`, { days: 30 });
      ({ url, expiresAt } = data);
      record.value.shareEnabled = true;
      record.value.shareExpiresAt = expiresAt;
    }
    const copied = await copyText(url);
    shareNotice.value = { url, expiresAt, copied };
  } catch (err) {
    error.value = err.response?.data?.message ?? '建立分享連結失敗';
  } finally {
    sharing.value = false;
  }
}

async function copyShareLink() {
  if (!shareNotice.value?.url) return;
  shareNotice.value.copied = await copyText(shareNotice.value.url);
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
        <button v-if="isPreview" type="button" class="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium text-stone-700 hover:bg-white" @click="router.push(isDraft ? `/records/${route.params.id}/edit` : `/pets/${record.pet?._id}`)"><ArrowLeft class="h-4 w-4" />{{ isDraft ? '返回編輯' : '回寵物資料' }}</button>
        <div v-else></div>
        <div class="flex gap-2">
          <button v-if="isPreview" type="button" :disabled="generating" class="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-50" @click="isDraft ? (showFinalizeConfirm = true) : generatePdf()"><Download class="h-4 w-4" />{{ generating ? '產生中…' : isDraft ? '確認結案並下載 PDF' : '重新下載 PDF' }}</button>
          <button v-else type="button" class="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-brand-700" @click="printReport"><Printer class="h-4 w-4" />列印／下載 PDF</button>
        </div>
      </div>

      <div v-if="isDraft" class="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 print:hidden"><p class="font-semibold">結案前預覽</p><p class="mt-1">目前仍是草稿，請確認內容後再結案。結案後此版本將鎖定，無法直接修改。</p></div>
      <div v-if="generated" class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 print:hidden">
        <span class="flex items-center gap-2"><CheckCircle2 class="h-5 w-5 shrink-0" />正式報告已結案並完成 PDF 下載，接下來可建立連結交付給飼主。</span>
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" :disabled="sharing" class="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-700 px-3 font-medium text-white hover:bg-emerald-800 disabled:opacity-50" @click="createShareLink"><Share2 class="h-4 w-4" />{{ sharing ? '建立中…' : '建立飼主分享連結' }}</button>
          <router-link :to="`/pets/${record.pet?._id}`" class="inline-flex min-h-10 items-center px-2 font-medium underline">稍後處理</router-link>
        </div>
      </div>
      <div v-if="shareNotice" class="rounded-xl border border-emerald-200 bg-white px-4 py-4 text-sm text-stone-700 print:hidden">
        <p class="font-semibold text-emerald-800">{{ shareNotice.copied ? '分享連結已建立並複製' : '分享連結已建立' }}</p>
        <p class="mt-2 break-all rounded-lg bg-stone-100 px-3 py-2 font-mono text-xs">{{ shareNotice.url }}</p>
        <p class="mt-2 text-xs text-stone-500">連結有效至 {{ formatDateTime(shareNotice.expiresAt) }}</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button type="button" class="inline-flex min-h-10 items-center gap-2 rounded-lg border border-stone-300 px-3 font-medium hover:bg-stone-50" @click="copyShareLink"><Copy class="h-4 w-4" />複製連結</button>
          <a v-if="ownerEmail" :href="emailHref" class="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand-600 px-3 font-medium text-white hover:bg-brand-700"><Mail class="h-4 w-4" />開啟 Email 寄給 {{ ownerEmail }}</a>
        </div>
        <p v-if="!ownerEmail" class="mt-3 text-xs text-amber-700">這位飼主尚未填寫 Email，請先複製連結，再透過其他方式傳送。</p>
      </div>
      <p v-if="error" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 print:hidden">{{ error }}</p>

      <article class="report-sheet rounded-2xl border border-stone-200 bg-white p-6 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none sm:p-[12mm]">
        <header class="flex flex-col gap-5 border-b border-brand-100 pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div class="flex items-center gap-2 text-xl font-semibold text-brand-700"><PawPrint class="h-6 w-6" stroke-width="1.75" aria-hidden="true" />寵物健康檢查報告</div>
            <p class="mt-2 font-mono text-xs text-stone-500">報告編號：{{ record.reportNumber }}</p>
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
            <div><dt class="text-xs font-medium text-stone-500">性別／年齡</dt><dd class="mt-1 text-stone-800">{{ sexLabel(record.pet?.sex) }}／{{ ageLabel(record.pet?.birthDate) }}</dd></div>
            <div><dt class="text-xs font-medium text-stone-500">晶片號碼</dt><dd class="mt-1 text-stone-800">{{ record.pet?.microchipNumber || '未記錄' }}</dd></div>
          </dl>
        </section>

        <section v-if="record.pet?.allergies || record.pet?.chronicConditions || record.pet?.currentMedications" class="mt-6 border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p v-if="record.pet.allergies"><strong>過敏：</strong>{{ record.pet.allergies }}</p>
          <p v-if="record.pet.chronicConditions"><strong>慢性病／重要病史：</strong>{{ record.pet.chronicConditions }}</p>
          <p v-if="record.pet.currentMedications"><strong>目前用藥：</strong>{{ record.pet.currentMedications }}</p>
        </section>

        <section v-if="record.chiefComplaint || record.history" class="mt-8 break-inside-avoid">
          <h2 class="mb-3 text-sm font-semibold text-brand-700">主訴與病史</h2>
          <div class="grid gap-5 rounded-xl border border-stone-200 p-4 sm:grid-cols-2"><div><h3 class="text-xs font-semibold text-stone-500">主訴</h3><p class="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-stone-700">{{ record.chiefComplaint || '—' }}</p></div><div><h3 class="text-xs font-semibold text-stone-500">病史</h3><p class="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-stone-700">{{ record.history || '—' }}</p></div></div>
        </section>

        <section v-if="vitals.length" class="mt-8 break-inside-avoid">
          <h2 class="mb-3 text-sm font-semibold text-brand-700">基本量測</h2>
          <dl class="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-stone-200 bg-stone-200 sm:grid-cols-5"><div v-for="item in vitals" :key="item.label" class="bg-white p-3 text-center"><dt class="text-xs text-stone-500">{{ item.label }}</dt><dd class="mt-1 text-sm font-semibold text-stone-900">{{ item.value }}</dd><dd v-if="item.assessment && item.assessment.status !== 'not_checked'" class="mt-1 text-[11px] font-medium" :class="item.assessment.status === 'abnormal' ? 'text-red-700' : 'text-emerald-700'">{{ item.assessment.status === 'abnormal' ? '異常' : '正常' }}・自動</dd><dd v-if="labReferenceLabel(item.assessment || {})" class="mt-0.5 text-[10px] text-stone-500">參考 {{ labReferenceLabel(item.assessment) }}</dd></div></dl>
        </section>

        <section v-if="checkedFindings.length" class="mt-8 break-inside-avoid">
          <h2 class="mb-3 text-sm font-semibold text-brand-700">理學檢查</h2>
          <div class="overflow-hidden rounded-xl border border-stone-200"><div v-for="finding in checkedFindings" :key="finding.key" class="grid grid-cols-[1fr_auto] gap-3 border-b border-stone-200 px-4 py-3 text-sm last:border-0 sm:grid-cols-[190px_90px_1fr]"><span class="font-medium text-stone-800">{{ finding.label }}</span><span :class="finding.status === 'abnormal' ? 'text-red-700' : 'text-emerald-700'">{{ finding.status === 'abnormal' ? '異常' : '正常' }}</span><span class="col-span-2 whitespace-pre-wrap text-stone-600 sm:col-span-1">{{ finding.note || '—' }}</span></div></div>
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

        <footer class="mt-10 border-t border-brand-100 pt-4 text-center text-xs text-stone-500">本報告由寵物健康管理系統產生 · 產出時間 {{ formatDate(record.updatedAt || record.createdAt) }}</footer>
      </article>
    </section>

    <p v-else-if="error" class="mx-auto max-w-3xl rounded-xl border border-red-200 bg-red-50 px-6 py-4 text-center text-sm text-red-700">{{ error }}</p>
    <p v-else class="mx-auto max-w-3xl px-6 text-center text-sm text-stone-500" role="status">載入健檢報告…</p>

    <ConfirmDialog
      :open="showFinalizeConfirm"
      title="確認結案"
      description="結案後這份報告將成為正式版本並鎖定，無法直接修改。確定要結案並下載 PDF 嗎？"
      confirm-label="確認結案"
      cancel-label="取消結案"
      :loading="generating"
      :destructive="false"
      @update:open="showFinalizeConfirm = $event"
      @confirm="confirmFinalize"
    />
  </div>
</template>
