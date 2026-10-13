// 院內待辦的手動順序（拖拉排序）。前端拖放時先在本機排好（不等伺服器），
// 伺服器收到「把 id 移到 beforeId 前面」再用同一套規則排一次、寫回 sortOrder。

// 未完成清單的排序鍵：拖拉過的照 sortOrder（重新編號成 0、1、2…）；還沒排過的沒有 sortOrder，
// 退回建立時間的毫秒數——一定比編號大，所以新增的一律在最下面。
export function todoSortKey(todo) {
  if (typeof todo?.sortOrder === 'number' && Number.isFinite(todo.sortOrder)) return todo.sortOrder;
  const created = new Date(todo?.createdAt).getTime();
  return Number.isFinite(created) ? created : 0;
}

export function compareTodoOrder(a, b) {
  const diff = todoSortKey(a) - todoSortKey(b);
  if (diff) return diff;
  return String(a?._id ?? '').localeCompare(String(b?._id ?? ''));
}

// 把 id 從清單裡拿出來，插到 beforeId 前面；beforeId 是 null＝移到最後。
// id 不在清單裡、或 beforeId 指到不在清單裡的項目（另一台剛完成或刪掉了）回 null。
export function moveBefore(ids, id, beforeId) {
  const list = ids.map(String);
  const from = list.indexOf(String(id));
  if (from === -1) return null;
  list.splice(from, 1);
  if (beforeId === null || beforeId === undefined) {
    list.push(String(id));
    return list;
  }
  const to = list.indexOf(String(beforeId));
  if (to === -1) return null;
  list.splice(to, 0, String(id));
  return list;
}
