// 櫃台處理視窗的「處理事項」：櫃台對這次看診做了哪些事（開收據、給藥單、影像怎麼給……）。
// 勾了都會寫進病歷日誌的「櫃台處理」一列；只有「上傳影像」另外會新增一筆院內待辦（見 imageUpload，不在這裡）。
// 原本是寫在 Google 表單備註裡的一串括號字，這裡把它們整理成分組：
//   - exclusive 的組一次只能選一個（影像怎麼給、收據要不要印花）；
//   - 沒選＝沒做／不適用，不是「否」。
export const DESK_ITEM_GROUPS = [
  {
    key: 'image',
    label: '影像',
    exclusive: true,
    // 「上傳影像」是同一組的第一個選項，但它有自己的欄位與待辦（imageUpload），不在 items 裡。
    items: [
      { key: 'image_usb', label: '影像USB' },
      { key: 'no_image', label: 'NO影像' },
    ],
  },
  {
    key: 'receipt',
    label: '收據',
    exclusive: true,
    items: [
      { key: 'receipt', label: '已開收據' },
      { key: 'receipt_no_stamp', label: '已開收據（不用印花）' },
    ],
  },
  {
    key: 'other',
    label: '其他',
    exclusive: false,
    items: [
      { key: 'itemized_bill', label: '已開明細' },
      { key: 'diagnosis_certificate', label: '已開診斷證明' },
      { key: 'prescription_given', label: '已給藥單' },
      { key: 'consent_signed', label: '已簽用藥同意書' },
      { key: 'no_visit_record', label: '這次看診不寄就診紀錄' },
    ],
  },
];

// 照定義順序排好的全部項目（日誌與儲存都用這個順序，兩台裝置勾的先後不影響結果）。
export const DESK_ITEMS = DESK_ITEM_GROUPS.flatMap((group) => group.items.map((item) => ({ ...item, group: group.key })));
export const DESK_ITEM_KEYS = DESK_ITEMS.map((item) => item.key);
const LABELS = new Map(DESK_ITEMS.map((item) => [item.key, item.label]));
const GROUP_OF = new Map(DESK_ITEMS.map((item) => [item.key, item.group]));
const EXCLUSIVE_GROUPS = new Set(DESK_ITEM_GROUPS.filter((group) => group.exclusive).map((group) => group.key));

export function deskItemLabel(key) {
  return LABELS.get(key) ?? '';
}

// 整理成定義順序、去重、丟掉不認得的（讀舊資料用）。
export function sortDeskItems(keys) {
  const wanted = new Set(Array.isArray(keys) ? keys : []);
  return DESK_ITEM_KEYS.filter((key) => wanted.has(key));
}

// 驗證送進來的勾選：回 { items } 或 { error }。不認得的項目、同一個互斥組選了兩個都是錯誤。
export function checkDeskItems(value) {
  if (!Array.isArray(value)) return { error: '處理事項的格式不正確' };
  if (value.some((key) => !LABELS.has(key))) return { error: '處理事項不在清單裡' };
  const unique = new Set(value);
  for (const group of EXCLUSIVE_GROUPS) {
    if ([...unique].filter((key) => GROUP_OF.get(key) === group).length > 1) {
      return { error: '同一組的處理事項只能選一個' };
    }
  }
  return { items: sortDeskItems([...unique]) };
}

// 勾／取消勾一項後的新集合：互斥組裡勾新的會自動取消同組原本的那一個。
export function toggleDeskItem(current, key, checked) {
  const next = new Set(current);
  if (!checked) {
    next.delete(key);
    return sortDeskItems([...next]);
  }
  const group = GROUP_OF.get(key);
  if (EXCLUSIVE_GROUPS.has(group)) {
    for (const other of [...next]) if (GROUP_OF.get(other) === group) next.delete(other);
  }
  next.add(key);
  return sortDeskItems([...next]);
}

// 病歷日誌「櫃台處理」那一列的結構化版本：依組別分段（影像／收據／其他），只回有勾的組，組內照定義順序。
// 前端依它畫成一組一行的徽章，不必再把「、」串起來的文字拆回去。
export function deskItemGroups(keys) {
  const picked = new Set(sortDeskItems(keys));
  return DESK_ITEM_GROUPS
    .map((group) => ({
      key: group.key,
      label: group.label,
      items: group.items.filter((item) => picked.has(item.key)).map((item) => ({ key: item.key, label: item.label })),
    }))
    .filter((group) => group.items.length);
}

// 病歷日誌「櫃台處理」那一列的文字：定義順序、用「、」接起來。沒有項目回空字串。
export function deskItemsText(keys) {
  return sortDeskItems(keys).map(deskItemLabel).join('、');
}
