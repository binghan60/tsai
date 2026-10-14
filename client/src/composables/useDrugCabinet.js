import { ref } from 'vue';
import { http } from '../api/http';
import { getSocket } from '../api/socket';

// 藥櫃清單，全站共用一份快取（打藥單的建議清單與藥櫃設定頁）。
// 清單整份讀進來、在前端比對（lib/drugSuggest.js），打字時不必每個字打一次 API。
// 別台裝置改了藥櫃，伺服器廣播 drugs:updated；讀過的話就靜默重讀，斷線重連也補讀一次。
const drugs = ref([]);
const loaded = ref(false);
let inflight = null;
let listening = false;

function fetchDrugs() {
  if (!inflight) {
    inflight = http.get('/drugs', { params: { includeDisabled: 1 } })
      .then(({ data }) => {
        drugs.value = Array.isArray(data) ? data : [];
        loaded.value = true;
        return drugs.value;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

function listen() {
  if (listening) return;
  listening = true;
  const socket = getSocket();
  const reload = () => { if (loaded.value) fetchDrugs().catch(() => {}); };
  socket.on('drugs:updated', reload);
  socket.on('connect', reload);
}

export function useDrugCabinet() {
  listen();

  async function loadDrugs({ force = false } = {}) {
    if (loaded.value && !force) return drugs.value;
    return fetchDrugs();
  }

  // 記一次使用，兩種分開記：從建議清單選（usageCount，建議清單的排序靠它）、點常用按鈕（source 'pinned'，
  // pinnedUsageCount）。只是統計與排序，失敗不打擾。
  function markUsed(drug, source = 'suggest') {
    if (!drug?._id) return;
    const field = source === 'pinned' ? 'pinnedUsageCount' : 'usageCount';
    const current = drugs.value.find((entry) => entry._id === drug._id);
    if (current) current[field] = (current[field] ?? 0) + 1;
    http.post(`/drugs/${drug._id}/use`, { source }).catch(() => {});
  }

  // 一筆或一次很多筆（一行一筆）；回 { created, skipped }。
  async function createDrugs(names) {
    const { data } = await http.post('/drugs', { names });
    drugs.value = [...drugs.value, ...(data.created ?? [])];
    return data;
  }

  async function updateDrug(id, payload) {
    const { data } = await http.put(`/drugs/${id}`, payload);
    drugs.value = drugs.value.map((entry) => (entry._id === id ? data : entry));
    return data;
  }

  async function deleteDrug(id) {
    await http.delete(`/drugs/${id}`);
    drugs.value = drugs.value.filter((entry) => entry._id !== id);
  }

  return { drugs, loaded, loadDrugs, markUsed, createDrugs, updateDrug, deleteDrug };
}
