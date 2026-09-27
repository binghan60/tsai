// 報到建立的健檢報告草稿連著一筆看診（後端 lib/recordVisitLink.js）：
// 體重、體溫、檢驗數值只存在看診上，填寫頁顯示的是看診的值，在這裡改＝寫回看診。
// 回診日期也來自看診，但只能讀（在掛號台敲定）。
//
// 填寫頁要做兩件事：
//   1. 存檔時只送醫師這次真的改過的欄位（visitEdits）——跟上一次從伺服器拿到的值比，
//      沒改的欄位不送，才不會拿舊畫面蓋掉診療台剛改的值；
//   2. 存檔回來帶著看診的最新值：存檔期間醫師沒動的欄位換成新值。

function numberText(value) {
  if (value === null || value === undefined || String(value).trim() === '') return '';
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : String(value).trim();
}

// source 是 { weightKg, temperatureC, labFindings }；labKeys 是這份範本的檢驗項目 key。
// 回傳以欄位 key 為鍵的可比較字串：weightKg、temperatureC、lab:<key>。
export function visitSnapshot(source, labKeys = []) {
  const labs = new Map((source?.labFindings ?? []).map((finding) => [finding.key, String(finding.value ?? '').trim()]));
  const snapshot = { weightKg: numberText(source?.weightKg), temperatureC: numberText(source?.temperatureC) };
  for (const key of labKeys) snapshot[`lab:${key}`] = labs.get(key) ?? '';
  return snapshot;
}

// 要寫回看診的欄位：跟 baseline（上次伺服器的值）不一樣的。沒有就回 null。
export function visitEdits(current, baseline) {
  if (!baseline) return null;
  const edits = {};
  for (const [key, value] of Object.entries(current)) {
    if (value === (baseline[key] ?? '')) continue;
    if (key.startsWith('lab:')) (edits.labValues ??= {})[key.slice(4)] = value;
    else edits[key] = value === '' ? null : Number(value);
  }
  return Object.keys(edits).length ? edits : null;
}

// 存檔回來後要換成伺服器值的欄位：存檔期間畫面沒變（current＝sent），而伺服器的值不一樣。
export function refreshedVisitKeys({ current, sent, server }) {
  return Object.keys(server).filter((key) => current[key] === sent[key] && current[key] !== server[key]);
}
