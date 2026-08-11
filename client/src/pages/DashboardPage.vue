<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { ArrowRight, ClipboardPlus, FileText, PawPrint, Pencil, Phone, Search, User, Users } from '@lucide/vue';
import { http } from '../api/http';
import { RECORD_STATUS_META } from '../lib/recordStatus';

const loading = ref(true);
const error = ref('');
const dashboard = ref(null);
const query = ref('');
const searching = ref(false);
const searchError = ref('');
const results = ref({ owners: [], pets: [] });

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
]);

const statusSegments = computed(() => {
  const values = dashboard.value?.statusBreakdown ?? { draft: 0, generated: 0, sent: 0 };
  const total = Math.max(values.draft + values.generated + values.sent, 1);
  return [
    { key: 'draft', label: '草稿', value: values.draft, width: (values.draft / total) * 100, class: 'bg-zinc-500' },
    { key: 'generated', label: '已完成', value: values.generated, width: (values.generated / total) * 100, class: 'bg-belle-600 dark:bg-brand-500' },
    { key: 'sent', label: '已寄送', value: values.sent, width: (values.sent / total) * 100, class: 'bg-emerald-600' },
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

onMounted(fetchDashboard);
</script>

<template>
  <section class="mx-auto max-w-7xl space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div><h1 class="text-xl font-semibold text-ink-900 dark:text-white">健檢工作台</h1><p class="mt-1 text-sm text-ink-500 dark:text-zinc-400">快速找到寵物、繼續草稿或建立新的健檢紀錄。</p></div>
      <div class="flex flex-wrap gap-2"><router-link to="/owners?create=1" class="inline-flex min-h-11 items-center rounded-xl border border-cream-300 bg-cream-50 px-4 text-sm font-medium text-ink-700 hover:border-belle-300 hover:text-belle-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:text-brand-400">+ 新增飼主</router-link><router-link to="/pets?intent=new-record" class="inline-flex min-h-11 items-center gap-2 rounded-xl bg-belle-600 px-4 text-sm font-medium text-white hover:bg-belle-700 dark:bg-brand-500 dark:hover:bg-brand-600"><ClipboardPlus class="h-4 w-4" />新增健檢</router-link></div>
    </div>

    <div class="relative rounded-2xl border border-cream-300 bg-cream-50 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none sm:p-5">
      <label for="global-search" class="mb-2 block text-xs font-medium text-ink-500 dark:text-zinc-400">快速搜尋</label>
      <div class="relative"><Search class="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-400 dark:text-zinc-400" /><input id="global-search" v-model="query" type="search" autocomplete="off" placeholder="搜尋寵物、飼主、電話、病歷號或晶片號" class="w-full rounded-xl border border-cream-300 bg-white py-3.5 pl-12 pr-4 text-sm text-ink-900 placeholder:text-ink-400 focus:border-belle-500 focus:outline-none focus:ring-2 focus:ring-belle-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:ring-brand-500/20" /></div>
      <p v-if="searching" class="mt-2 text-xs text-ink-400 dark:text-zinc-400" role="status">搜尋中…</p>
      <p v-else-if="searchError" class="mt-2 text-xs text-red-700 dark:text-red-300">{{ searchError }}</p>

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
    </div>

    <p v-if="error" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">{{ error }}</p>
    <p v-else-if="loading" class="text-sm text-ink-500 dark:text-zinc-400" role="status">載入工作台…</p>

    <template v-else>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div v-for="stat in stats" :key="stat.label" class="rounded-2xl border bg-cream-50 p-4 shadow-sm dark:bg-zinc-900 dark:shadow-none" :class="stat.emphasis && stat.value ? 'border-belle-300 dark:border-brand-500/50' : 'border-cream-300 dark:border-zinc-800'"><div class="flex h-9 w-9 items-center justify-center rounded-xl bg-belle-50 text-belle-600 dark:bg-brand-500/10 dark:text-brand-400"><component :is="stat.icon" class="h-4.5 w-4.5" /></div><div class="mt-3 text-xl font-semibold text-ink-900 dark:text-white">{{ stat.value }}</div><div class="mt-0.5 text-xs text-ink-500 dark:text-zinc-400">{{ stat.label }}</div></div>
      </div>

      <div class="grid gap-4 xl:grid-cols-2">
        <section class="overflow-hidden rounded-2xl border border-cream-300 bg-cream-50 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div class="flex items-center justify-between border-b border-cream-300 px-5 py-4 dark:border-zinc-800"><div><h2 class="text-sm font-semibold text-ink-900 dark:text-white">繼續填寫草稿</h2><p class="mt-0.5 text-xs text-ink-400 dark:text-zinc-400">依最後更新時間排序</p></div><Pencil class="h-5 w-5 text-ink-400 dark:text-zinc-400" /></div>
          <div v-if="dashboard.draftRecords?.length" class="divide-y divide-cream-200 dark:divide-zinc-800"><router-link v-for="item in dashboard.draftRecords" :key="item._id" :to="`/records/${item._id}/edit`" class="flex min-h-16 items-center justify-between gap-3 px-5 py-3 hover:bg-cream-100 dark:hover:bg-zinc-800/50"><span class="min-w-0"><span class="block truncate text-sm font-medium text-ink-900 dark:text-white">{{ item.petId?.name || '寵物未找到' }}<span class="ml-2 font-normal text-ink-500 dark:text-zinc-400">{{ item.petId?.ownerId?.name }}</span></span><span class="block text-xs text-ink-400 dark:text-zinc-400">{{ formatDate(item.visitDate) }} · 更新 {{ formatDateTime(item.updatedAt) }}</span></span><span class="shrink-0 text-sm font-medium text-belle-600 dark:text-brand-400">繼續填寫</span></router-link></div>
          <div v-else class="px-5 py-10 text-center"><Check class="mx-auto h-7 w-7 text-emerald-600" /><p class="mt-2 text-sm text-ink-500 dark:text-zinc-400">目前沒有待完成草稿</p></div>
        </section>

        <section class="overflow-hidden rounded-2xl border border-cream-300 bg-cream-50 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div class="flex items-center justify-between border-b border-cream-300 px-5 py-4 dark:border-zinc-800"><div><h2 class="text-sm font-semibold text-ink-900 dark:text-white">最近健檢紀錄</h2><p class="mt-0.5 text-xs text-ink-400 dark:text-zinc-400">快速回到最近處理的寵物</p></div><FileText class="h-5 w-5 text-ink-400 dark:text-zinc-400" /></div>
          <div v-if="dashboard.recentRecords?.length" class="divide-y divide-cream-200 dark:divide-zinc-800"><router-link v-for="item in dashboard.recentRecords" :key="item._id" :to="`/records/${item._id}/preview`" class="flex min-h-16 items-center justify-between gap-3 px-5 py-3 hover:bg-cream-100 dark:hover:bg-zinc-800/50"><span class="min-w-0"><span class="block truncate text-sm font-medium text-ink-900 dark:text-white">{{ item.petId?.name || '寵物未找到' }}<span class="ml-2 font-normal text-ink-500 dark:text-zinc-400">{{ item.petId?.ownerId?.name }}</span></span><span class="block text-xs text-ink-400 dark:text-zinc-400">{{ formatDate(item.visitDate) }} · {{ item.vet || '獸醫師未填' }}</span></span><span class="shrink-0 rounded-full px-3 py-1 text-xs font-medium" :class="RECORD_STATUS_META[item.status]?.class">{{ RECORD_STATUS_META[item.status]?.label }}</span></router-link></div>
          <div v-else class="px-5 py-10 text-center"><PawPrint class="mx-auto h-7 w-7 text-ink-400 dark:text-zinc-500" /><p class="mt-2 text-sm text-ink-500 dark:text-zinc-400">目前沒有健檢紀錄</p></div>
        </section>
      </div>

      <section class="rounded-2xl border border-cream-300 bg-cream-50 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"><div class="mb-3 flex items-center justify-between"><h2 class="text-sm font-semibold text-ink-900 dark:text-white">報告狀態</h2><span class="text-xs text-ink-400 dark:text-zinc-400">流程概況</span></div><div class="flex h-3 overflow-hidden rounded-full bg-cream-200 dark:bg-zinc-800"><div v-for="segment in statusSegments" :key="segment.key" :class="segment.class" :style="{ width: `${segment.width}%` }"></div></div><div class="mt-4 flex flex-wrap gap-x-6 gap-y-2"><span v-for="segment in statusSegments" :key="segment.key" class="text-sm text-ink-600 dark:text-zinc-300">{{ segment.label }} <strong>{{ segment.value }}</strong></span></div></section>
    </template>
  </section>
</template>
