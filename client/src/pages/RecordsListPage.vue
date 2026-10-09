<script setup>
import { apiErrorMessage } from '../lib/apiError';
import { ref, watch } from 'vue';
import PatientLink from '../components/PatientLink.vue';
import { Cat, FileText, Plus } from '@lucide/vue';
import { http } from '../api/http';
import { formatDate as formatClinicDate, relativeDayLabel } from '../lib/datetime';
import { DELIVERY_STATUS_META, RECORD_STATUS_META, getDeliveryStatus, isFinalizedRecord } from '../lib/recordStatus';
import { useRoute, useRouter } from 'vue-router';
import { useSearchQueryParam } from '../composables/useSearchQueryParam';
import { usePagedList } from '../composables/usePagedList';
import { useToast } from '../composables/useToast';
import PetPickerDialog from '../components/PetPickerDialog.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import DeleteRecordDialog from '../components/DeleteRecordDialog.vue';
import FilterTabs from '../components/FilterTabs.vue';
import FilterBar from '../components/FilterBar.vue';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import ListFooter from '../components/ListFooter.vue';
import RowActions from '../components/RowActions.vue';
import { Alert, AlertDescription } from '../components/ui/alert';
import ListSkeleton from '../components/ListSkeleton.vue';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import DataCard from '../components/DataCard.vue';

// 預設先提供完整紀錄；需要處理的工作則依優先級排列在後續篩選中。
const VIEWS = [
  { key: 'all', label: '全部', tone: 'neutral' },
  { key: 'todo', label: '待處理', tone: 'neutral' },
  { key: 'failed', label: '失敗／待確認', tone: 'danger' },
  { key: 'pending', label: DELIVERY_STATUS_META.not_sent.label, tone: 'warning' },
  { key: 'drafts', label: RECORD_STATUS_META.draft.label, tone: 'warning' },
  // 總覽「本月已寄出」點進來的就是這一格；沒有這個頁籤時清單篩了卻沒有任何一格亮著。
  { key: 'sent', label: DELIVERY_STATUS_META.sent.label, tone: 'success' },
];
const VIEW_PREFERENCE_KEY = 'health-check:records-view';

const view = useSearchQueryParam('view', 'all');
const query = useSearchQueryParam('q');
const dateFrom = useSearchQueryParam('from');
const dateTo = useSearchQueryParam('to');
const route = useRoute();
const router = useRouter();
const toast = useToast();

// 網址上的 view 是明確指定（書籤／分享連結）時最高優先；只有未指定時才套用個人偏好。
// localStorage 可能被無痕模式或瀏覽器設定封鎖，因此讀寫都不能影響正常使用。
if (!route.query.view) {
  try {
    const savedView = localStorage.getItem(VIEW_PREFERENCE_KEY);
    if (VIEWS.some((item) => item.key === savedView)) view.value = savedView;
  } catch {
    // 忽略儲存空間不可用，維持「全部」預設即可。
  }
}

const counts = ref({});
const petPickerOpen = ref(false);
const recordToRemove = ref(null);
const deletingRecordId = ref(null);
const removeError = ref('');

// 關鍵字是即時搜尋（FilterBar 等停止打字才送出 applyFilters）；日期要在選單裡按「套用」——
// 翻月份的過程會經過好幾個「還沒決定好」的中間值。查詢中舊清單留著，不換成骨架。
const { items: records, total, limit, loading, error, page: currentPage, totalPages, goToPage, applyFilters, reload: fetchRecords } = usePagedList({
  errorMessage: '健檢報告暫時無法載入，請稍後重試',
  fetch: async ({ page }) => (await http.get('/records', {
    params: {
      view: view.value || 'all',
      page,
      ...(query.value.trim() ? { q: query.value.trim() } : {}),
      ...(dateFrom.value ? { from: dateFrom.value } : {}),
      ...(dateTo.value ? { to: dateTo.value } : {}),
    },
  })).data,
  onData: (data) => { counts.value = data.counts ?? {}; },
});

function selectView(key) {
  if ((view.value || 'all') === key) return;
  // 換佇列等於換一份清單，停在第 3 頁沒有意義（那一頁多半根本不存在）——
  // 交給下面的 watcher 統一處理頁碼重置，避免這裡跟日期篩選各自重置一次觸發兩次查詢。
  view.value = key;
}

function openPetPicker() {
  petPickerOpen.value = true;
}

function closePetPicker() {
  petPickerOpen.value = false;
  if (route.query.new === '1') {
    const query = { ...route.query };
    delete query.new;
    router.replace({ path: route.path, query });
  }
}

async function startRecordForPet(pet) {
  petPickerOpen.value = false;
  if (route.query.new === '1') {
    const query = { ...route.query };
    delete query.new;
    await router.replace({ path: route.path, query });
  }
  await router.push(`/pets/${pet._id}/records/new`);
}

watch(view, applyFilters);
watch(view, (nextView) => {
  try {
    localStorage.setItem(VIEW_PREFERENCE_KEY, nextView || 'all');
  } catch {
    // 偏好記不住不該阻止篩選功能本身。
  }
});
watch(() => route.query.new, (value) => {
  if (value === '1') openPetPicker();
}, { immediate: true });

function formatDate(value) {
  return formatClinicDate(value);
}

function recordLink(record) {
  return record.status === 'draft' ? `/records/${record._id}/edit` : `/records/${record._id}/preview`;
}

function actionLabel(record) {
  return record.status === 'draft' ? '繼續填寫' : '查看報告';
}


// 判準與後端刪除端點一致：已寄出、寄送中、結果待確認的報告不給刪，
// 按鈕乾脆不出現，免得點了才被 409 擋回來。
function canDelete(record) {
  return !['sent', 'sending', 'uncertain'].includes(getDeliveryStatus(record));
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
    toast.success(`已刪除「${record.petId?.name || '貓咪'}」${formatDate(record.visitDate)} 的健檢報告`, '刪除紀錄成功');
    // 刪掉這頁最後一筆時，fetchRecords 會自己退回有效頁碼。
    await fetchRecords();
  } catch (err) {
    const msg = apiErrorMessage(err, '刪除健檢報告失敗');
    removeError.value = msg;
    toast.error(msg, '刪除失敗');
  } finally {
    deletingRecordId.value = null;
  }
}

</script>

<template>
  <section class="flex flex-col gap-5">
    <PageHeader title="健檢報告">
      <template #actions>
        <Button type="button" @click="openPetPicker"><Plus stroke-width="1.75" />新增健檢</Button>
      </template>
    </PageHeader>

    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>

    <DataCard title="報告清單" :count="loading && !total ? null : total" style="--data-columns: minmax(12rem, 1.6fr) minmax(8rem, 1fr) minmax(9rem, 1.2fr) 8.5rem minmax(11rem, 1.2fr) 11rem">
      <template #filters>
        <FilterBar
          id="records-search"
          v-model="query"
          label="搜尋健檢報告"
          placeholder="貓咪、飼主"
          with-date-range
          :date-from="dateFrom"
          :date-to="dateTo"
          date-from-label="起始看診日"
          date-to-label="結束看診日"
          class="w-full min-w-0 md:w-[28rem]"
          @update:date-from="dateFrom = $event"
          @update:date-to="dateTo = $event"
          @submit="applyFilters"
        />
      </template>
      <template #tabs>
        <FilterTabs :model-value="view || 'all'" :items="VIEWS" :counts="counts" aria-label="健檢報告佇列" @update:model-value="selectView" />
      </template>
      <ListSkeleton v-if="loading && !records.length" :rows="6" inset />
      <EmptyState v-else-if="!records.length" :icon="FileText" title="這個佇列目前是空的" description="換一個佇列，或直接建立新的健檢報告。" inset />
      <template v-else>
      <!-- 桌機：一列一份。寄送失敗的列左側一條警示色條。 -->
      <div class="hidden xl:block">
        <div class="desktop-data-header">
          <span>貓咪</span><span>飼主</span><span>健檢類型</span><span>看診日</span><span>狀態</span><span></span>
        </div>
        <div
          v-for="record in records"
          :key="record._id"
          class="desktop-data-row hover:bg-hover"
          :class="getDeliveryStatus(record) === 'failed' ? 'shadow-[inset_3px_0_0_var(--danger)]' : ''"
        >
          <router-link :to="record.petId ? `/pets/${record.petId._id}` : recordLink(record)" class="desktop-data-cell flex items-center gap-3">
            <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground"><Cat class="size-5" stroke-width="1.75" /></span>
            <span class="min-w-0 truncate font-semibold text-primary">{{ record.petId?.name || '找不到貓咪' }}</span>
          </router-link>
          <span class="desktop-data-cell truncate text-sm"><PatientLink v-if="record.petId?.ownerId?.name" :pet-id="record.petId" quiet>{{ record.petId.ownerId.name }}</PatientLink></span>
          <span class="desktop-data-cell">
            <span class="block truncate text-sm" v-tip.overflow="record.examType || ''">{{ record.examType }}</span>
            <span v-if="record.reportVersion > 1" class="block text-xs text-subtle-foreground">第 <span class="num">{{ record.reportVersion }}</span> 版</span>
          </span>
          <span class="desktop-data-cell">
            <span class="num block text-sm">{{ formatDate(record.visitDate) }}</span>
            <span class="block text-xs text-subtle-foreground">{{ relativeDayLabel(record.visitDate) }}</span>
          </span>
          <span class="desktop-data-cell flex flex-wrap items-center gap-1.5">
            <Badge variant="status" :class="RECORD_STATUS_META[record.status]?.class">{{ RECORD_STATUS_META[record.status]?.label }}</Badge>
            <Badge v-if="record.status !== 'draft'" variant="status" :class="DELIVERY_STATUS_META[getDeliveryStatus(record)]?.class" v-tip="record.deliveryError || undefined">{{ DELIVERY_STATUS_META[getDeliveryStatus(record)]?.label }}</Badge>
          </span>
          <span class="desktop-data-cell flex items-center justify-end gap-1">
            <Button as-child variant="soft" size="sm"><router-link :to="recordLink(record)">{{ actionLabel(record) }}</router-link></Button>
            <RowActions v-if="canDelete(record)" :actions="[{ key: 'delete', label: record.status === 'draft' ? '捨棄草稿' : '刪除報告', danger: true }]" :label="`${record.petId?.name || '這份報告'}的更多操作`" @select="openRemoveRecord(record)" />
            <span v-else class="size-9 shrink-0" aria-hidden="true" />
          </span>
        </div>
      </div>

      <!-- 窄螢幕：一份一張小卡。 -->
      <ul class="divide-y divide-border xl:hidden">
        <li v-for="record in records" :key="record._id" class="space-y-2 px-4 py-3" :class="getDeliveryStatus(record) === 'failed' ? 'shadow-[inset_3px_0_0_var(--danger)]' : ''">
          <div class="flex items-start gap-3">
            <router-link :to="record.petId ? `/pets/${record.petId._id}` : recordLink(record)" class="min-w-0 flex-1">
              <span class="block truncate font-semibold text-primary">{{ record.petId?.name || '找不到貓咪' }}</span>
              <span class="flex gap-3 text-sm text-muted-foreground"><span class="truncate">{{ record.examType || '健檢報告' }}</span><span class="num shrink-0">{{ formatDate(record.visitDate) }}</span></span>
            </router-link>
            <RowActions v-if="canDelete(record)" :actions="[{ key: 'delete', label: record.status === 'draft' ? '捨棄草稿' : '刪除報告', danger: true }]" :label="`${record.petId?.name || '這份報告'}的更多操作`" @select="openRemoveRecord(record)" />
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            <Badge variant="status" :class="RECORD_STATUS_META[record.status]?.class">{{ RECORD_STATUS_META[record.status]?.label }}</Badge>
            <Badge v-if="record.status !== 'draft'" variant="status" :class="DELIVERY_STATUS_META[getDeliveryStatus(record)]?.class">{{ DELIVERY_STATUS_META[getDeliveryStatus(record)]?.label }}</Badge>
            <Button as-child variant="soft" size="sm" class="ml-auto"><router-link :to="recordLink(record)">{{ actionLabel(record) }}</router-link></Button>
          </div>
          <p v-if="record.deliveryError" class="text-sm text-danger">{{ record.deliveryError }}</p>
        </li>
      </ul>

      </template>
      <template v-if="records.length" #footer>
        <ListFooter :page="currentPage" :total-pages="totalPages" :total="total" :page-size="limit" @update:page="goToPage" />
      </template>
    </DataCard>
  </section>
  <PetPickerDialog :open="petPickerOpen" @close="closePetPicker" @select="startRecordForPet" />
  <!-- 草稿只要一般確認，已結案報告才要打字（與貓咪詳情頁、後端刪除端點同一個判準）。 -->
  <ConfirmDialog
    :open="Boolean(recordToRemove) && !isFinalizedRecord(recordToRemove)"
    title="捨棄健檢草稿"
    :description="`確定要捨棄「${recordToRemove?.petId?.name || '貓咪'}」${formatDate(recordToRemove?.visitDate)} 這筆草稿嗎？此操作無法復原。`"
    confirm-label="捨棄草稿"
    destructive
    :loading="Boolean(deletingRecordId)"
    @update:open="(value) => !value && (recordToRemove = null)"
    @confirm="removeRecord()"
  />
  <DeleteRecordDialog
    v-if="recordToRemove && isFinalizedRecord(recordToRemove)"
    :record="recordToRemove"
    :confirm-word="recordToRemove.petId?.name ?? ''"
    :submitting="Boolean(deletingRecordId)"
    :error-message="removeError"
    @close="recordToRemove = null"
    @submit="removeRecord"
  />
</template>
