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

// ── 待確認清單（工具欄「檢驗」）：認不出貓的結果讓人選 ──

// IDEXX 上的名字是技術員手打的，比對時去掉所有空白、不分大小寫。
function nameKey(name) {
  return String(name ?? '').replace(/\s+/g, '').toLowerCase();
}

export function sameName(a, b) {
  return Boolean(nameKey(a)) && nameKey(a) === nameKey(b);
}

// 候選＝當天的掛號（取消、未到除外、已建檔的貓才算）。同名的排最前面，其餘依時段。
// 同名而且只有一隻，前端就預先選好（suggested）。
export function rankCandidates(appointments, patientName) {
  const candidates = (appointments ?? [])
    .filter((appointment) => appointment.petId && !INACTIVE_STATUSES.has(appointment.status))
    .map((appointment) => ({
      appointmentId: appointment._id,
      petId: appointment.petId,
      petName: appointment.petName ?? '',
      ownerName: appointment.ownerName ?? '',
      time: appointment.time ?? '',
      status: appointment.status,
      sameName: sameName(appointment.petName, patientName),
    }))
    .sort((a, b) => Number(b.sameName) - Number(a.sameName) || a.time.localeCompare(b.time));
  const matches = candidates.filter((candidate) => candidate.sameName);
  return candidates.map((candidate) => ({ ...candidate, suggested: matches.length === 1 && candidate.sameName }));
}

// 復原（選錯貓）：只清「現在還是當初填進去的值」的欄位；已經被人改過的留著，回報給使用者。
export function planUndo(currentLabValues, filled) {
  const current = new Map((currentLabValues ?? []).map((lab) => [lab.key, String(lab.value ?? '').trim()]));
  const clear = [];
  const kept = [];
  for (const entry of filled ?? []) {
    const value = current.get(entry.key);
    if (value === undefined) continue;
    if (value === String(entry.value ?? '').trim()) clear.push(entry.key);
    else kept.push(entry.label || entry.key);
  }
  return { clear, kept };
}

// ── 數值差異（醫師已經填了不同的值，IDEXX 沒有蓋掉）──

// 比對視窗打開時，用報告上「現在」的值重新比：醫師後來自己改成跟 IDEXX 一樣的就不再列。
export function liveConflicts(conflicts, currentLabValues) {
  const current = new Map((currentLabValues ?? []).map((lab) => [lab.key, String(lab.value ?? '').trim()]));
  return (conflicts ?? [])
    .map((conflict) => ({ key: conflict.key, label: conflict.label, current: current.get(conflict.key) ?? '', idexx: String(conflict.idexx ?? '') }))
    .filter((conflict) => conflict.current !== conflict.idexx);
}

// 使用者勾選要覆蓋的：只收這份結果真的有差異的欄位，前端送來別的 key 一律忽略。
export function overwriteValues(conflicts, keys) {
  const wanted = new Set((Array.isArray(keys) ? keys : []).map(String));
  return Object.fromEntries((conflicts ?? []).filter((conflict) => wanted.has(conflict.key)).map((conflict) => [conflict.key, conflict.idexx]));
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
