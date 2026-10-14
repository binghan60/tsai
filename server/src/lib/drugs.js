// 藥櫃（醫師打藥單時的自動建議清單）的純邏輯：整理藥品名稱、判斷重複、拆批次貼上的多行文字。
// 一筆藥就是一行文字（可以連劑量一起寫），所以名稱裡不留換行，連續空白併成一個。
export const DRUG_NAME_MAX_LENGTH = 200;
export const DRUG_BULK_MAX = 500;

export function cleanDrugName(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

// 重複的判斷不分大小寫、不看空白多寡：Metoclopramide 與 metoclopramide 是同一筆。
export function drugNameKey(value) {
  return cleanDrugName(value).toLowerCase();
}

// 批次新增：可以傳陣列，或一段一行一筆的文字。整理後去掉空行與彼此重複的（留第一次出現的寫法）。
export function parseDrugNames(input) {
  const lines = Array.isArray(input) ? input : String(input ?? '').split(/\r?\n/);
  const seen = new Set();
  const names = [];
  for (const line of lines) {
    const name = cleanDrugName(line);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}
