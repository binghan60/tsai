// 從表單範本衍生出各區塊需要的項目定義。
// 這裡產出的物件形狀刻意與原本硬編碼的常數一致，讓既有版面不必改寫。

export function allItems(template) {
  return (template?.sections ?? []).flatMap((section) =>
    (section.items ?? []).map((item) => ({ ...item, sectionKey: section.key }))
  );
}

export function itemsOfType(template, type) {
  return allItems(template).filter((item) => item.type === type);
}

export function itemByRole(template, role) {
  return allItems(template).find((item) => item.role === role) ?? null;
}

export function measurementDefs(template) {
  return itemsOfType(template, 'measurement').map(({ key, label, unit, min, max, step, referenceMin, referenceMax }) => ({
    key,
    label,
    unit,
    min,
    max,
    step,
    referenceMin: referenceMin ?? null,
    referenceMax: referenceMax ?? null,
  }));
}

export function examinationDefs(template) {
  return itemsOfType(template, 'finding').map(({ key, label }) => ({ key, label }));
}

export function labDefs(template) {
  return itemsOfType(template, 'lab').map(({ key, label, group, numeric, unit, referenceMin, referenceMax }) => ({
    key,
    label,
    group,
    numeric,
    unit: unit ?? '',
    referenceMin: referenceMin ?? null,
    referenceMax: referenceMax ?? null,
  }));
}

// 填表單時的自動判讀依據：直接來自範本項目，不必再打一次 API。
export function referenceRanges(template) {
  return Object.fromEntries(
    allItems(template)
      .filter((item) => (item.type === 'measurement' || item.type === 'lab')
        && (item.referenceMin != null || item.referenceMax != null))
      .map((item) => [item.key, { min: item.referenceMin ?? null, max: item.referenceMax ?? null, unit: item.unit ?? '' }])
  );
}

export function labGroups(template) {
  return [...new Set(labDefs(template).map((item) => item.group).filter(Boolean))];
}

// 表單頁的 DOM id 沿用 `record-section-<key>`，既有的錨點與捲動行為不受影響。
export function sectionDomId(sectionKey) {
  return `record-section-${sectionKey}`;
}

export function sectionKeyForItem(template, itemKey) {
  return allItems(template).find((item) => item.key === itemKey)?.sectionKey ?? null;
}
