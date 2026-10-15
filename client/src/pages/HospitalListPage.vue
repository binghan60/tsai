<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { BedDouble } from '@lucide/vue';
import { http } from '../api/http';
import { clinicDateInput, clinicTimeInput, elapsedLabel, shortDate } from '../lib/datetime';
import { stayDays } from '../lib/hospitalization';
import { useSearchQueryParam } from '../composables/useSearchQueryParam';
import { usePagedList } from '../composables/usePagedList';
import PageHeader from '../components/PageHeader.vue';
import DataCard from '../components/DataCard.vue';
import FilterTabs from '../components/FilterTabs.vue';
import EmptyState from '../components/EmptyState.vue';
import ListFooter from '../components/ListFooter.vue';
import ListSkeleton from '../components/ListSkeleton.vue';
import PatientLink from '../components/PatientLink.vue';
import StrayBadge from '../components/StrayBadge.vue';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';

// 住院清單：住院中（全部，依入院時間）／已出院（依出院時間新到舊、分頁）。整列點了到住院專區；
// 住院中的列上一顆「新增紀錄」，直接到住院專區新增一筆照護紀錄。
const TABS = [
  { key: 'admitted', label: '住院中' },
  { key: 'discharged', label: '已出院' },
];

const tab = useSearchQueryParam('tab', 'admitted');
const counts = ref({});
const now = ref(new Date());

const { items, total, limit, loading, error, page, totalPages, goToPage, applyFilters } = usePagedList({
  liveEvents: ['hospitalization:updated', 'patients:updated'],
  errorMessage: '住院清單暫時無法載入，請稍後重試',
  fetch: async ({ page: current }) => (await http.get('/hospitalizations', { params: { status: tab.value === 'discharged' ? 'discharged' : 'admitted', page: current } })).data,
  onData: (data) => {
    counts.value = data.counts ?? {};
    now.value = new Date();
  },
});
watch(tab, applyFilters);
// 經過時間每分鐘跟著走（清單整天開著）。
let clock = null;
onMounted(() => { clock = setInterval(() => { now.value = new Date(); }, 60_000); });
onBeforeUnmount(() => clearInterval(clock));

const detailLink = (item) => `/hospital/${item._id}`;

// 最後一筆紀錄：今天的寫時刻＋經過多久，更早的寫日期與時刻。
function lastEntry(item) {
  if (!item.lastEntryAt) return null;
  const today = clinicDateInput(item.lastEntryAt) === clinicDateInput(now.value);
  return { time: today ? clinicTimeInput(item.lastEntryAt) : `${shortDate(item.lastEntryAt)} ${clinicTimeInput(item.lastEntryAt)}`, ago: today ? elapsedLabel(item.lastEntryAt, now.value).text : '' };
}

function stayText(item) {
  if (item.status === 'discharged') return `${stayDays(item.admittedAt, item.dischargedAt) ?? ''} 天`;
  return item.dayNumber ? `第 ${item.dayNumber} 天` : '';
}

const weightText = (item) => (item.todayWeightKg === null || item.todayWeightKg === undefined ? '' : `${item.todayWeightKg} kg`);
</script>

<template>
  <section class="flex flex-col gap-5">
    <PageHeader title="住院" />

    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>

    <DataCard title="住院清單" :count="loading && !total ? null : total" style="--data-columns: minmax(14rem, 2fr) minmax(7rem, 1fr) minmax(5rem, 0.7fr) minmax(5.5rem, 0.7fr) minmax(6rem, 0.7fr) minmax(8rem, 1fr) 8rem">
      <template #tabs>
        <FilterTabs v-model="tab" :items="TABS" :counts="counts" aria-label="住院中或已出院" />
      </template>
      <ListSkeleton v-if="loading && !items.length" :rows="4" inset />
      <EmptyState v-else-if="!items.length" :icon="BedDouble" :title="tab === 'discharged' ? '沒有已出院的住院紀錄' : '目前沒有住院中的貓咪'" inset />
      <template v-else>
        <!-- 桌機：整列是一個連結（蓋在列上的 router-link），名字、飼主、按鈕浮在它上面各自可點。 -->
        <div class="hidden xl:block">
          <div class="desktop-data-header">
            <span>貓咪</span><span>飼主</span><span>入院</span><span>住院</span><span>今天體重</span><span>最後一筆紀錄</span><span></span>
          </div>
          <div v-for="item in items" :key="item._id" class="desktop-data-row relative hover:bg-hover">
            <router-link :to="detailLink(item)" class="absolute inset-0" :aria-label="`${item.pet?.name ?? ''}的住院紀錄`" />
            <span class="desktop-data-cell pointer-events-none flex min-w-0 items-center gap-2.5">
              <PatientLink :pet-id="item.petId" class="pointer-events-auto relative shrink-0 font-semibold">{{ item.pet?.name }}</PatientLink>
              <StrayBadge v-if="item.pet?.isStray" />
              <span class="min-w-0 truncate text-sm text-muted-foreground">{{ item.reason }}</span>
            </span>
            <span class="desktop-data-cell pointer-events-none truncate text-sm"><PatientLink v-if="item.pet?.ownerName" :pet-id="item.petId" quiet class="pointer-events-auto relative">{{ item.pet.ownerName }}</PatientLink></span>
            <span class="desktop-data-cell num pointer-events-none text-sm">{{ shortDate(item.admittedAt) }}</span>
            <span class="desktop-data-cell pointer-events-none text-sm">
              <span class="block">{{ stayText(item) }}</span>
              <span v-if="item.status === 'discharged'" class="num block text-xs text-subtle-foreground">{{ shortDate(item.dischargedAt) }} 出院</span>
            </span>
            <span class="desktop-data-cell num pointer-events-none text-sm">{{ weightText(item) }}</span>
            <span class="desktop-data-cell pointer-events-none flex items-baseline gap-3 text-sm">
              <template v-if="lastEntry(item)"><span class="num">{{ lastEntry(item).time }}</span><span class="text-subtle-foreground">{{ lastEntry(item).ago }}</span></template>
            </span>
            <span class="desktop-data-cell pointer-events-none flex justify-end">
              <Button v-if="item.status === 'admitted'" as-child variant="soft" size="sm" class="pointer-events-auto relative"><router-link :to="`${detailLink(item)}?new=1`">新增紀錄</router-link></Button>
            </span>
          </div>
        </div>

        <!-- 窄螢幕：一筆一張小卡。 -->
        <ul class="divide-y divide-border xl:hidden">
          <li v-for="item in items" :key="item._id" class="relative space-y-1.5 px-4 py-3 hover:bg-hover">
            <router-link :to="detailLink(item)" class="absolute inset-0" :aria-label="`${item.pet?.name ?? ''}的住院紀錄`" />
            <div class="pointer-events-none flex items-center gap-2">
              <PatientLink :pet-id="item.petId" class="pointer-events-auto relative font-semibold">{{ item.pet?.name }}</PatientLink>
              <StrayBadge v-if="item.pet?.isStray" />
              <span class="text-sm">{{ stayText(item) }}</span>
              <Button v-if="item.status === 'admitted'" as-child variant="soft" size="sm" class="pointer-events-auto relative ml-auto"><router-link :to="`${detailLink(item)}?new=1`">新增紀錄</router-link></Button>
            </div>
            <p v-if="item.reason" class="pointer-events-none truncate text-sm text-muted-foreground">{{ item.reason }}</p>
            <p class="pointer-events-none flex flex-wrap gap-x-4 text-sm text-muted-foreground">
              <span v-if="item.pet?.ownerName">{{ item.pet.ownerName }}</span>
              <span class="num">{{ shortDate(item.admittedAt) }} 入院</span>
              <span v-if="item.status === 'discharged'" class="num">{{ shortDate(item.dischargedAt) }} 出院</span>
              <span v-if="weightText(item)" class="num">{{ weightText(item) }}</span>
              <span v-if="lastEntry(item)"><span class="num">{{ lastEntry(item).time }}</span> {{ lastEntry(item).ago }}</span>
            </p>
          </li>
        </ul>
      </template>
      <template v-if="items.length" #footer>
        <ListFooter :page="page" :total-pages="totalPages" :total="total" :page-size="limit" @update:page="goToPage" />
      </template>
    </DataCard>
  </section>
</template>
