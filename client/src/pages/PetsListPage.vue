<script setup>
import { computed, ref, watch } from 'vue';
import { Cat, ClipboardPlus, User } from '@lucide/vue';
import { http } from '../api/http';
import OwnerPickerDialog from '../components/OwnerPickerDialog.vue';
import PetFormDialog from '../components/PetFormDialog.vue';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import EmptyState from '../components/EmptyState.vue';
import { Alert, AlertDescription } from '../components/ui/alert';
import ListSkeleton from '../components/ListSkeleton.vue';
import { useSearchQueryParam } from '../composables/useSearchQueryParam';

const pets = ref([]);
const page = useSearchQueryParam('page', '1');
const total = ref(0);
const limit = ref(25);
const loading = ref(false);
const error = ref('');
const ownerPickerOpen = ref(false);
const petOwner = ref(null);
const petCreating = ref(false);
const petCreateError = ref('');
let requestSequence = 0;

async function fetchPets() {
  const currentRequest = ++requestSequence;
  loading.value = true;
  error.value = '';
  try {
    const { data } = await http.get('/pets', {
      params: { page: Number(page.value) || 1 },
    });
    if (currentRequest === requestSequence) {
      pets.value = data.items ?? [];
      total.value = data.total ?? 0;
      limit.value = data.limit ?? 25;
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

watch(page, fetchPets, { immediate: true });

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
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-foreground">寵物資料</h1>
        <p class="mt-1 text-sm text-muted-foreground">先確認寵物與飼主身分，再建立健檢紀錄。</p>
      </div>
      <Button type="button" @click="openCreatePet">+ 新增寵物</Button>
    </div>

    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
    <ListSkeleton v-else-if="loading" :rows="5" />

    <template v-else>
      <p class="text-xs tabular-nums text-muted-foreground">共 {{ total }} 隻寵物</p>

      <Card v-if="pets.length" class="hidden gap-0 overflow-hidden py-0 shadow-sm dark:shadow-none lg:block">
        <Table>
          <TableHeader>
            <TableRow class="border-border text-muted-foreground">
              <TableHead class="font-medium">寵物</TableHead>
              <TableHead class="font-medium">飼主</TableHead>
              <TableHead class="text-right font-medium">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="pet in pets" :key="pet._id" class="border-border">
              <TableCell >
                <router-link :to="`/pets/${pet._id}`" class="group flex items-center gap-3">
                  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-belle-50 text-belle-600 dark:bg-brand-500/10 dark:text-brand-400">
                    <Cat class="h-4.5 w-4.5" stroke-width="1.75" />
                  </span>
                  <span>
                    <span class="block font-medium text-belle-600 group-hover:text-belle-700 dark:text-brand-400 dark:group-hover:text-brand-300">{{ pet.name }}</span>
                    <span class="text-xs text-muted-foreground">{{ pet.species || '寵物' }}<template v-if="pet.breed"> · {{ pet.breed }}</template> · {{ sexLabel(pet.sex) }}</span>
                  </span>
                </router-link>
              </TableCell>
              <TableCell >
                <router-link v-if="pet.ownerId" :to="`/owners/${pet.ownerId._id}`" class="inline-flex items-center gap-2 text-foreground hover:text-belle-600 dark:hover:text-brand-400">
                  <User class="h-4 w-4 shrink-0 text-muted-foreground" stroke-width="1.75" />
                  <span><span class="block">{{ pet.ownerId.name }}</span><span class="block text-xs text-muted-foreground">{{ pet.ownerId.phone }}</span></span>
                </router-link>
              </TableCell>
              <TableCell class="text-right">
                <Button as-child size="sm"><router-link :to="`/pets/${pet._id}/records/new`">
                  <ClipboardPlus class="h-4 w-4" />新增健檢
                </router-link></Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      <div v-if="pets.length" class="space-y-3 lg:hidden">
        <Card v-for="pet in pets" :key="pet._id" class="p-4 shadow-sm dark:shadow-none">
          <router-link :to="`/pets/${pet._id}`" class="flex items-start gap-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-belle-50 text-belle-600 dark:bg-brand-500/10 dark:text-brand-400"><Cat class="h-5 w-5" /></span>
            <span class="min-w-0 flex-1">
              <span class="block text-base font-semibold text-foreground">{{ pet.name }}</span>
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

      <EmptyState v-if="pets.length === 0" :icon="Cat" title="找不到符合條件的寵物" />

      <div v-if="totalPages > 1" class="flex items-center justify-between gap-3">
        <p class="text-xs tabular-nums text-muted-foreground">第 {{ currentPage }} / {{ totalPages }} 頁</p>
        <div class="flex gap-2">
          <Button type="button" variant="outline" size="sm" class="hidden sm:inline-flex" :disabled="currentPage <= 1" @click="goToPage(1)">第一頁</Button>
          <Button type="button" variant="outline" size="sm" :disabled="currentPage <= 1" @click="goToPage(currentPage - 1)">上一頁</Button>
          <Button type="button" variant="outline" size="sm" :disabled="currentPage >= totalPages" @click="goToPage(currentPage + 1)">下一頁</Button>
          <Button type="button" variant="outline" size="sm" class="hidden sm:inline-flex" :disabled="currentPage >= totalPages" @click="goToPage(totalPages)">最後頁</Button>
        </div>
      </div>
    </template>
  </section>
  <OwnerPickerDialog :open="ownerPickerOpen" @close="ownerPickerOpen = false" @select="selectOwner" />
  <PetFormDialog
    v-if="petOwner"
    title="新增寵物"
    submit-label="新增寵物"
    :submitting="petCreating"
    :error-message="petCreateError"
    @submit="createPet"
    @close="petOwner = null"
  />
</template>
