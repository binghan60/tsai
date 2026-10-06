export function paginationItems(page, totalPages) {
  const total = Math.max(Number(totalPages) || 1, 1);
  const current = Math.min(Math.max(Number(page) || 1, 1), total);

  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => ({ type: 'page', value: index + 1 }));
  }

  if (current <= 4) {
    return [
      ...Array.from({ length: 5 }, (_, index) => ({ type: 'page', value: index + 1 })),
      { type: 'ellipsis', key: 'end' },
      { type: 'page', value: total },
    ];
  }

  if (current >= total - 3) {
    return [
      { type: 'page', value: 1 },
      { type: 'ellipsis', key: 'start' },
      ...Array.from({ length: 5 }, (_, index) => ({ type: 'page', value: total - 4 + index })),
    ];
  }

  return [
    { type: 'page', value: 1 },
    { type: 'ellipsis', key: 'start' },
    { type: 'page', value: current - 1 },
    { type: 'page', value: current },
    { type: 'page', value: current + 1 },
    { type: 'ellipsis', key: 'end' },
    { type: 'page', value: total },
  ];
}

// 至少一頁：清單是空的也有「第 1 頁」，頁碼列與「超出最後一頁就退回」的判斷才不用另外處理 0。
export function pageCount(total, pageSize) {
  const size = Math.max(Number(pageSize) || 1, 1);
  return Math.max(Math.ceil((Number(total) || 0) / size), 1);
}

export function clampPage(page, totalPages) {
  return Math.min(Math.max(Math.trunc(Number(page)) || 1, 1), Math.max(Number(totalPages) || 1, 1));
}

export function pageSlice(items, page, pageSize) {
  return items.slice((page - 1) * pageSize, page * pageSize);
}
