import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { clampPage, pageCount } from '../lib/pagination';
import { useSearchQueryParam } from './useSearchQueryParam';

// 伺服器分頁的清單頁（貓咪、健檢報告、寄送歷程）共用的那一段：頁碼記在網址上、
// 換頁就重查、只採用最後一次送出的查詢結果、頁碼超出最後一頁時退回。
//
// fetch({ page }) 回傳後端的 { items, total, limit }；篩選條件（關鍵字、佇列、日期）由頁面自己
// 用 useSearchQueryParam 管，在 fetch 裡組進參數。呼叫這支之前要先把那些 ref 準備好——
// 第一次查詢在這裡面就送出了。
export function usePagedList({ fetch, errorMessage, defaultLimit = 10, onData }) {
  const pageParam = useSearchQueryParam('page', '1');
  const items = ref([]);
  const total = ref(0);
  const limit = ref(defaultLimit);
  const loading = ref(false);
  const error = ref('');
  const page = computed(() => Number(pageParam.value) || 1);
  const totalPages = computed(() => pageCount(total.value, limit.value));
  let requestSequence = 0;

  async function reload() {
    const currentRequest = ++requestSequence;
    loading.value = true;
    error.value = '';
    try {
      const data = await fetch({ page: page.value });
      if (currentRequest !== requestSequence) return;
      items.value = data.items ?? [];
      total.value = data.total ?? 0;
      limit.value = data.limit ?? defaultLimit;
      onData?.(data);
      // 其他人刪除資料或新的篩選條件縮小結果時，原本的頁碼可能超出最後一頁；
      // 立即回到有效頁碼，避免只看到空白狀態且沒有分頁可以離開。
      if (!items.value.length && total.value > 0 && page.value > totalPages.value) {
        pageParam.value = String(totalPages.value);
      }
    } catch {
      if (currentRequest === requestSequence) error.value = errorMessage;
    } finally {
      if (currentRequest === requestSequence) loading.value = false;
    }
  }

  function goToPage(next) {
    const target = clampPage(next, totalPages.value);
    if (target !== page.value) pageParam.value = String(target);
  }

  // 篩選條件變了：回第一頁；本來就在第一頁時頁碼不會變，要自己重查。
  function applyFilters() {
    if (pageParam.value !== '1') pageParam.value = '1';
    else reload();
  }

  watch(pageParam, reload, { immediate: true });
  // 離開頁面後才回來的結果不再寫進已經卸載的畫面。
  onBeforeUnmount(() => {
    requestSequence += 1;
  });

  return { items, total, limit, loading, error, page, totalPages, goToPage, applyFilters, reload };
}
