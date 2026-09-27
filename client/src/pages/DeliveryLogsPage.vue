<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ChevronDown, ChevronUp, Mail, Trash2 } from '@lucide/vue';
import { http } from '../api/http';
import { formatDate, formatDateTime } from '../lib/datetime';
import { DELIVERY_EVENT_META } from '../lib/recordStatus';
import { useSearchQueryParam } from '../composables/useSearchQueryParam';
import { useRoute } from 'vue-router';
import { Badge } from '../components/ui/badge';
import DataCard from '../components/DataCard.vue';
import { Alert, AlertDescription } from '../components/ui/alert';
import ListSkeleton from '../components/ListSkeleton.vue';
import ListFooter from '../components/ListFooter.vue';
import { Button } from '../components/ui/button';
import FilterTabs from '../components/FilterTabs.vue';
import FilterBar from '../components/FilterBar.vue';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';

// 這頁的重點不是「報告」而是「寄送這件事」：每一次嘗試各自一列（後端已把 queued 與結果併成一筆），
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
  <section class="flex flex-col gap-5">
    <PageHeader title="寄送歷程" description="每一次寄送嘗試都留一筆；報告刪除後這裡仍查得到寄給了誰。" />

    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>

    <DataCard title="寄送紀錄" :count="loading && !total ? null : total" style="--data-columns: 11rem 7rem minmax(12rem, 1.2fr) minmax(12rem, 1fr) minmax(12rem, 1.2fr)">
      <template #filters>
        <FilterBar
          id="delivery-search"
          v-model="query"
          label="搜尋寄送歷程"
          placeholder="貓咪、飼主、信箱"
          with-date-range
          :date-from="dateFrom"
          :date-to="dateTo"
          date-from-label="起始日期"
          date-to-label="結束日期"
          class="w-full min-w-0 md:w-[28rem]"
          @update:date-from="dateFrom = $event"
          @update:date-to="dateTo = $event"
          @submit="applyFilters"
        />
      </template>
      <template #tabs>
        <FilterTabs :model-value="event" :items="EVENTS" aria-label="寄送事件篩選" @update:model-value="selectEvent" />
      </template>
      <ListSkeleton v-if="loading" :rows="5" :avatar="false" inset />
      <EmptyState v-else-if="!logs.length" :icon="Mail" title="目前沒有寄送歷程" inset />
      <template v-else>
      <!-- 桌機：一列一次寄送嘗試。失敗的列左側一條警示色條。 -->
      <div class="hidden xl:block">
        <div class="desktop-data-header">
          <span>時間</span><span>結果</span><span>報告</span><span>收件信箱</span><span>說明</span>
        </div>
        <div
          v-for="log in logs"
          :key="log.attemptId || log._id"
          class="desktop-data-row hover:bg-hover"
          :class="[log.event === 'failed' ? 'shadow-[inset_3px_0_0_var(--danger)]' : '', detailExpanded(log) ? 'desktop-data-row--expanded' : '']"
        >
          <span class="desktop-data-cell"><span class="num block text-sm">{{ formatDate(log.completedAt || log.startedAt) }}</span><span class="num block text-xs text-subtle-foreground">{{ formatDateTime(log.completedAt || log.startedAt, { hour: '2-digit', minute: '2-digit', hour12: false }) }}</span></span>
          <span class="desktop-data-cell"><Badge variant="status" :class="DELIVERY_EVENT_META[log.event]?.class">{{ DELIVERY_EVENT_META[log.event]?.label || log.event }}</Badge></span>
          <span class="desktop-data-cell">
            <router-link v-if="log.recordExists" :to="`/records/${log.recordId}/preview`" class="block truncate font-semibold text-primary">{{ log.petName || '貓咪未記錄' }}</router-link>
            <span v-else class="flex min-w-0 items-center gap-1.5 text-muted-foreground"><Trash2 class="size-4 shrink-0" stroke-width="1.75" /><span class="truncate">{{ log.petName || '貓咪未記錄' }}</span></span>
            <span class="block truncate text-xs text-subtle-foreground">{{ log.ownerName || '飼主未記錄' }}<template v-if="!log.recordExists">，報告已刪除</template></span>
          </span>
          <span class="desktop-data-cell truncate text-sm" v-tip.overflow="log.recipient || ''">{{ log.recipient || '—' }}</span>
          <span class="desktop-data-cell">
            <div v-if="log.error" class="flex min-w-0 gap-1.5 text-sm text-danger" :class="detailExpanded(log) ? 'items-start' : 'items-center'">
              <span class="min-w-0 flex-1 wrap-break-word" :class="detailExpanded(log) ? 'whitespace-normal' : 'truncate'" v-tip.overflow="log.error">{{ log.error }}</span>
              <Button v-if="log.error.length > 40" type="button" variant="secondary" size="xs" class="shrink-0" @click="toggleDetail(log)">
                <component :is="detailExpanded(log) ? ChevronUp : ChevronDown" stroke-width="1.75" />{{ detailExpanded(log) ? '收合' : '詳情' }}
              </Button>
            </div>
            <span v-else-if="log.event === 'queued'" class="text-sm text-info">等待寄送完成</span>
            <span v-else-if="log.event === 'uncertain'" class="text-sm text-warning">寄送結果待確認</span>
            <span v-else class="text-sm text-subtle-foreground">—</span>
          </span>
        </div>
      </div>

      <!-- 窄螢幕：一次一張小卡。 -->
      <ul class="divide-y divide-border xl:hidden">
        <li v-for="log in logs" :key="log.attemptId || log._id" class="space-y-1.5 px-4 py-3" :class="log.event === 'failed' ? 'shadow-[inset_3px_0_0_var(--danger)]' : ''">
          <div class="flex items-center justify-between gap-3">
            <Badge variant="status" :class="DELIVERY_EVENT_META[log.event]?.class">{{ DELIVERY_EVENT_META[log.event]?.label || log.event }}</Badge>
            <span class="num text-sm text-subtle-foreground">{{ formatDateTime(log.completedAt || log.startedAt) }}</span>
          </div>
          <p class="flex gap-3"><router-link v-if="log.recordExists" :to="`/records/${log.recordId}/preview`" class="font-semibold text-primary">{{ log.petName || '貓咪未記錄' }}</router-link><span v-else class="text-muted-foreground">{{ log.petName || '貓咪未記錄' }}（報告已刪除）</span><span class="text-muted-foreground">{{ log.ownerName }}</span></p>
          <p class="truncate text-sm">{{ log.recipient || '—' }}</p>
          <p v-if="log.error" class="text-sm text-danger">{{ log.error }}</p>
        </li>
      </ul>

      </template>
      <template v-if="!loading && logs.length" #footer>
        <ListFooter :page="currentPage" :total-pages="totalPages" :total="total" :page-size="limit" @update:page="goToPage" />
      </template>
    </DataCard>
  </section>
</template>
