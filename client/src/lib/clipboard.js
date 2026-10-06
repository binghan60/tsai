// 複製到剪貼簿。成功回 true；瀏覽器不給寫（非 HTTPS、沒有權限、分頁不在前景）回 false，由呼叫端決定怎麼提示。
export async function copyText(value) {
  try {
    await navigator.clipboard.writeText(String(value ?? ''));
    return true;
  } catch {
    return false;
  }
}
