// 送 IDEXX／離院通知排隊（XML 怎麼組在 lib/idexxCensus.js）。按下送 IDEXX、取消送 IDEXX，以及掛號離開診所的每個地方
// 都呼叫 queueIdexxCensus，它看這張掛號上一次送了什麼，需要時才排一份新的；抓檔程式之後來拿。
import IdexxRequest from '../models/IdexxRequest.js';
import LabResult from '../models/LabResult.js';
import Owner from '../models/Owner.js';
import Pet from '../models/Pet.js';
import { idexxCensusSettings } from '../config/idexxBridge.js';
import { encodeBig5 } from './big5.js';
import { buildIdexxRequestXml, idexxMessageId, inClinic, nextCensusKind } from './idexxCensus.js';

export async function syncIdexxCensus(appointment, { settings = idexxCensusSettings(), now = new Date() } = {}) {
  if (settings.mode === 'off' || !appointment?._id) return null;
  const last = await IdexxRequest.findOne({ appointmentId: appointment._id }).sort({ createdAt: -1, _id: -1 }).lean();
  const kind = nextCensusKind(last?.kind ?? null, inClinic(appointment));
  if (!kind) return null;
  // 離院照到院那一份的貓、訊息種類與編碼送：中途改了設定，主機上那一筆還是要用同一種訊息收掉。
  const petId = kind === 'out' ? last.petId : appointment.petId;
  const mode = kind === 'out' ? last.mode : settings.mode;
  const encoding = kind === 'out' ? last.encoding : settings.encoding;
  // 開單的檢驗已經做完（有結果填進這次看診）：主機上那張單已經自己完成，再送取消只會讓主機收到一張對不上的單。
  // 記一筆 skipped 當作「已經收掉」，之後再按「送 IDEXX」才會重新開單。報到通知（census）沒有這個問題，離院照送。
  if (kind === 'out' && mode === 'work_request' && await LabResult.exists({ appointmentId: appointment._id })) {
    const skippedId = idexxMessageId(now);
    return IdexxRequest.create({
      appointmentId: appointment._id, petId, kind, mode, encoding,
      messageId: skippedId, fileName: `${skippedId}.xml`, status: 'skipped',
    });
  }
  const pet = await Pet.findById(petId).lean();
  if (!pet) return null;
  const owner = pet.ownerId ? await Owner.findById(pet.ownerId).lean() : null;
  const messageId = idexxMessageId(now);
  const xml = buildIdexxRequestXml({
    mode, kind, messageId, now, encoding,
    appointmentId: appointment._id, pet, owner,
    weightKg: appointment.weightKg ?? pet.weightKg,
  });
  const { bytes, unmappable } = encoding === 'utf-8' ? { bytes: Buffer.from(xml, 'utf8'), unmappable: [] } : encodeBig5(xml);
  return IdexxRequest.create({
    appointmentId: appointment._id, petId: pet._id, kind, mode, encoding,
    messageId, fileName: `${messageId}.xml`, body: bytes, unmappable: [...new Set(unmappable)],
  });
}

// 給路由用：掛號本身已經存好了，通知排不進去只記錯誤、不讓報到或完成處理失敗——
// 最壞就是貓咪沒出現在 IDEXX 主機上，技術員手動新增，結果回來進待確認清單，流程照樣走得下去。
export async function queueIdexxCensus(appointment) {
  try {
    return await syncIdexxCensus(appointment);
  } catch (err) {
    console.error('[idexx] 報到／離院通知排隊失敗', err);
    return null;
  }
}

// 抓檔程式每輪來拿：還沒送的，舊到新（同一隻貓的到院一定排在離院前面）。
// 不用 lean：lean 拿到的是 BSON Binary，轉回 Buffer 要自己算長度；讓 mongoose 轉好比較不會出錯。
export async function pendingIdexxRequests(limit = 20) {
  return IdexxRequest.find({ status: 'pending' }).sort({ createdAt: 1, _id: 1 }).limit(limit).select('fileName body');
}

// 抓檔程式寫好檔案後回報。已經回報過（重送、兩台同時拿到）也算成功。
export async function markIdexxRequestDelivered(id, bridgeId, now = new Date()) {
  const result = await IdexxRequest.updateOne(
    { _id: id, status: 'pending' },
    { $set: { status: 'delivered', deliveredAt: now, deliveredBy: String(bridgeId ?? '').slice(0, 100) } }
  );
  return result.modifiedCount > 0;
}
