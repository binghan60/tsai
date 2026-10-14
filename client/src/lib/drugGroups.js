import { sortByDrugOrder } from '../../../shared/drugOrder.js';

// 藥櫃的分組排列：分類依手動順序，未分類（groupId 為 null）固定排最後；組內藥品依手動順序。
// enabledOnly：藥櫃視窗只給啟用中的；設定頁要看到全部。空分類照樣列出（設定頁要能整理、拖進去）。
export function groupDrugs(groups, drugs, { enabledOnly = false } = {}) {
  const usable = (drugs ?? []).filter((drug) => !enabledOnly || drug.enabled !== false);
  const known = new Set((groups ?? []).map((group) => String(group._id)));
  const byGroup = new Map();
  for (const drug of usable) {
    // 分類已經被刪、藥品還指著它（另一台剛刪）時當作未分類，不讓藥品憑空消失。
    const key = drug.groupId && known.has(String(drug.groupId)) ? String(drug.groupId) : null;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(drug);
  }
  const result = sortByDrugOrder(groups ?? []).map((group) => ({
    id: String(group._id),
    name: group.name,
    group,
    drugs: sortByDrugOrder(byGroup.get(String(group._id)) ?? []),
  }));
  result.push({ id: null, name: '未分類', group: null, drugs: sortByDrugOrder(byGroup.get(null) ?? []) });
  return result;
}

// 藥櫃視窗的搜尋：不分大小寫、任何位置都算，跨所有分類。
export function searchDrugs(drugs, keyword) {
  const needle = String(keyword ?? '').trim().toLowerCase();
  if (!needle) return [];
  return (drugs ?? []).filter((drug) => String(drug.name ?? '').toLowerCase().includes(needle));
}
