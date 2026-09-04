<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Cat, ClipboardPlus, User } from '@lucide/vue';
import { http } from '../api/http';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import FilterBar from '../components/FilterBar.vue';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import Pagination from '../components/Pagination.vue';
import { Alert, AlertDescription } from '../components/ui/alert';
import ListSkeleton from '../components/ListSkeleton.vue';
import { useSearchQueryParam } from '../composables/useSearchQueryParam';
import { formatDateTime } from '../lib/datetime';

const pets = ref([]);
const page = useSearchQueryParam('page', '1');
const query = useSearchQueryParam('q');
const total = ref(0);
const limit = ref(10);
const loading = ref(false);
const error = ref('');
let requestSequence = 0;

async function fetchPets() {
  const currentRequest = ++requestSequence;
  loading.value = true;
  error.value = '';
  try {
    const { data } = await http.get('/pets', {
      params: {
        page: Number(page.value) || 1,
        ...(query.value.trim() ? { q: query.value.trim() } : {}),
      },
    });
    if (currentRequest === requestSequence) {
      pets.value = data.items ?? [];
      total.value = data.total ?? 0;
      limit.value = data.limit ?? 10;
      if (!pets.value.length && total.value > 0 && currentPage.value > data.totalPages) {
        page.value = String(data.totalPages);
      }
    }
  } catch (err) {
    if (currentRequest === requestSequence) error.value = '寵物資料暫時無法載入，請稍後重試';
  } finally {
    if (currentRequest === requestSequence) loading.value = false;
  }
}

function sexLabel(sex) {
  return { male: '公', female: '母' }[sex] ?? '';
}

// 關鍵字選好、按下搜尋才查——邊打邊查在每個系統打字習慣不一樣的情況下容易誤觸，
// 全站搜尋一律走提交式，不做即時。
function applyFilters() {
  if (page.value !== '1') page.value = '1';
  else fetchPets();
}

watch(page, fetchPets, { immediate: true });

onBeforeUnmount(() => {
  requestSequence += 1;
});

const currentPage = computed(() => Number(page.value) || 1);
const totalPages = computed(() => Math.max(Math.ceil(total.value / limit.value), 1));

const createdAtOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
};

function goToPage(next) {
  const target = Math.min(Math.max(next, 1), totalPages.value);
  if (target !== currentPage.value) page.value = String(target);
}

</script>

<template>
  <section class="mx-auto max-w-7xl space-y-5">
    <PageHeader title="寵物資料" description="先確認寵物與飼主身分，再建立就診紀錄。">
      <template #actions>
        <FilterBar id="pet-list-search" v-model="query" label="搜尋寵物" placeholder="搜尋寵物、飼主或電話" class="w-full min-w-0 md:w-96 xl:w-[28rem]" @submit="applyFilters" />
        <Button as-child><router-link to="/pets/new">+ 新增寵物</router-link></Button>
      </template>
    </PageHeader>

    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
    <ListSkeleton v-else-if="loading" :rows="5" />

    <template v-else>
      <Card v-if="pets.length" class="hidden overflow-hidden p-0 shadow-sm dark:shadow-none xl:block" style="--data-columns: minmax(9rem, 1fr) minmax(8rem, 0.9fr) 6rem minmax(11rem, 1fr) 10.5rem 9rem">
        <div class="desktop-data-header">
          <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">寵物</span>
          <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">品種</span>
          <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">性別</span>
          <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">飼主</span>
          <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">新增時間</span>
          <span class="desktop-data-cell"></span>
        </div>
        <div v-for="pet in pets" :key="pet._id" class="desktop-data-row">
          <router-link :to="`/pets/${pet._id}`" class="desktop-data-cell flex items-center gap-3">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <Cat class="h-4 w-4" stroke-width="1.75" />
            </span>
            <span class="min-w-0 truncate text-sm font-semibold text-primary">{{ pet.name }}</span>
          </router-link>
          <span class="desktop-data-cell truncate text-sm text-foreground" :title="pet.breed || ''">{{ pet.breed || '' }}</span>
          <span class="desktop-data-cell text-sm text-foreground">{{ sexLabel(pet.sex) }}</span>
          <span class="desktop-data-cell">
            <span v-if="pet.ownerId" class="flex min-w-0 items-center gap-2 text-foreground" :title="pet.ownerId.phone ? `${pet.ownerId.name} · ${pet.ownerId.phone}` : pet.ownerId.name">
              <User class="h-4 w-4 shrink-0 text-muted-foreground" stroke-width="1.75" />
              <span class="min-w-0 truncate text-sm">{{ pet.ownerId.name }}<span v-if="pet.ownerId.phone" class="text-xs text-muted-foreground"> · {{ pet.ownerId.phone }}</span></span>
            </span>
          </span>
          <span class="desktop-data-cell whitespace-nowrap text-xs tabular-nums text-muted-foreground">{{ formatDateTime(pet.createdAt, createdAtOptions) }}</span>
          <span class="desktop-data-cell text-right">
            <Button as-child size="sm"><router-link :to="`/pets/${pet._id}/records/new`">
              <ClipboardPlus class="h-4 w-4" />新增健檢
            </router-link></Button>
          </span>
        </div>
      </Card>

      <div v-if="pets.length" class="space-y-3 xl:hidden">
        <Card v-for="pet in pets" :key="pet._id" class="p-4 shadow-sm dark:shadow-none">
          <router-link :to="`/pets/${pet._id}`" class="flex items-start gap-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground"><Cat class="h-5 w-5" /></span>
            <span class="min-w-0 flex-1">
              <span class="block text-base font-semibold text-primary">{{ pet.name }}</span>
            </span>
          </router-link>
          <dl class="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3 text-sm sm:grid-cols-3">
            <div class="rounded-lg bg-muted/35 px-3 py-2"><dt class="text-xs text-muted-foreground">品種</dt><dd class="mt-0.5 truncate text-foreground">{{ pet.breed || '' }}</dd></div>
            <div class="rounded-lg bg-muted/35 px-3 py-2"><dt class="text-xs text-muted-foreground">性別</dt><dd class="mt-0.5 text-foreground">{{ sexLabel(pet.sex) }}</dd></div>
            <div class="rounded-lg bg-muted/35 px-3 py-2"><dt class="text-xs text-muted-foreground">飼主</dt><dd class="mt-0.5 truncate text-foreground">{{ pet.ownerId?.name || '' }}</dd></div>
            <div class="rounded-lg bg-muted/35 px-3 py-2"><dt class="text-xs text-muted-foreground">新增時間</dt><dd class="mt-0.5 whitespace-nowrap text-xs tabular-nums text-foreground">{{ formatDateTime(pet.createdAt, createdAtOptions) }}</dd></div>
          </dl>
          <div class="mt-3 flex justify-end">
            <Button as-child size="sm" class="shrink-0"><router-link :to="`/pets/${pet._id}/records/new`">
              <ClipboardPlus class="h-4 w-4" />新增健檢
            </router-link></Button>
          </div>
        </Card>
      </div>

      <EmptyState v-if="pets.length === 0" :icon="Cat" :title="query ? '找不到符合條件的寵物' : '尚未建立寵物資料'" />

      <Pagination :page="currentPage" :total-pages="totalPages" @update:page="goToPage" />
    </template>
  </section>
</template>
