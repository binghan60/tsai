import { v4 as uuidv4 } from 'uuid';
import MedicalRecord from '../models/MedicalRecord.js';
import DeliveryLog from '../models/DeliveryLog.js';
import Pet from '../models/Pet.js';
import { readStoredPdf } from './reportPdfJobs.js';
import { encryptPdf } from './pdfEncrypt.js';
import { reportPasscode } from './reportPasscode.js';
import { assertMailConfigured, isAmbiguousMailFailure, sendHealthReportEmail } from './mailer.js';
import { emailProblem } from './emailCheck.js';
import { checkBouncesSoon } from './mailBounces.js';
import { configuredAppOrigin } from '../config/publicUrl.js';

// 把健檢報告寄給飼主。手動寄送（POST /records/:id/send-email）與結案時勾的自動寄送共用這一套，分兩段：
// claimDelivery 檢查、搶下這次寄送（deliveryStatus → sending）、記 queued；
// performDelivery 讀出存好的 PDF、加密、連 Gmail、寫回結果。

// 寄送的租約鎖：程序中途消失時，超過這段時間別的請求才接手。
const DELIVERY_LEASE_MS = 10 * 60 * 1000;
const configuredShareDays = Number.parseInt(process.env.SHARE_LINK_DAYS, 10);
const DEFAULT_SHARE_DAYS = Number.isInteger(configuredShareDays) && configuredShareDays > 0
  ? Math.min(configuredShareDays, 365)
  : 30;

export function shareExpiryFromNow(days = DEFAULT_SHARE_DAYS) {
  const safeDays = Number.isInteger(days) ? Math.min(Math.max(days, 1), 365) : DEFAULT_SHARE_DAYS;
  return new Date(Date.now() + safeDays * 24 * 60 * 60 * 1000);
}

export function isFinalizedRecord(record) {
  return Boolean(record && record.status !== 'draft');
}

export function effectiveDeliveryStatus(record) {
  return record?.deliveryStatus ?? 'not_sent';
}

// 每次寄送嘗試都往流水帳補一筆。貓咪與飼主姓名在這裡就抄進去，不留 ref——
// 這筆紀錄的價值正是在報告被刪除之後還查得到，那時 populate 只會拿到 null。
async function logDelivery(record, event, extra = {}) {
  if (!record?._id) return;
  try {
    const pet = record.petId;
    const owner = pet?.ownerId;
    await DeliveryLog.create({
      recordId: record._id,
      petName: pet?.name || '',
      ownerName: owner?.name || '',
      event,
      ...extra,
    });
  } catch (err) {
    // 流水帳寫不進去不該讓寄送本身失敗——信有沒有送到飼主手上才是主線。
    console.error('寫入寄送紀錄失敗', err);
  }
}

function mailErrorResponse(err) {
  if (err.code === 'MAIL_NOT_CONFIGURED') return { status: 503, message: err.message };
  if (err.code === 'MAIL_RECIPIENT_REJECTED') return { status: 422, message: err.message };
  if (err.code === 'EAUTH') return { status: 502, message: 'Gmail 驗證失敗，請確認寄信設定後再試；報告已結案，不受影響' };
  if (err.code === 'ETIMEDOUT') return { status: 504, message: '連線 Gmail 逾時，請確認網路後再試；報告已結案，不受影響' };
  if (err.code === 'ECONNECTION') return { status: 502, message: '無法連線 Gmail SMTP，請確認網路或防火牆設定；報告已結案，不受影響' };
  if (['EENVELOPE', 'EMESSAGE', 'EPROTOCOL'].includes(err.code)) {
    return { status: 502, message: 'Gmail 未接受這封郵件，請稍後再試；報告已結案，不受影響' };
  }
  return null;
}

// 回傳 { response } 表示這次不寄（照它回給呼叫端），{ delivery } 表示已經搶下、交給 performDelivery。
// onlyIfNotSent：自動寄送用——已經寄過（例如有人先手動寄了）就不再寄，不能讓飼主收到兩封。
export async function claimDelivery(recordId, { onlyIfNotSent = false } = {}) {
  const record = await MedicalRecord.findById(recordId).select('+pdfFileId').populate({
    path: 'petId',
    populate: { path: 'ownerId', select: 'name email phone' },
  }).select('+deliveryAttemptId +deliveryLeaseExpiresAt');
  if (!record) return { response: { status: 404, body: { message: '找不到報告' } } };
  if (!isFinalizedRecord(record)) {
    return { response: { status: 409, body: { message: '請先完成結案，再寄送正式報告' } } };
  }
  if (effectiveDeliveryStatus(record) === 'sending') {
    const leaseIsActive = record.deliveryLeaseExpiresAt && record.deliveryLeaseExpiresAt > new Date();
    if (leaseIsActive) {
      return { response: { status: 409, body: { message: '報告正在寄送中，請勿重複操作' } } };
    }

    // 程序在寄送中途消失時，不能假設郵件「一定沒寄出」後自動重送。
    // SMTP 可能已經接受，只是本機還沒寫回 sent；先標為待確認，由使用者決定是否重寄。
    await MedicalRecord.updateOne(
      {
        _id: record._id,
        deliveryStatus: 'sending',
        $or: [
          { deliveryLeaseExpiresAt: null },
          { deliveryLeaseExpiresAt: { $exists: false } },
          { deliveryLeaseExpiresAt: { $lte: new Date() } },
        ],
      },
      {
        $set: {
          deliveryStatus: 'uncertain',
          deliveryError: '上一次寄送程序中斷，郵件可能已送出；請先確認收件匣，再決定是否重新寄送',
        },
        $unset: { deliveryAttemptId: 1, deliveryLeaseExpiresAt: 1 },
      }
    );
    return {
      response: {
        status: 409,
        body: {
          message: '上一次寄送結果無法確認。請先確認飼主信箱；若確定未收到，再次按下寄送即可重試。',
          deliveryStatus: 'uncertain',
        },
      },
    };
  }

  const pet = record.petId;
  const owner = pet?.ownerId;
  const recipient = owner?.email?.trim();
  if (!recipient) return { response: { status: 422, body: { message: '這位飼主尚未填寫 Email，請先補齊飼主資料' } } };
  // 寄出前擋得住的打錯：格式、常見的網域錯字、不存在的網域。郵件伺服器只看格式就收下，
  // 之後才退信（lib/mailBounces.js 會讀回來），能當場擋的先擋。
  const recipientProblem = await emailProblem(recipient);
  if (recipientProblem) return { response: { status: 422, body: { message: recipientProblem } } };

  if (record.pdfStatus !== 'ready') {
    return {
      response: {
        status: 409,
        body: { message: record.pdfStatus === 'failed' ? 'PDF 產生失敗，請先重試。' : 'PDF 正在產生中，完成後才能寄送。' },
      },
    };
  }

  const deliveryAttemptId = uuidv4();
  const claimedAt = new Date();
  const claimedDelivery = await MedicalRecord.findOneAndUpdate(
    {
      _id: record._id,
      status: 'finalized',
      deliveryStatus: onlyIfNotSent ? 'not_sent' : { $ne: 'sending' },
    },
    {
      $set: {
        deliveryStatus: 'sending',
        deliveryError: '',
        lastDeliveryAttemptAt: claimedAt,
        deliveryAttemptId,
        deliveryLeaseExpiresAt: new Date(claimedAt.getTime() + DELIVERY_LEASE_MS),
        // 這次寄出去了，結案時排的自動寄送就不必再寄一次。
        autoSendRequestedAt: null,
      },
    },
    { new: true }
  ).select('+deliveryAttemptId +deliveryLeaseExpiresAt');
  if (!claimedDelivery) {
    return { response: { status: 409, body: { message: '寄送工作已由另一個請求取得，請稍後再查看狀態' } } };
  }
  // 先記 queued：後面產 PDF 或 SMTP 卡住而程序被中斷時，至少留得下「曾經嘗試寄送」。
  await logDelivery(record, 'queued', { recipient, attemptId: deliveryAttemptId });

  return { delivery: { record, pet, owner, recipient, deliveryAttemptId } };
}

// 回傳 { status, body }。已知的寄送失敗會先把 failed／uncertain 寫回報告再回傳；
// 意料之外的錯誤一樣先寫回，再丟給呼叫端。resolveOrigin 是產生對外連結網域的函式。
export async function performDelivery({ record, pet, owner, recipient, deliveryAttemptId }, resolveOrigin) {
  let smtpInfo = null;
  let smtpStarted = false;
  let activeShareExpiresAt = null;
  try {
    assertMailConfigured();
    const storedPdf = await readStoredPdf(record);
    if (!storedPdf) {
      const pdfError = new Error('PDF 檔案暫時無法讀取，請重新產生。');
      pdfError.status = 409;
      throw pdfError;
    }
    const passcode = reportPasscode(owner.phone);
    const pdfBuffer = await encryptPdf(storedPdf, passcode);
    const reportUrl = `${resolveOrigin()}/report/${record.shareToken}`;

    // 郵件寄出前先確保信內的分享連結已經可用，並把 lease 往後延長涵蓋 SMTP 階段。
    activeShareExpiresAt = record.shareExpiresAt && record.shareExpiresAt > new Date()
      ? record.shareExpiresAt
      : shareExpiryFromNow();
    const readyForSmtp = await MedicalRecord.updateOne(
      { _id: record._id, deliveryAttemptId },
      {
        $set: {
          shareEnabled: true,
          sharedAt: record.sharedAt || new Date(),
          shareExpiresAt: activeShareExpiresAt,
          deliveryLeaseExpiresAt: new Date(Date.now() + DELIVERY_LEASE_MS),
        },
      }
    );
    if (readyForSmtp.matchedCount !== 1) {
      const error = new Error('寄送工作已失去擁有權，已停止寄信');
      error.code = 'DELIVERY_ATTEMPT_LOST';
      throw error;
    }

    smtpStarted = true;
    smtpInfo = await sendHealthReportEmail({
      to: recipient,
      ownerName: owner.name,
      petName: pet.name,
      visitDate: record.visitDate,
      reportUrl,
      reportExpiresAt: activeShareExpiresAt,
      passcodeProtected: Boolean(passcode),
      pdfBuffer,
    });

    // 只允許取得這次 attempt 的請求寫入結果，避免舊請求覆蓋較新的寄送狀態。
    const sentAt = new Date();
    const sentRecord = await MedicalRecord.findOneAndUpdate(
      { _id: record._id, deliveryAttemptId },
      {
        $set: {
          status: 'finalized',
          deliveryStatus: 'sent',
          deliveryError: '',
          pdfGeneratedAt: sentAt,
          sentAt,
          sentTo: recipient,
          emailMessageId: smtpInfo.messageId,
        },
        $unset: { deliveryAttemptId: 1, deliveryLeaseExpiresAt: 1 },
      },
      { new: true }
    );
    if (!sentRecord) {
      const error = new Error('郵件已被伺服器接受，但寄送結果無法寫回');
      error.code = 'DELIVERY_RESULT_NOT_SAVED';
      throw error;
    }
    await logDelivery(record, 'sent', { recipient, messageId: smtpInfo.messageId, attemptId: deliveryAttemptId });
    // 「已寄出」只代表郵件伺服器收下了；投不到的會退信，過一會兒去寄件信箱看。
    checkBouncesSoon();

    return {
      status: 200,
      body: {
        status: 'finalized',
        deliveryStatus: sentRecord.deliveryStatus,
        sentAt: sentRecord.sentAt,
        sentTo: sentRecord.sentTo,
        messageId: sentRecord.emailMessageId,
        shareUrl: reportUrl,
        shareExpiresAt: activeShareExpiresAt,
      },
    };
  } catch (err) {
    const response = mailErrorResponse(err);
    const outcomeUncertain = Boolean(smtpInfo) || isAmbiguousMailFailure(err, { smtpStarted });
    const nextStatus = outcomeUncertain ? 'uncertain' : 'failed';
    const deliveryError = outcomeUncertain
      ? smtpInfo
        ? '郵件伺服器可能已接受，但系統無法確認最後寫入結果；請先確認收件匣，避免重複寄送'
        : '寄送連線在郵件伺服器確認結果前中斷，郵件可能已送出；請先確認收件匣，避免重複寄送'
      : response?.message || '寄送失敗，請稍後重試';
    try {
      await MedicalRecord.updateOne(
        { _id: record._id, deliveryAttemptId },
        {
          $set: {
            deliveryStatus: nextStatus,
            deliveryError,
            ...(outcomeUncertain ? { sentTo: recipient } : {}),
            ...(smtpInfo?.messageId ? { emailMessageId: smtpInfo.messageId } : {}),
          },
          $unset: { deliveryAttemptId: 1, deliveryLeaseExpiresAt: 1 },
        }
      );
    } catch (saveError) {
      console.error('記錄寄送失敗狀態時發生錯誤', saveError);
    }
    await logDelivery(record, nextStatus === 'uncertain' ? 'uncertain' : 'failed', {
      recipient,
      messageId: smtpInfo?.messageId || '',
      error: deliveryError,
      attemptId: deliveryAttemptId,
    });
    if (outcomeUncertain) {
      return {
        status: 202,
        body: {
          message: deliveryError,
          deliveryStatus: 'uncertain',
          sentTo: recipient,
          shareUrl: `${resolveOrigin()}/report/${record.shareToken}`,
          shareExpiresAt: activeShareExpiresAt,
        },
      };
    }
    if (response) return { status: response.status, body: { message: response.message } };
    throw err;
  }
}

// ── 結案時勾了「PDF 產生後自動寄給飼主」──
// 意圖記在報告的 autoSendRequestedAt，伺服器重啟也不會掉。PDF 背景工作每產好一份就叫 runAutoSends
// （app.js 用 onPdfReady 接上），伺服器啟動時也跑一次，補上重啟前沒寄到的。
// 每份報告只會自動寄一次：先把 autoSendRequestedAt 清掉、清得到的那個才寄；寄不出去就停在失敗，由人決定要不要重寄。

// 結案當下就檢查信箱：有問題趁醫師還在畫面上講，不要等 PDF 產好才在背景默默失敗。回傳錯誤訊息（空字串＝可以寄）。
export async function autoSendRecipientProblem(petId) {
  const pet = await Pet.findById(petId).populate({ path: 'ownerId', select: 'email' });
  const email = pet?.ownerId?.email?.trim();
  if (!email) return '這位飼主尚未填寫 Email，請先補齊飼主資料';
  return emailProblem(email);
}

// 背景寄送沒有請求可以推斷網域，一律用設定好的（正式環境啟動時就檢查過 PUBLIC_APP_URL）。
function configuredOriginOrThrow() {
  const origin = configuredAppOrigin();
  if (origin) return origin;
  const error = new Error('尚未設定 PUBLIC_APP_URL，無法產生對外連結');
  error.code = 'PUBLIC_URL_NOT_CONFIGURED';
  throw error;
}

// 自動寄送沒人在畫面前等結果：信箱有問題（422）要留在報告上，進「寄送失敗」佇列。
async function markAutoSendFailed(recordId, message) {
  const error = `沒有自動寄出：${message}`;
  const record = await MedicalRecord.findOneAndUpdate(
    { _id: recordId, deliveryStatus: 'not_sent' },
    { $set: { deliveryStatus: 'failed', deliveryError: error, lastDeliveryAttemptAt: new Date() } },
    { new: true }
  ).populate({ path: 'petId', populate: { path: 'ownerId', select: 'name email' } });
  if (!record) return;
  await logDelivery(record, 'failed', {
    recipient: record.petId?.ownerId?.email?.trim() || '',
    error,
    attemptId: uuidv4(),
  });
}

async function autoSendOne(recordId) {
  const taken = await MedicalRecord.findOneAndUpdate(
    { _id: recordId, status: 'finalized', pdfStatus: 'ready', autoSendRequestedAt: { $type: 'date' } },
    { $set: { autoSendRequestedAt: null } }
  );
  // 搶不到＝別人已經處理；狀態不是 not_sent＝已經有人寄過或正在寄，都不再寄。
  if (!taken || effectiveDeliveryStatus(taken) !== 'not_sent') return;

  const claim = await claimDelivery(recordId, { onlyIfNotSent: true });
  if (claim.response) {
    if (claim.response.status === 422) await markAutoSendFailed(recordId, claim.response.body.message);
    else console.warn('[mail] 自動寄送沒有執行', String(recordId), claim.response.body.message);
    return;
  }
  const result = await performDelivery(claim.delivery, configuredOriginOrThrow);
  if (result.status >= 400) console.warn('[mail] 自動寄送沒有寄出', String(recordId), result.body.message);
}

const AUTO_SEND_BATCH = 20;
const AUTO_SEND_MAX_ROUNDS = 10;
let autoSendRun = null;
let autoSendAgain = false;

// 同時只跑一輪；跑的期間又有 PDF 產好，跑完再補一輪。錯誤只記 log，不影響 PDF 背景工作。
export function runAutoSends() {
  if (autoSendRun) {
    autoSendAgain = true;
    return autoSendRun;
  }
  autoSendRun = (async () => {
    let rounds = 0;
    do {
      autoSendAgain = false;
      rounds += 1;
      const pending = await MedicalRecord.find({
        autoSendRequestedAt: { $type: 'date' },
        status: 'finalized',
        pdfStatus: 'ready',
      }).select('_id').sort({ autoSendRequestedAt: 1 }).limit(AUTO_SEND_BATCH);
      for (const { _id } of pending) {
        try {
          await autoSendOne(_id);
        } catch (err) {
          console.error('[mail] 自動寄送失敗', String(_id), err);
        }
      }
      if (pending.length === AUTO_SEND_BATCH) autoSendAgain = true;
    } while (autoSendAgain && rounds < AUTO_SEND_MAX_ROUNDS);
  })()
    .catch((err) => console.error('[mail] 自動寄送工作中斷', err))
    .finally(() => {
      autoSendRun = null;
    });
  return autoSendRun;
}

// 關機時 app.js 先等這一輪寄完，才關資料庫——寄到一半被切斷，報告會卡在寄送中。
export function waitForAutoSends() {
  return autoSendRun ?? Promise.resolve();
}
