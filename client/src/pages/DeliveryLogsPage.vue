<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { AlertTriangle, ChevronDown, ChevronUp, Mail, Search, Trash2, X } from '@lucide/vue';
import { http } from '../api/http';
import { formatDateTime } from '../lib/datetime';
import { DELIVERY_EVENT_META } from '../lib/recordStatus';
import { groupDeliveryAttempts } from '../lib/deliveryAttempts';
import { useSearchQueryParam } from '../composables/useSearchQueryParam';
import { useRoute } from 'vue-router';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Alert, AlertDescription } from '../components/ui/alert';
import ListSkeleton from '../components/ListSkeleton.vue';
import FilterTabs from '../components/FilterTabs.vue';
import { Input } from '../components/ui/input';
import { DatePicker } from '../components/ui/date-picker';

// 這頁的重點不是「報告」而是「寄送這件事」：每一次嘗試各自一列，
// 包含後來被刪掉的報告。報告清單那頁回答「還有什麼沒寄」，這頁回答「當初寄了什麼給誰」。
const EVENTS = [
  { key: '', label: '全部', tone: 'neutral' },
  { key: 'sent', label: '寄送成功', tone: 'success' },
  { key: 'failed', label: '寄送失敗', tone: 'danger' },
  { key: 'uncertain', label: '結果待確認', tone: 'warning' },
  { key: 'queued', label: '開始寄送', tone: 'info' },
];
const EVENT_PREFERENCE_KEY = 'health-check:delivery-event';

const event = useSearchQueryParam('event');
const page = useSearchQueryParam('page', '1');
const query = useSearchQueryParam('q');
const dateFrom = useSearchQueryParam('from');
const dateTo = useSearchQueryParam('to');
const route = useRoute();

// 分享或書籤中的網址篩選優先；未指定時才延續使用者上次查看的事件。
if (!route.query.event) {
  try {
    const savedEvent = localStorage.getItem(EVENT_PREFERENCE_KEY);
    if (EVENTS.some((item) => item.key === savedEvent)) event.value = savedEvent;
  } catch {
    // localStorage 不可用時，維持「全部」。
  }
}

const logs = ref([]);
const total = ref(0);
const limit = ref(50);
const loading = ref(false);
const error = ref('');
const expandedDetails = ref(new Set());

let requestSequence = 0;
const deliveryAttempts = computed(() => groupDeliveryAttempts(logs.value));

async function fetchLogs() {
  const currentRequest = ++requestSequence;
  loading.value = true;
  error.value = '';
  try {
    const { data } = await http.get('/delivery-logs', {
      params: {
        page: Number(page.value) || 1,
        ...(event.value ? { event: event.value } : {}),
        ...(query.value.trim() ? { q: query.value.trim() } : {}),
        ...(dateFrom.value ? { from: dateFrom.value } : {}),
        ...(dateTo.value ? { to: dateTo.value } : {}),
      },
    });
    if (currentRequest !== requestSequence) return;
    logs.value = data.items ?? [];
    total.value = data.total ?? 0;
    limit.value = data.limit ?? 50;
  } catch (err) {
    if (currentRequest === requestSequence) error.value = '寄送歷程暫時無法載入，請稍後重試';
  } finally {
    if (currentRequest === requestSequence) loading.value = false;
  }
}

const currentPage = computed(() => Number(page.value) || 1);
const totalPages = computed(() => Math.max(Math.ceil(total.value / limit.value), 1));

function selectEvent(key) {
  if (event.value === key) return;
  event.value = key;
}

function goToPage(next) {
  const target = Math.min(Math.max(next, 1), totalPages.value);
  if (target === currentPage.value) return;
  page.value = String(target);
}

// 關鍵字與日期是選好、按下搜尋才查——邊選邊查在切換事件分頁時很自然，
// 但打關鍵字或翻開日期選單挑月份的過程都會經過好幾個「還沒決定好」的中間值，
// 每次都送一次查詢沒有意義。
function applyFilters() {
  if (page.value !== '1') page.value = '1';
  else fetchLogs();
}

function clearSearchFilters() {
  query.value = '';
  dateFrom.value = '';
  dateTo.value = '';
  applyFilters();
}

function detailKey(log) {
  return log.attemptId || log._id;
}

function detailExpanded(log) {
  return expandedDetails.value.has(detailKey(log));
}

function toggleDetail(log) {
  const next = new Set(expandedDetails.value);
  const key = detailKey(log);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedDetails.value = next;
}

watch(event, applyFilters);
watch(page, fetchLogs, { immediate: true });
watch(event, (nextEvent) => {
  try {
    localStorage.setItem(EVENT_PREFERENCE_KEY, nextEvent || '');
  } catch {
    // 儲存偏好失敗不影響寄送歷程查詢。
  }
});
onBeforeUnmount(() => {
  requestSequence += 1;
});
</script>

<template>
  <section class="mx-auto max-w-7xl space-y-5">
    <div>
      <h1 class="text-xl font-semibold text-foreground">寄送歷程</h1>
      <p class="mt-1 text-sm text-muted-foreground">追查每一次寄送嘗試的收件信箱、最終結果與失敗原因；報告刪除後歷程仍會保留。</p>
    </div>

    <FilterTabs :model-value="event" :items="EVENTS" aria-label="寄送事件篩選" @update:model-value="selectEvent" />
    <form class="grid gap-3 rounded-xl border border-border bg-card p-3 shadow-sm sm:grid-cols-[minmax(220px,1fr)_170px_170px_auto_auto]" @submit.prevent="applyFilters">
      <label class="space-y-1 text-xs font-medium text-muted-foreground">
        <span>關鍵字</span>
        <span class="relative block">
          <Search class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id="delivery-search" v-model="query" type="search" class="pl-10" placeholder="寵物、飼主、信箱或報告編號" aria-label="搜尋寄送歷程" />
        </span>
      </label>
      <label class="space-y-1 text-xs font-medium text-muted-foreground"><span>起始日期</span><DatePicker v-model="dateFrom" aria-label="寄送起始日期" /></label>
      <label class="space-y-1 text-xs font-medium text-muted-foreground"><span>結束日期</span><DatePicker v-model="dateTo" aria-label="寄送結束日期" /></label>
      <Button type="submit" size="sm" class="self-end"><Search class="h-4 w-4" stroke-width="1.75" />搜尋</Button>
      <Button type="button" variant="outline" size="sm" class="self-end" :disabled="!query && !dateFrom && !dateTo" @click="clearSearchFilters"><X class="h-4 w-4" />清除</Button>
    </form>
    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
    <ListSkeleton v-else-if="loading" :rows="5" />
    <p v-else-if="!logs.length" class="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
      目前沒有寄送歷程。
    </p>

    <template v-else>
      <!-- 桌機：表格 -->
      <Card class="hidden overflow-hidden p-0 shadow-sm xl:block dark:shadow-none">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead >時間</TableHead>
              <TableHead >事件</TableHead>
              <TableHead >報告</TableHead>
              <TableHead >收件信箱</TableHead>
              <TableHead >處理結果</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="log in deliveryAttempts" :key="log.attemptId || log._id">
              <TableCell class="text-sm tabular-nums text-foreground">{{ formatDateTime(log.completedAt || log.startedAt) }}</TableCell>
              <TableCell >
                <Badge variant="status" :class="DELIVERY_EVENT_META[log.event]?.class">{{ DELIVERY_EVENT_META[log.event]?.label || log.event }}</Badge>
              </TableCell>
              <TableCell >
                <span class="block text-sm text-foreground">{{ log.petName || '寵物未記錄' }}<span class="ml-2 text-xs text-muted-foreground">{{ log.ownerName }}</span></span>
                <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <!-- 報告還在就給連結；已刪除的直接標明，連過去只會是 404。 -->
                  <router-link v-if="log.recordExists" :to="`/records/${log.recordId}/preview`" class="underline hover:text-belle-600 dark:hover:text-brand-400">查看報告</router-link>
                  <template v-else>
                    <span class="inline-flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-muted-foreground">
                      <Trash2 class="h-3 w-3" stroke-width="1.75" />報告已刪除
                    </span>
                  </template>
                </span>
              </TableCell>
              <TableCell >
                <span class="flex items-center gap-1.5 text-sm text-foreground">
                  <Mail class="h-3.5 w-3.5 shrink-0 text-muted-foreground" stroke-width="1.75" />{{ log.recipient || '—' }}
                </span>
              </TableCell>
              <TableCell >
                <div v-if="log.error" class="max-w-80 text-xs text-red-700 dark:text-red-300">
                  <span class="flex items-start gap-1">
                    <AlertTriangle class="mt-0.5 h-3 w-3 shrink-0" stroke-width="1.75" />
                    <span class="min-w-0 whitespace-normal break-words" :class="detailExpanded(log) || log.error.length <= 40 ? '' : 'line-clamp-2'">{{ log.error }}</span>
                  </span>
                  <button
                    v-if="log.error.length > 40"
                    type="button"
                    class="mt-1 inline-flex min-h-8 items-center gap-1 rounded-md px-1 font-medium text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
                    @click="toggleDetail(log)"
                  >
                    <ChevronUp v-if="detailExpanded(log)" class="h-3.5 w-3.5" />
                    <ChevronDown v-else class="h-3.5 w-3.5" />
                    {{ detailExpanded(log) ? '收合詳情' : '展開詳情' }}
                  </button>
                </div>
                <span v-else-if="log.event === 'sent'" class="text-xs text-emerald-700 dark:text-emerald-300">已寄送</span>
                <span v-else-if="log.event === 'queued'" class="text-xs text-sky-700 dark:text-sky-300">等待寄送完成</span>
                <span v-else-if="log.event === 'uncertain'" class="text-xs text-amber-700 dark:text-amber-300">寄送結果待確認</span>
                <span v-else class="text-xs text-muted-foreground">—</span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      <!-- 手機：卡片 -->
      <div class="space-y-3 xl:hidden">
        <Card v-for="log in deliveryAttempts" :key="log.attemptId || log._id" class="gap-2 p-4 shadow-sm dark:shadow-none">
          <div class="flex items-start justify-between gap-3">
            <Badge variant="status" :class="DELIVERY_EVENT_META[log.event]?.class">{{ DELIVERY_EVENT_META[log.event]?.label || log.event }}</Badge>
            <span class="text-xs tabular-nums text-muted-foreground">{{ formatDateTime(log.completedAt || log.startedAt) }}</span>
          </div>
          <p class="text-sm text-foreground">{{ log.petName || '寵物未記錄' }}<span class="ml-2 text-xs text-muted-foreground">{{ log.ownerName }}</span></p>
          <p class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <router-link v-if="log.recordExists" :to="`/records/${log.recordId}/preview`" class="inline-flex min-h-11 items-center underline">查看報告</router-link>
            <template v-else>
              <span class="inline-flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5"><Trash2 class="h-3 w-3" stroke-width="1.75" />報告已刪除</span>
            </template>
          </p>
          <p class="flex items-center gap-1.5 text-sm text-foreground">
            <Mail class="h-3.5 w-3.5 shrink-0 text-muted-foreground" stroke-width="1.75" />{{ log.recipient || '—' }}
          </p>
          <p v-if="log.error" class="flex items-start gap-1 text-xs text-red-700 dark:text-red-300">
            <AlertTriangle class="mt-0.5 h-3 w-3 shrink-0" stroke-width="1.75" /><span class="min-w-0">{{ log.error }}</span>
          </p>
        </Card>
      </div>

      <div v-if="totalPages > 1" class="flex items-center justify-between gap-3">
        <p class="text-xs tabular-nums text-muted-foreground">共 {{ total }} 個寄送事件・第 {{ currentPage }} / {{ totalPages }} 頁</p>
        <div class="flex gap-2">
          <Button type="button" variant="outline" size="sm" class="hidden sm:inline-flex" :disabled="currentPage <= 1" @click="goToPage(1)">第一頁</Button>
          <Button type="button" variant="outline" size="sm" :disabled="currentPage <= 1" @click="goToPage(currentPage - 1)">上一頁</Button>
          <Button type="button" variant="outline" size="sm" :disabled="currentPage >= totalPages" @click="goToPage(currentPage + 1)">下一頁</Button>
          <Button type="button" variant="outline" size="sm" class="hidden sm:inline-flex" :disabled="currentPage >= totalPages" @click="goToPage(totalPages)">最後頁</Button>
        </div>
      </div>
    </template>
  </section>
</template>
