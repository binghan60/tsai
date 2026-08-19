<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { CalendarDays, ClipboardPlus, FileText, PawPrint, Pencil, Share2, Trash2, User } from '@lucide/vue';
import PetFormDialog from '../components/PetFormDialog.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import DeleteRecordDialog from '../components/DeleteRecordDialog.vue';
import { http } from '../api/http';
import { ageLabel as calcAgeLabel, formatDate as formatClinicDate, formatDateTime } from '../lib/datetime';
import { DELIVERY_STATUS_META, RECORD_STATUS_META, getDeliveryStatus, isFinalizedRecord } from '../lib/recordStatus';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { useBackTarget } from '../composables/useBackTarget';
import { Badge } from '../components/ui/badge';

import { useToast } from '../composables/useToast';

const route = useRoute();
const toast = useToast();
const pet = ref(null);
const { to: backTo, label: backLabel } = useBackTarget(() => (pet.value?.ownerId?._id ? `/owners/${pet.value.ownerId._id}` : '/owners'), '回飼主資料');
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

const sexLabel = computed(() => ({ male: '公', female: '母', unknown: '未記錄' })[pet.value?.sex] ?? '未記錄');
const neuteredLabel = computed(() => ({ yes: '已絕育', no: '未絕育', unknown: '未記錄' })[pet.value?.neutered] ?? '未記錄');
const ageLabel = computed(() => calcAgeLabel(pet.value?.birthDate, new Date(), '年齡未記錄'));
const hasWeight = computed(() => pet.value?.weightKg != null);
const hasAllergies = computed(() => Boolean(pet.value?.allergies));
const chronicAndMeds = computed(() => [pet.value?.chronicConditions, pet.value?.currentMedications].filter(Boolean).join('；'));
const hasChronicOrMeds = computed(() => Boolean(chronicAndMeds.value));
const hasPetInfo = computed(() => hasWeight.value || hasAllergies.value || hasChronicOrMeds.value);

function formatDate(value) {
  return formatClinicDate(value, '日期未填');
}

function isShareActive(record) {
  return Boolean(record?.shareEnabled);
}

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
    toast.success(`已成功更新「${values.name || pet.value.name}」的資料`, '修改資料成功');
    await fetchPet();
  } catch (err) {
    editError.value = err.response?.data?.message ?? '寵物資料儲存失敗';
    toast.error(editError.value, '修改資料失敗');
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
    shareNotice.value = { url: data.url, copied };
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
  shareNotice.value = { url, copied };
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
    toast.success(`已成功刪除「${formatDate(record.visitDate)}」的健檢紀錄`, '刪除紀錄成功');
    await fetchPet();
  } catch (err) {
    const msg = err.response?.data?.message ?? '刪除健檢紀錄失敗';
    removeError.value = msg;
    toast.error(msg, '刪除失敗');
  } finally {
    deletingRecordId.value = null;
  }
}

onMounted(fetchPet);
</script>

<template>
  <section v-if="pet" class="mx-auto max-w-7xl space-y-5">
    <router-link :to="backTo" class="inline-flex min-h-11 items-center text-sm font-medium text-belle-600 hover:text-belle-700 dark:text-brand-400 dark:hover:text-brand-300">← {{ backLabel }}</router-link>

    <Card class="border-cream-300 p-5 shadow-sm dark:border-zinc-800 dark:shadow-none sm:p-6">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex min-w-0 items-start gap-4">
          <div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-belle-50 text-belle-600 dark:bg-brand-500/10 dark:text-brand-400"><PawPrint class="h-7 w-7" stroke-width="1.75" /></div>
          <div class="min-w-0">
            <h1 class="text-xl font-semibold text-ink-900 dark:text-white">{{ pet.name }}</h1>
            <p class="mt-1 text-sm text-ink-600 dark:text-zinc-300">{{ pet.species || '寵物' }}<template v-if="pet.breed"> · {{ pet.breed }}</template> · {{ sexLabel }} · {{ neuteredLabel }} · {{ ageLabel }}</p>
            <p class="mt-1 flex items-center gap-1.5 text-sm text-ink-500 dark:text-zinc-400"><User class="h-4 w-4" />飼主：{{ pet.ownerId?.name || '—' }}<template v-if="pet.ownerId?.phone"> · {{ pet.ownerId.phone }}</template></p>
          </div>
        </div>
        <Button variant="outline" class="min-h-11" @click="editOpen = true"><Pencil class="h-4 w-4" />編輯資料</Button>
      </div>

      <dl v-if="hasPetInfo" class="mt-5 grid gap-3 border-t border-cream-300 pt-5 text-sm dark:border-zinc-800 sm:grid-cols-2 lg:grid-cols-3">
        <div v-if="hasWeight"><dt class="text-xs font-medium text-ink-400 dark:text-zinc-400">最近體重</dt><dd class="mt-1 text-ink-700 dark:text-zinc-200">{{ pet.weightKg }} kg</dd></div>
        <div v-if="hasAllergies"><dt class="text-xs font-medium text-ink-400 dark:text-zinc-400">過敏紀錄</dt><dd class="mt-1 whitespace-pre-wrap text-ink-700 dark:text-zinc-200">{{ pet.allergies }}</dd></div>
        <div v-if="hasChronicOrMeds"><dt class="text-xs font-medium text-ink-400 dark:text-zinc-400">慢性病／目前用藥</dt><dd class="mt-1 whitespace-pre-wrap text-ink-700 dark:text-zinc-200">{{ chronicAndMeds }}</dd></div>
      </dl>
    </Card>

    <p v-if="error" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">{{ error }}</p>

    <Card v-if="shareNotice" class="border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 shadow-none dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
      <p class="font-medium">{{ shareNotice.copied ? '分享連結已複製' : '分享連結已建立' }}</p>
      <p class="mt-1 break-all">{{ shareNotice.url }}</p>
      <p class="mt-1 text-xs opacity-80">無使用期限，手動撤銷前皆可開啟</p>
    </Card>

    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div><h2 class="text-base font-semibold text-ink-900 dark:text-white">歷次健檢</h2><p class="mt-1 text-xs text-ink-400 dark:text-zinc-400">依健檢日期排序，草稿可繼續編輯。</p></div>
        <Button as-child><router-link :to="`/pets/${pet._id}/records/new`"><ClipboardPlus class="h-4 w-4" />新增健檢</router-link></Button>
      </div>

      <ul v-if="pet.medicalRecords.length" class="space-y-3">
        <li v-for="record in pet.medicalRecords" :key="record._id">
          <Card class="border-cream-300 p-4 shadow-sm dark:border-zinc-800 dark:shadow-none">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="flex min-w-0 items-start gap-3"><CalendarDays class="mt-0.5 h-5 w-5 shrink-0 text-ink-400 dark:text-zinc-400" /><div><div class="flex flex-wrap items-center gap-2"><span class="font-medium text-ink-900 dark:text-white">{{ formatDate(record.visitDate) }}</span><Badge :class="RECORD_STATUS_META[record.status]?.class" class="rounded-full px-3 py-1 text-xs font-medium">{{ RECORD_STATUS_META[record.status]?.label ?? record.status }}</Badge><Badge v-if="isFinalizedRecord(record)" :class="DELIVERY_STATUS_META[getDeliveryStatus(record)]?.class" class="rounded-full px-3 py-1 text-xs font-medium">{{ DELIVERY_STATUS_META[getDeliveryStatus(record)]?.label }}</Badge><Badge v-if="record.supersededBy" class="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">已有新版</Badge><Badge v-if="isShareActive(record)" class="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">無期限分享</Badge></div><p class="mt-1 text-xs text-ink-400 dark:text-zinc-400">第 {{ record.reportVersion || 1 }} 版<template v-if="record.vet"> · {{ record.vet }}</template> · 更新於 {{ formatDateTime(record.updatedAt) }}<template v-if="record.sentTo"> · 寄至 {{ record.sentTo }}</template></p></div></div>
            <div class="flex flex-wrap items-center gap-1 text-sm">
              <Button v-if="record.status === 'draft'" as-child variant="outline" size="sm" class="min-h-11"><router-link :to="`/records/${record._id}/edit`">繼續填寫</router-link></Button>
              <Button v-else as-child variant="outline" size="sm" class="min-h-11"><router-link :to="`/records/${record._id}/preview`"><FileText class="h-4 w-4" />查看報告</router-link></Button>
              <Button v-if="isFinalizedRecord(record) && !isShareActive(record)" type="button" variant="secondary" size="sm" class="min-h-11" :disabled="sharingId === record._id" @click="shareRecord(record)"><Share2 class="h-4 w-4" />{{ sharingId === record._id ? '處理中…' : '分享' }}</Button>
              <template v-if="isShareActive(record)"><Button type="button" variant="secondary" size="sm" class="min-h-11" @click="copyExistingShare(record)">複製連結</Button><Button type="button" variant="destructive-outline" size="sm" class="min-h-11" :disabled="revokingId === record._id" @click="openRevokeShare(record)">{{ revokingId === record._id ? '撤銷中…' : '撤銷' }}</Button></template>
              <Button v-if="!['sent', 'sending'].includes(getDeliveryStatus(record))" type="button" variant="destructive" size="sm" class="min-h-11" :disabled="deletingRecordId === record._id" :aria-label="`刪除健檢紀錄 ${formatDate(record.visitDate)}`" @click="openRemoveRecord(record)"><Trash2 class="h-4 w-4" />刪除</Button>
            </div>
          </div>
          </Card>
        </li>
      </ul>
      <div v-else class="rounded-2xl border border-dashed border-cream-300 px-5 py-10 text-center dark:border-zinc-800"><PawPrint class="mx-auto mb-2 h-8 w-8 text-ink-400 dark:text-zinc-500" /><p class="text-sm text-ink-500 dark:text-zinc-400">尚無健檢紀錄</p></div>
    </div>

    <PetFormDialog v-if="editOpen" title="編輯寵物資料" submit-label="儲存" :initial-value="{ ...pet, birthDate: pet.birthDate?.slice(0, 10) }" :submitting="editSaving" :error-message="editError" @submit="savePet" @close="editOpen = false" />
    <ConfirmDialog
      :open="Boolean(shareToRevoke)"
      title="撤銷分享連結"
      description="確定要撤銷這份報告的分享連結嗎？已取得連結的人將無法再開啟。"
      confirm-label="撤銷"
      :loading="Boolean(revokingId)"
      @update:open="(value) => !value && (shareToRevoke = null)"
      @confirm="revokeShare(shareToRevoke)"
    />
    <DeleteRecordDialog
      v-if="recordToRemove"
      :record="recordToRemove"
      :confirm-word="pet?.name ?? ''"
      :submitting="Boolean(deletingRecordId)"
      :error-message="removeError"
      @close="recordToRemove = null"
      @submit="removeRecord"
    />
  </section>

  <p v-else-if="error" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">{{ error }}</p>
  <p v-else class="text-sm text-ink-500 dark:text-zinc-400" role="status">載入寵物資料…</p>
</template>
