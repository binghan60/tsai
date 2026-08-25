<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { AlertTriangle, ChevronDown, ChevronUp, Mail, Trash2 } from '@lucide/vue';
import { http } from '../api/http';
import { formatDateTime } from '../lib/datetime';
import { DELIVERY_EVENT_META } from '../lib/recordStatus';
import { groupDeliveryAttempts } from '../lib/deliveryAttempts';
import { useSearchQueryParam } from '../composables/useSearchQueryParam';
import { useRoute } from 'vue-router';
import { Badge } from '../components/ui/badge';
import { Card } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';
import ListSkeleton from '../components/ListSkeleton.vue';
import Pagination from '../components/Pagination.vue';
import FilterTabs from '../components/FilterTabs.vue';
import FilterBar from '../components/FilterBar.vue';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';

// 這頁的重點不是「報告」而是「寄送這件事」：每一次嘗試各自一列，
// 包含後來被刪掉的報告。報告清單那頁回答「還有什麼沒寄」，這頁回答「當初寄了什麼給誰」。
const EVENTS = [
  { key: '', label: '全部', tone: 'neutral' },
  { key: 'sent', label: '寄送成功', tone: 'success' },
  { key: 'failed', label: '寄送失敗', tone: 'danger' },
  { key: 'uncertain', label: '結果待確認', tone: 'warning' },
  { key: 'queued', label: '寄送中', tone: 'info' },
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
const limit = ref(10);
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
    limit.value = data.limit ?? 10;
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
    <PageHeader title="寄送歷程" description="追查每一次寄送嘗試的收件信箱、最終結果與失敗原因；報告刪除後歷程仍會保留。" />

    <div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,24rem)] xl:items-center">
      <FilterTabs :model-value="event" :items="EVENTS" aria-label="寄送事件篩選" @update:model-value="selectEvent" />
      <FilterBar
        id="delivery-search"
        v-model="query"
        label="搜尋寄送歷程"
        placeholder="寵物、飼主、信箱或報告編號"
        with-date-range
        :date-from="dateFrom"
        :date-to="dateTo"
        date-from-label="起始日期"
        date-to-label="結束日期"
        class="w-full min-w-0"
        @update:date-from="dateFrom = $event"
        @update:date-to="dateTo = $event"
        @submit="applyFilters"
      />
    </div>
    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
    <ListSkeleton v-else-if="loading" :rows="5" />
    <Card v-else-if="!logs.length"><EmptyState inset :icon="Mail" title="目前沒有寄送歷程" /></Card>

    <template v-else>
      <!-- 桌機：清單卡。寄送失敗的列左側加一條警示色條，這裡「有事要處理」的判準是
           log.event === 'failed'，跟健檢紀錄頁用 deliveryStatus 是同一個道理、不同資料來源。 -->
      <Card class="hidden overflow-hidden p-0 shadow-sm xl:block dark:shadow-none" style="--data-columns: 9rem 6.5rem minmax(10rem, 1fr) minmax(10rem, 1fr) minmax(11rem, 1.1fr)">
        <div class="desktop-data-header">
          <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">時間</span>
          <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">事件</span>
          <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">報告</span>
          <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">收件信箱</span>
          <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">處理結果</span>
        </div>
        <div
          v-for="log in deliveryAttempts"
          :key="log.attemptId || log._id"
          class="desktop-data-row"
          :class="[
            log.event === 'failed' ? 'bg-danger-surface/40 shadow-[inset_3px_0_0_var(--danger)]' : '',
            detailExpanded(log) ? 'desktop-data-row--expanded' : '',
          ]"
        >
          <span class="desktop-data-cell whitespace-nowrap text-xs tabular-nums text-foreground">{{ formatDateTime(log.completedAt || log.startedAt) }}</span>
          <span class="desktop-data-cell"><Badge variant="status" :class="DELIVERY_EVENT_META[log.event]?.class">{{ DELIVERY_EVENT_META[log.event]?.label || log.event }}</Badge></span>
          <span class="desktop-data-cell">
            <router-link
              v-if="log.recordExists"
              :to="`/records/${log.recordId}/preview`"
              class="block truncate text-sm font-medium text-primary"
              :title="`${log.petName || '寵物未記錄'} · ${log.ownerName || '飼主未記錄'}`"
            >
              {{ log.petName || '寵物未記錄' }}<span class="font-normal text-muted-foreground"> · {{ log.ownerName || '飼主未記錄' }}</span>
            </router-link>
            <span v-else class="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground" :title="`${log.petName || '寵物未記錄'} · 報告已刪除`">
              <Trash2 class="h-3.5 w-3.5 shrink-0" stroke-width="1.75" />
              <span class="truncate">{{ log.petName || '寵物未記錄' }} · 報告已刪除</span>
            </span>
          </span>
          <span class="desktop-data-cell flex items-center gap-1.5 text-sm text-foreground">
            <Mail class="h-3.5 w-3.5 shrink-0 text-muted-foreground" stroke-width="1.75" /><span class="min-w-0 truncate" :title="log.recipient || '—'">{{ log.recipient || '—' }}</span>
          </span>
          <span class="desktop-data-cell">
            <div v-if="log.error" class="flex min-w-0 items-center gap-1 text-xs text-danger" :class="detailExpanded(log) ? 'items-start' : ''">
              <AlertTriangle class="mt-0.5 h-3 w-3 shrink-0" stroke-width="1.75" />
              <span
                class="min-w-0 flex-1 wrap-break-word"
                :class="detailExpanded(log) ? 'whitespace-normal' : 'truncate'"
                :title="log.error"
              >{{ log.error }}</span>
              <button
                v-if="log.error.length > 40"
                type="button"
                class="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-1 font-medium text-danger hover:bg-danger-surface"
                @click="toggleDetail(log)"
              >
                <ChevronUp v-if="detailExpanded(log)" class="h-3.5 w-3.5" />
                <ChevronDown v-else class="h-3.5 w-3.5" />
                {{ detailExpanded(log) ? '收合' : '詳情' }}
              </button>
            </div>
            <span v-else-if="log.event === 'sent'" class="text-xs text-success">已寄送</span>
            <span v-else-if="log.event === 'queued'" class="text-xs text-info">等待寄送完成</span>
            <span v-else-if="log.event === 'uncertain'" class="text-xs text-warning">寄送結果待確認</span>
            <span v-else class="text-xs text-muted-foreground">—</span>
          </span>
        </div>
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
            <router-link v-if="log.recordExists" :to="`/records/${log.recordId}/preview`" class="inline-flex min-h-11 items-center font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary">查看報告</router-link>
            <template v-else>
              <span class="inline-flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5"><Trash2 class="h-3 w-3" stroke-width="1.75" />報告已刪除</span>
            </template>
          </p>
          <p class="flex items-center gap-1.5 text-sm text-foreground">
            <Mail class="h-3.5 w-3.5 shrink-0 text-muted-foreground" stroke-width="1.75" />{{ log.recipient || '—' }}
          </p>
          <p v-if="log.error" class="flex items-start gap-1 text-xs text-danger">
            <AlertTriangle class="mt-0.5 h-3 w-3 shrink-0" stroke-width="1.75" /><span class="min-w-0">{{ log.error }}</span>
          </p>
        </Card>
      </div>

      <Pagination :page="currentPage" :total-pages="totalPages" @update:page="goToPage" />
    </template>
  </section>
</template>
