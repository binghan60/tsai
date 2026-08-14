<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowRight, Check, ClipboardPlus, FileText, PawPrint, Pencil, Phone, Trash2, User, Users } from '@lucide/vue';
import { http } from '../api/http';
import { DELIVERY_STATUS_META, RECORD_STATUS_META, getDeliveryStatus } from '../lib/recordStatus';
import SearchPanel from '../components/SearchPanel.vue';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import ConfirmDialog from '../components/ConfirmDialog.vue';

const loading = ref(true);
const route = useRoute();
const error = ref('');
const dashboard = ref(null);
const query = ref('');
const searching = ref(false);
const searchError = ref('');
const results = ref({ owners: [], pets: [] });
const deletingDraftId = ref('');
const draftToDiscard = ref(null);

async function fetchDashboard() {
  loading.value = true;
  error.value = '';
  try {
    const { data } = await http.get('/dashboard');
    dashboard.value = data;
  } catch (err) {
    error.value = '工作台資料暫時無法載入，請稍後重試';
  } finally {
    loading.value = false;
  }
}

const stats = computed(() => [
  { label: '飼主', value: dashboard.value?.ownerCount ?? '—', icon: Users },
  { label: '寵物', value: dashboard.value?.petCount ?? '—', icon: PawPrint },
  { label: '本月健檢', value: dashboard.value?.monthlyReportCount ?? '—', icon: FileText },
  { label: '待完成草稿', value: dashboard.value?.draftCount ?? '—', icon: Pencil, emphasis: true },
  { label: '待寄送報告', value: dashboard.value?.finalizedPendingCount ?? '—', icon: FileText, emphasis: true },
]);

const statusSegments = computed(() => {
  const values = { draft: 0, finalized: 0, sending: 0, sent: 0, failed: 0, ...(dashboard.value?.statusBreakdown ?? {}) };
  const total = Math.max(values.draft + values.finalized + values.sending + values.sent + values.failed, 1);
  return [
    { key: 'draft', label: '草稿', value: values.draft, width: (values.draft / total) * 100, class: 'bg-zinc-500' },
    { key: 'finalized', label: '已結案待寄送', value: values.finalized, width: (values.finalized / total) * 100, class: 'bg-brand-500' },
    { key: 'sending', label: '寄送中', value: values.sending, width: (values.sending / total) * 100, class: 'bg-sky-500' },
    { key: 'sent', label: '已寄送', value: values.sent, width: (values.sent / total) * 100, class: 'bg-emerald-600' },
    { key: 'failed', label: '寄送失敗', value: values.failed, width: (values.failed / total) * 100, class: 'bg-red-600' },
  ];
});

async function searchAll() {
  const value = query.value.trim();
  if (!value) {
    results.value = { owners: [], pets: [] };
    return;
  }
  searching.value = true;
  searchError.value = '';
  try {
    const { data } = await http.get('/search', { params: { q: value } });
    results.value = data;
  } catch (err) {
    searchError.value = '搜尋暫時無法使用';
  } finally {
    searching.value = false;
  }
}

async function discardDraft(item) {
  if (deletingDraftId.value) return;
  deletingDraftId.value = item._id;
  error.value = '';
  try {
    await http.delete(`/records/${item._id}`);
    draftToDiscard.value = null;
    await fetchDashboard();
  } catch (err) {
    error.value = '捨棄草稿失敗，請稍後再試';
  } finally {
    deletingDraftId.value = '';
  }
}

function openDiscardDraft(item) {
  if (deletingDraftId.value) return;
  draftToDiscard.value = item;
}

let searchTimer;
watch(query, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(searchAll, 250);
});

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString('zh-TW') : '日期未填';
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
}

function recordLink(item) {
  return item.status === 'draft' ? `/records/${item._id}/edit` : `/records/${item._id}/preview`;
}

onMounted(async () => {
  await fetchDashboard();
  if (route.query.focus === 'search') {
    await nextTick();
    document.getElementById('global-search')?.focus();
  }
});
</script>

<template>
  <section class="mx-auto max-w-7xl space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div><h1 class="text-xl font-semibold text-ink-900 dark:text-white">健檢工作台</h1><p class="mt-1 text-sm text-ink-500 dark:text-zinc-400">快速找到寵物、繼續草稿或建立新的健檢紀錄。</p></div>
      <div class="flex flex-wrap gap-2"><Button as-child variant="outline"><router-link to="/owners?create=1">+ 新增飼主</router-link></Button><Button as-child><router-link to="/pets?intent=new-record"><ClipboardPlus class="h-4 w-4" />新增健檢</router-link></Button></div>
    </div>

    <SearchPanel id="global-search" v-model="query" label="快速搜尋" placeholder="搜尋寵物、飼主、電話、病歷號或晶片號" :loading="searching" :error="searchError">
      <div v-if="query.trim() && !searching" class="mt-3 grid gap-3 lg:grid-cols-2">
        <div class="overflow-hidden rounded-xl border border-cream-300 dark:border-zinc-700">
          <p class="border-b border-cream-300 px-4 py-2 text-xs font-semibold text-ink-500 dark:border-zinc-700 dark:text-zinc-400">寵物</p>
          <router-link v-for="pet in results.pets" :key="pet._id" :to="`/pets/${pet._id}`" class="flex min-h-14 items-center justify-between gap-3 border-b border-cream-200 px-4 py-2 last:border-0 hover:bg-cream-100 dark:border-zinc-800 dark:hover:bg-zinc-800"><span class="flex min-w-0 items-center gap-3"><PawPrint class="h-5 w-5 shrink-0 text-belle-600 dark:text-brand-400" /><span class="min-w-0"><span class="block truncate text-sm font-medium text-ink-900 dark:text-white">{{ pet.name }}</span><span class="block truncate text-xs text-ink-400 dark:text-zinc-400">{{ pet.medicalRecordNumber || '病歷號未建立' }} · 飼主 {{ pet.ownerId?.name || '—' }}</span></span></span><ArrowRight class="h-4 w-4 shrink-0 text-ink-400 dark:text-zinc-500" /></router-link>
          <p v-if="results.pets.length === 0" class="px-4 py-4 text-sm text-ink-500 dark:text-zinc-400">找不到寵物</p>
        </div>
        <div class="overflow-hidden rounded-xl border border-cream-300 dark:border-zinc-700">
          <p class="border-b border-cream-300 px-4 py-2 text-xs font-semibold text-ink-500 dark:border-zinc-700 dark:text-zinc-400">飼主</p>
          <router-link v-for="owner in results.owners" :key="owner._id" :to="`/owners/${owner._id}`" class="flex min-h-14 items-center justify-between gap-3 border-b border-cream-200 px-4 py-2 last:border-0 hover:bg-cream-100 dark:border-zinc-800 dark:hover:bg-zinc-800"><span class="flex min-w-0 items-center gap-3"><User class="h-5 w-5 shrink-0 text-belle-600 dark:text-brand-400" /><span class="min-w-0"><span class="block truncate text-sm font-medium text-ink-900 dark:text-white">{{ owner.name }}</span><span class="flex items-center gap-1 text-xs text-ink-400 dark:text-zinc-400"><Phone class="h-3 w-3" />{{ owner.phone }}</span></span></span><ArrowRight class="h-4 w-4 shrink-0 text-ink-400 dark:text-zinc-500" /></router-link>
          <p v-if="results.owners.length === 0" class="px-4 py-4 text-sm text-ink-500 dark:text-zinc-400">找不到飼主</p>
        </div>
      </div>
    </SearchPanel>

    <p v-if="error" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">{{ error }}</p>
    <p v-else-if="loading" class="text-sm text-ink-500 dark:text-zinc-400" role="status">載入工作台…</p>

    <template v-else>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card v-for="stat in stats" :key="stat.label" class="flex-row items-center gap-3 border p-4 shadow-sm dark:shadow-none" :class="stat.emphasis && stat.value ? 'border-belle-300 dark:border-brand-500/50' : 'border-cream-300 dark:border-zinc-800'">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-belle-50 text-belle-600 dark:bg-brand-500/10 dark:text-brand-400"><component :is="stat.icon" class="h-5 w-5" /></div>
          <div class="min-w-0">
            <div class="text-xl font-semibold text-ink-900 dark:text-white">{{ stat.value }}</div>
            <div class="text-xs text-ink-500 dark:text-zinc-400">{{ stat.label }}</div>
          </div>
        </Card>
      </div>

      <div class="grid gap-4 xl:grid-cols-2">
        <Card class="gap-0 overflow-hidden border-cream-300 py-0 shadow-sm dark:border-zinc-800">
          <CardHeader class="flex-row items-center justify-between gap-3 border-b border-cream-300 px-5 py-4 dark:border-zinc-800">
            <div><CardTitle class="text-sm">繼續填寫草稿</CardTitle><CardDescription class="mt-0.5 text-xs">依最後更新時間排序</CardDescription></div>
            <Pencil class="h-5 w-5 text-ink-400 dark:text-zinc-400" />
          </CardHeader>
          <CardContent class="p-0">
            <div v-if="dashboard.draftRecords?.length" class="divide-y divide-cream-200 dark:divide-zinc-800">
              <div v-for="item in dashboard.draftRecords" :key="item._id" class="flex min-h-16 items-center justify-between gap-3 px-5 py-3 hover:bg-cream-100 dark:hover:bg-zinc-800/50">
                <router-link :to="`/records/${item._id}/edit`" class="flex min-w-0 flex-1 items-center justify-between gap-3">
                  <span class="min-w-0"><span class="block truncate text-sm font-medium text-ink-900 dark:text-white">{{ item.petId?.name || '寵物未找到' }}<span class="ml-2 font-normal text-ink-500 dark:text-zinc-400">{{ item.petId?.ownerId?.name }}</span></span><span class="block text-xs text-ink-400 dark:text-zinc-400">{{ formatDate(item.visitDate) }} · 更新 {{ formatDateTime(item.updatedAt) }}</span></span>
                  <span class="shrink-0 text-sm font-medium text-belle-600 dark:text-brand-400">繼續填寫</span>
                </router-link>
                <Button type="button" variant="destructive" size="icon" class="h-11 w-11 shrink-0" :disabled="deletingDraftId === item._id" :aria-label="`捨棄 ${item.petId?.name || '草稿'}`" title="捨棄草稿" @click="openDiscardDraft(item)">
                  <Trash2 class="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div v-else class="px-5 py-10 text-center"><Check class="mx-auto h-7 w-7 text-emerald-600" /><p class="mt-2 text-sm text-ink-500 dark:text-zinc-400">目前沒有待完成草稿</p></div>
          </CardContent>
        </Card>

        <Card class="gap-0 overflow-hidden border-cream-300 py-0 shadow-sm dark:border-zinc-800">
          <CardHeader class="flex-row items-center justify-between gap-3 border-b border-cream-300 px-5 py-4 dark:border-zinc-800">
            <div><CardTitle class="text-sm">最近健檢紀錄</CardTitle><CardDescription class="mt-0.5 text-xs">快速回到最近處理的寵物</CardDescription></div>
            <FileText class="h-5 w-5 text-ink-400 dark:text-zinc-400" />
          </CardHeader>
          <CardContent class="p-0">
            <div v-if="dashboard.recentRecords?.length" class="divide-y divide-cream-200 dark:divide-zinc-800">
              <div v-for="item in dashboard.recentRecords" :key="item._id" class="flex min-h-16 items-center justify-between gap-3 px-5 py-3 hover:bg-cream-100 dark:hover:bg-zinc-800/50">
                <router-link :to="recordLink(item)" class="flex min-w-0 flex-1 items-center justify-between gap-3">
                  <span class="min-w-0"><span class="block truncate text-sm font-medium text-ink-900 dark:text-white">{{ item.petId?.name || '寵物未找到' }}<span class="ml-2 font-normal text-ink-500 dark:text-zinc-400">{{ item.petId?.ownerId?.name }}</span></span><span class="block text-xs text-ink-400 dark:text-zinc-400">{{ formatDate(item.visitDate) }} · {{ item.vet || '獸醫師未填' }}</span></span>
                  <span class="flex shrink-0 flex-wrap justify-end gap-1.5"><Badge :class="RECORD_STATUS_META[item.status]?.class" class="rounded-full px-3 py-1 text-xs font-medium">{{ RECORD_STATUS_META[item.status]?.label }}</Badge><Badge v-if="item.status !== 'draft'" :class="DELIVERY_STATUS_META[getDeliveryStatus(item)]?.class" class="rounded-full px-3 py-1 text-xs font-medium">{{ DELIVERY_STATUS_META[getDeliveryStatus(item)]?.label }}</Badge></span>
                </router-link>
                <Button v-if="item.status === 'draft'" type="button" variant="destructive" size="icon" class="h-11 w-11 shrink-0" :disabled="deletingDraftId === item._id" :aria-label="`捨棄 ${item.petId?.name || '草稿'}`" title="捨棄草稿" @click="openDiscardDraft(item)">
                  <Trash2 class="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div v-else class="px-5 py-10 text-center"><PawPrint class="mx-auto h-7 w-7 text-ink-400 dark:text-zinc-500" /><p class="mt-2 text-sm text-ink-500 dark:text-zinc-400">目前沒有健檢紀錄</p></div>
          </CardContent>
        </Card>
      </div>

      <Card class="border-cream-300 p-5 shadow-sm dark:border-zinc-800">
        <div class="mb-3 flex items-center justify-between"><CardTitle class="text-sm">報告狀態</CardTitle><span class="text-xs text-ink-400 dark:text-zinc-400">流程概況</span></div>
        <div class="flex h-3 overflow-hidden rounded-full bg-cream-200 dark:bg-zinc-800"><div v-for="segment in statusSegments" :key="segment.key" :class="segment.class" :style="{ width: `${segment.width}%` }"></div></div>
        <div class="mt-4 flex flex-wrap gap-x-6 gap-y-2"><span v-for="segment in statusSegments" :key="segment.key" class="text-sm text-ink-600 dark:text-zinc-300">{{ segment.label }} <strong>{{ segment.value }}</strong></span></div>
      </Card>

      <ConfirmDialog
        :open="Boolean(draftToDiscard)"
        title="捨棄草稿"
        :description="`確定要捨棄 ${draftToDiscard?.petId?.name || '這份'} 的草稿嗎？此操作無法復原。`"
        confirm-label="捨棄草稿"
        :loading="Boolean(deletingDraftId)"
        @update:open="(value) => !value && (draftToDiscard = null)"
        @confirm="discardDraft(draftToDiscard)"
      />
    </template>
  </section>
</template>
