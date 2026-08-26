<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Cat, ClipboardPlus, User } from '@lucide/vue';
import { http } from '../api/http';
import OwnerPickerDialog from '../components/OwnerPickerDialog.vue';
import PetFormDialog from '../components/PetFormDialog.vue';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import FilterBar from '../components/FilterBar.vue';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import Pagination from '../components/Pagination.vue';
import { Alert, AlertDescription } from '../components/ui/alert';
import ListSkeleton from '../components/ListSkeleton.vue';
import { useSearchQueryParam } from '../composables/useSearchQueryParam';
import { emptyPetDraft } from '../lib/formDrafts';

const pets = ref([]);
const page = useSearchQueryParam('page', '1');
const query = useSearchQueryParam('q');
const total = ref(0);
const limit = ref(10);
const loading = ref(false);
const error = ref('');
const ownerPickerOpen = ref(false);
const petOwner = ref(null);
const petCreating = ref(false);
const petCreateError = ref('');
const petDraft = ref(emptyPetDraft());
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
  return { male: '公', female: '母', unknown: '性別未記錄' }[sex] ?? '性別未記錄';
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

function openCreatePet() {
  ownerPickerOpen.value = true;
}

function selectOwner(owner) {
  ownerPickerOpen.value = false;
  petCreateError.value = '';
  petOwner.value = owner;
}

async function createPet(values) {
  if (!petOwner.value || petCreating.value) return;
  petCreating.value = true;
  petCreateError.value = '';
  try {
    await http.post(`/owners/${petOwner.value._id}/pets`, values);
    petOwner.value = null;
    petDraft.value = emptyPetDraft();
    await fetchPets();
  } catch (err) {
    petCreateError.value = err.response?.data?.message ?? '新增寵物失敗，請稍後再試。';
  } finally {
    petCreating.value = false;
  }
}
</script>

<template>
  <section class="mx-auto max-w-7xl space-y-5">
    <PageHeader title="寵物資料" description="先確認寵物與飼主身分，再建立就診紀錄。">
      <template #actions>
        <FilterBar id="pet-list-search" v-model="query" label="搜尋寵物" placeholder="搜尋寵物、飼主或電話" class="w-full min-w-0 md:w-96 xl:w-[28rem]" @submit="applyFilters" />
        <Button type="button" @click="openCreatePet">+ 新增寵物</Button>
      </template>
    </PageHeader>

    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
    <ListSkeleton v-else-if="loading" :rows="5" />

    <template v-else>
      <Card v-if="pets.length" class="hidden overflow-hidden p-0 shadow-sm dark:shadow-none xl:block" style="--data-columns: minmax(16rem, 1.2fr) minmax(14rem, 1fr) 9rem">
        <div class="desktop-data-header">
          <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">寵物</span>
          <span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">飼主</span>
          <span class="desktop-data-cell"></span>
        </div>
        <div v-for="pet in pets" :key="pet._id" class="desktop-data-row">
          <router-link :to="`/pets/${pet._id}`" class="desktop-data-cell flex items-center gap-3">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <Cat class="h-4 w-4" stroke-width="1.75" />
            </span>
            <span class="min-w-0 truncate text-sm font-semibold text-primary" :title="`${pet.name} · ${pet.species || '寵物'}${pet.breed ? ` · ${pet.breed}` : ''} · ${sexLabel(pet.sex)}`">
              {{ pet.name }}<span class="font-normal text-muted-foreground"> · {{ pet.species || '寵物' }}<template v-if="pet.breed"> · {{ pet.breed }}</template> · {{ sexLabel(pet.sex) }}</span>
            </span>
          </router-link>
          <span class="desktop-data-cell">
            <router-link v-if="pet.ownerId" :to="`/owners/${pet.ownerId._id}`" class="flex min-w-0 items-center gap-2 text-primary" :title="`${pet.ownerId.name} · ${pet.ownerId.phone || '未填電話'}`">
              <User class="h-4 w-4 shrink-0 text-muted-foreground" stroke-width="1.75" />
              <span class="min-w-0 truncate text-sm">{{ pet.ownerId.name }}<span class="text-xs text-muted-foreground"> · {{ pet.ownerId.phone || '未填電話' }}</span></span>
            </router-link>
          </span>
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
              <span class="block text-sm text-muted-foreground">{{ pet.species || '寵物' }}<template v-if="pet.breed"> · {{ pet.breed }}</template> · {{ sexLabel(pet.sex) }}</span>
            </span>
          </router-link>
          <div class="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
            <span class="min-w-0 text-sm text-foreground">飼主：{{ pet.ownerId?.name || '—' }}</span>
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
  <OwnerPickerDialog :open="ownerPickerOpen" @close="ownerPickerOpen = false" @select="selectOwner" />
  <PetFormDialog
    v-if="petOwner"
    title="新增寵物"
    submit-label="新增寵物"
    :initial-value="petDraft"
    :submitting="petCreating"
    :error-message="petCreateError"
    @submit="createPet"
    @update:draft="petDraft = $event"
    @close="petOwner = null"
  />
</template>
