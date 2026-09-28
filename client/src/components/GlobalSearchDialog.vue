<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Cat, CornerDownLeft, Loader2, Search, SearchX, X } from '@lucide/vue';
import { http } from '../api/http';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import PetLine from './PetLine.vue';
import ReminderTags from './ReminderTags.vue';

// 全站搜尋。刻意做成蓋在當前頁面上的面板，而不是導去工作台再 focus 那裡的搜尋框——
// 搜尋是「查一下」，不是「換頁」。換頁會把使用者從正在看的資料上扯開，
// 填表填到一半時還會多跳一次未儲存確認，代價完全不成比例。
const open = defineModel('open', { type: Boolean, default: false });

const router = useRouter();
const query = ref('');
const searching = ref(false);
const searchError = ref('');
const results = ref({ pets: [] });
const activeIndex = ref(0);
// Input 是元件，ref 拿到的不是 <input>；包一層 div 再找裡面的輸入框來 focus。
const inputWrap = ref(null);
const KBD = 'inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border bg-card px-1.5 font-sans text-2xs leading-none font-semibold text-muted-foreground';
const listEl = ref(null);

// 飼主不是獨立可瀏覽的實體，搜尋結果一律呈現成貓咪——後端 /api/search 的 pets
// 本來就已經用飼主姓名／電話／Email 做過 join，打飼主關鍵字一樣找得到他的貓咪。
const flatResults = computed(() => results.value.pets.map((pet) => ({ kind: 'pet', id: pet._id, to: `/pets/${pet._id}`, data: pet })));
const hasQuery = computed(() => query.value.trim().length > 0);

let searchSequence = 0;

// keepSelection：重開面板時的背景重查，不要把使用者選到一半的那一列跳回第一筆。
async function runSearch({ keepSelection = false } = {}) {
  const value = query.value.trim();
  if (!value) {
    searchSequence += 1;
    results.value = { pets: [] };
    searching.value = false;
    return;
  }
  const currentRequest = ++searchSequence;
  searching.value = true;
  searchError.value = '';
  try {
    const { data } = await http.get('/search', { params: { q: value } });
    if (currentRequest !== searchSequence) return;
    results.value = { pets: data.pets ?? [] };
    activeIndex.value = keepSelection ? Math.min(activeIndex.value, Math.max(results.value.pets.length - 1, 0)) : 0;
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

function focusInput({ select = false } = {}) {
  const input = inputWrap.value?.querySelector('input');
  input?.focus();
  if (select) input?.select();
}

// 關掉再開保留上次的關鍵字與結果（使用者要求：常常是查到一半被打斷，回來還要接著看），
// 只有重新整理頁面或按清除才會清空。重開時關鍵字整段選取：直接打字就換成新的搜尋，
// 按 Enter／方向鍵則沿用上次的結果；同時在背景重查一次，資料有改也是最新的。
watch(open, async (value) => {
  if (!value) {
    clearTimeout(searchTimer);
    return;
  }
  searchError.value = '';
  await nextTick();
  focusInput({ select: true });
  if (hasQuery.value) runSearch({ keepSelection: true });
});

function clearSearch() {
  clearTimeout(searchTimer);
  searchSequence += 1;
  query.value = '';
  results.value = { pets: [] };
  searchError.value = '';
  searching.value = false;
  activeIndex.value = 0;
  focusInput();
}

async function move(step) {
  const total = flatResults.value.length;
  if (!total) return;
  activeIndex.value = (activeIndex.value + step + total) % total;
  // 用方向鍵選到清單外的那一列時跟著捲過去。
  await nextTick();
  listEl.value?.querySelector(`[data-index="${activeIndex.value}"]`)?.scrollIntoView({ block: 'nearest' });
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
      size="lg"
      class="top-24 translate-y-0 gap-0 overflow-hidden p-0"
      :show-close-button="false"
      @open-auto-focus.prevent
    >
      <DialogTitle class="sr-only">搜尋飼主、貓咪或電話</DialogTitle>
      <DialogDescription class="sr-only">輸入關鍵字即時搜尋，用上下鍵選擇、Enter 前往。</DialogDescription>

      <div ref="inputWrap" class="flex items-center gap-3 border-b border-border px-5">
        <Loader2 v-if="searching" class="size-5 shrink-0 animate-spin text-primary" stroke-width="2" aria-hidden="true" />
        <Search v-else class="size-5 shrink-0 text-muted-foreground" stroke-width="2" aria-hidden="true" />
        <Input
          v-model="query"
          type="text"
          autocomplete="off"
          placeholder="搜尋貓咪、飼主或電話"
          class="h-16 min-w-0 flex-1 border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0 dark:bg-transparent"
          @keydown="onKeydown"
        />
        <Button v-if="query" variant="secondary" size="icon-xs" class="shrink-0" aria-label="清除搜尋" @click="clearSearch"><X stroke-width="1.75" /></Button>
      </div>

      <div ref="listEl" class="max-h-[min(60vh,30rem)] overflow-y-auto">
        <!-- 打字時舊結果先留著、只在輸入框轉圈：每打一個字就整片換成「搜尋中」會一直閃。 -->
        <div v-if="!flatResults.length || searchError" class="flex flex-col items-center gap-3 px-6 py-12 text-center" :role="searching ? 'status' : undefined">
          <span class="flex size-12 items-center justify-center rounded-full bg-sunken text-subtle-foreground">
            <SearchX v-if="hasQuery && !searching && !searchError" class="size-6" stroke-width="1.75" />
            <Search v-else class="size-6" stroke-width="1.75" />
          </span>
          <p v-if="searchError" class="text-danger">{{ searchError }}</p>
          <p v-else-if="searching" class="text-muted-foreground">搜尋中…</p>
          <template v-else-if="hasQuery">
            <p class="font-semibold">找不到「{{ query.trim() }}」</p>
            <p class="text-sm text-muted-foreground">試試貓咪名的一部分、飼主姓名或電話末幾碼。</p>
          </template>
          <template v-else>
            <p class="font-semibold">要找哪隻貓咪？</p>
            <p class="text-sm text-muted-foreground">輸入貓咪名、飼主姓名或電話，打飼主也找得到他的貓咪。</p>
          </template>
        </div>

        <div v-else class="p-2">
          <p class="flex items-center gap-2 px-3 pt-1 pb-2"><span class="spec-label">貓咪</span><span class="num text-xs text-subtle-foreground">{{ flatResults.length }}</span></p>
          <button
            v-for="(item, index) in flatResults"
            :key="item.id"
            type="button"
            :data-index="index"
            class="flex min-h-16 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors"
            :class="index === activeIndex ? 'bg-accent/60' : 'hover:bg-hover'"
            :aria-current="index === activeIndex ? 'true' : undefined"
            @mousemove="activeIndex = index"
            @click="go(item)"
          >
            <span class="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground"><Cat class="size-5" stroke-width="1.75" /></span>
            <span class="min-w-0 flex-1">
              <span class="flex min-w-0 items-center gap-2">
                <span class="truncate text-base font-semibold text-foreground">{{ item.data.name }}</span>
                <ReminderTags :pet="item.data" />
              </span>
              <PetLine :pet="item.data" class="text-sm text-muted-foreground" />
            </span>
            <span class="hidden min-w-0 shrink-0 text-right sm:block">
              <span class="block truncate text-sm font-medium text-foreground">{{ item.data.ownerId?.name }}</span>
              <span v-if="item.data.ownerId?.phone" class="num block text-sm text-muted-foreground">{{ item.data.ownerId.phone }}</span>
            </span>
            <CornerDownLeft class="size-4 shrink-0 text-subtle-foreground" :class="index === activeIndex ? 'visible' : 'invisible'" stroke-width="2" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div class="hidden items-center gap-4 border-t border-border bg-sunken px-5 py-2.5 text-xs text-muted-foreground sm:flex">
        <span class="flex items-center gap-1.5"><kbd :class="KBD">↑</kbd><kbd :class="KBD">↓</kbd>選擇</span>
        <span class="flex items-center gap-1.5"><kbd :class="KBD">Enter</kbd>開啟</span>
        <span class="flex items-center gap-1.5"><kbd :class="KBD">Esc</kbd>關閉</span>
        <span class="ml-auto flex items-center gap-1.5"><kbd :class="KBD">Ctrl</kbd><kbd :class="KBD">K</kbd>隨時叫出</span>
      </div>
    </DialogContent>
  </Dialog>
</template>

