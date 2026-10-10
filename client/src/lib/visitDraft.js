// 診療台工作區一次編輯的欄位：量測與文字欄位（含藥單、內部備註），送同一支 workflow/clinical 端點自動存檔。
// 檢驗數值不在這裡編輯（IDEXX 自動填入、或在健檢報告填寫頁改），所以不在草稿裡。
export const CLINICAL_FIELDS = ['weightKg', 'temperatureC', 'visitNote', 'prescription', 'internalNote', 'specialCareNote', 'followUpRecommendation'];

// 量測在草稿裡一律是字串：輸入框是文字框，伺服器回的是數字，兩邊型別不同就會把同一個值當成改過。
const MEASUREMENT_FIELDS = new Set(['weightKg', 'temperatureC']);

export function clinicalDraft(appointment) {
  return Object.fromEntries(CLINICAL_FIELDS.map((key) => [key, MEASUREMENT_FIELDS.has(key) ? String(appointment[key] ?? '') : appointment[key] ?? '']));
}

// 只送有變的欄位。
export function draftPatch(draft, baseline) {
  return Object.fromEntries(CLINICAL_FIELDS.filter((key) => draft[key] !== baseline[key]).map((key) => [key, draft[key]]));
}

// 別人改了無關欄位（例如櫃台按了完成處理）時，不能把使用者正在打的字洗掉；
// 同一個欄位兩邊都動過才算衝突，交給使用者決定要留哪一份。
export function mergeClinicalUpdate(draft, baseline, incoming) {
  const latest = clinicalDraft(incoming);
  const merged = {};
  const conflicts = [];
  for (const key of CLINICAL_FIELDS) {
    const dirty = draft[key] !== baseline[key];
    const changed = latest[key] !== baseline[key];
    merged[key] = dirty ? draft[key] : latest[key];
    if (dirty && changed && draft[key] !== latest[key]) conflicts.push(key);
  }
  return { draft: merged, baseline: latest, conflicts };
}

// 衝突時「使用目前內容」：把某個欄位換回伺服器的版本。
export function takeBaseline(draft, baseline, key) {
  draft[key] = baseline[key];
}
