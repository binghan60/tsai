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
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';

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
const limit = ref(25);
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
      },
    });
    if (currentRequest !== requestSequence) return;
    records.value = data.items ?? [];
    counts.value = data.counts ?? {};
    total.value = data.total ?? 0;
    limit.value = data.limit ?? 25;
    const returnedTotalPages = Math.max(Math.ceil(total.value / limit.value), 1);
    // 其他人刪除資料或新篩選條件縮小結果時，原本頁碼可能超出最後一頁；
    // 立即回到有效頁碼，避免只看到空白狀態且沒有分頁可以離開。
    if (!records.value.length && total.value > 0 && currentPage.value > returnedTotalPages) {
      page.value = String(returnedTotalPages);
    }
  } catch (err) {
    if (currentRequest === requestSequence) error.value = '健檢紀錄暫時無法載入，請稍後重試';
  } finally {
    if (currentRequest === requestSequence) loading.value = false;
  }
}

const currentPage = computed(() => Number(page.value) || 1);
const totalPages = computed(() => Math.max(Math.ceil(total.value / limit.value), 1));

function selectView(key) {
  if ((view.value || 'all') === key) return;
  view.value = key;
  // 換佇列等於換一份清單，停在第 3 頁沒有意義（那一頁多半根本不存在）。
  page.value = '1';
}

function goToPage(next) {
  const target = Math.min(Math.max(next, 1), totalPages.value);
  if (target === currentPage.value) return;
  page.value = String(target);
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

watch([view, page], fetchRecords, { immediate: true });
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
  return formatClinicDate(value, '日期未填');
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
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-foreground">健檢紀錄</h1>
        <p class="mt-1 text-sm text-muted-foreground">依處理狀態篩選與追蹤每筆健檢紀錄。</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <!-- 寄送紀錄是另一種問法：這頁問「還有什麼沒寄」，那頁問「當初寄了什麼給誰」。 -->
        <Button type="button" @click="openPetPicker"><ClipboardPlus class="h-4 w-4" stroke-width="1.75" />新增健檢</Button>
      </div>
    </div>

    <FilterTabs :model-value="view || 'all'" :items="VIEWS" :counts="counts" aria-label="健檢紀錄佇列" @update:model-value="selectView" />

    <p v-if="!loading && !error && !records.length" class="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
      這個佇列目前是空的。
    </p>

    <template v-else-if="records.length">
      <!-- 桌機：表格 -->
      <Card class="hidden overflow-hidden p-0 shadow-sm xl:block dark:shadow-none">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead >寵物</TableHead>
              <TableHead >健檢類型</TableHead>
              <TableHead >看診日</TableHead>
              <TableHead >獸醫師</TableHead>
              <TableHead >狀態</TableHead>
              <TableHead class="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="record in records" :key="record._id">
              <TableCell >
                <router-link :to="record.petId ? `/pets/${record.petId._id}` : recordLink(record)" class="group flex items-center gap-3">
                  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-belle-50 text-belle-600 dark:bg-brand-500/10 dark:text-brand-400">
                    <PawPrint class="h-5 w-5" stroke-width="1.75" />
                  </span>
                  <span class="min-w-0">
                    <span class="block truncate text-sm font-medium text-foreground group-hover:text-belle-600 dark:group-hover:text-brand-400">{{ record.petId?.name || '寵物未找到' }}</span>
                    <span class="block truncate text-xs text-muted-foreground">{{ record.petId?.ownerId?.name || '飼主未知' }}</span>
                  </span>
                </router-link>
              </TableCell>
              <TableCell >
                <span class="text-sm text-foreground">{{ record.examType || '—' }}</span>
                <span v-if="record.reportVersion > 1" class="ml-2 text-xs text-muted-foreground">第 {{ record.reportVersion }} 版</span>
              </TableCell>
              <TableCell class="text-sm tabular-nums text-foreground">{{ formatDate(record.visitDate) }}</TableCell>
              <TableCell class="text-sm text-foreground">{{ record.vet || '未填' }}</TableCell>
              <TableCell >
                <span class="flex flex-wrap gap-1.5">
                  <Badge variant="status" :class="RECORD_STATUS_META[record.status]?.class">{{ RECORD_STATUS_META[record.status]?.label }}</Badge>
                  <Badge v-if="record.status !== 'draft'" variant="status" :class="DELIVERY_STATUS_META[getDeliveryStatus(record)]?.class">{{ DELIVERY_STATUS_META[getDeliveryStatus(record)]?.label }}</Badge>
                </span>
                <!-- 寄送失敗最需要知道的是原因，不然只能一份份點進去查。 -->
                <span v-if="record.deliveryError" class="mt-1 flex items-start gap-1 text-xs text-red-700 dark:text-red-300">
                  <AlertTriangle class="mt-0.5 h-3 w-3 shrink-0" stroke-width="1.75" />
                  <span class="min-w-0">{{ record.deliveryError }}</span>
                </span>
              </TableCell>
              <TableCell class="text-right">
                <Button as-child variant="outline" size="sm">
                  <router-link :to="recordLink(record)">
                    <component :is="record.status === 'draft' ? Pencil : FileText" class="h-4 w-4" stroke-width="1.75" />
                    {{ actionLabel(record) }}
                  </router-link>
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      <!-- 手機：卡片 -->
      <div class="space-y-3 xl:hidden">
        <Card v-for="record in records" :key="record._id" class="gap-3 p-4 shadow-sm dark:shadow-none">
          <router-link :to="record.petId ? `/pets/${record.petId._id}` : recordLink(record)" class="flex items-start gap-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-belle-50 text-belle-600 dark:bg-brand-500/10 dark:text-brand-400">
              <PawPrint class="h-5 w-5" stroke-width="1.75" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-foreground">{{ record.petId?.name || '寵物未找到' }}</span>
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
            {{ record.examType || '健檢' }} · {{ formatDate(record.visitDate) }} · {{ record.vet || '獸醫師未填' }}
          </p>
          <p v-if="record.deliveryError" class="flex items-start gap-1 text-xs text-red-700 dark:text-red-300">
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

      <div v-if="totalPages > 1" class="flex items-center justify-between gap-3">
        <p class="text-xs tabular-nums text-muted-foreground">共 {{ total }} 筆・第 {{ currentPage }} / {{ totalPages }} 頁</p>
        <div class="flex gap-2">
          <Button type="button" variant="outline" size="sm" class="hidden sm:inline-flex" :disabled="currentPage <= 1" @click="goToPage(1)">第一頁</Button>
          <Button type="button" variant="outline" size="sm" :disabled="currentPage <= 1" @click="goToPage(currentPage - 1)">上一頁</Button>
          <Button type="button" variant="outline" size="sm" :disabled="currentPage >= totalPages" @click="goToPage(currentPage + 1)">下一頁</Button>
          <Button type="button" variant="outline" size="sm" class="hidden sm:inline-flex" :disabled="currentPage >= totalPages" @click="goToPage(totalPages)">最後頁</Button>
        </div>
      </div>
    </template>
  </section>
  <PetPickerDialog :open="petPickerOpen" @close="closePetPicker" @select="startRecordForPet" />
</template>
