<script setup>
import { onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Cat, ClipboardPlus, Search, User } from '@lucide/vue';
import { http } from '../api/http';

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

onMounted(fetchPets);
</script>

<template>
  <section class="mx-auto max-w-7xl space-y-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-ink-900 dark:text-white">寵物資料</h1>
        <p class="mt-1 text-sm text-ink-500 dark:text-zinc-400">先確認寵物與飼主身分，再建立健檢紀錄。</p>
      </div>
      <router-link to="/owners?create=1" class="rounded-xl border border-cream-300 bg-cream-50 px-4 py-2.5 text-sm font-medium text-ink-700 hover:border-belle-300 hover:text-belle-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-brand-500/50 dark:hover:text-brand-400">
        + 新增飼主與寵物
      </router-link>
    </div>

    <div v-if="route.query.intent === 'new-record'" class="rounded-xl border border-belle-200 bg-belle-50 px-4 py-3 text-sm text-belle-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">
      請搜尋並選擇寵物，接著點選「新增健檢」。
    </div>

    <div class="rounded-2xl border border-cream-300 bg-cream-50 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
      <label for="pet-search" class="mb-2 block text-xs font-medium text-ink-500 dark:text-zinc-400">搜尋寵物</label>
      <div class="relative">
        <Search class="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-400 dark:text-zinc-400" stroke-width="1.75" />
        <input
          id="pet-search"
          v-model="query"
          type="search"
          autocomplete="off"
          placeholder="輸入寵物名、飼主姓名、電話、病歷號或晶片號"
          class="w-full rounded-xl border border-cream-300 bg-white py-3 pl-11 pr-4 text-sm text-ink-900 placeholder:text-ink-400 focus:border-belle-500 focus:outline-none focus:ring-2 focus:ring-belle-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:ring-brand-500/20"
        />
      </div>
    </div>

    <p v-if="error" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">{{ error }}</p>
    <p v-else-if="loading" class="text-sm text-ink-500 dark:text-zinc-400" role="status">載入寵物資料…</p>

    <template v-else>
      <p class="text-xs text-ink-400 dark:text-zinc-400">共 {{ pets.length }} 隻寵物</p>

      <div v-if="pets.length" class="hidden overflow-hidden rounded-2xl border border-cream-300 bg-cream-50 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none md:block">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-cream-300 text-ink-500 dark:border-zinc-800 dark:text-zinc-400">
              <th class="px-5 py-3 font-medium">寵物</th>
              <th class="px-5 py-3 font-medium">辨識資料</th>
              <th class="px-5 py-3 font-medium">飼主</th>
              <th class="px-5 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="pet in pets" :key="pet._id" class="border-b border-cream-200 transition-colors last:border-0 hover:bg-cream-100 dark:border-zinc-800 dark:hover:bg-zinc-800/40">
              <td class="px-5 py-3">
                <router-link :to="`/pets/${pet._id}`" class="group flex items-center gap-3">
                  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-belle-50 text-belle-600 dark:bg-brand-500/10 dark:text-brand-400">
                    <Cat class="h-4.5 w-4.5" stroke-width="1.75" />
                  </span>
                  <span>
                    <span class="block font-medium text-belle-600 group-hover:text-belle-700 dark:text-brand-400 dark:group-hover:text-brand-300">{{ pet.name }}</span>
                    <span class="text-xs text-ink-400 dark:text-zinc-400">{{ pet.species || '寵物' }}<template v-if="pet.breed"> · {{ pet.breed }}</template></span>
                  </span>
                </router-link>
              </td>
              <td class="px-5 py-3 text-ink-600 dark:text-zinc-300">
                <span class="block font-medium">{{ pet.medicalRecordNumber || '病歷號未建立' }}</span>
                <span class="block text-xs text-ink-400 dark:text-zinc-400">{{ sexLabel(pet.sex) }}<template v-if="pet.microchipNumber"> · 晶片 {{ pet.microchipNumber }}</template></span>
              </td>
              <td class="px-5 py-3">
                <router-link v-if="pet.ownerId" :to="`/owners/${pet.ownerId._id}`" class="inline-flex min-h-11 items-center gap-2 text-ink-600 hover:text-belle-600 dark:text-zinc-300 dark:hover:text-brand-400">
                  <User class="h-4 w-4 shrink-0 text-ink-400 dark:text-zinc-400" stroke-width="1.75" />
                  <span><span class="block">{{ pet.ownerId.name }}</span><span class="block text-xs text-ink-400 dark:text-zinc-400">{{ pet.ownerId.phone }}</span></span>
                </router-link>
              </td>
              <td class="px-5 py-3 text-right">
                <router-link :to="`/pets/${pet._id}/records/new`" class="inline-flex min-h-11 items-center gap-2 rounded-xl bg-belle-600 px-3 py-2 text-sm font-medium text-white hover:bg-belle-700 dark:bg-brand-500 dark:hover:bg-brand-600">
                  <ClipboardPlus class="h-4 w-4" />新增健檢
                </router-link>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="pets.length" class="space-y-3 md:hidden">
        <article v-for="pet in pets" :key="pet._id" class="rounded-2xl border border-cream-300 bg-cream-50 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
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
            <router-link :to="`/pets/${pet._id}/records/new`" class="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-belle-600 px-3 py-2 text-sm font-medium text-white dark:bg-brand-500">
              <ClipboardPlus class="h-4 w-4" />新增健檢
            </router-link>
          </div>
        </article>
      </div>

      <div v-if="pets.length === 0" class="rounded-2xl border border-dashed border-cream-300 px-5 py-14 text-center dark:border-zinc-800">
        <Cat class="mx-auto mb-2 h-8 w-8 text-ink-400 dark:text-zinc-500" stroke-width="1.5" />
        <p class="text-sm text-ink-500 dark:text-zinc-400">找不到符合條件的寵物</p>
      </div>
    </template>
  </section>
</template>
