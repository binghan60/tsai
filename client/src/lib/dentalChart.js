// 牙齒圖的資料與摘要：{ teeth: { '104': { status, note } }, restNormal }。
// 只記有狀況的牙；restNormal＝醫師按了「其餘全部正常」，報告上會寫出來，
// 否則沒標的牙到底是「正常」還是「沒檢查」看不出來。
//
// 每種狀況除了顏色還有形狀記號（虛線、點點、斜線、打叉），列印成黑白或紅綠色盲時仍分得出來。
export const DENTAL_STATES = [
  { value: 'missing', label: '缺牙', mark: '虛線外框' },
  { value: 'calculus', label: '牙結石', mark: '點點' },
  { value: 'periodontal', label: '牙周病', mark: '斜線' },
  { value: 'extracted', label: '拔除', mark: '打叉' },
  { value: 'other', label: '其他', mark: '實色' },
];
const LABELS = Object.fromEntries(DENTAL_STATES.map((state) => [state.value, state.label]));

export function normalizeDental(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { teeth: {}, restNormal: false };
  return { teeth: value.teeth ?? {}, restNormal: Boolean(value.restNormal) };
}

export function hasDentalContent(value) {
  const chart = normalizeDental(value);
  return chart.restNormal || Object.keys(chart.teeth).length > 0;
}

const byCode = (a, b) => a.localeCompare(b, 'en', { numeric: true });

// 圖下方（與報告上）的文字清單：依狀況分組列牙位，再列有備註的牙。
export function dentalSummary(value) {
  const { teeth, restNormal } = normalizeDental(value);
  const groups = DENTAL_STATES.map((state) => ({
    status: state.value,
    label: state.label,
    codes: Object.keys(teeth).filter((code) => teeth[code]?.status === state.value).sort(byCode),
  })).filter((group) => group.codes.length);
  const notes = Object.keys(teeth)
    .filter((code) => String(teeth[code]?.note ?? '').trim())
    .sort(byCode)
    .map((code) => ({ code, status: teeth[code]?.status || '', label: LABELS[teeth[code]?.status] || '', note: String(teeth[code].note).trim() }));
  return { groups, notes, restNormal };
}

// 刷子模式：點一顆牙就套上目前選的狀況；再點一次同一個狀況就拿掉（備註留著時只清狀況）。
export function brushTooth(value, code, status) {
  const chart = normalizeDental(value);
  const current = chart.teeth[code] ?? {};
  const teeth = { ...chart.teeth };
  if (current.status === status) {
    if (String(current.note ?? '').trim()) teeth[code] = { ...current, status: '' };
    else delete teeth[code];
  } else {
    teeth[code] = { ...current, status, note: current.note ?? '' };
  }
  return { ...chart, teeth };
}
