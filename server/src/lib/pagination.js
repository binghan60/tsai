export function paginationOptions(
  query,
  { defaultLimit = 25, maxLimit = 100, pageParam = 'page', limitParam = 'limit' } = {}
) {
  const parsedPage = Number.parseInt(query?.[pageParam], 10);
  const parsedLimit = Number.parseInt(query?.[limitParam], 10);
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const requestedLimit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : defaultLimit;
  const limit = Math.min(requestedLimit, maxLimit);

  return { page, limit, skip: (page - 1) * limit };
}

export function paginationMeta(total, { page, limit }) {
  return {
    total,
    page,
    limit,
    totalPages: Math.max(Math.ceil(total / limit), 1),
  };
}

export function paginatedPayload(items, total, pagination) {
  return { items, ...paginationMeta(total, pagination) };
}
