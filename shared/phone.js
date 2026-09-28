// 台灣手機號碼：09 開頭共 10 碼。公開初診頁前後端共用同一套判斷。
// 飼主常打成 0912-345-678、0912 345 678 或 +886 912 345 678，一律整理成 10 碼數字再存，
// 櫃台看到的格式才會一致；整理完仍不是手機號碼就回傳空字串。
export function normalizeMobilePhone(value) {
  let digits = String(value ?? '').replace(/[\s\-().]/g, '');
  if (digits.startsWith('+886')) digits = `0${digits.slice(4).replace(/^0/, '')}`;
  else if (digits.startsWith('886') && digits.length >= 12) digits = `0${digits.slice(3).replace(/^0/, '')}`;
  return /^09\d{8}$/.test(digits) ? digits : '';
}
