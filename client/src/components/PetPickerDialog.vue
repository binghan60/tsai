<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Cat, ChevronLeft, ChevronRight, Search, User, X } from '@lucide/vue';
import { http } from '../api/http';
import ModalDialog from './ModalDialog.vue';
import { DialogDescription, DialogTitle } from './ui/dialog';
import ListSkeleton from './ListSkeleton.vue';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import { Input } from './ui/input';
import PickerOptionRow from './PickerOptionRow.vue';

const props = defineProps({
  open: { type: Boolean, default: false },
});

const emit = defineEmits(['close', 'select']);

const pets = ref([]);
const page = ref(1);
const query = ref('');
const total = ref(0);
const limit = ref(25);
const loading = ref(false);
const error = ref('');
let requestSequence = 0;
let searchTimer;

const totalPages = computed(() => Math.max(Math.ceil(total.value / limit.value), 1));

async function fetchPets() {
  const currentRequest = ++requestSequence;
  loading.value = true;
  error.value = '';
  try {
    const { data } = await http.get('/pets', {
      params: { page: page.value, limit: 25, ...(query.value.trim() ? { q: query.value.trim() } : {}) },
    });
    if (currentRequest !== requestSequence) return;
    pets.value = data.items ?? [];
    total.value = data.total ?? 0;
    limit.value = data.limit ?? 25;
  } catch (err) {
    if (currentRequest === requestSequence) error.value = '寵物清單載入失敗，請稍後再試。';
  } finally {
    if (currentRequest === requestSequence) loading.value = false;
  }
}

function close() {
  if (!loading.value) emit('close');
}

function selectPet(pet) {
  emit('select', pet);
}

function goToPage(next) {
  const target = Math.min(Math.max(next, 1), totalPages.value);
  if (target !== page.value) page.value = target;
}

function clearQuery() {
  query.value = '';
}

watch(() => props.open, (open) => {
  clearTimeout(searchTimer);
  if (!open) return;

  // 只改真正需要重設的狀態，讓對應 watcher 負責送出唯一一次查詢。
  // 舊做法預先留下「略過下一次」旗標；當值本來就是空字串／第 1 頁時 watcher
  // 不會觸發，旗標卻會誤吃掉使用者下一次真正的搜尋或翻頁。
  if (query.value !== '') {
    query.value = '';
  } else if (page.value !== 1) {
    page.value = 1;
  } else {
    fetchPets();
  }
});

watch(query, () => {
  if (!props.open) return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (!props.open) return;
    if (page.value !== 1) {
      page.value = 1;
      return;
    }
    fetchPets();
  }, 250);
});

watch(page, () => {
  if (props.open) fetchPets();
});

onBeforeUnmount(() => clearTimeout(searchTimer));
</script>

<template>
  <ModalDialog v-if="open" size="md" @close="close">
    <div class="p-6 pb-3 sm:p-7 sm:pb-3">
      <DialogTitle>選擇要做健檢的寵物</DialogTitle>
      <DialogDescription class="mt-1">選定寵物後會直接開始新增就診紀錄。</DialogDescription>
    </div>

    <div class="space-y-3 px-6 pb-6 sm:px-7 sm:pb-7">
      <div class="relative">
        <Search class="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" stroke-width="1.75" aria-hidden="true" />
        <Input v-model="query" type="text" inputmode="search" class="h-11 pl-10 pr-10" placeholder="搜尋寵物、飼主或電話" aria-label="搜尋寵物、飼主或電話" />
        <button v-if="query" type="button" class="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="清除搜尋" @click="clearQuery">
          <X class="h-4 w-4" />
        </button>
      </div>
      <p v-if="!loading" class="text-xs tabular-nums text-muted-foreground">共 {{ total }} 隻寵物</p>
      <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
      <ListSkeleton v-if="loading" inset :rows="4" />
      <div v-else-if="pets.length" class="space-y-2">
        <PickerOptionRow
          v-for="pet in pets"
          :key="pet._id"
          :title="pet.name"
          :aria-label="`選擇寵物 ${pet.name}`"
          @select="selectPet(pet)"
        >
          <template #icon>
            <Cat class="h-5 w-5" stroke-width="1.75" />
          </template>
          <template #description>
            <span class="flex items-center gap-1 truncate">
              <User class="h-3.5 w-3.5 shrink-0" />{{ pet.ownerId?.name || '未指定飼主' }}
            </span>
          </template>
        </PickerOptionRow>
      </div>
      <p v-else class="rounded-xl border border-border px-4 py-8 text-center text-sm text-muted-foreground">{{ query.trim() ? '找不到符合的寵物。' : '目前沒有可選擇的寵物。' }}</p>

      <div v-if="totalPages > 1" class="flex items-center justify-between gap-3">
        <span class="text-xs tabular-nums text-muted-foreground">第 {{ page }} / {{ totalPages }} 頁</span>
        <div class="flex gap-2">
          <Button type="button" variant="outline" size="sm" :disabled="page <= 1 || loading" @click="goToPage(page - 1)">
            <ChevronLeft class="h-4 w-4" />上一頁
          </Button>
          <Button type="button" variant="outline" size="sm" :disabled="page >= totalPages || loading" @click="goToPage(page + 1)">
            下一頁<ChevronRight class="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  </ModalDialog>
</template>
