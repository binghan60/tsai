import { resolveMx, resolve4, resolve6 } from 'node:dns/promises';

// 寄出前能擋的打錯：格式、常見的網域錯字、根本收不了信的網域。
// 帳號那一段打錯（wang123 → wang132）這裡擋不到，要靠退信（lib/mailBounces.js）。
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 常見的網域錯字 → 原本要打的。只列「幾乎不可能是真的」的寫法；清單以外的交給 DNS 檢查。
const DOMAIN_TYPOS = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gnail.com': 'gmail.com',
  'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.om': 'gmail.com', 'gmail.comm': 'gmail.com',
  'gmail.com.tw': 'gmail.com', 'gmaill.com': 'gmail.com', 'gmali.com': 'gmail.com', 'gmil.com': 'gmail.com',
  'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'hotmail.co': 'hotmail.com',
  'yaho.com.tw': 'yahoo.com.tw', 'yahooo.com.tw': 'yahoo.com.tw', 'yhaoo.com.tw': 'yahoo.com.tw', 'yahoo.com.t': 'yahoo.com.tw', 'yahoo.cm.tw': 'yahoo.com.tw',
  'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yhaoo.com': 'yahoo.com', 'yahoo.con': 'yahoo.com',
  'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'outlook.con': 'outlook.com',
  'iclould.com': 'icloud.com', 'icoud.com': 'icloud.com', 'icloud.con': 'icloud.com', 'iclod.com': 'icloud.com',
};

export function emailDomain(email) {
  return String(email ?? '').trim().toLowerCase().split('@').pop() ?? '';
}

// 回傳錯誤訊息（空字串＝看不出問題）。純邏輯，不查 DNS。
export function emailFormatProblem(email) {
  const value = String(email ?? '').trim();
  if (!EMAIL_PATTERN.test(value)) return '飼主 Email 格式不正確，請先修正飼主資料';
  const domain = emailDomain(value);
  const intended = DOMAIN_TYPOS[domain];
  if (intended) return `飼主 Email 的「@${domain}」看起來打錯了（是不是 @${intended}？），請先修正飼主資料`;
  return '';
}

const NO_SUCH_DOMAIN = new Set(['ENOTFOUND', 'ENODATA', 'ESERVFAIL_NXDOMAIN', 'NXDOMAIN']);

// 這個網域收不收得了信：有 MX 就算；沒有 MX 但網域本身解析得到（有些網域直接用 A 紀錄收信）也算。
// 只有「確定查無此網域」才回 false；DNS 逾時、暫時查不到一律放行——不能因為診所網路一時不穩就寄不出報告。
export async function domainAcceptsMail(domain, resolvers = { resolveMx, resolve4, resolve6 }) {
  const attempt = async (lookup) => {
    try {
      return (await lookup(domain)).length > 0 ? 'yes' : 'no';
    } catch (err) {
      return NO_SUCH_DOMAIN.has(err?.code) ? 'no' : 'unknown';
    }
  };
  const results = [await attempt(resolvers.resolveMx)];
  if (results[0] === 'yes') return true;
  results.push(await attempt(resolvers.resolve4), await attempt(resolvers.resolve6));
  if (results.includes('yes')) return true;
  return results.includes('unknown');
}

// 寄送前的完整檢查，回傳錯誤訊息（空字串＝可以寄）。
export async function emailProblem(email, resolvers) {
  const format = emailFormatProblem(email);
  if (format) return format;
  const domain = emailDomain(email);
  if (!(await domainAcceptsMail(domain, resolvers))) return `飼主 Email 的網域「${domain}」不存在、收不了信，請先修正飼主資料`;
  return '';
}
