import { onScopeDispose, ref, toValue } from 'vue';
import { http } from '../api/http';

// 某隻貓的歷次病歷日誌（分頁），給 ClinicalNotesPanel 用：診療台工作區、櫃台處理視窗、病歷速覽
// 都是同一段——只採用最後一次送出的查詢、頁碼超出最後一頁時退回、元件卸載後不再寫回。
//
// petId 與 excludeAppointmentId 可以是 getter；excludeAppointmentId 用來排掉「這次看診自己」那筆日誌
// （它已經顯示在畫面的其他地方）。換了一隻貓由呼叫端再呼叫一次 load(1)。
export function usePetClinicalNotes({ petId, excludeAppointmentId, limit = 5 }) {
  const notes = ref([]);
  const page = ref(1);
  const totalPages = ref(1);
  const loading = ref(false);
  const error = ref('');
  let request = 0;
  let loadedPetId = null;

  // silent：即時推播觸發的重讀——不顯示「載入中」、失敗不蓋掉現有清單（診療台自動存檔會連發通知）。
  async function load(nextPage = 1, { silent = false } = {}) {
    const token = ++request;
    const id = toValue(petId);
    // 換了一隻貓（或這筆掛號還沒建檔）：先清掉上一隻的日誌，別讓它留在畫面上。
    if (id !== loadedPetId) {
      notes.value = [];
      page.value = 1;
      totalPages.value = 1;
      loadedPetId = id;
    }
    if (!silent) error.value = '';
    if (!id) {
      loading.value = false;
      return;
    }
    if (!silent) loading.value = true;
    try {
      const exclude = toValue(excludeAppointmentId);
      const { data } = await http.get(`/pets/${id}/clinical-notes`, {
        params: { page: nextPage, limit, ...(exclude ? { excludeAppointmentId: exclude } : {}) },
      });
      if (token !== request || toValue(petId) !== id) return;
      const pages = data.totalPages || 1;
      if (nextPage > pages) {
        await load(pages, { silent });
        return;
      }
      notes.value = data.items || [];
      page.value = nextPage;
      totalPages.value = pages;
    } catch {
      if (token === request && !silent) error.value = '病歷日誌未能載入，請重試。';
    } finally {
      if (token === request && !silent) loading.value = false;
    }
  }

  onScopeDispose(() => {
    request += 1;
  });

  return { notes, page, totalPages, loading, error, load, reload: () => load(page.value) };
}
