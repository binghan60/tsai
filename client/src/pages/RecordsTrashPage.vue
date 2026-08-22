<script setup>
import { computed, ref, watch } from 'vue';
import { ArchiveRestore, FileText, Undo2 } from '@lucide/vue';
import { http } from '../api/http';
import { formatDate, formatDateTime } from '../lib/datetime';
import { useSearchQueryParam } from '../composables/useSearchQueryParam';
import { useToast } from '../composables/useToast';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EmptyState from '../components/EmptyState.vue';
import ListSkeleton from '../components/ListSkeleton.vue';

const toast = useToast();
const page = useSearchQueryParam('page', '1');
const items = ref([]);
const total = ref(0);
const limit = ref(25);
const loading = ref(false);
const error = ref('');
const restoreTarget = ref(null);
const restoringId = ref(null);
let requestSequence = 0;

const currentPage = computed(() => Number(page.value) || 1);
const totalPages = computed(() => Math.max(Math.ceil(total.value / limit.value), 1));

async function fetchTrash() {
  const currentRequest = ++requestSequence;
  loading.value = true;
  error.value = '';
  try {
    const { data } = await http.get('/records/trash', { params: { page: currentPage.value } });
    if (currentRequest !== requestSequence) return;
    items.value = data.items ?? [];
    total.value = data.total ?? 0;
    limit.value = data.limit ?? 25;
    if (!items.value.length && total.value > 0 && currentPage.value > data.totalPages) {
      page.value = String(data.totalPages);
    }
  } catch (err) {
    if (currentRequest === requestSequence) error.value = err.response?.data?.message ?? '回收站暫時無法載入';
  } finally {
    if (currentRequest === requestSequence) loading.value = false;
  }
}

async function restoreRecord() {
  const target = restoreTarget.value;
  if (!target) return;
  restoringId.value = target._id;
  error.value = '';
  try {
    const { data } = await http.post(`/records/trash/${target._id}/restore`);
    restoreTarget.value = null;
    toast.success(`已還原病歷「${data.reportNumber || target.reportNumber || ''}」`, '還原成功');
    await fetchTrash();
  } catch (err) {
    error.value = err.response?.data?.message ?? '病歷還原失敗';
    toast.error(error.value, '還原失敗');
  } finally {
    restoringId.value = null;
  }
}

function goToPage(next) {
  const target = Math.min(Math.max(next, 1), totalPages.value);
  if (target !== currentPage.value) page.value = String(target);
}

watch(page, fetchTrash, { immediate: true });
</script>

<template>
  <section class="mx-auto max-w-5xl space-y-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-foreground">病歷回收站</h1>
        <p class="mt-1 text-sm text-muted-foreground">保留刪除時間與完整病歷快照；原寵物仍存在時可以還原。</p>
      </div>
      <Button as-child variant="outline"><router-link to="/records">返回健檢紀錄</router-link></Button>
    </div>

    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
    <ListSkeleton v-if="loading && !items.length" :rows="5" />

    <div v-else-if="items.length" class="space-y-3">
      <Card v-for="item in items" :key="item._id" class="flex-row flex-wrap items-center justify-between gap-4 p-4 shadow-sm dark:shadow-none">
        <div class="flex min-w-0 items-start gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <FileText class="h-5 w-5" stroke-width="1.75" />
          </span>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium text-foreground">{{ item.petName || '寵物資料未保留' }}</span>
              <Badge variant="outline">{{ item.status === 'draft' ? '草稿' : '已結案' }}</Badge>
            </div>
            <p class="mt-1 text-sm text-muted-foreground">
              {{ item.examType || '健檢' }} · {{ formatDate(item.visitDate, '日期未填') }}
              <template v-if="item.reportNumber"> · {{ item.reportNumber }}</template>
            </p>
            <p class="mt-1 text-xs text-muted-foreground">刪除於 {{ formatDateTime(item.deletedAt) }}</p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" :disabled="Boolean(restoringId)" @click="restoreTarget = item">
          <Undo2 class="h-4 w-4" />{{ restoringId === item._id ? '還原中…' : '還原' }}
        </Button>
      </Card>
    </div>

    <EmptyState v-else :icon="ArchiveRestore" title="回收站目前是空的" description="刪除的健檢草稿與報告會保留稽核快照。" />

    <div v-if="totalPages > 1" class="flex items-center justify-between gap-3">
      <p class="text-xs tabular-nums text-muted-foreground">共 {{ total }} 筆・第 {{ currentPage }} / {{ totalPages }} 頁</p>
      <div class="flex gap-2">
        <Button type="button" variant="outline" size="sm" :disabled="currentPage <= 1" @click="goToPage(currentPage - 1)">上一頁</Button>
        <Button type="button" variant="outline" size="sm" :disabled="currentPage >= totalPages" @click="goToPage(currentPage + 1)">下一頁</Button>
      </div>
    </div>

    <ConfirmDialog
      :open="Boolean(restoreTarget)"
      title="還原病歷"
      :description="`確定要還原「${restoreTarget?.petName || restoreTarget?.reportNumber || '這份病歷'}」嗎？還原後會重新出現在寵物的健檢紀錄中。`"
      confirm-label="還原"
      :destructive="false"
      :loading="Boolean(restoringId)"
      @update:open="(value) => !value && (restoreTarget = null)"
      @confirm="restoreRecord"
    />
  </section>
</template>
