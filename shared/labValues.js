// 檢驗數值的共用規則：病歷日誌的檢驗摘要、健檢報告填寫頁寫回看診的驗證都用這份。
// 檢驗項目不是另一份清單，而是掛號時選的健檢表單裡「檢驗」類型的項目。

// 表單裡啟用中的檢驗項目（停用的區塊、停用的項目都不算）。
export function templateLabItems(template) {
  const items = [];
  for (const section of template?.sections ?? []) {
    if (section.enabled === false) continue;
    for (const item of section.items ?? []) {
      if (item.type === 'lab' && item.enabled !== false) items.push(item);
    }
  }
  return items;
}

// IDEXX 儀器回傳的項目代號（例如 CREA、RBC_BLD）→ 表單的檢驗項目；儀器驗完會依這個自動填進看診的檢驗數值。
// 同一個項目在不同儀器上代號不同（血球機 RBC、inVue RBC_BLD），所以一個項目可以有好幾個。
// 代號本身可能有空格（SNAP 判讀機的「Bile acids Preprandial」），只能用逗號或頓號分隔，不能用空白。
// 比對不分大小寫；存的時候保留使用者打的寫法，去掉空白與重複。
const IDEXX_CODE_MAX = 40;
const IDEXX_CODES_PER_ITEM = 10;

export function idexxCodeKey(code) {
  return String(code ?? '').trim().toUpperCase();
}

// IDEXX 檢驗別＝結果上的儀器名稱（Catalyst_One、IDEXX_inVue_Dx、SNAP）。不同儀器可能用同一個代號指不同的東西，
// 所以比對是「檢驗別＋代號」。儀器名稱是機器寫的，比對時不分大小寫，底線與空白視為相同（Catalyst One＝Catalyst_One）。
// 留空＝任何儀器的結果都對得上（舊的表單都是這樣）。
const IDEXX_INSTRUMENT_MAX = 60;

export function normalizeIdexxInstrument(value) {
  return String(value ?? '').trim().slice(0, IDEXX_INSTRUMENT_MAX);
}

export function idexxInstrumentKey(instrument) {
  return String(instrument ?? '').trim().replace(/[\s_]+/g, ' ').toLowerCase();
}

export function normalizeIdexxCodes(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(/[,，、\n]/);
  const seen = new Set();
  const codes = [];
  for (const raw of list) {
    const code = String(raw ?? '').trim().slice(0, IDEXX_CODE_MAX);
    if (!code || seen.has(idexxCodeKey(code))) continue;
    seen.add(idexxCodeKey(code));
    codes.push(code);
  }
  return codes.slice(0, IDEXX_CODES_PER_ITEM);
}

// IDEXX 結果實際要顯示的數值：醫師在病歷日誌改過的（labResults.overrides）換成改後的值，
// 另帶 edited 與 originalValue（IDEXX 原始值）。原始的 assays 不動——那是儀器原文，IDEXX 送更正版時也只更新它。
export function effectiveAssays(result) {
  const overrides = new Map((result?.overrides ?? []).map((entry) => [entry.code, entry.value]));
  return (result?.assays ?? []).map((assay) => (overrides.has(assay.code)
    ? { ...assay, value: overrides.get(assay.code), originalValue: assay.value, edited: true }
    : assay));
}

// 偏高 ↑／偏低 ↓；不是數字、沒有參考範圍、在範圍內都回空字串。
export function labFlag(lab) {
  const text = String(lab?.value ?? '').trim();
  const numeric = Number(text);
  if (!text || !Number.isFinite(numeric)) return '';
  if (lab.referenceMax !== null && lab.referenceMax !== undefined && numeric > lab.referenceMax) return '↑';
  if (lab.referenceMin !== null && lab.referenceMin !== undefined && numeric < lab.referenceMin) return '↓';
  return '';
}
