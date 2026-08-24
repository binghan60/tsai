<script setup>
import { computed, ref, watch } from 'vue';
import { FileX2, Search, X } from '@lucide/vue';
import { http } from '../api/http';
import { formatDate as formatClinicDate, formatDateTime } from '../lib/datetime';
import { DELIVERY_STATUS_META, RECORD_STATUS_META } from '../lib/recordStatus';
import { useSearchQueryParam } from '../composables/useSearchQueryParam';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Input } from '../components/ui/input';
import { DatePicker } from '../components/ui/date-picker';
import EmptyState from '../components/EmptyState.vue';
import ListSkeleton from '../components/ListSkeleton.vue';

// 這頁回答的問題是「那份報告去哪了」。報告本身已經不存在，所以這裡的每一欄都來自
// 刪除當下抄下來的快照，不是 populate 出來的——被刪掉的那些正是最需要回溯的。
const page = useSearchQueryParam('page', '1');
const query = useSearchQueryParam('q');
const dateFrom = useSearchQueryParam('from');
const dateTo = useSearchQueryParam('to');

const entries = ref([]);
const total = ref(0);
const limit = ref(25);
const loading = ref(false);
const error = ref('');
const detail = ref(null);
const detailLoading = ref(false);

let requestSequence = 0;

const currentPage = computed(() => Math.max(Number.parseInt(page.value, 10) || 1, 1));
const totalPages = computed(() => Math.max(Math.ceil(total.value / limit.value), 1));

async function fetchEntries() {
  const currentRequest = ++requestSequence;
  loading.value = true;
  error.value = '';
  try {
    const { data } = await http.get('/deleted-records', {
      params: {
        page: currentPage.value,
        q: query.value || undefined,
        from: dateFrom.value || undefined,
        to: dateTo.value || undefined,
      },
    });
    if (currentRequest !== requestSequence) return;
    entries.value = data.items ?? [];
    total.value = data.total ?? 0;
    limit.value = data.limit ?? 25;
  } catch (err) {
    if (currentRequest !== requestSequence) return;
    error.value = '刪除紀錄暫時無法載入，請稍後重試';
  } finally {
    if (currentRequest === requestSequence) loading.value = false;
  }
}

async function openDetail(entry) {
  if (detailLoading.value) return;
  detailLoading.value = true;
  try {
    const { data } = await http.get(`/deleted-records/${entry._id}`);
    detail.value = data;
  } catch (err) {
    error.value = '無法載入這筆刪除紀錄的完整內容';
  } finally {
    detailLoading.value = false;
  }
}

function applyFilters() {
  page.value = '1';
  fetchEntries();
}

function clearFilters() {
  query.value = '';
  dateFrom.value = '';
  dateTo.value = '';
  applyFilters();
}

function goToPage(next) {
  const target = Math.min(Math.max(next, 1), totalPages.value);
  if (target === currentPage.value) return;
  page.value = String(target);
}

function statusMeta(entry) {
  if (entry.status === 'draft') return RECORD_STATUS_META.draft;
  return DELIVERY_STATUS_META[entry.deliveryStatus || 'not_sent'] ?? DELIVERY_STATUS_META.not_sent;
}

function formatDate(value) {
  return formatClinicDate(value, '日期未填');
}

// 快照裡的 sections 是結案時凍結的完整表單，這裡只挑出有作答的項目攤平顯示——
// 稽核要看的是「當時寫了什麼」，不是重新渲染一份報告。
const detailAnswers = computed(() => {
  const sections = detail.value?.snapshot?.sections ?? [];
  return sections
    .map((section) => ({
      title: section.title ?? section.label ?? '未命名區塊',
      items: (section.items ?? []).filter((item) => {
        if (item.type === 'finding') return item.status && item.status !== 'not_checked';
        if (item.type === 'lab') return (item.status && item.status !== 'not_checked') || String(item.value ?? '').trim();
        return String(item.value ?? '').trim();
      }),
    }))
    .filter((section) => section.items.length);
});

function answerText(item) {
  if (item.type === 'finding') return item.status === 'abnormal' ? `異常${item.note ? `：${item.note}` : ''}` : '正常';
  if (item.type === 'lab') {
    const value = String(item.value ?? '').trim();
    const status = item.status === 'abnormal' ? '異常' : item.status === 'normal' ? '正常' : '';
    return [value, status, item.note].filter(Boolean).join(' · ');
  }
  return String(item.value ?? '');
}

watch(page, fetchEntries, { immediate: true });
</script>

<template>
  <section class="mx-auto max-w-7xl space-y-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-foreground">已刪除的報告</h1>
        <p class="mt-1 text-sm text-muted-foreground">報告刪除時留下的稽核快照，用來回溯「那份報告去哪了」。</p>
      </div>
      <Button as-child variant="outline" size="sm">
        <router-link to="/records">回健檢紀錄</router-link>
      </Button>
    </div>

    <form class="grid gap-3 rounded-xl border border-border bg-card p-3 shadow-sm sm:grid-cols-[minmax(220px,1fr)_170px_170px_auto_auto]" @submit.prevent="applyFilters">
      <label class="space-y-1 text-xs font-medium text-muted-foreground">
        <span>關鍵字</span>
        <span class="relative block">
          <Search class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id="deleted-search" v-model="query" type="search" class="pl-10" placeholder="寵物、飼主、獸醫師或報告編號" aria-label="搜尋刪除紀錄" />
        </span>
      </label>
      <label class="space-y-1 text-xs font-medium text-muted-foreground"><span>起始刪除日</span><DatePicker v-model="dateFrom" aria-label="起始刪除日" /></label>
      <label class="space-y-1 text-xs font-medium text-muted-foreground"><span>結束刪除日</span><DatePicker v-model="dateTo" aria-label="結束刪除日" /></label>
      <Button type="submit" size="sm" class="self-end"><Search class="h-4 w-4" stroke-width="1.75" />搜尋</Button>
      <Button type="button" variant="outline" size="sm" class="self-end" :disabled="!query && !dateFrom && !dateTo" @click="clearFilters"><X class="h-4 w-4" />清除</Button>
    </form>

    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>

    <ListSkeleton v-if="loading" :rows="6" />

    <Card v-else-if="!entries.length">
      <EmptyState inset :icon="FileX2" title="沒有刪除紀錄" description="目前沒有符合條件的已刪除報告。" />
    </Card>

    <template v-else>
      <!-- 桌機：表格 -->
      <Card class="hidden overflow-hidden p-0 shadow-sm xl:block dark:shadow-none">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>寵物 / 飼主</TableHead>
              <TableHead>報告編號</TableHead>
              <TableHead>看診日</TableHead>
              <TableHead>刪除時的狀態</TableHead>
              <TableHead>刪除時間</TableHead>
              <TableHead class="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="entry in entries" :key="entry._id">
              <TableCell>
                <span class="block truncate text-sm font-medium text-foreground">{{ entry.petName || '寵物未記錄' }}</span>
                <span class="block truncate text-xs text-muted-foreground">{{ entry.ownerName || '飼主未記錄' }}</span>
              </TableCell>
              <TableCell class="text-sm tabular-nums text-foreground">
                {{ entry.reportNumber || '—' }}
                <span v-if="entry.reportVersion > 1" class="ml-1 text-xs text-muted-foreground">第 {{ entry.reportVersion }} 版</span>
              </TableCell>
              <TableCell class="text-sm tabular-nums text-foreground">{{ formatDate(entry.visitDate) }}</TableCell>
              <TableCell>
                <Badge variant="status" :class="statusMeta(entry).class">{{ statusMeta(entry).label }}</Badge>
              </TableCell>
              <TableCell class="text-sm tabular-nums text-muted-foreground">{{ formatDateTime(entry.deletedAt) }}</TableCell>
              <TableCell class="text-right">
                <Button type="button" variant="outline" size="sm" :disabled="detailLoading" @click="openDetail(entry)">查看內容</Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      <!-- 手機：卡片 -->
      <div class="space-y-3 xl:hidden">
        <Card v-for="entry in entries" :key="entry._id" class="gap-2 p-4 shadow-sm dark:shadow-none">
          <div class="flex items-start justify-between gap-3">
            <span class="min-w-0">
              <span class="block truncate text-sm font-medium text-foreground">{{ entry.petName || '寵物未記錄' }}</span>
              <span class="block truncate text-xs text-muted-foreground">{{ entry.ownerName || '飼主未記錄' }}</span>
            </span>
            <Badge variant="status" :class="statusMeta(entry).class" class="shrink-0">{{ statusMeta(entry).label }}</Badge>
          </div>
          <p class="text-xs text-muted-foreground">
            {{ entry.reportNumber || '無編號' }} · 看診日 {{ formatDate(entry.visitDate) }}
          </p>
          <p class="text-xs tabular-nums text-muted-foreground">刪除於 {{ formatDateTime(entry.deletedAt) }}</p>
          <Button type="button" variant="outline" size="sm" class="w-full" :disabled="detailLoading" @click="openDetail(entry)">查看內容</Button>
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

    <!-- 快照內容就地展開，不換路由：這是稽核用的一次性查看，不需要自己的網址。 -->
    <Card v-if="detail" class="p-5 shadow-sm dark:shadow-none">
      <div class="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div class="min-w-0">
          <h2 class="text-base font-semibold text-foreground">{{ detail.petName || '寵物未記錄' }} · {{ detail.reportNumber || '無編號' }}</h2>
          <p class="mt-0.5 text-xs text-muted-foreground">
            看診日 {{ formatDate(detail.visitDate) }} · {{ detail.vet || '獸醫師未填' }} · 刪除於 {{ formatDateTime(detail.deletedAt) }}
          </p>
        </div>
        <Button type="button" variant="destructive" size="sm" @click="detail = null"><X class="h-4 w-4" />關閉</Button>
      </div>

      <div v-if="detailAnswers.length" class="mt-4 space-y-4">
        <section v-for="section in detailAnswers" :key="section.title">
          <h3 class="text-sm font-semibold text-foreground">{{ section.title }}</h3>
          <dl class="mt-2 divide-y divide-border border-t border-border">
            <div v-for="item in section.items" :key="item.key" class="flex flex-wrap gap-x-4 gap-y-1 py-2">
              <dt class="w-40 shrink-0 text-xs text-muted-foreground">{{ item.label }}</dt>
              <dd class="min-w-0 flex-1 text-sm whitespace-pre-wrap text-foreground">{{ answerText(item) }}</dd>
            </div>
          </dl>
        </section>
      </div>
      <p v-else class="mt-4 text-sm text-muted-foreground">這份報告刪除時還沒有凍結表單內容（多半是草稿）。</p>
    </Card>
  </section>
</template>
