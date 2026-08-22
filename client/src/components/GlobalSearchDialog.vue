<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowRight, PawPrint, Phone, Search, User } from '@lucide/vue';
import { http } from '../api/http';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

// 全站搜尋。刻意做成蓋在當前頁面上的面板，而不是導去工作台再 focus 那裡的搜尋框——
// 搜尋是「查一下」，不是「換頁」。換頁會把使用者從正在看的資料上扯開，
// 填表填到一半時還會多跳一次未儲存確認，代價完全不成比例。
const open = defineModel('open', { type: Boolean, default: false });

const router = useRouter();
const query = ref('');
const searching = ref(false);
const searchError = ref('');
const results = ref({ owners: [], pets: [] });
const activeIndex = ref(0);
const inputEl = ref(null);

// 上下鍵要跨越「寵物」「飼主」兩個分組連續移動，所以攤平成一條清單，
// 分組只是渲染時的視覺分隔。
const flatResults = computed(() => [
  ...results.value.pets.map((pet) => ({ kind: 'pet', id: pet._id, to: `/pets/${pet._id}`, data: pet })),
  ...results.value.owners.map((owner) => ({ kind: 'owner', id: owner._id, to: `/owners/${owner._id}`, data: owner })),
]);
const hasQuery = computed(() => query.value.trim().length > 0);

let searchSequence = 0;

async function runSearch() {
  const value = query.value.trim();
  if (!value) {
    searchSequence += 1;
    results.value = { owners: [], pets: [] };
    searching.value = false;
    return;
  }
  const currentRequest = ++searchSequence;
  searching.value = true;
  searchError.value = '';
  try {
    const { data } = await http.get('/search', { params: { q: value } });
    if (currentRequest !== searchSequence) return;
    results.value = { owners: data.owners ?? [], pets: data.pets ?? [] };
    activeIndex.value = 0;
  } catch (err) {
    if (currentRequest === searchSequence) searchError.value = '搜尋暫時無法使用';
  } finally {
    if (currentRequest === searchSequence) searching.value = false;
  }
}

let searchTimer;
watch(query, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 250);
});

// 每次開啟都從乾淨狀態開始：面板是「問一個問題」，不是回到上次問到一半的地方。
watch(open, async (value) => {
  if (!value) {
    clearTimeout(searchTimer);
    return;
  }
  query.value = '';
  results.value = { owners: [], pets: [] };
  searchError.value = '';
  activeIndex.value = 0;
  await nextTick();
  inputEl.value?.focus();
});

function move(step) {
  const total = flatResults.value.length;
  if (!total) return;
  activeIndex.value = (activeIndex.value + step + total) % total;
}

async function go(item) {
  if (!item) return;
  open.value = false;
  await router.push(item.to);
}

function onKeydown(event) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    move(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    move(-1);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    go(flatResults.value[activeIndex.value]);
  }
}

// Ctrl/Cmd+K 從任何頁面叫出面板。掛在 window 上而不是某個輸入框，
// 因為它要在使用者「正在做別的事」的時候也能用。
function onGlobalKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    open.value = !open.value;
  }
}

onMounted(() => window.addEventListener('keydown', onGlobalKeydown));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown);
  clearTimeout(searchTimer);
});
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="top-24 max-w-xl translate-y-0 gap-0 p-0 sm:max-w-xl"
      :show-close-button="false"
      @open-auto-focus.prevent
    >
      <DialogTitle class="sr-only">搜尋飼主、寵物或寵物病歷號</DialogTitle>
      <DialogDescription class="sr-only">輸入關鍵字即時搜尋，用上下鍵選擇、Enter 前往。</DialogDescription>

      <div class="relative flex items-center gap-3 border-b border-border px-4">
        <Search class="h-5 w-5 shrink-0 text-muted-foreground" stroke-width="1.75" aria-hidden="true" />
        <input
          ref="inputEl"
          v-model="query"
          type="text"
          autocomplete="off"
          placeholder="搜尋寵物、飼主或電話"
          class="min-h-14 min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          @keydown="onKeydown"
        />
        <kbd class="hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground sm:block">Esc</kbd>
      </div>

      <div class="max-h-[min(60vh,26rem)] overflow-y-auto">
        <p v-if="searching" class="px-4 py-6 text-sm text-muted-foreground" role="status">搜尋中…</p>
        <p v-else-if="searchError" class="px-4 py-6 text-sm text-red-700 dark:text-red-300">{{ searchError }}</p>
        <p v-else-if="!hasQuery" class="px-4 py-6 text-sm text-muted-foreground">輸入寵物名、飼主姓名、電話或寵物病歷號開始搜尋。</p>
        <p v-else-if="!flatResults.length" class="px-4 py-6 text-sm text-muted-foreground">找不到符合的寵物或飼主。</p>

        <template v-else>
          <template v-for="(item, index) in flatResults" :key="`${item.kind}-${item.id}`">
            <p
              v-if="index === 0 || flatResults[index - 1].kind !== item.kind"
              class="px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground"
            >{{ item.kind === 'pet' ? '寵物' : '飼主' }}</p>
            <button
              type="button"
              class="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left"
              :class="index === activeIndex ? 'bg-muted/40 ' : 'hover:bg-muted/40 '"
              @mousemove="activeIndex = index"
              @click="go(item)"
            >
              <span class="flex min-w-0 items-center gap-3">
                <component
                  :is="item.kind === 'pet' ? PawPrint : User"
                  class="h-5 w-5 shrink-0 text-belle-600 dark:text-brand-400"
                  stroke-width="1.75"
                />
                <span class="min-w-0">
                  <span class="block truncate text-sm font-medium text-foreground">{{ item.data.name }}</span>
                  <span v-if="item.kind === 'pet'" class="block truncate text-xs text-muted-foreground">
                    飼主 {{ item.data.ownerId?.name || '—' }}
                  </span>
                  <span v-else class="flex items-center gap-1 text-xs text-muted-foreground">
                    <Phone class="h-3 w-3" stroke-width="1.75" />{{ item.data.phone }}
                  </span>
                </span>
              </span>
              <ArrowRight class="h-4 w-4 shrink-0 text-muted-foreground" stroke-width="1.75" />
            </button>
          </template>
        </template>
      </div>

      <div class="hidden items-center gap-3 border-t border-border px-4 py-2 text-xs text-muted-foreground sm:flex">
        <span><kbd class="rounded border border-border px-1">↑</kbd> <kbd class="rounded border border-border px-1">↓</kbd> 選擇</span>
        <span><kbd class="rounded border border-border px-1">Enter</kbd> 前往</span>
      </div>
    </DialogContent>
  </Dialog>
</template>
