import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { http } from '../api/http';

// 選人用的候選清單（掛號視窗選貓／飼主、新增健檢選貓）：邊打邊查，停止打字 250ms 才查。
// 清單限高、超過就在框內捲動（同名的貓、同一位飼主養很多隻時，只列前幾筆會找不到要的那一隻）；
// 一次最多拿 CANDIDATE_LIMIT 筆，再多就提示還有幾筆沒列出（hiddenCount）。
const CANDIDATE_LIMIT = 50;

export function useCandidateSearch(endpoint) {
  const query = ref('');
  const results = ref([]);
  const total = ref(0);
  const loading = ref(false);
  const failed = ref(false);
  let timer;
  let sequence = 0;
  watch(query, (value) => {
    clearTimeout(timer);
    const keyword = value.trim();
    if (!keyword) {
      results.value = [];
      total.value = 0;
      loading.value = false;
      return;
    }
    loading.value = true;
    timer = setTimeout(async () => {
      const current = ++sequence;
      try {
        const { data } = await http.get(endpoint, { params: { q: keyword, limit: CANDIDATE_LIMIT } });
        if (current !== sequence) return;
        results.value = data.items ?? [];
        total.value = data.total ?? results.value.length;
        failed.value = false;
      } catch {
        if (current === sequence) failed.value = true;
      } finally {
        if (current === sequence) loading.value = false;
      }
    }, 250);
  });
  onBeforeUnmount(() => clearTimeout(timer));
  const hiddenCount = computed(() => (loading.value || failed.value ? 0 : Math.max(total.value - results.value.length, 0)));
  return { query, results, loading, failed, hiddenCount };
}
