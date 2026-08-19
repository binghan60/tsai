<script setup>
import { onMounted, ref } from 'vue';
import { ArchiveRestore, Recycle, Trash2 } from '@lucide/vue';
import { http } from '../api/http';
import { formatDateTime } from '../lib/datetime';
import { DELIVERY_STATUS_META, RECORD_STATUS_META } from '../lib/recordStatus';
import { useToast } from '../composables/useToast';
import SettingsLayout from '../components/SettingsLayout.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';

const toast = useToast();
const entries = ref([]);
const loading = ref(true);
const error = ref('');
const busyId = ref('');
const entryToPurge = ref(null);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const { data } = await http.get('/trash');
    entries.value = data;
  } catch {
    error.value = '回收桶暫時無法載入，請稍後重試';
  } finally {
    loading.value = false;
  }
}

function petLabel(entry) {
  return entry.petId?.name || '寵物已刪除';
}
function ownerLabel(entry) {
  return entry.petId?.ownerId?.name || '';
}

async function restore(entry) {
  busyId.value = entry._id;
  try {
    await http.post(`/trash/${entry._id}/restore`);
    entries.value = entries.value.filter((item) => item._id !== entry._id);
    toast.success(`已還原「${petLabel(entry)}」的健檢報告`, '還原成功');
  } catch (err) {
    toast.error(err.response?.data?.message ?? '還原失敗，請稍後再試', '還原失敗');
  } finally {
    busyId.value = '';
  }
}

async function purge() {
  const target = entryToPurge.value;
  if (!target) return;
  busyId.value = target._id;
  try {
    await http.delete(`/trash/${target._id}`);
    entries.value = entries.value.filter((item) => item._id !== target._id);
    entryToPurge.value = null;
    toast.success('已從回收桶永久清除', '清除成功');
  } catch (err) {
    entryToPurge.value = null;
    toast.error(err.response?.data?.message ?? '清除失敗，請稍後再試', '清除失敗');
  } finally {
    busyId.value = '';
  }
}

onMounted(load);
</script>

<template>
  <SettingsLayout title="回收桶" description="已刪除的健檢報告會先留在這裡，可以還原或永久清除。">
    <p v-if="error" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">{{ error }}</p>
    <p v-if="loading" class="text-sm text-ink-500 dark:text-zinc-400" role="status">載入回收桶…</p>

    <template v-else-if="entries.length">
      <!-- 桌機：與健檢表單列表同一套表格版式 -->
      <Card class="hidden gap-0 overflow-hidden border-cream-300 py-0 shadow-sm dark:border-zinc-800 md:block">
        <Table>
          <TableHeader>
            <TableRow class="border-cream-300 text-ink-500 dark:border-zinc-800 dark:text-zinc-400">
              <TableHead class="px-5 py-3 font-medium">寵物／飼主</TableHead>
              <TableHead class="px-5 py-3 font-medium">報告編號</TableHead>
              <TableHead class="px-5 py-3 font-medium">刪除前狀態</TableHead>
              <TableHead class="px-5 py-3 font-medium">刪除時間</TableHead>
              <TableHead class="px-5 py-3 text-right font-medium">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="entry in entries" :key="entry._id" class="border-cream-200 dark:border-zinc-800 dark:hover:bg-zinc-800/40">
              <TableCell class="px-5 py-3">
                <span class="block font-medium text-ink-900 dark:text-white">{{ petLabel(entry) }}</span>
                <span v-if="ownerLabel(entry)" class="text-xs text-ink-400 dark:text-zinc-500">{{ ownerLabel(entry) }}</span>
              </TableCell>
              <TableCell class="px-5 py-3 font-mono text-xs text-ink-600 dark:text-zinc-300">{{ entry.reportNumber || '未建立報告編號' }}</TableCell>
              <TableCell class="px-5 py-3">
                <div class="flex flex-wrap gap-1.5">
                  <Badge :class="RECORD_STATUS_META[entry.status]?.class" class="rounded-full px-2.5 py-0.5 text-xs font-medium">{{ RECORD_STATUS_META[entry.status]?.label ?? entry.status }}</Badge>
                  <Badge v-if="entry.status !== 'draft'" :class="DELIVERY_STATUS_META[entry.deliveryStatus]?.class" class="rounded-full px-2.5 py-0.5 text-xs font-medium">{{ DELIVERY_STATUS_META[entry.deliveryStatus]?.label }}</Badge>
                </div>
              </TableCell>
              <TableCell class="px-5 py-3 text-xs text-ink-500 dark:text-zinc-400">{{ formatDateTime(entry.deletedAt) }}</TableCell>
              <TableCell class="px-5 py-3">
                <div class="flex justify-end gap-1">
                  <Button type="button" variant="outline" size="sm" class="min-h-10" :disabled="Boolean(busyId)" @click="restore(entry)">
                    <ArchiveRestore class="h-4 w-4" stroke-width="1.75" />{{ busyId === entry._id ? '處理中…' : '還原' }}
                  </Button>
                  <Button type="button" variant="ghost" size="icon" class="h-10 w-10 text-red-700 dark:text-red-300" :disabled="Boolean(busyId)" :aria-label="`永久刪除「${petLabel(entry)}」的這筆刪除紀錄`" @click="entryToPurge = entry">
                    <Trash2 class="h-4 w-4" stroke-width="1.75" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      <!-- 手機：表格擠不下，改回一筆一張卡 -->
      <div class="space-y-3 md:hidden">
        <Card v-for="entry in entries" :key="entry._id" class="gap-3 border-cream-300 p-4 shadow-sm dark:border-zinc-800">
          <div class="min-w-0">
            <span class="block font-semibold text-ink-900 dark:text-white">{{ petLabel(entry) }}</span>
            <span class="mt-0.5 block text-xs text-ink-400 dark:text-zinc-500">
              <template v-if="ownerLabel(entry)">{{ ownerLabel(entry) }} · </template>{{ entry.reportNumber || '未建立報告編號' }}
            </span>
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            <Badge :class="RECORD_STATUS_META[entry.status]?.class" class="rounded-full px-2.5 py-0.5 text-xs font-medium">{{ RECORD_STATUS_META[entry.status]?.label ?? entry.status }}</Badge>
            <Badge v-if="entry.status !== 'draft'" :class="DELIVERY_STATUS_META[entry.deliveryStatus]?.class" class="rounded-full px-2.5 py-0.5 text-xs font-medium">{{ DELIVERY_STATUS_META[entry.deliveryStatus]?.label }}</Badge>
            <span class="ml-auto text-xs text-ink-400 dark:text-zinc-500">刪除於 {{ formatDateTime(entry.deletedAt) }}</span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" class="min-h-10" :disabled="Boolean(busyId)" @click="restore(entry)">
              <ArchiveRestore class="h-4 w-4" stroke-width="1.75" />{{ busyId === entry._id ? '處理中…' : '還原' }}
            </Button>
            <Button type="button" variant="ghost" size="sm" class="ml-auto min-h-10 text-red-700 dark:text-red-300" :disabled="Boolean(busyId)" @click="entryToPurge = entry">
              <Trash2 class="h-4 w-4" stroke-width="1.75" />永久刪除
            </Button>
          </div>
        </Card>
      </div>
    </template>

    <div v-else-if="!loading" class="rounded-2xl border border-dashed border-cream-300 px-5 py-14 text-center dark:border-zinc-800">
      <Recycle class="mx-auto mb-3 h-8 w-8 text-ink-400 dark:text-zinc-500" stroke-width="1.75" />
      <p class="font-medium text-ink-700 dark:text-zinc-200">回收桶是空的</p>
      <p class="mt-1 text-sm text-ink-500 dark:text-zinc-400">刪除健檢報告後會先留在這裡，方便需要時還原。</p>
    </div>

    <ConfirmDialog
      :open="Boolean(entryToPurge)"
      title="永久刪除這筆紀錄"
      :description="`「${petLabel(entryToPurge ?? {})}」的這份刪除紀錄將從回收桶永久移除，之後無法再還原。`"
      confirm-label="永久刪除"
      :loading="Boolean(busyId)"
      @update:open="(value) => !value && (entryToPurge = null)"
      @confirm="purge"
    />
  </SettingsLayout>
</template>
