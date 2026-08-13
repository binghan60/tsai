<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, CheckCircle2, Copy, Mail, PawPrint, Printer, Share2 } from '@lucide/vue';
import { http } from '../api/http';
import ConfirmDialog from '../components/ConfirmDialog.vue';

const route = useRoute();
const router = useRouter();
const record = ref(null);
const error = ref('');
const sharing = ref(false);
const emailing = ref(false);
const shareNotice = ref(null);
const showFinalizeConfirm = ref(false);
const showEmailConfirm = ref(false);
const isPreview = computed(() => route.name === 'record-preview');
const isDraft = computed(() => record.value?.status === 'draft');
const isSent = computed(() => record.value?.status === 'sent');
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

async function confirmFinalize() {
  await sendEmail();
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
    record.value.status = data.status;
    record.value.sentAt = data.sentAt;
    record.value.sentTo = data.sentTo;
    record.value.deliveryMethod = data.deliveryMethod;
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
    error.value = err.response?.data?.message ?? `寄送 Email 失敗，報告仍維持${wasDraft ? '草稿' : '原本'}狀態`;
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
        <button v-if="isPreview" type="button" class="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium text-stone-700 hover:bg-white" @click="router.push(isDraft ? `/records/${route.params.id}/edit` : `/pets/${record.pet?._id}`)"><ArrowLeft class="h-4 w-4" />{{ isDraft ? '返回編輯' : '回寵物資料' }}</button>
        <div v-else></div>
        <div class="flex gap-2">
          <button v-if="isPreview" type="button" :disabled="emailing || !ownerEmail" class="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50" @click="isDraft ? (showFinalizeConfirm = true) : (showEmailConfirm = true)"><Mail class="h-4 w-4" />{{ emailing ? '寄送中…' : isDraft ? '確認結案並寄送 PDF' : isSent ? '重新寄送 Email' : '寄送 PDF' }}</button>
          <button v-else type="button" class="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-brand-700" @click="printReport"><Printer class="h-4 w-4" />列印／下載 PDF</button>
        </div>
      </div>

      <div v-if="isDraft" class="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 print:hidden"><p class="font-semibold">結案前預覽</p><p class="mt-1">目前仍是草稿。確認結案後，系統會直接將 PDF 寄給飼主；Gmail接受後此版本才會鎖定，不會下載到本機。</p><p v-if="!ownerEmail" class="mt-2 font-medium text-red-700">飼主尚未填寫 Email，暫時無法結案寄送。<router-link v-if="record.owner?._id" :to="`/owners/${record.owner._id}`" class="underline">前往飼主資料補填</router-link></p></div>
      <div v-if="isPreview && !isDraft && !isSent" class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 print:hidden">
        <span class="flex items-center gap-2"><CheckCircle2 class="h-5 w-5 shrink-0" />這是舊版尚未寄送的正式報告，請寄送 Email 完成流程。</span>
        <div class="flex flex-wrap items-center gap-2">
          <button v-if="ownerEmail" type="button" :disabled="emailing" class="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-700 px-3 font-medium text-white hover:bg-emerald-800 disabled:opacity-50" @click="showEmailConfirm = true"><Mail class="h-4 w-4" />{{ emailing ? '寄送中…' : '直接寄送 PDF' }}</button>
          <router-link :to="`/pets/${record.pet?._id}`" class="inline-flex min-h-10 items-center px-2 font-medium underline">稍後處理</router-link>
        </div>
        <p v-if="!ownerEmail" class="w-full text-xs text-amber-800">飼主尚未填寫 Email；請回飼主資料補填後再寄送。</p>
      </div>
      <div v-if="isPreview && isSent" class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 print:hidden">
        <span class="flex items-center gap-2"><CheckCircle2 class="h-5 w-5 shrink-0" />{{ record.deliveryMethod === 'email' ? '報告已透過 Email 寄送' : '舊版報告狀態：已寄送' }}<template v-if="record.sentAt">，時間：{{ formatDateTime(record.sentAt) }}</template></span>
        <div class="flex flex-wrap items-center gap-2">
          <button v-if="ownerEmail" type="button" :disabled="emailing" class="inline-flex min-h-10 items-center gap-2 rounded-lg border border-emerald-300 px-3 font-medium hover:bg-emerald-100 disabled:opacity-50" @click="showEmailConfirm = true"><Mail class="h-4 w-4" />{{ emailing ? '寄送中…' : '重新寄送 Email' }}</button>
          <button type="button" :disabled="sharing" class="inline-flex min-h-10 items-center gap-2 rounded-lg border border-emerald-300 px-3 font-medium hover:bg-emerald-100 disabled:opacity-50" @click="createShareLink"><Share2 class="h-4 w-4" />{{ shareActionLabel }}</button>
          <router-link :to="`/pets/${record.pet?._id}`" class="inline-flex min-h-10 items-center px-2 font-medium underline">回寵物資料</router-link>
        </div>
      </div>
      <div v-if="shareNotice" class="rounded-xl border border-emerald-200 bg-white px-4 py-4 text-sm text-stone-700 print:hidden">
        <p class="font-semibold text-emerald-800">{{ shareNotice.emailed ? `郵件伺服器已接受寄送至 ${record.sentTo}` : shareNotice.copied ? '分享連結已建立並複製' : '分享連結已建立' }}</p>
        <p class="mt-2 break-all rounded-lg bg-stone-100 px-3 py-2 font-mono text-xs">{{ shareNotice.url }}</p>
        <p class="mt-2 text-xs text-stone-500">連結無使用期限，手動撤銷前皆可開啟</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button type="button" class="inline-flex min-h-10 items-center gap-2 rounded-lg border border-stone-300 px-3 font-medium hover:bg-stone-50" @click="copyShareLink"><Copy class="h-4 w-4" />複製連結</button>
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
      title="確認結案並寄送"
      :description="`系統會將正式 PDF 附件及無期限查看連結寄到 ${ownerEmail}。Gmail接受郵件後，報告將立即鎖定且無法直接修改；本機不會下載檔案。`"
      confirm-label="結案並寄送 PDF"
      cancel-label="取消結案"
      :loading="emailing"
      :destructive="false"
      @update:open="showFinalizeConfirm = $event"
      @confirm="confirmFinalize"
    />
    <ConfirmDialog
      :open="showEmailConfirm"
      :title="isSent ? '重新寄送健檢報告' : '寄送健檢報告'"
      :description="`系統會將 PDF 附件及無期限查看連結寄到 ${ownerEmail}。只有郵件伺服器接受後，報告才會標記為已寄送。`"
      :confirm-label="isSent ? '重新寄送' : '確認寄送'"
      cancel-label="取消"
      :loading="emailing"
      :destructive="false"
      @update:open="showEmailConfirm = $event"
      @confirm="sendEmail"
    />
  </div>
</template>
