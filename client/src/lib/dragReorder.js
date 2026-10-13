// 直排清單拖拉排序的計算（composables/useDragReorder.js 用）。
// rows 是拖拉開始時量到的每一列位置 { top, height }（清單座標、還沒位移前），from 是被拖的那一列。

// 被拖的列只能在清單範圍內移動，不會拖出第一列上方或最後一列下方。
export function clampDragOffset(rows, from, offset) {
  const dragged = rows[from];
  const last = rows.at(-1);
  const min = rows[0].top - dragged.top;
  const max = last.top + last.height - (dragged.top + dragged.height);
  return Math.min(max, Math.max(min, offset));
}

// 放開時會落在第幾格：往下拖時下緣越過哪幾列的中線、往上拖時上緣越過哪幾列的中線，就跟它們換位
// （用中線對中線要拖滿一整列才換，手感太鈍）。
export function dropIndex(rows, from, offset) {
  const top = rows[from].top + offset;
  const bottom = top + rows[from].height;
  let to = from;
  rows.forEach((row, index) => {
    const center = row.top + row.height / 2;
    if (index > from && bottom > center) to += 1;
    if (index < from && top < center) to -= 1;
  });
  return to;
}

// 拖拉途中其他列要讓位多少：被拖的列從 from 移到 to，中間那幾列往反方向挪一列的高度。
export function dragShift(index, from, to, height) {
  if (index === from) return 0;
  if (from < to && index > from && index <= to) return -height;
  if (to < from && index >= to && index < from) return height;
  return 0;
}

// 清單有分頁，畫面上只拖得到這一頁；把「這一頁的第 from 列放到第 to 格」換成伺服器要的
// beforeId（整份清單裡排在它下面的那一筆，null＝最後）。放到這一頁最後一格時，
// 它下面接的是整份清單裡這一頁之後的第一筆。
export function dropBeforeId(allIds, pageIds, from, to) {
  const moved = pageIds[from];
  const rest = pageIds.filter((id) => id !== moved);
  if (to < rest.length) return rest[to];
  const allRest = allIds.filter((id) => id !== moved);
  const lastIndex = allRest.indexOf(rest.at(-1));
  return lastIndex === -1 ? null : allRest[lastIndex + 1] ?? null;
}

// 鍵盤上下移一格（把手上按方向鍵）：回 { beforeId } 或 null（已經在最上面／最下面）。
export function stepBeforeId(allIds, id, step) {
  const index = allIds.indexOf(id);
  if (index === -1) return null;
  if (step < 0) return index === 0 ? null : { beforeId: allIds[index - 1] };
  if (index === allIds.length - 1) return null;
  return { beforeId: allIds[index + 2] ?? null };
}
