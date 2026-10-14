import { ref } from 'vue';
import { http } from '../api/http';
import { getSocket } from '../api/socket';

// 藥櫃（分類與藥品），全站共用一份快取（打藥單的建議清單、藥櫃視窗、藥櫃設定頁）。
// 清單整份讀進來、在前端比對與分組（lib/drugSuggest.js、lib/drugGroups.js），打字時不必每個字打一次 API。
// 別台裝置改了藥櫃，伺服器廣播 drugs:updated；讀過的話就靜默重讀，斷線重連也補讀一次。
const drugs = ref([]);
const groups = ref([]);
const loaded = ref(false);
let inflight = null;
let listening = false;

function fetchCabinet() {
  if (!inflight) {
    inflight = Promise.all([
      http.get('/drugs', { params: { includeDisabled: 1 } }),
      http.get('/drug-groups'),
    ])
      .then(([drugsResponse, groupsResponse]) => {
        drugs.value = Array.isArray(drugsResponse.data) ? drugsResponse.data : [];
        groups.value = Array.isArray(groupsResponse.data) ? groupsResponse.data : [];
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
  const reload = () => { if (loaded.value) fetchCabinet().catch(() => {}); };
  socket.on('drugs:updated', reload);
  socket.on('connect', reload);
}

export function useDrugCabinet() {
  listen();

  async function loadDrugs({ force = false } = {}) {
    if (loaded.value && !force) return drugs.value;
    return fetchCabinet();
  }

  // 一筆或一次很多筆（一行一筆），可指定分類（null＝未分類）；回 { created, skipped }。
  async function createDrugs(names, groupId = null) {
    const { data } = await http.post('/drugs', { names, groupId });
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

  // 搬到某分類（null＝未分類）的 beforeId 前面（null＝最後）。伺服器照規則重新編號，這裡整份重讀對齊。
  async function moveDrug(id, { groupId = null, beforeId = null } = {}) {
    try {
      await http.post(`/drugs/${id}/move`, { groupId, beforeId });
    } finally {
      await fetchCabinet().catch(() => {});
    }
  }

  async function createGroup(name) {
    const { data } = await http.post('/drug-groups', { name });
    groups.value = [...groups.value, data];
    return data;
  }

  async function renameGroup(group, name) {
    const { data } = await http.put(`/drug-groups/${group._id}`, { name, expectedVersion: group.__v });
    groups.value = groups.value.map((entry) => (entry._id === group._id ? data : entry));
    return data;
  }

  async function moveGroup(id, beforeId = null) {
    try {
      await http.post(`/drug-groups/${id}/move`, { beforeId });
    } finally {
      await fetchCabinet().catch(() => {});
    }
  }

  async function deleteGroup(id) {
    await http.delete(`/drug-groups/${id}`);
    await fetchCabinet();
  }

  return {
    drugs, groups, loaded, loadDrugs,
    createDrugs, updateDrug, deleteDrug, moveDrug,
    createGroup, renameGroup, moveGroup, deleteGroup,
  };
}
