// 退信通知（DSN）的解析，純邏輯。讀信在 lib/mailBounces.js。
//
// 郵件伺服器收下信之後才發現投不到（地址不存在、信箱已滿到拒收、網域不收信），會寄一封通知回寄件信箱。
// 那封通知裡有三樣我們要的東西：原信的 Message-ID（對得回是哪一次寄送）、投不到的地址、原因。
// Gmail 的通知把原信的 Message-ID 放在 In-Reply-To／References 標頭，機器可讀的部分（message/delivery-status）
// 有 Action／Final-Recipient／Diagnostic-Code。

const unfold = (text) => String(text ?? '').replace(/\r?\n[ \t]+/g, ' ');
const field = (text, name) => new RegExp(`^${name}:[ \\t]*(.+)$`, 'im').exec(text)?.[1]?.trim() ?? '';
const messageIds = (value) => String(value ?? '').match(/<[^<>\s]+>/g) ?? [];

// 給人看的原因。診斷碼是英文的 SMTP 回應，挑最常見的幾種翻成一句話，其餘原文照列（截短）。
export function bounceReason(diagnostic) {
  const text = String(diagnostic ?? '').replace(/^smtp;\s*/i, '').trim();
  const lower = text.toLowerCase();
  if (/(5\.1\.1|user unknown|no such user|does not exist|address not found|unknown user|recipient address rejected|mailbox not found|invalid recipient)/.test(lower)) return '收件地址不存在';
  if (/(5\.2\.2|over quota|mailbox full|quota exceeded|out of storage)/.test(lower)) return '對方信箱已滿';
  if (/(5\.1\.2|domain not found|host not found|unrouteable|no mx|dns error|name or service not known)/.test(lower)) return '收件網域不存在或收不了信';
  if (/(5\.7\.|blocked|spam|policy|denied|rejected)/.test(lower)) return '被對方的郵件伺服器拒收';
  return text ? `無法送達（${text.slice(0, 160)}）` : '無法送達';
}

// source：通知信的原始內容（開頭一段就夠，原信的附件在最後面）；envelope：IMAP 給的信封（選填）。
// 不是「確定投不到」的通知回 null——暫時延遲（Action: delayed）之後可能還是送得到。
export function parseBounce(source, envelope = {}) {
  const text = unfold(source);
  const action = field(text, 'Action').toLowerCase();
  const failedRecipients = field(text, 'X-Failed-Recipients');
  // 沒有機器可讀的 Action 時，Gmail 的通知至少有 X-Failed-Recipients。
  if (action ? action !== 'failed' : !failedRecipients) return null;

  const originalIds = [...messageIds(envelope.inReplyTo), ...messageIds(field(text, 'In-Reply-To')), ...messageIds(field(text, 'References'))];
  if (!originalIds.length) return null;
  const recipient = (field(text, 'Final-Recipient') || field(text, 'Original-Recipient')).replace(/^rfc822;\s*/i, '').trim() || failedRecipients.split(',')[0].trim();
  return {
    messageIds: [...new Set(originalIds)],
    recipient,
    reason: bounceReason(field(text, 'Diagnostic-Code') || field(text, 'Status')),
  };
}
