<script setup>
import { computed, ref, watch } from 'vue';
import { AlertTriangle, ClipboardPlus, FileText, PawPrint, Pencil, User } from '@lucide/vue';
import { http } from '../api/http';
import { formatDate as formatClinicDate } from '../lib/datetime';
import { DELIVERY_STATUS_META, RECORD_STATUS_META, getDeliveryStatus } from '../lib/recordStatus';
import { useRoute, useRouter } from 'vue-router';
import { useSearchQueryParam } from '../composables/useSearchQueryParam';
import PetPickerDialog from '../components/PetPickerDialog.vue';
import FilterTabs from '../components/FilterTabs.vue';
import FilterBar from '../components/FilterBar.vue';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import Pagination from '../components/Pagination.vue';
import ListSkeleton from '../components/ListSkeleton.vue';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';

// 預設先提供完整紀錄；需要處理的工作則依優先級排列在後續篩選中。
const VIEWS = [
  { key: 'all', label: '全部', tone: 'neutral' },
  { key: 'todo', label: '待辦', tone: 'neutral' },
  { key: 'failed', label: '失敗／待確認', tone: 'danger' },
  { key: 'pending', label: DELIVERY_STATUS_META.not_sent.label, tone: 'warning' },
  { key: 'drafts', label: RECORD_STATUS_META.draft.label, tone: 'warning' },
];
const VIEW_PREFERENCE_KEY = 'health-check:records-view';

const view = useSearchQueryParam('view', 'all');
const page = useSearchQueryParam('page', '1');
const query = useSearchQueryParam('q');
const dateFrom = useSearchQueryParam('from');
const dateTo = useSearchQueryParam('to');
const route = useRoute();
const router = useRouter();

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

const records = ref([]);
const counts = ref({});
const total = ref(0);
const limit = ref(10);
const loading = ref(false);
const error = ref('');
const petPickerOpen = ref(false);

let requestSequence = 0;

async function fetchRecords() {
  const currentRequest = ++requestSequence;
  loading.value = true;
  error.value = '';
  try {
    const { data } = await http.get('/records', {
      params: {
        view: view.value || 'all',
        page: Number(page.value) || 1,
        ...(query.value.trim() ? { q: query.value.trim() } : {}),
        ...(dateFrom.value ? { from: dateFrom.value } : {}),
        ...(dateTo.value ? { to: dateTo.value } : {}),
      },
    });
    if (currentRequest !== requestSequence) return;
    records.value = data.items ?? [];
    counts.value = data.counts ?? {};
    total.value = data.total ?? 0;
    limit.value = data.limit ?? 10;
    const returnedTotalPages = Math.max(Math.ceil(total.value / limit.value), 1);
    // 其他人刪除資料或新篩選條件縮小結果時，原本頁碼可能超出最後一頁；
    // 立即回到有效頁碼，避免只看到空白狀態且沒有分頁可以離開。
    if (!records.value.length && total.value > 0 && currentPage.value > returnedTotalPages) {
      page.value = String(returnedTotalPages);
    }
  } catch (err) {
    if (currentRequest === requestSequence) error.value = '就診紀錄暫時無法載入，請稍後重試';
  } finally {
    if (currentRequest === requestSequence) loading.value = false;
  }
}

const currentPage = computed(() => Number(page.value) || 1);
const totalPages = computed(() => Math.max(Math.ceil(total.value / limit.value), 1));

function selectView(key) {
  if ((view.value || 'all') === key) return;
  // 換佇列等於換一份清單，停在第 3 頁沒有意義（那一頁多半根本不存在）——
  // 交給下面的 watcher 統一處理頁碼重置，避免這裡跟日期篩選各自重置一次觸發兩次查詢。
  view.value = key;
}

function goToPage(next) {
  const target = Math.min(Math.max(next, 1), totalPages.value);
  if (target === currentPage.value) return;
  page.value = String(target);
}

// 關鍵字與日期是選好、按下搜尋才查——邊選邊查在切換佇列分頁時很自然，
// 但打關鍵字或翻開日期選單挑月份的過程都會經過好幾個「還沒決定好」的中間值，
// 每次都送一次查詢沒有意義。
function applyFilters() {
  if (page.value !== '1') page.value = '1';
  else fetchRecords();
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
watch(page, fetchRecords, { immediate: true });
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
  return formatClinicDate(value, '—');
}

function recordLink(record) {
  return record.status === 'draft' ? `/records/${record._id}/edit` : `/records/${record._id}/preview`;
}

function actionLabel(record) {
  return record.status === 'draft' ? '繼續填寫' : '查看報告';
}

</script>

<template>
  <section class="mx-auto max-w-7xl space-y-5">
    <PageHeader title="就診紀錄" description="依處理狀態篩選與追蹤每筆就診紀錄。">
      <template #actions>
        <Button type="button" @click="openPetPicker"><ClipboardPlus class="h-4 w-4" stroke-width="1.75" />新增健檢</Button>
      </template>
    </PageHeader>

    <div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,24rem)] xl:items-center">
      <FilterTabs :model-value="view || 'all'" :items="VIEWS" :counts="counts" aria-label="就診紀錄佇列" @update:model-value="selectView" />
      <FilterBar
        id="records-search"
        v-model="query"
        label="搜尋就診紀錄"
        placeholder="寵物、飼主或報告編號"
        with-date-range
        :date-from="dateFrom"
        :date-to="dateTo"
        date-from-label="起始看診日"
        date-to-label="結束看診日"
        class="w-full min-w-0"
        @update:date-from="dateFrom = $event"
        @update:date-to="dateTo = $event"
        @submit="applyFilters"
      />
    </div>

    <ListSkeleton v-if="loading" :rows="6" />

    <Card v-else-if="!error && !records.length">
      <EmptyState inset :icon="FileText" title="這個佇列目前是空的" description="換一個佇列，或直接建立新的就診紀錄。" />
    </Card>

    <template v-else-if="records.length">
      <!-- 桌機：清單卡，不是傳統網格表格——每列是身分區塊＋類型日期＋狀態徽章＋一顆主要按鈕，
           沒有直線分隔，靠橫向髮線區隔列與列。寄送失敗的列左側加一條警示色條，不用額外圖示搶注意力。 -->
      <Card class="hidden overflow-hidden p-0 shadow-sm xl:block dark:shadow-none" style="--data-columns: minmax(14rem, 1.3fr) minmax(14rem, 1fr) minmax(11rem, 0.8fr) 8.5rem">
        <div class="desktop-data-header">
          <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">寵物 / 飼主</span>
          <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">健檢類型．看診日</span>
          <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">狀態</span>
          <span class="desktop-data-cell"></span>
        </div>
        <div
          v-for="record in records"
          :key="record._id"
          class="desktop-data-row"
          :class="getDeliveryStatus(record) === 'failed' ? 'bg-danger-surface/40 shadow-[inset_3px_0_0_var(--danger)]' : ''"
        >
          <router-link :to="record.petId ? `/pets/${record.petId._id}` : recordLink(record)" class="desktop-data-cell flex items-center gap-3">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <PawPrint class="h-4 w-4" stroke-width="1.75" />
            </span>
            <span class="min-w-0 truncate text-sm font-semibold text-primary" :title="`${record.petId?.name || '寵物未找到'} · ${record.petId?.ownerId?.name || '飼主未知'}`">
              {{ record.petId?.name || '寵物未找到' }}<span class="font-normal text-muted-foreground"> · {{ record.petId?.ownerId?.name || '飼主未知' }}</span>
            </span>
          </router-link>

          <span class="desktop-data-cell flex items-center gap-2 text-sm text-foreground">
            <span class="min-w-0 flex-1 truncate" :title="record.examType || '—'">{{ record.examType || '—' }}<span v-if="record.reportVersion > 1" class="text-xs text-muted-foreground"> ・第 {{ record.reportVersion }} 版</span></span>
            <span class="shrink-0 text-xs text-muted-foreground">{{ formatDate(record.visitDate) }}</span>
          </span>

          <span class="desktop-data-cell flex items-center gap-1.5 whitespace-nowrap">
            <Badge variant="status" :class="RECORD_STATUS_META[record.status]?.class">{{ RECORD_STATUS_META[record.status]?.label }}</Badge>
            <Badge v-if="record.status !== 'draft'" variant="status" :class="DELIVERY_STATUS_META[getDeliveryStatus(record)]?.class">{{ DELIVERY_STATUS_META[getDeliveryStatus(record)]?.label }}</Badge>
            <AlertTriangle v-if="record.deliveryError" class="h-3.5 w-3.5 shrink-0 text-danger" stroke-width="1.75" :title="record.deliveryError" />
          </span>

          <span class="desktop-data-cell text-right">
            <Button as-child variant="outline" size="sm">
              <router-link :to="recordLink(record)">
                <component :is="record.status === 'draft' ? Pencil : FileText" class="h-4 w-4" stroke-width="1.75" />
                {{ actionLabel(record) }}
              </router-link>
            </Button>
          </span>
        </div>
      </Card>

      <!-- 手機：卡片 -->
      <div class="space-y-3 xl:hidden">
        <Card v-for="record in records" :key="record._id" class="gap-3 p-4 shadow-sm dark:shadow-none">
          <router-link :to="record.petId ? `/pets/${record.petId._id}` : recordLink(record)" class="flex items-start gap-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <PawPrint class="h-5 w-5" stroke-width="1.75" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-primary">{{ record.petId?.name || '寵物未找到' }}</span>
              <span class="flex items-center gap-1 truncate text-xs text-muted-foreground">
                <User class="h-3 w-3 shrink-0" stroke-width="1.75" />{{ record.petId?.ownerId?.name || '飼主未知' }}
              </span>
            </span>
          </router-link>

          <div class="flex flex-wrap gap-1.5">
            <Badge variant="status" :class="RECORD_STATUS_META[record.status]?.class">{{ RECORD_STATUS_META[record.status]?.label }}</Badge>
            <Badge v-if="record.status !== 'draft'" variant="status" :class="DELIVERY_STATUS_META[getDeliveryStatus(record)]?.class">{{ DELIVERY_STATUS_META[getDeliveryStatus(record)]?.label }}</Badge>
          </div>

          <p class="text-xs text-muted-foreground">
            {{ record.examType || '健檢' }} · {{ formatDate(record.visitDate) }}<template v-if="record.vet"> · {{ record.vet }}</template>
          </p>
          <p v-if="record.deliveryError" class="flex items-start gap-1 text-xs text-danger">
            <AlertTriangle class="mt-0.5 h-3 w-3 shrink-0" stroke-width="1.75" />
            <span class="min-w-0">{{ record.deliveryError }}</span>
          </p>

          <Button as-child variant="outline" size="sm" class="w-full">
            <router-link :to="recordLink(record)">
              <component :is="record.status === 'draft' ? Pencil : FileText" class="h-4 w-4" stroke-width="1.75" />
              {{ actionLabel(record) }}
            </router-link>
          </Button>
        </Card>
      </div>

      <Pagination :page="currentPage" :total-pages="totalPages" @update:page="goToPage" />
    </template>
  </section>
  <PetPickerDialog :open="petPickerOpen" @close="closePetPicker" @select="startRecordForPet" />
</template>
