<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { AlertTriangle, ArrowLeft, Mail, Trash2 } from '@lucide/vue';
import { http } from '../api/http';
import { formatDateTime } from '../lib/datetime';
import { DELIVERY_EVENT_META } from '../lib/recordStatus';
import { useSearchQueryParam } from '../composables/useSearchQueryParam';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Alert, AlertDescription } from '../components/ui/alert';
import ListSkeleton from '../components/ListSkeleton.vue';

// 這頁的重點不是「報告」而是「寄送這件事」：每一次嘗試各自一列，
// 包含後來被刪掉的報告。報告清單那頁回答「還有什麼沒寄」，這頁回答「當初寄了什麼給誰」。
const EVENTS = [
  { key: '', label: '全部' },
  { key: 'sent', label: '寄送成功' },
  { key: 'failed', label: '寄送失敗' },
  { key: 'uncertain', label: '結果待確認' },
  { key: 'queued', label: '開始寄送' },
];

const event = useSearchQueryParam('event');
const page = useSearchQueryParam('page', '1');

const logs = ref([]);
const total = ref(0);
const limit = ref(50);
const loading = ref(false);
const error = ref('');

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
      },
    });
    if (currentRequest !== requestSequence) return;
    logs.value = data.items ?? [];
    total.value = data.total ?? 0;
    limit.value = data.limit ?? 50;
  } catch (err) {
    if (currentRequest === requestSequence) error.value = '寄送紀錄暫時無法載入，請稍後重試';
  } finally {
    if (currentRequest === requestSequence) loading.value = false;
  }
}

const currentPage = computed(() => Number(page.value) || 1);
const totalPages = computed(() => Math.max(Math.ceil(total.value / limit.value), 1));

function selectEvent(key) {
  if (event.value === key) return;
  event.value = key;
  page.value = '1';
}

function goToPage(next) {
  const target = Math.min(Math.max(next, 1), totalPages.value);
  if (target === currentPage.value) return;
  page.value = String(target);
}

watch([event, page], fetchLogs, { immediate: true });
onBeforeUnmount(() => {
  requestSequence += 1;
});
</script>

<template>
  <section class="mx-auto max-w-7xl space-y-5">
    <router-link to="/records" class="inline-flex items-center gap-1 text-sm font-medium text-belle-600 hover:text-belle-700 dark:text-brand-400 dark:hover:text-brand-300">
      <ArrowLeft class="h-4 w-4" stroke-width="1.75" />回健檢紀錄
    </router-link>

    <div>
      <h1 class="text-xl font-semibold text-foreground">寄送紀錄</h1>
      <p class="mt-1 text-sm text-muted-foreground">每一次寄送嘗試的完整歷程，包含收件信箱與失敗原因。報告刪除後這裡仍然查得到。</p>
    </div>

    <div class="relative">
      <nav class="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1.5 pr-8 shadow-sm" aria-label="寄送事件篩選">
        <button
        v-for="item in EVENTS"
        :key="item.key || 'all'"
        type="button"
        class="inline-flex min-h-10 shrink-0 items-center rounded-lg border px-3 text-sm font-medium transition-colors"
        :class="event === item.key
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-transparent text-foreground hover:bg-muted/40  '"
        :aria-current="event === item.key ? 'page' : undefined"
        @click="selectEvent(item.key)"
        >{{ item.label }}</button>
      </nav>
      <span aria-hidden="true" class="pointer-events-none absolute inset-y-1.5 right-1.5 w-10 rounded-r-lg bg-gradient-to-l from-card via-card/80 to-transparent sm:hidden"></span>
    </div>

    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
    <ListSkeleton v-else-if="loading" :rows="5" />
    <p v-else-if="!logs.length" class="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
      目前沒有寄送紀錄。
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
              <TableHead >備註</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="log in logs" :key="log._id">
              <TableCell class="text-sm tabular-nums text-foreground">{{ formatDateTime(log.createdAt) }}</TableCell>
              <TableCell >
                <Badge variant="status" :class="DELIVERY_EVENT_META[log.event]?.class">{{ DELIVERY_EVENT_META[log.event]?.label || log.event }}</Badge>
              </TableCell>
              <TableCell >
                <span class="block text-sm text-foreground">{{ log.petName || '寵物未記錄' }}<span class="ml-2 text-xs text-muted-foreground">{{ log.ownerName }}</span></span>
                <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <!-- 報告還在就給連結；已刪除的直接標明，連過去只會是 404。 -->
                  <router-link v-if="log.recordExists" :to="`/records/${log.recordId}/preview`" class="tabular-nums underline hover:text-belle-600 dark:hover:text-brand-400">{{ log.reportNumber || '—' }}</router-link>
                  <template v-else>
                    <span class="tabular-nums">{{ log.reportNumber || '—' }}</span>
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
                <span v-if="log.error" class="flex items-start gap-1 text-xs text-red-700 dark:text-red-300">
                  <AlertTriangle class="mt-0.5 h-3 w-3 shrink-0" stroke-width="1.75" /><span class="min-w-0">{{ log.error }}</span>
                </span>
                <span v-else-if="log.messageId" class="block truncate text-xs text-muted-foreground" :title="log.messageId">{{ log.messageId }}</span>
                <span v-else class="text-xs text-muted-foreground">—</span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      <!-- 手機：卡片 -->
      <div class="space-y-3 xl:hidden">
        <Card v-for="log in logs" :key="log._id" class="gap-2 p-4 shadow-sm dark:shadow-none">
          <div class="flex items-start justify-between gap-3">
            <Badge variant="status" :class="DELIVERY_EVENT_META[log.event]?.class">{{ DELIVERY_EVENT_META[log.event]?.label || log.event }}</Badge>
            <span class="text-xs tabular-nums text-muted-foreground">{{ formatDateTime(log.createdAt) }}</span>
          </div>
          <p class="text-sm text-foreground">{{ log.petName || '寵物未記錄' }}<span class="ml-2 text-xs text-muted-foreground">{{ log.ownerName }}</span></p>
          <p class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <router-link v-if="log.recordExists" :to="`/records/${log.recordId}/preview`" class="tabular-nums underline">{{ log.reportNumber || '—' }}</router-link>
            <template v-else>
              <span class="tabular-nums">{{ log.reportNumber || '—' }}</span>
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
        <p class="text-xs tabular-nums text-muted-foreground">共 {{ total }} 筆・第 {{ currentPage }} / {{ totalPages }} 頁</p>
        <div class="flex gap-2">
          <Button type="button" variant="outline" size="sm" :disabled="currentPage <= 1" @click="goToPage(currentPage - 1)">上一頁</Button>
          <Button type="button" variant="outline" size="sm" :disabled="currentPage >= totalPages" @click="goToPage(currentPage + 1)">下一頁</Button>
        </div>
      </div>
    </template>
  </section>
</template>
