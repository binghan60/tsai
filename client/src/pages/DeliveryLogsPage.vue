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

// 這頁的重點不是「報告」而是「寄送這件事」：每一次嘗試各自一列，
// 包含後來被刪掉的報告。報告清單那頁回答「還有什麼沒寄」，這頁回答「當初寄了什麼給誰」。
const EVENTS = [
  { key: '', label: '全部' },
  { key: 'sent', label: '寄送成功' },
  { key: 'failed', label: '寄送失敗' },
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
    <router-link to="/records" class="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-belle-600 hover:text-belle-700 dark:text-brand-400 dark:hover:text-brand-300">
      <ArrowLeft class="h-4 w-4" stroke-width="1.75" />回健檢紀錄
    </router-link>

    <div>
      <h1 class="text-xl font-semibold text-ink-900 dark:text-white">寄送紀錄</h1>
      <p class="mt-1 text-sm text-ink-500 dark:text-zinc-400">每一次寄送嘗試的完整歷程，包含收件信箱與失敗原因。報告刪除後這裡仍然查得到。</p>
    </div>

    <nav class="flex gap-1 overflow-x-auto rounded-xl border border-cream-300 bg-cream-50 p-1.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900" aria-label="寄送事件篩選">
      <button
        v-for="item in EVENTS"
        :key="item.key || 'all'"
        type="button"
        class="inline-flex min-h-10 shrink-0 items-center rounded-lg border px-3 text-sm font-medium transition-colors"
        :class="event === item.key
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-transparent text-ink-600 hover:bg-cream-100 dark:text-zinc-300 dark:hover:bg-zinc-800'"
        :aria-current="event === item.key ? 'page' : undefined"
        @click="selectEvent(item.key)"
      >{{ item.label }}</button>
    </nav>

    <p v-if="error" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">{{ error }}</p>
    <p v-else-if="loading" class="text-sm text-ink-500 dark:text-zinc-400" role="status">載入寄送紀錄…</p>
    <p v-else-if="!logs.length" class="rounded-xl border border-cream-300 bg-cream-50 px-4 py-10 text-center text-sm text-ink-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
      目前沒有寄送紀錄。
    </p>

    <template v-else>
      <!-- 桌機：表格 -->
      <Card class="hidden overflow-hidden border-cream-300 p-0 shadow-sm lg:block dark:border-zinc-800 dark:shadow-none">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead class="px-5 py-3">時間</TableHead>
              <TableHead class="px-5 py-3">事件</TableHead>
              <TableHead class="px-5 py-3">報告</TableHead>
              <TableHead class="px-5 py-3">收件信箱</TableHead>
              <TableHead class="px-5 py-3">備註</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="log in logs" :key="log._id">
              <TableCell class="px-5 py-3 text-sm tabular-nums text-ink-700 dark:text-zinc-300">{{ formatDateTime(log.createdAt) }}</TableCell>
              <TableCell class="px-5 py-3">
                <Badge :class="DELIVERY_EVENT_META[log.event]?.class" class="rounded-full px-3 py-1 text-xs font-medium">{{ DELIVERY_EVENT_META[log.event]?.label || log.event }}</Badge>
              </TableCell>
              <TableCell class="px-5 py-3">
                <span class="block text-sm text-ink-900 dark:text-zinc-100">{{ log.petName || '寵物未記錄' }}<span class="ml-2 text-xs text-ink-400 dark:text-zinc-500">{{ log.ownerName }}</span></span>
                <span class="flex items-center gap-1.5 text-xs text-ink-400 dark:text-zinc-500">
                  <!-- 報告還在就給連結；已刪除的直接標明，連過去只會是 404。 -->
                  <router-link v-if="log.recordExists" :to="`/records/${log.recordId}/preview`" class="tabular-nums underline hover:text-belle-600 dark:hover:text-brand-400">{{ log.reportNumber || '—' }}</router-link>
                  <template v-else>
                    <span class="tabular-nums">{{ log.reportNumber || '—' }}</span>
                    <span class="inline-flex items-center gap-1 rounded-full bg-cream-200 px-1.5 py-0.5 text-ink-500 dark:bg-zinc-800 dark:text-zinc-400">
                      <Trash2 class="h-3 w-3" stroke-width="1.75" />報告已刪除
                    </span>
                  </template>
                </span>
              </TableCell>
              <TableCell class="px-5 py-3">
                <span class="flex items-center gap-1.5 text-sm text-ink-700 dark:text-zinc-300">
                  <Mail class="h-3.5 w-3.5 shrink-0 text-ink-400 dark:text-zinc-500" stroke-width="1.75" />{{ log.recipient || '—' }}
                </span>
              </TableCell>
              <TableCell class="px-5 py-3">
                <span v-if="log.error" class="flex items-start gap-1 text-xs text-red-700 dark:text-red-300">
                  <AlertTriangle class="mt-0.5 h-3 w-3 shrink-0" stroke-width="1.75" /><span class="min-w-0">{{ log.error }}</span>
                </span>
                <span v-else-if="log.messageId" class="block truncate text-xs text-ink-400 dark:text-zinc-500" :title="log.messageId">{{ log.messageId }}</span>
                <span v-else class="text-xs text-ink-400 dark:text-zinc-500">—</span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      <!-- 手機：卡片 -->
      <div class="space-y-3 lg:hidden">
        <Card v-for="log in logs" :key="log._id" class="gap-2 border-cream-300 p-4 shadow-sm dark:border-zinc-800 dark:shadow-none">
          <div class="flex items-start justify-between gap-3">
            <Badge :class="DELIVERY_EVENT_META[log.event]?.class" class="rounded-full px-3 py-1 text-xs font-medium">{{ DELIVERY_EVENT_META[log.event]?.label || log.event }}</Badge>
            <span class="text-xs tabular-nums text-ink-400 dark:text-zinc-500">{{ formatDateTime(log.createdAt) }}</span>
          </div>
          <p class="text-sm text-ink-900 dark:text-zinc-100">{{ log.petName || '寵物未記錄' }}<span class="ml-2 text-xs text-ink-400 dark:text-zinc-500">{{ log.ownerName }}</span></p>
          <p class="flex flex-wrap items-center gap-1.5 text-xs text-ink-400 dark:text-zinc-500">
            <router-link v-if="log.recordExists" :to="`/records/${log.recordId}/preview`" class="tabular-nums underline">{{ log.reportNumber || '—' }}</router-link>
            <template v-else>
              <span class="tabular-nums">{{ log.reportNumber || '—' }}</span>
              <span class="inline-flex items-center gap-1 rounded-full bg-cream-200 px-1.5 py-0.5 dark:bg-zinc-800"><Trash2 class="h-3 w-3" stroke-width="1.75" />報告已刪除</span>
            </template>
          </p>
          <p class="flex items-center gap-1.5 text-sm text-ink-700 dark:text-zinc-300">
            <Mail class="h-3.5 w-3.5 shrink-0 text-ink-400 dark:text-zinc-500" stroke-width="1.75" />{{ log.recipient || '—' }}
          </p>
          <p v-if="log.error" class="flex items-start gap-1 text-xs text-red-700 dark:text-red-300">
            <AlertTriangle class="mt-0.5 h-3 w-3 shrink-0" stroke-width="1.75" /><span class="min-w-0">{{ log.error }}</span>
          </p>
        </Card>
      </div>

      <div v-if="totalPages > 1" class="flex items-center justify-between gap-3">
        <p class="text-xs text-ink-400 dark:text-zinc-500">共 {{ total }} 筆・第 {{ currentPage }} / {{ totalPages }} 頁</p>
        <div class="flex gap-2">
          <Button type="button" variant="outline" size="sm" class="min-h-11" :disabled="currentPage <= 1" @click="goToPage(currentPage - 1)">上一頁</Button>
          <Button type="button" variant="outline" size="sm" class="min-h-11" :disabled="currentPage >= totalPages" @click="goToPage(currentPage + 1)">下一頁</Button>
        </div>
      </div>
    </template>
  </section>
</template>
