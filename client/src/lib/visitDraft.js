// 醫師工作區一次編輯的欄位。四個文字欄位各有各的讀者（見 shared/appointmentWorkflow.js
// 與設計稿的分工表），量測值則同時要進病歷日誌，所以一起送同一支 clinical 端點。
export const CLINICAL_FIELDS = ['weightKg', 'temperatureC', 'visitNote', 'handoffNote', 'specialCareNote', 'followUpRecommendation', 'followUpReason'];

export function clinicalDraft(appointment) {
  return Object.fromEntries(CLINICAL_FIELDS.map(key => [key, appointment[key] ?? '']));
}

export function draftPatch(draft, baseline) {
  return Object.fromEntries(CLINICAL_FIELDS.filter(key => draft[key] !== baseline[key]).map(key => [key, draft[key]]));
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
