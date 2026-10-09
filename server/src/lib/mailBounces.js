import { clearInterval, setInterval } from 'node:timers';
import { ImapFlow } from 'imapflow';
import DeliveryLog from '../models/DeliveryLog.js';
import MedicalRecord from '../models/MedicalRecord.js';
import { parseBounce } from './bounceMessage.js';

// 退信檢查：郵件伺服器收下信（＝系統記成「已寄出」）之後才投不到的，會退一封通知到寄件信箱。
// 這裡定時去那個信箱讀通知，對回是哪一次寄送，把結果改成失敗（寄送紀錄補一筆 failed、報告進「寄送失敗」佇列）。
//
// 用寄信的同一組帳號密碼（Gmail 應用程式密碼）走 IMAP；信箱唯讀開啟，不標已讀、不搬、不刪。
// 冪等：同一封通知讀幾次都一樣——已經記過退信的那次寄送不會再記。
// MAIL_BOUNCE_CHECK=off 關掉；沒設定 Gmail 寄信帳號時也不跑。

const LOOKBACK_DAYS = 3; // 通知多半幾秒到幾分鐘內就來，少數（對方伺服器重試後才放棄）會拖到兩三天
const POLL_MS = 5 * 60 * 1000;
const AFTER_SEND_MS = [45 * 1000, 3 * 60 * 1000]; // 剛寄出的那封：很快再看兩次，不等下一輪
const SOURCE_BYTES = 24 * 1024;
export const BOUNCE_PREFIX = '退信：';

function imapOptions() {
  if (String(process.env.MAIL_BOUNCE_CHECK ?? '').toLowerCase() === 'off') return null;
  const user = process.env.SMTP_EMAIL?.trim();
  const pass = process.env.SMTP_PASSWORD?.replace(/\s/g, '');
  const host = process.env.IMAP_HOST?.trim() || (user ? 'imap.gmail.com' : '');
  if (!user || !pass || !host) return null;
  return { host, port: Number(process.env.IMAP_PORT || 993), secure: true, auth: { user, pass }, logger: false };
}

export function bounceCheckEnabled() {
  return Boolean(imapOptions());
}

// 一封退信通知 → 寄送紀錄與報告。回傳有沒有記下新的退信。
export async function recordBounce(bounce, now = new Date()) {
  const sent = await DeliveryLog.findOne({ event: 'sent', messageId: { $in: bounce.messageIds } }).sort({ createdAt: -1 });
  if (!sent) return false;
  const already = await DeliveryLog.exists({
    recordId: sent.recordId,
    event: 'failed',
    messageId: sent.messageId,
  });
  if (already) return false;

  const error = `${BOUNCE_PREFIX}${bounce.reason}`;
  await DeliveryLog.create({
    recordId: sent.recordId,
    petName: sent.petName,
    ownerName: sent.ownerName,
    attemptId: sent.attemptId,
    event: 'failed',
    recipient: sent.recipient || bounce.recipient,
    messageId: sent.messageId,
    error,
    createdAt: now,
  });
  // 只有這封信還是那份報告「最後一次寄送」時才改報告的狀態：之後已經重寄成功的，不被舊的退信拉回失敗。
  await MedicalRecord.updateOne(
    { _id: sent.recordId, emailMessageId: sent.messageId, deliveryStatus: 'sent' },
    { $set: { deliveryStatus: 'failed', deliveryError: `${error}（${sent.recipient || bounce.recipient}）` } },
  );
  return true;
}

let running = null;

// 讀一輪。同時只跑一個；連不上信箱只記 log，不影響寄信。回傳這一輪新記下幾封退信。
export function checkBounces() {
  if (running) return running;
  const options = imapOptions();
  if (!options) return Promise.resolve(0);
  running = (async () => {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    // 這幾天沒有寄出過任何信就不必登入信箱。
    if (!(await DeliveryLog.exists({ event: 'sent', createdAt: { $gte: since } }))) return 0;
    const client = new ImapFlow(options);
    let recorded = 0;
    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX', { readOnly: true });
      try {
        const uids = await client.search({ since, from: 'mailer-daemon' }, { uid: true });
        if (uids?.length) {
          for await (const message of client.fetch(uids, { envelope: true, source: { start: 0, maxLength: SOURCE_BYTES } }, { uid: true })) {
            const bounce = parseBounce(message.source?.toString('utf8') ?? '', message.envelope ?? {});
            if (bounce && await recordBounce(bounce)) recorded += 1;
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => client.close());
    }
    return recorded;
  })().catch((err) => {
    console.error('[mail] 讀取退信失敗', err?.message || err);
    return 0;
  }).finally(() => { running = null; });
  return running;
}

let poller = null;

export function startBounceChecks() {
  if (poller || !bounceCheckEnabled()) return;
  poller = setInterval(checkBounces, POLL_MS);
  poller.unref?.();
  console.log('[mail] 已啟用退信檢查');
}

export function stopBounceChecks() {
  clearInterval(poller);
  poller = null;
}

// 剛寄出一封：通知通常很快就到，不必等下一輪。
export function checkBouncesSoon() {
  if (!bounceCheckEnabled()) return;
  for (const delay of AFTER_SEND_MS) setTimeout(checkBounces, delay).unref?.();
}
