// 醫師工作區一次編輯的欄位：量測、檢驗數值、文字欄位（含藥單）與內部備註，送同一支 clinical 端點。
// 檢驗數值在草稿裡是 { 項目 key: 字串 }，比對與衝突都逐項算——醫師在打 WBC 時，
// 別台存了 ALT 不該被當成衝突。衝突的檢驗項目用 `lab:<key>` 表示。
export const CLINICAL_FIELDS = ['weightKg', 'temperatureC', 'visitNote', 'prescription', 'internalNote', 'specialCareNote', 'followUpRecommendation', 'followUpReason'];
export const labConflictKey = (key) => `lab:${key}`;

function labMap(appointment) {
  return Object.fromEntries((appointment?.labValues ?? []).map((lab) => [lab.key, String(lab.value ?? '')]));
}

// 量測在草稿裡一律是字串：輸入框是文字框，伺服器回的是數字，兩邊型別不同就會把同一個值當成改過。
const MEASUREMENT_FIELDS = new Set(['weightKg', 'temperatureC']);

export function clinicalDraft(appointment) {
  return {
    ...Object.fromEntries(CLINICAL_FIELDS.map((key) => [key, MEASUREMENT_FIELDS.has(key) ? String(appointment[key] ?? '') : appointment[key] ?? ''])),
    labs: labMap(appointment),
  };
}

function labKeys(...maps) {
  return [...new Set(maps.flatMap((map) => Object.keys(map ?? {})))];
}

// 只送有變的欄位。檢驗數值送 { key: value }，空字串＝拿掉這一項（後端 mergeLabValues 的規則）。
export function draftPatch(draft, baseline) {
  const patch = Object.fromEntries(CLINICAL_FIELDS.filter((key) => draft[key] !== baseline[key]).map((key) => [key, draft[key]]));
  const labs = {};
  for (const key of labKeys(draft.labs, baseline.labs)) {
    const local = draft.labs?.[key] ?? '';
    if (local !== (baseline.labs?.[key] ?? '')) labs[key] = local;
  }
  if (Object.keys(labs).length) patch.labValues = labs;
  return patch;
}

// 別人改了無關欄位（例如櫃台按了完成處理）時，不能把使用者正在打的字洗掉；
// 同一個欄位兩邊都動過才算衝突，交給使用者決定要留哪一份。
export function mergeClinicalUpdate(draft, baseline, incoming) {
  const latest = clinicalDraft(incoming);
  const merged = { labs: {} };
  const conflicts = [];
  for (const key of CLINICAL_FIELDS) {
    const dirty = draft[key] !== baseline[key];
    const changed = latest[key] !== baseline[key];
    merged[key] = dirty ? draft[key] : latest[key];
    if (dirty && changed && draft[key] !== latest[key]) conflicts.push(key);
  }
  for (const key of labKeys(draft.labs, baseline.labs, latest.labs)) {
    const local = draft.labs?.[key] ?? '';
    const base = baseline.labs?.[key] ?? '';
    const remote = latest.labs?.[key] ?? '';
    const dirty = local !== base;
    const value = dirty ? local : remote;
    if (value) merged.labs[key] = value;
    if (dirty && remote !== base && local !== remote) conflicts.push(labConflictKey(key));
  }
  return { draft: merged, baseline: latest, conflicts };
}

// 衝突時「使用目前內容」：把某個欄位（或某一項檢驗）換回伺服器的版本。
export function takeBaseline(draft, baseline, conflictKey) {
  if (conflictKey.startsWith('lab:')) {
    const key = conflictKey.slice(4);
    const value = baseline.labs?.[key] ?? '';
    if (value) draft.labs[key] = value;
    else delete draft.labs[key];
    return;
  }
  draft[conflictKey] = baseline[conflictKey];
}
