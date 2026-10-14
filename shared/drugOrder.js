// 藥櫃的手動順序（分類之間、同一分類內的藥品）。規則跟院內待辦的拖拉排序一樣：
// 排過的照 sortOrder（0、1、2…），還沒排過的沒有 sortOrder，退回建立時間——新增的一律在最後。
import { compareTodoOrder, moveBefore } from './todoOrder.js';

export const compareDrugOrder = compareTodoOrder;

export function sortByDrugOrder(rows) {
  return [...rows].sort(compareDrugOrder);
}

// 把 id 放進 targetIds（目標分類目前的順序）並移到 beforeId 前面（null＝最後）。
// id 本來不在 targetIds 裡（換組）就先接在最後再移；beforeId 不在目標清單裡回 null（另一台剛改過）。
export function planDrugMove(targetIds, id, beforeId) {
  const list = targetIds.map(String);
  if (!list.includes(String(id))) list.push(String(id));
  return moveBefore(list, id, beforeId);
}
