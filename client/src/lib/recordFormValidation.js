// 報告送去預覽（＝準備結案）前的完整性檢查。
//
// 這份判準跟後端 server/src/lib/recordValidation.js 是同一套規則的兩個實作：
// 前端要能指到出問題的欄位並捲過去，所以吐的是帶 DOM 錨點的 issue；後端只要吐
// 缺什麼的清單。兩邊各寫一份的風險是判準分岔成「前端放行、後端 422」——使用者
// 按下預覽、通過、結案時才被擋，而且錯誤訊息還不一樣。後端那份已經有測試釘住，
// 這份抽出來的理由就是讓它也釘得住。
//
// 從 RecordFormPage.vue 抽出來時刻意不碰 Vue 與 DOM：sections 與作答都由呼叫端傳進來，
// 錨點只是照命名規則組字串。這樣測試不需要掛載元件。

// 「有預設值或屬於行政欄位」的角色，不能當作「這份報告有臨床內容」的訊號。
// 與後端 PREFILLED_ROLES 對應。
export const ADMIN_ROLES = new Set(['visitDate', 'vet']);

// 錨點要用實際渲染出來的 DOM id，不同型別的版式元件命名規則不同。
export function anchorFor(item, fallbackId = '') {
  if (!item) return fallbackId;
  if (item.type === 'finding') return `record-exam-row-${item.key}`;
  if (item.type === 'lab') return `record-lab-row-${item.key}`;
  return `record-${item.key}`;
}

// 「這個項目有沒有作答」的唯一判準，臨床內容檢查與必填檢查共用同一份——
// 兩邊各寫一份遲早會分岔。與後端 itemHasAnswer 對齊：
// finding 看有沒有標記過檢查結果（它沒有 value，看 value 會永遠不滿足）；
// lab 是標記過或填了數值都算，「按了正常但沒填數值」也是有作答。
export function createIsFilled({ getValue, findings = [], labFindings = [] }) {
  return function filled(item) {
    if (!item) return false;
    if (item.type === 'finding') return findings.some((entry) => entry.key === item.key && entry.status !== 'not_checked');
    if (item.type === 'lab') {
      return labFindings.some((entry) => entry.key === item.key && (entry.status !== 'not_checked' || String(entry.value ?? '').trim()));
    }
    return Boolean(String(getValue(item) ?? '').trim());
  };
}

export function collectPreviewIssues({ sections = [], getValue = () => null, findings = [], labFindings = [] } = {}) {
  const issues = [];
  const addIssue = (message, targetId, focusId = targetId) => issues.push({ message, targetId, focusId });
  const items = sections.flatMap((section) => section.items ?? []);
  const byRole = (role) => items.find((item) => item.role === role) ?? null;
  const fallbackId = sections[0]?.id ?? '';
  const filled = createIsFilled({ getValue, findings, labFindings });

  for (const item of items.filter((entry) => entry.required)) {
    if (!filled(item)) addIssue(`請填寫${item.label}`, anchorFor(item, fallbackId));
  }

  if (!items.some((item) => !ADMIN_ROLES.has(item.role) && filled(item))) {
    addIssue('請至少填寫一個區塊的檢查內容', fallbackId);
  }

  // 結論與照護建議至少要有一項；兩個欄位都被停用時就不檢查。
  const conclusion = byRole('conclusion');
  const treatmentPlan = byRole('treatmentPlan');
  if ((conclusion || treatmentPlan) && !filled(conclusion) && !filled(treatmentPlan)) {
    const label = [conclusion?.label, treatmentPlan?.label].filter(Boolean).join('或');
    addIssue(`請填寫${label}`, anchorFor(conclusion ?? treatmentPlan, fallbackId));
  }

  // 數值範圍取自範本項目，不寫死任何一個欄位的上下限。
  for (const item of items.filter((entry) => entry.type === 'measurement' || entry.type === 'number')) {
    const raw = getValue(item);
    if (raw === null || raw === undefined || String(raw).trim() === '') continue;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) {
      addIssue(`${item.label}必須是數字`, anchorFor(item, fallbackId));
      continue;
    }
    if (item.min != null && numeric < item.min) addIssue(`${item.label}不可小於 ${item.min}`, anchorFor(item, fallbackId));
    if (item.max != null && numeric > item.max) addIssue(`${item.label}不可大於 ${item.max}`, anchorFor(item, fallbackId));
  }

  // 標成異常卻沒寫說明，等於報告上出現一個沒有解釋的紅字。
  for (const finding of findings.filter((entry) => entry.status === 'abnormal' && !entry.note?.trim())) {
    addIssue(`請補充理學檢查異常說明：${finding.label}`, `record-exam-row-${finding.key}`, `record-exam-note-${finding.key}`);
  }
  for (const finding of labFindings.filter((entry) => entry.status === 'abnormal' && !entry.note?.trim())) {
    addIssue(`請補充檢驗異常說明：${finding.label}`, `record-lab-row-${finding.key}`, `record-lab-note-${finding.key}`);
  }

  return issues;
}
