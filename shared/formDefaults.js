const DEFAULT_VALUE_TYPES = new Set(['text', 'textarea', 'number', 'date', 'select', 'radio', 'checkbox']);

// Dependency-free so the browser and API apply identical template-default rules.
export function defaultValueForItem(item) {
  const value = String(item?.defaultValue ?? '').trim();
  if (!value || item?.enabled === false || !DEFAULT_VALUE_TYPES.has(item?.type)) return undefined;
  if (item.type === 'checkbox') {
    const options = new Set((item.options ?? []).filter(Boolean));
    const selected = value.split(',').map((option) => option.trim()).filter((option) => options.has(option));
    return selected.length ? selected : undefined;
  }
  if (['select', 'radio'].includes(item.type) && !(item.options ?? []).includes(value)) return undefined;
  return value;
}
