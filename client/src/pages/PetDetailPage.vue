<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { CalendarDays, ClipboardPlus, Copy, FileText, Link2Off, PawPrint, Pencil, Share2, Trash2, User } from '@lucide/vue';
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

const sexLabel = computed(() => ({ male: '公', female: '母', unknown: '未記錄' })[pet.value?.sex] ?? '未記錄');
const neuteredLabel = computed(() => ({ yes: '已絕育', no: '未絕育', unknown: '未記錄' })[pet.value?.neutered] ?? '未記錄');
const ageLabel = computed(() => calcAgeLabel(pet.value?.birthDate, new Date(), '年齡未記錄'));
const petInfoFields = computed(() => [
  { label: '最近體重', value: pet.value?.weightKg != null ? `${pet.value.weightKg} kg` : '' },
  { label: '過敏紀錄', value: pet.value?.allergies ?? '' },
  { label: '慢性病／重要病史', value: pet.value?.chronicConditions ?? '' },
  { label: '目前用藥', value: pet.value?.currentMedications ?? '' },
  { label: '其他備註', value: pet.value?.notes ?? '' },
]);
const filledPetInfoFields = computed(() => petInfoFields.value.filter((field) => String(field.value).trim()));

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
  return formatClinicDate(value, '日期未填');
}

function isShareActive(record) {
  return Boolean(record?.shareEnabled && record.shareExpiresAt && new Date(record.shareExpiresAt) > new Date());
}

async function fetchPet(petId = route.params.id) {
  const currentRequest = ++fetchSequence;
  error.value = '';
  try {
    const { data } = await http.get(`/pets/${petId}`, { params: { recordPage: recordPage.value } });
    if (currentRequest !== fetchSequence || String(route.params.id) !== String(petId)) return;
    pet.value = data;
    recordPagination.value = data.recordPagination ?? recordPagination.value;
    if (!data.medicalRecords?.length && data.recordPagination?.total > 0 && recordPage.value > data.recordPagination.totalPages) {
      recordPage.value = data.recordPagination.totalPages;
    }
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

watch(recordPage, () => {
  if (pet.value) fetchPet();
});

watch(
  () => route.params.id,
  (petId) => {
    pet.value = null;
    recordPage.value = 1;
    editOpen.value = false;
    shareNotice.value = null;
    shareToRevoke.value = null;
    recordToRemove.value = null;
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

    <Card class="p-5 shadow-sm dark:shadow-none">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex min-w-0 items-start gap-4">
          <div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground"><PawPrint class="h-7 w-7" stroke-width="1.75" /></div>
          <div class="min-w-0">
            <h1 class="text-xl font-semibold text-foreground">{{ pet.name }}</h1>
            <p class="mt-1 text-sm text-foreground">{{ pet.species || '寵物' }}<template v-if="pet.breed"> · {{ pet.breed }}</template> · {{ sexLabel }} · {{ neuteredLabel }} · {{ ageLabel }}</p>
            <p class="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><User class="h-4 w-4" />飼主：{{ pet.ownerId?.name || '—' }}<template v-if="pet.ownerId?.phone"> · {{ pet.ownerId.phone }}</template></p>
          </div>
        </div>
        <Button variant="outline" @click="editOpen = true"><Pencil class="h-4 w-4" />編輯資料</Button>
      </div>

      <dl v-if="filledPetInfoFields.length" class="mt-5 grid gap-3 border-t border-border pt-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div v-for="field in filledPetInfoFields" :key="field.label">
          <dt class="text-xs font-medium text-muted-foreground">{{ field.label }}</dt>
          <dd class="mt-1 whitespace-pre-wrap text-foreground">{{ field.value }}</dd>
        </div>
      </dl>
    </Card>

    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>

    <Card v-if="shareNotice" class="border-success/35 bg-success-surface p-4 text-sm text-success shadow-none">
      <p class="font-medium">{{ shareNotice.copied ? '分享連結已複製' : '分享連結已建立' }}</p>
      <p class="mt-1 break-all">{{ shareNotice.url }}</p>
      <p class="mt-1 text-xs opacity-80">無使用期限，手動撤銷前皆可開啟</p>
    </Card>

    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div><h2 class="text-base font-semibold text-foreground">歷次健檢</h2><p class="mt-1 text-xs text-muted-foreground">依健檢日期排序，草稿可繼續編輯。</p></div>
        <Button as-child><router-link :to="`/pets/${pet._id}/records/new`"><ClipboardPlus class="h-4 w-4" />新增健檢</router-link></Button>
      </div>

      <ul v-if="pet.medicalRecords.length" class="space-y-3">
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
      :open="Boolean(shareToRevoke)"
      title="撤銷分享連結"
      description="確定要撤銷這份報告的分享連結嗎？已取得連結的人將無法再開啟。"
      confirm-label="撤銷"
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
