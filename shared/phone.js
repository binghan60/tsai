// 台灣手機號碼：09 開頭共 10 碼。飼主的「手機」欄前後端共用同一套判斷（公開初診頁、櫃台端的飼主與掛號）；
// 市話另有 landline 欄位，不走這裡。
// 常見的寫法 0912-345-678、0912 345 678、+886 912 345 678 一律整理成 10 碼數字再存，
// 櫃台看到的格式才會一致；整理完仍不是手機號碼就回傳空字串。
export function normalizeMobilePhone(value) {
  let digits = String(value ?? '').replace(/[\s\-().]/g, '');
  if (digits.startsWith('+886')) digits = `0${digits.slice(4).replace(/^0/, '')}`;
  else if (digits.startsWith('886') && digits.length >= 12) digits = `0${digits.slice(3).replace(/^0/, '')}`;
  return /^09\d{8}$/.test(digits) ? digits : '';
}

export const MOBILE_PHONE_ERROR = '請填寫 09 開頭的 10 碼手機號碼';

// 回傳 { phone: 要存的值, error }。空值不算錯（必填與否由呼叫端決定）。
// previous 是原本存的值：沒改動就照收——舊系統匯入的飼主「手機」常是市話，
// 不能因為順手改了姓名或地址就被擋下來；真的改了電話才要求是手機格式。
export function checkMobilePhone(value, previous) {
  const raw = String(value ?? '').trim();
  if (!raw) return { phone: '', error: '' };
  const normalized = normalizeMobilePhone(raw);
  if (normalized) return { phone: normalized, error: '' };
  if (previous !== undefined && previous !== null && raw === String(previous).trim()) return { phone: raw, error: '' };
  return { phone: raw, error: MOBILE_PHONE_ERROR };
}
