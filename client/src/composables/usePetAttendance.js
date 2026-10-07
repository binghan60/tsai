import { onScopeDispose, ref, toValue } from 'vue';
import { http } from '../api/http';

// 某隻貓的出席紀錄（遲到與未到）：貓咪詳情頁的徽章與「出席紀錄」頁籤共用。
// 畫面只看這隻貓自己的（scope 預設 pet）；API 另外回飼主名下全部的 counts.owner，目前沒有畫面用。
// 只採用最後一次送出的查詢。
export function usePetAttendance(petId, { limit = 10 } = {}) {
  const items = ref([]);
  const counts = ref({ pet: null, owner: null });
  const scope = ref('pet');
  const page = ref(1);
  const totalPages = ref(1);
  const total = ref(0);
  const loading = ref(false);
  const error = ref('');
  let request = 0;
  let loadedPetId = null;

  async function load({ page: nextPage = page.value, scope: nextScope = scope.value } = {}) {
    const token = ++request;
    const id = toValue(petId);
    // 換了一隻貓：先清掉上一隻的數字與清單，別讓它留在畫面上。
    if (id !== loadedPetId) {
      items.value = [];
      counts.value = { pet: null, owner: null };
      total.value = 0;
      totalPages.value = 1;
      loadedPetId = id;
    }
    scope.value = nextScope;
    error.value = '';
    if (!id) {
      loading.value = false;
      return;
    }
    loading.value = true;
    try {
      const { data } = await http.get(`/pets/${id}/attendance`, { params: { scope: nextScope, page: nextPage, limit } });
      if (token !== request || toValue(petId) !== id) return;
      const pages = data.totalPages || 1;
      if (nextPage > pages) {
        await load({ page: pages, scope: nextScope });
        return;
      }
      items.value = data.items || [];
      counts.value = data.counts || { pet: null, owner: null };
      page.value = nextPage;
      totalPages.value = pages;
      total.value = data.total || 0;
    } catch {
      if (token === request) error.value = '出席紀錄未能載入，請重試。';
    } finally {
      if (token === request) loading.value = false;
    }
  }

  onScopeDispose(() => {
    request += 1;
  });

  return { items, counts, scope, page, totalPages, total, limit, loading, error, load };
}
