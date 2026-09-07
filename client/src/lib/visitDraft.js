export const CLINICAL_FIELDS = ['weightKg', 'temperatureC', 'visitNote', 'handoffNote', 'specialCareNote', 'followUpRecommendation', 'followUpReason', 'billingItems'];
export function clinicalDraft(appointment) {
  return Object.fromEntries(CLINICAL_FIELDS.map(key => [key, key === 'billingItems'
    ? JSON.parse(JSON.stringify(appointment[key] || []))
    : appointment[key] ?? '']));
}
export function draftPatch(draft, baseline) {
  return Object.fromEntries(CLINICAL_FIELDS.filter(key => JSON.stringify(draft[key]) !== JSON.stringify(baseline[key])).map(key => [key, draft[key]]));
}
// Preserve typing when unrelated payment or scheduling updates arrive.
export function mergeClinicalUpdate(draft, baseline, incoming) {
  const latest = clinicalDraft(incoming);
  const merged = {};
  const conflicts = [];
  for (const key of CLINICAL_FIELDS) {
    const dirty = JSON.stringify(draft[key]) !== JSON.stringify(baseline[key]);
    const changed = JSON.stringify(latest[key]) !== JSON.stringify(baseline[key]);
    merged[key] = dirty ? draft[key] : latest[key];
    if (dirty && changed && JSON.stringify(draft[key]) !== JSON.stringify(latest[key])) conflicts.push(key);
  }
  return { draft: merged, baseline: latest, conflicts };
}
