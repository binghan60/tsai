<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Cat, Plus } from '@lucide/vue';
import { http } from '../api/http';
import DataCard from '../components/DataCard.vue';
import { Button } from '../components/ui/button';
import FilterBar from '../components/FilterBar.vue';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import ListFooter from '../components/ListFooter.vue';
import PetSex from '../components/PetSex.vue';
import PetLine from '../components/PetLine.vue';
import ReminderTags from '../components/ReminderTags.vue';
import RowActions from '../components/RowActions.vue';
import { usePinnedPetsStore } from '../stores/pinnedPets';
import { useStaffIdentity } from '../composables/useStaffIdentity';
import { useToast } from '../composables/useToast';
import { Alert, AlertDescription } from '../components/ui/alert';
import ListSkeleton from '../components/ListSkeleton.vue';
import { useSearchQueryParam } from '../composables/useSearchQueryParam';
import { formatDate, relativeDayLabel } from '../lib/datetime';

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
    if (currentRequest === requestSequence) error.value = '貓咪資料暫時無法載入，請稍後重試';
  } finally {
    if (currentRequest === requestSequence) loading.value = false;
  }
}

const pinned = usePinnedPetsStore();
const { identity } = useStaffIdentity();
const toast = useToast();

// 列上的次要操作：病歷速覽（右側暫存區面板推入）、加入／移出暫存區。
function rowActions(pet) {
  return [
    { key: 'quick-view', label: '病歷速覽' },
    { key: 'pin', label: pinned.isPinned(pet._id) ? '移出暫存區' : '加入暫存區' },
  ];
}
async function rowAction(key, pet) {
  if (key === 'quick-view') return pinned.openQuickView(pet._id);
  try {
    if (pinned.isPinned(pet._id)) await pinned.unpin(pet._id);
    else await pinned.pin(pet._id, identity.value);
  } catch (err) {
    toast.error(err.response?.data?.message || '暫存區更新失敗，請稍後再試');
  }
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

function goToPage(next) {
  const target = Math.min(Math.max(next, 1), totalPages.value);
  if (target !== currentPage.value) page.value = String(target);
}

</script>

<template>
  <section class="flex flex-col gap-5">
    <PageHeader title="貓咪">
      <template #actions>
        <Button as-child><router-link to="/pets/new"><Plus stroke-width="1.75" />新增貓咪</router-link></Button>
      </template>
    </PageHeader>

    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>

    <DataCard title="貓咪清單" :count="loading && !total ? null : total" style="--data-columns: minmax(12rem, 2fr) minmax(8rem, 1.3fr) 5.5rem minmax(10rem, 1.5fr) 8.5rem minmax(9rem, 1.3fr) 12rem">
      <template #filters>
        <FilterBar id="pet-list-search" v-model="query" label="搜尋貓咪" placeholder="名字、飼主、電話" class="w-full min-w-0 md:w-[26rem]" @submit="applyFilters" />
      </template>
      <ListSkeleton v-if="loading" :rows="6" avatar inset />
      <EmptyState v-else-if="pets.length === 0" :icon="Cat" :title="query ? '找不到符合條件的貓咪' : '還沒有貓咪資料'" :description="query ? '換個關鍵字試試，或按「新增貓咪」建檔。' : '按右上角「新增貓咪」建立第一筆。'" inset />
      <template v-else>
        <!-- 桌機：一列一隻，欄位對齊。 -->
        <div class="hidden xl:block">
          <div class="desktop-data-header">
            <span>貓咪</span><span>品種</span><span>性別</span><span>飼主</span><span>最近紀錄</span><span>提醒</span><span></span>
          </div>
          <div v-for="pet in pets" :key="pet._id" class="desktop-data-row hover:bg-hover">
            <router-link :to="`/pets/${pet._id}`" class="desktop-data-cell flex items-center gap-3">
              <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground"><Cat class="size-5" stroke-width="1.75" /></span>
              <span class="min-w-0 truncate font-semibold text-primary">{{ pet.name }}</span>
            </router-link>
            <span class="desktop-data-cell truncate text-sm text-muted-foreground" :title="pet.breed || ''">{{ pet.breed || '—' }}</span>
            <span class="desktop-data-cell text-sm text-muted-foreground"><PetSex v-if="pet.sex === 'male' || pet.sex === 'female'" :sex="pet.sex" with-label /><template v-else>—</template></span>
            <span class="desktop-data-cell">
              <span class="block truncate text-sm">{{ pet.ownerId?.name || '—' }}</span>
              <span v-if="pet.ownerId?.phone" class="num block truncate text-xs text-subtle-foreground">{{ pet.ownerId.phone }}</span>
            </span>
            <span class="desktop-data-cell">
              <template v-if="pet.lastEntryAt">
                <span class="num block text-sm">{{ formatDate(pet.lastEntryAt) }}</span>
                <span class="block text-xs text-subtle-foreground">{{ relativeDayLabel(pet.lastEntryAt) }}</span>
              </template>
              <span v-else class="text-sm text-subtle-foreground">尚無紀錄</span>
            </span>
            <span class="desktop-data-cell"><ReminderTags :pet="pet" /></span>
            <span class="desktop-data-cell flex items-center justify-end gap-1">
              <Button as-child variant="secondary" size="sm"><router-link :to="`/pets/${pet._id}/records/new`">新增健檢</router-link></Button>
              <RowActions :actions="rowActions(pet)" :label="`${pet.name}的更多操作`" @select="(key) => rowAction(key, pet)" />
            </span>
          </div>
        </div>

        <!-- 窄螢幕：一隻一張小卡。 -->
        <ul class="divide-y divide-border xl:hidden">
          <li v-for="pet in pets" :key="pet._id" class="space-y-2 px-4 py-3">
            <router-link :to="`/pets/${pet._id}`" class="flex items-center gap-3">
              <span class="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground"><Cat class="size-5" stroke-width="1.75" /></span>
              <span class="min-w-0 flex-1">
                <span class="flex items-baseline gap-2"><span class="truncate font-semibold text-primary">{{ pet.name }}</span><PetLine :pet="pet" /></span>
                <span class="flex gap-3 text-sm text-muted-foreground"><span class="truncate">{{ pet.ownerId?.name }}</span><span v-if="pet.ownerId?.phone" class="num shrink-0">{{ pet.ownerId.phone }}</span></span>
              </span>
            </router-link>
            <div class="flex items-center gap-2">
              <ReminderTags :pet="pet" class="min-w-0 flex-1" />
              <Button as-child variant="secondary" size="sm" class="ml-auto shrink-0"><router-link :to="`/pets/${pet._id}/records/new`">新增健檢</router-link></Button>
            </div>
          </li>
        </ul>

      </template>
      <template v-if="!loading && pets.length" #footer>
        <ListFooter :page="currentPage" :total-pages="totalPages" :total="total" :page-size="limit" @update:page="goToPage" />
      </template>
    </DataCard>
  </section>
</template>
