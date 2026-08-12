<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { CalendarDays, ClipboardPlus, FileText, PawPrint, Pencil, Share2, User } from '@lucide/vue';
import PetFormDialog from '../components/PetFormDialog.vue';
import { http } from '../api/http';
import { downloadBlob, extractErrorMessage } from '../lib/downloadFile';
import { RECORD_STATUS_META } from '../lib/recordStatus';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';

const route = useRoute();
const pet = ref(null);
const error = ref('');
const downloadingId = ref(null);
const sharingId = ref(null);
const revokingId = ref(null);
const shareNotice = ref(null);
const editOpen = ref(false);
const editSaving = ref(false);
const editError = ref('');

const sexLabel = computed(() => ({ male: '公', female: '母', unknown: '未記錄' })[pet.value?.sex] ?? '未記錄');
const neuteredLabel = computed(() => ({ yes: '已絕育', no: '未絕育', unknown: '未記錄' })[pet.value?.neutered] ?? '未記錄');
const ageLabel = computed(() => {
  if (!pet.value?.birthDate) return '年齡未記錄';
  const birth = new Date(pet.value.birthDate);
  const today = new Date();
  let years = today.getFullYear() - birth.getFullYear();
  let months = today.getMonth() - birth.getMonth();
  if (today.getDate() < birth.getDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return years > 0 ? `${years} 歲 ${months} 個月` : `${Math.max(months, 0)} 個月`;
});

async function fetchPet() {
  error.value = '';
  try {
    const { data } = await http.get(`/pets/${route.params.id}`);
    pet.value = data;
  } catch (err) {
    error.value = '寵物資料暫時無法載入，請稍後重試';
  }
}

async function savePet(values) {
  editSaving.value = true;
  editError.value = '';
  try {
    await http.put(`/pets/${pet.value._id}`, values);
    editOpen.value = false;
    await fetchPet();
  } catch (err) {
    editError.value = err.response?.data?.message ?? '寵物資料儲存失敗';
  } finally {
    editSaving.value = false;
  }
}

async function downloadPdf(record) {
  downloadingId.value = record._id;
  error.value = '';
  try {
    const response = await http.post(`/records/${record._id}/generate-pdf`, null, { responseType: 'blob' });
    downloadBlob(response.data, `${record.reportNumber || 'health-check'}.pdf`);
    await fetchPet();
  } catch (err) {
    error.value = await extractErrorMessage(err, '產生 PDF 失敗');
  } finally {
    downloadingId.value = null;
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
    const { data } = await http.post(`/records/${record._id}/share`, { days: 30 });
    const copied = await copyText(data.url);
    shareNotice.value = { url: data.url, expiresAt: data.expiresAt, copied };
    await fetchPet();
  } catch (err) {
    error.value = err.response?.data?.message ?? '建立分享連結失敗';
  } finally {
    sharingId.value = null;
  }
}

async function copyExistingShare(record) {
  const url = `${window.location.origin}/report/${record.shareToken}`;
  const copied = await copyText(url);
  shareNotice.value = { url, expiresAt: record.shareExpiresAt, copied };
}

async function revokeShare(record) {
  if (!window.confirm('確定要撤銷這份報告的分享連結嗎？已取得連結的人將無法再開啟。')) return;
  revokingId.value = record._id;
  try {
    await http.post(`/records/${record._id}/revoke-share`);
    shareNotice.value = null;
    await fetchPet();
  } catch (err) {
    error.value = err.response?.data?.message ?? '撤銷分享失敗';
  } finally {
    revokingId.value = null;
  }
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString('zh-TW') : '日期未填';
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

onMounted(fetchPet);
</script>

<template>
  <section v-if="pet" class="mx-auto max-w-7xl space-y-5">
    <router-link :to="`/owners/${pet.ownerId?._id}`" class="inline-flex min-h-11 items-center text-sm font-medium text-belle-600 hover:text-belle-700 dark:text-brand-400 dark:hover:text-brand-300">← 回飼主資料</router-link>

    <Card class="border-cream-300 p-5 shadow-sm dark:border-zinc-800 dark:shadow-none sm:p-6">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex min-w-0 items-start gap-4">
          <div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-belle-50 text-belle-600 dark:bg-brand-500/10 dark:text-brand-400"><PawPrint class="h-7 w-7" stroke-width="1.75" /></div>
          <div class="min-w-0">
            <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1"><h1 class="text-xl font-semibold text-ink-900 dark:text-white">{{ pet.name }}</h1><span class="font-mono text-xs text-ink-500 dark:text-zinc-400">{{ pet.medicalRecordNumber || `PET-${pet._id.slice(-8).toUpperCase()}` }}</span></div>
            <p class="mt-1 text-sm text-ink-600 dark:text-zinc-300">{{ pet.species || '寵物' }}<template v-if="pet.breed"> · {{ pet.breed }}</template> · {{ sexLabel }} · {{ neuteredLabel }} · {{ ageLabel }}</p>
            <p class="mt-1 flex items-center gap-1.5 text-sm text-ink-500 dark:text-zinc-400"><User class="h-4 w-4" />飼主：{{ pet.ownerId?.name || '—' }}<template v-if="pet.ownerId?.phone"> · {{ pet.ownerId.phone }}</template></p>
          </div>
        </div>
        <Button variant="outline" class="min-h-11" @click="editOpen = true"><Pencil class="h-4 w-4" />編輯資料</Button>
      </div>

      <dl class="mt-5 grid gap-3 border-t border-cream-300 pt-5 text-sm dark:border-zinc-800 sm:grid-cols-2 lg:grid-cols-4">
        <div><dt class="text-xs font-medium text-ink-400 dark:text-zinc-400">晶片號碼</dt><dd class="mt-1 text-ink-700 dark:text-zinc-200">{{ pet.microchipNumber || '未記錄' }}</dd></div>
        <div><dt class="text-xs font-medium text-ink-400 dark:text-zinc-400">最近體重</dt><dd class="mt-1 text-ink-700 dark:text-zinc-200">{{ pet.weightKg != null ? `${pet.weightKg} kg` : '未記錄' }}</dd></div>
        <div><dt class="text-xs font-medium text-ink-400 dark:text-zinc-400">過敏紀錄</dt><dd class="mt-1 whitespace-pre-wrap text-ink-700 dark:text-zinc-200">{{ pet.allergies || '無紀錄' }}</dd></div>
        <div><dt class="text-xs font-medium text-ink-400 dark:text-zinc-400">慢性病／目前用藥</dt><dd class="mt-1 whitespace-pre-wrap text-ink-700 dark:text-zinc-200">{{ [pet.chronicConditions, pet.currentMedications].filter(Boolean).join('；') || '無紀錄' }}</dd></div>
      </dl>
    </Card>

    <p v-if="error" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">{{ error }}</p>

    <Card v-if="shareNotice" class="border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 shadow-none dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
      <p class="font-medium">{{ shareNotice.copied ? '分享連結已複製' : '分享連結已建立' }}</p>
      <p class="mt-1 break-all">{{ shareNotice.url }}</p>
      <p class="mt-1 text-xs opacity-80">有效期限：{{ formatDateTime(shareNotice.expiresAt) }}</p>
    </Card>

    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div><h2 class="text-base font-semibold text-ink-900 dark:text-white">歷次健檢</h2><p class="mt-1 text-xs text-ink-400 dark:text-zinc-400">依健檢日期排序，草稿可繼續編輯。</p></div>
        <router-link :to="`/pets/${pet._id}/records/new`" class="inline-flex min-h-11 items-center gap-2 rounded-xl bg-belle-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-belle-700 dark:bg-brand-500 dark:hover:bg-brand-600"><ClipboardPlus class="h-4 w-4" />新增健檢</router-link>
      </div>

      <ul v-if="pet.medicalRecords.length" class="space-y-3">
        <li v-for="record in pet.medicalRecords" :key="record._id">
          <Card class="border-cream-300 p-4 shadow-sm dark:border-zinc-800 dark:shadow-none">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="flex min-w-0 items-start gap-3"><CalendarDays class="mt-0.5 h-5 w-5 shrink-0 text-ink-400 dark:text-zinc-400" /><div><div class="flex flex-wrap items-center gap-2"><span class="font-medium text-ink-900 dark:text-white">{{ formatDate(record.visitDate) }}</span><Badge :class="RECORD_STATUS_META[record.status]?.class" class="rounded-full px-3 py-1 text-xs font-medium">{{ RECORD_STATUS_META[record.status]?.label ?? record.status }}</Badge><Badge v-if="record.shareEnabled" class="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">分享中</Badge></div><p class="mt-1 text-xs text-ink-400 dark:text-zinc-400">{{ record.reportNumber || '尚未建立報告編號' }}<template v-if="record.vet"> · {{ record.vet }}</template> · 更新於 {{ formatDateTime(record.updatedAt) }}</p></div></div>
            <div class="flex flex-wrap items-center gap-1 text-sm">
              <router-link :to="`/records/${record._id}/edit`" class="inline-flex min-h-11 items-center rounded-xl px-3 font-medium text-belle-600 hover:bg-belle-50 dark:text-brand-400 dark:hover:bg-brand-500/10">編輯</router-link>
              <router-link :to="`/records/${record._id}/preview`" class="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 font-medium text-belle-600 hover:bg-belle-50 dark:text-brand-400 dark:hover:bg-brand-500/10"><FileText class="h-4 w-4" />預覽</router-link>
              <button v-if="record.status !== 'draft'" type="button" :disabled="downloadingId === record._id" class="inline-flex min-h-11 items-center rounded-xl px-3 font-medium text-belle-600 hover:bg-belle-50 disabled:opacity-50 dark:text-brand-400 dark:hover:bg-brand-500/10" @click="downloadPdf(record)">{{ downloadingId === record._id ? '產生中…' : '下載 PDF' }}</button>
              <button v-if="record.status !== 'draft' && !record.shareEnabled" type="button" :disabled="sharingId === record._id" class="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 font-medium text-belle-600 hover:bg-belle-50 disabled:opacity-50 dark:text-brand-400 dark:hover:bg-brand-500/10" @click="shareRecord(record)"><Share2 class="h-4 w-4" />{{ sharingId === record._id ? '建立中…' : '分享' }}</button>
              <template v-if="record.shareEnabled"><button class="inline-flex min-h-11 items-center rounded-xl px-3 font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-500/10" @click="copyExistingShare(record)">複製連結</button><button :disabled="revokingId === record._id" class="inline-flex min-h-11 items-center rounded-xl px-3 font-medium text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40" @click="revokeShare(record)">{{ revokingId === record._id ? '撤銷中…' : '撤銷' }}</button></template>
            </div>
          </div>
          </Card>
        </li>
      </ul>
      <div v-else class="rounded-2xl border border-dashed border-cream-300 px-5 py-10 text-center dark:border-zinc-800"><PawPrint class="mx-auto mb-2 h-8 w-8 text-ink-400 dark:text-zinc-500" /><p class="text-sm text-ink-500 dark:text-zinc-400">尚無健檢紀錄</p></div>
    </div>

    <PetFormDialog v-if="editOpen" title="編輯寵物資料" submit-label="儲存" :initial-value="{ ...pet, birthDate: pet.birthDate?.slice(0, 10) }" :submitting="editSaving" :error-message="editError" @submit="savePet" @close="editOpen = false" />
  </section>

  <p v-else-if="error" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">{{ error }}</p>
  <p v-else class="text-sm text-ink-500 dark:text-zinc-400" role="status">載入寵物資料…</p>
</template>
