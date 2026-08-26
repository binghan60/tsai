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
