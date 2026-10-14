// 藥櫃建議的比對邏輯：打藥單時，拿游標前正在打的那一段去比對藥櫃，跳出建議。
//
// 「正在打的那一段」＝從上一個空白或標點（或行首）到游標。開頭的編號（「1.」「2)」）不算進去，
// 所以「1.met」一樣比對 met。英文至少兩個字才比（一個字母幾乎什麼都對得到）；有中文的一個字就比。
const SEPARATOR = /[\s\u3000,，、;；:：。()（）[\]【】「」『』/／+＋*=<>]/u;
const LEADING_NUMBERING = /^[\d.\-)）]+/;
const NON_ASCII_LETTER = /[^\x00-\x7F]/; // eslint-disable-line no-control-regex
const MAX_QUERY_LENGTH = 40;

export function drugQueryAt(textBefore) {
  const text = String(textBefore ?? '');
  let start = text.length;
  while (start > 0 && !SEPARATOR.test(text[start - 1])) start -= 1;
  const numbering = text.slice(start).match(LEADING_NUMBERING);
  if (numbering) start += numbering[0].length;
  const query = text.slice(start);
  if (!query || query.length > MAX_QUERY_LENGTH) return null;
  if (!/\p{L}/u.test(query)) return null;
  if (!NON_ASCII_LETTER.test(query) && query.length < 2) return null;
  return { start, query };
}

// 比對不分大小寫、任何位置都算；排序：開頭就符合 > 某個英文字的開頭符合 > 中間符合，
// 同一級再看使用次數、名稱。已經打完整的那一筆不再建議。
export function rankDrugs(drugs, query, limit = 8) {
  const keyword = String(query ?? '').toLowerCase();
  if (!keyword) return [];
  const ranked = [];
  for (const drug of drugs ?? []) {
    if (drug?.enabled === false) continue;
    const name = String(drug?.name ?? '');
    const lower = name.toLowerCase();
    if (lower === keyword) continue;
    const index = lower.indexOf(keyword);
    if (index < 0) continue;
    let tier = 2;
    if (index === 0) tier = 0;
    else if (wordStartIndex(lower, keyword) >= 0) tier = 1;
    ranked.push({ drug, tier, matchStart: tier === 1 ? wordStartIndex(lower, keyword) : index });
  }
  ranked.sort((a, b) => a.tier - b.tier
    || (b.drug.usageCount ?? 0) - (a.drug.usageCount ?? 0)
    || String(a.drug.name).localeCompare(String(b.drug.name), 'zh-Hant'));
  return ranked.slice(0, limit).map(({ drug, matchStart }) => ({ ...drug, matchStart, matchLength: keyword.length }));
}

// 關鍵字出現在某個英文字開頭的位置（前一個字元不是英數字），找不到回 -1。
function wordStartIndex(lower, keyword) {
  let index = lower.indexOf(keyword);
  while (index >= 0) {
    if (index === 0 || !/[a-z0-9]/.test(lower[index - 1])) return index;
    index = lower.indexOf(keyword, index + 1);
  }
  return -1;
}

// 常用藥品（pinnedAt 有值）：常駐在藥單輸入框上方的快捷按鈕。停用的不出現；依設成常用的時間排，先設的在前，位置才固定好記。
export function pinnedDrugs(drugs) {
  return (drugs ?? [])
    .filter((drug) => drug?.pinnedAt && drug.enabled !== false)
    .sort((a, b) => new Date(a.pinnedAt) - new Date(b.pinnedAt));
}
