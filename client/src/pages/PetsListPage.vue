<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Cat, ClipboardPlus, User } from '@lucide/vue';
import { http } from '../api/http';
import SearchPanel from '../components/SearchPanel.vue';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';

const route = useRoute();
const pets = ref([]);
const query = ref('');
const loading = ref(false);
const error = ref('');
let requestSequence = 0;

async function fetchPets() {
  const currentRequest = ++requestSequence;
  loading.value = true;
  error.value = '';
  try {
    const { data } = await http.get('/pets', { params: query.value ? { q: query.value } : {} });
    if (currentRequest === requestSequence) pets.value = data;
  } catch (err) {
    if (currentRequest === requestSequence) error.value = '寵物資料暫時無法載入，請稍後重試';
  } finally {
    if (currentRequest === requestSequence) loading.value = false;
  }
}

function sexLabel(sex) {
  return { male: '公', female: '母', unknown: '性別未記錄' }[sex] ?? '性別未記錄';
}

let debounceTimer;
watch(query, () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(fetchPets, 300);
});
onBeforeUnmount(() => clearTimeout(debounceTimer));

onMounted(fetchPets);
</script>

<template>
  <section class="mx-auto max-w-7xl space-y-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-ink-900 dark:text-white">寵物資料</h1>
        <p class="mt-1 text-sm text-ink-500 dark:text-zinc-400">先確認寵物與飼主身分，再建立健檢紀錄。</p>
      </div>
      <Button as-child variant="outline"><router-link to="/owners?create=1">+ 新增飼主與寵物</router-link></Button>
    </div>

    <div v-if="route.query.intent === 'new-record'" class="rounded-xl border border-belle-200 bg-belle-50 px-4 py-3 text-sm text-belle-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">
      請搜尋並選擇寵物，接著點選「新增健檢」。
    </div>

    <SearchPanel id="pet-search" v-model="query" label="搜尋寵物" placeholder="輸入寵物名、飼主姓名、電話或病歷號" />

    <p v-if="error" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">{{ error }}</p>
    <p v-else-if="loading" class="text-sm text-ink-500 dark:text-zinc-400" role="status">載入寵物資料…</p>

    <template v-else>
      <p class="text-xs text-ink-400 dark:text-zinc-400">共 {{ pets.length }} 隻寵物</p>

      <Card v-if="pets.length" class="hidden gap-0 overflow-hidden border-cream-300 py-0 shadow-sm dark:border-zinc-800 dark:shadow-none md:block">
        <Table>
          <TableHeader>
            <TableRow class="border-cream-300 text-ink-500 dark:border-zinc-800 dark:text-zinc-400">
              <TableHead class="px-5 py-3 font-medium">寵物</TableHead>
              <TableHead class="px-5 py-3 font-medium">辨識資料</TableHead>
              <TableHead class="px-5 py-3 font-medium">飼主</TableHead>
              <TableHead class="px-5 py-3 text-right font-medium">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="pet in pets" :key="pet._id" class="border-cream-200 dark:border-zinc-800 dark:hover:bg-zinc-800/40">
              <TableCell class="px-5 py-3">
                <router-link :to="`/pets/${pet._id}`" class="group flex items-center gap-3">
                  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-belle-50 text-belle-600 dark:bg-brand-500/10 dark:text-brand-400">
                    <Cat class="h-4.5 w-4.5" stroke-width="1.75" />
                  </span>
                  <span>
                    <span class="block font-medium text-belle-600 group-hover:text-belle-700 dark:text-brand-400 dark:group-hover:text-brand-300">{{ pet.name }}</span>
                    <span class="text-xs text-ink-400 dark:text-zinc-400">{{ pet.species || '寵物' }}<template v-if="pet.breed"> · {{ pet.breed }}</template></span>
                  </span>
                </router-link>
              </TableCell>
              <TableCell class="px-5 py-3 text-ink-600 dark:text-zinc-300">
                <span class="block font-medium">{{ pet.medicalRecordNumber || '病歷號未建立' }}</span>
                <span class="block text-xs text-ink-400 dark:text-zinc-400">{{ sexLabel(pet.sex) }}</span>
              </TableCell>
              <TableCell class="px-5 py-3">
                <router-link v-if="pet.ownerId" :to="`/owners/${pet.ownerId._id}`" class="inline-flex min-h-11 items-center gap-2 text-ink-600 hover:text-belle-600 dark:text-zinc-300 dark:hover:text-brand-400">
                  <User class="h-4 w-4 shrink-0 text-ink-400 dark:text-zinc-400" stroke-width="1.75" />
                  <span><span class="block">{{ pet.ownerId.name }}</span><span class="block text-xs text-ink-400 dark:text-zinc-400">{{ pet.ownerId.phone }}</span></span>
                </router-link>
              </TableCell>
              <TableCell class="px-5 py-3 text-right">
                <Button as-child size="sm" class="min-h-11"><router-link :to="`/pets/${pet._id}/records/new`">
                  <ClipboardPlus class="h-4 w-4" />新增健檢
                </router-link></Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      <div v-if="pets.length" class="space-y-3 md:hidden">
        <Card v-for="pet in pets" :key="pet._id" class="border-cream-300 p-4 shadow-sm dark:border-zinc-800 dark:shadow-none">
          <router-link :to="`/pets/${pet._id}`" class="flex items-start gap-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-belle-50 text-belle-600 dark:bg-brand-500/10 dark:text-brand-400"><Cat class="h-5 w-5" /></span>
            <span class="min-w-0 flex-1">
              <span class="block text-base font-semibold text-ink-900 dark:text-white">{{ pet.name }}</span>
              <span class="block text-sm text-ink-500 dark:text-zinc-400">{{ pet.species || '寵物' }}<template v-if="pet.breed"> · {{ pet.breed }}</template> · {{ sexLabel(pet.sex) }}</span>
              <span class="mt-1 block text-xs text-ink-400 dark:text-zinc-400">{{ pet.medicalRecordNumber || '病歷號未建立' }}</span>
            </span>
          </router-link>
          <div class="mt-4 flex items-center justify-between gap-3 border-t border-cream-300 pt-3 dark:border-zinc-800">
            <span class="min-w-0 text-sm text-ink-600 dark:text-zinc-300">飼主：{{ pet.ownerId?.name || '—' }}</span>
            <Button as-child size="sm" class="min-h-11 shrink-0"><router-link :to="`/pets/${pet._id}/records/new`">
              <ClipboardPlus class="h-4 w-4" />新增健檢
            </router-link></Button>
          </div>
        </Card>
      </div>

      <div v-if="pets.length === 0" class="rounded-2xl border border-dashed border-cream-300 px-5 py-14 text-center dark:border-zinc-800">
        <Cat class="mx-auto mb-2 h-8 w-8 text-ink-400 dark:text-zinc-500" stroke-width="1.5" />
        <p class="text-sm text-ink-500 dark:text-zinc-400">找不到符合條件的寵物</p>
      </div>
    </template>
  </section>
</template>
