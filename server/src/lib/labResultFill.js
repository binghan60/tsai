import { idexxCodeKey } from '../../../shared/labValues.js';

// IDEXX 檢驗結果 → 看診的檢驗數值（appointment.labValues）。看診是檢驗數值的唯一存放處，
// 健檢報告草稿讀的就是它（lib/recordVisitLink.js），所以填進看診＝報告打開就看得到。
// 這裡只放判斷規則（純邏輯）；讀寫資料庫在 lib/labResultApply.js。

// 報到時送到 IDEXX 主機的病患編號就是貓咪的 _id，結果會原樣帶回來；
// 在 IDEXX 主機上手動新增的病患沒有編號（空字串），或是別的系統留下的編號，都不算。
export function petIdFromPatientId(patientId) {
  const text = String(patientId ?? '').trim();
  return /^[0-9a-f]{24}$/i.test(text) ? text : null;
}

const INACTIVE_STATUSES = new Set(['cancelled', 'no_show']);

// 這份結果屬於哪一次看診：同一隻貓、檢驗當天的掛號（呼叫端已經用日期篩過），排除取消與未到。
// 當天只有一筆就是它；有好幾筆時挑「檢驗之前最後報到的那一筆」，都還沒報到就不猜。
export function pickVisit(appointments, runAt) {
  const active = (appointments ?? []).filter((appointment) => !INACTIVE_STATUSES.has(appointment.status));
  if (active.length <= 1) return active[0] ?? null;
  const runTime = runAt ? new Date(runAt).getTime() : Infinity;
  const checkedIn = active
    .filter((appointment) => appointment.checkedInAt && new Date(appointment.checkedInAt).getTime() <= runTime)
    .sort((a, b) => new Date(b.checkedInAt) - new Date(a.checkedInAt));
  return checkedIn[0] ?? null;
}

// 儀器自己判定沒結果（!）或結果無效（-，例如 inVue 因檢體品質壓掉的結果）的項目不填。
const UNUSABLE_QUALIFIERS = new Set(['!', '-']);
// 跟看診 labValues 的欄位長度上限一致（models/Appointment.js）。
const LAB_VALUE_MAX = 40;

// 決定要填哪些格子：
//   fill      這些 key 目前是空的，填 IDEXX 的值
//   conflicts 已經有人填了不同的值——不蓋掉，記下來讓醫師自己決定
//   unmapped  表單裡沒有對應代號的項目（全血檢常有二十幾項，表單只列幾項，這很正常）
// 同一個項目有兩個代號都出現在這份結果裡時，以先出現的為準。
export function planLabFill(assays, labItems, currentLabValues) {
  const itemsByCode = new Map();
  for (const item of labItems ?? []) {
    for (const code of item.idexxCodes ?? []) itemsByCode.set(idexxCodeKey(code), item);
  }
  const current = new Map((currentLabValues ?? []).map((lab) => [lab.key, String(lab.value ?? '').trim()]));
  const fill = {};
  const conflicts = [];
  const unmapped = [];
  const handled = new Set();

  for (const assay of assays ?? []) {
    const item = itemsByCode.get(idexxCodeKey(assay.code));
    if (!item) {
      unmapped.push(assay.code);
      continue;
    }
    if (handled.has(item.key)) continue;
    const value = String(assay.value ?? '').trim();
    if (!value || UNUSABLE_QUALIFIERS.has(assay.qualifier) || value.length > LAB_VALUE_MAX) continue;
    handled.add(item.key);
    const existing = current.get(item.key) ?? '';
    if (!existing) fill[item.key] = value;
    else if (existing !== value) conflicts.push({ key: item.key, label: item.label, current: existing, idexx: value });
  }
  return { fill, conflicts, unmapped };
}
