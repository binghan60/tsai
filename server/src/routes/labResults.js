import express, { Router } from 'express';
import mongoose from 'mongoose';
import LabResult from '../models/LabResult.js';
import LabBridgeStatus from '../models/LabBridgeStatus.js';
import { hasIdexxBridgeAccess, idexxBridgeConfigured } from '../config/idexxBridge.js';
import { IdexxParseError, decodeIdexxXml, parseIdexxResult } from '../lib/idexxResult.js';
import { labResultContent, planLabResultImport } from '../lib/labResultImport.js';
import {
  applyLabResult, dismissLabResult, matchByPatientId, matchManually, openConflicts, resolveConflicts, unmatchLabResult,
} from '../lib/labResultApply.js';
import { rankCandidates } from '../lib/labResultFill.js';
import { markIdexxRequestDelivered, pendingIdexxRequests } from '../lib/idexxRequests.js';
import { clinicDayStart, clinicToday } from '../lib/clinicTime.js';
import { emitLabResultsUpdate } from '../lib/realtime.js';
import { paginatedPayload, paginationOptions } from '../lib/pagination.js';
import Appointment from '../models/Appointment.js';

// 給診所電腦上的抓檔程式用：只有 POST /import 與 POST /heartbeat，改用 IDEXX_BRIDGE_TOKEN 驗證
// （見 config/idexxBridge.js）。掛在 /api/lab-results、登入檢查之前；其他路徑不在這裡，照常往下走登入檢查。
export const labResultBridgeRouter = Router();

function requireBridge(req, res, next) {
  if (!idexxBridgeConfigured()) {
    return res.status(503).json({ message: '伺服器尚未設定 IDEXX_BRIDGE_TOKEN（至少 32 字元），無法接收檢驗結果' });
  }
  if (!hasIdexxBridgeAccess(req)) return res.status(401).json({ message: '抓檔程式的密鑰不正確' });
  next();
}

// 檔名只是給人追查用；HTTP 標頭只能放 ASCII，中文檔名由抓檔程式先做 URL 編碼。
function uploadedFileName(req) {
  try {
    return decodeURIComponent(req.get('x-file-name') ?? '').slice(0, 255);
  } catch {
    return '';
  }
}

async function importLabResult(parsed, { rawXml, fileName }) {
  const content = labResultContent(parsed);
  const key = { diagnosticSetId: parsed.diagnosticSetId, instrument: parsed.instrument };
  for (let attempt = 0; ; attempt += 1) {
    const existing = await LabResult.findOne(key).lean();
    const plan = planLabResultImport(existing, parsed);
    const now = new Date();
    if (plan === 'create') {
      try {
        const created = await LabResult.create({ ...content, rawXml, fileName, lastReceivedAt: now });
        return { status: 'created', id: created._id, petId: null };
      } catch (err) {
        // 同一份檔案同時被送了兩次，另一次先寫進去了；重讀一次就會變成「重複」。
        if (err?.code === 11000 && attempt === 0) continue;
        throw err;
      }
    }
    const update = { $set: { lastReceivedAt: now }, $inc: { receiveCount: 1 } };
    // 配對欄位（petId、matchedAt）不動：更正版還是同一隻貓的同一次檢驗。
    if (plan === 'update') Object.assign(update.$set, content, { rawXml, fileName, revisedAt: now });
    await LabResult.updateOne({ _id: existing._id }, update);
    return { status: plan === 'update' ? 'updated' : plan, id: existing._id, petId: existing.petId ?? null };
  }
}

// 收下之後自動認貓、填進看診（lib/labResultApply.js）。檔案已經存好了，這一步失敗只記錯誤、
// 不讓整個上傳失敗——抓檔程式重送同一份時（duplicate）會再試一次。
// 還不知道是哪隻貓的就不碰資料庫，直接回 unmatched。
async function autoFill(imported, parsed) {
  if (imported.status === 'stale') return null;
  try {
    const petId = imported.petId ?? (await matchByPatientId(imported.id, parsed.patient.id));
    if (!petId) return { status: 'unmatched' };
    return await applyLabResult(imported.id, { force: imported.status === 'updated' });
  } catch (err) {
    console.error('[lab-results] 自動填入看診失敗', err);
    return { status: 'error', message: err.message };
  }
}

// 上傳一份一份排隊處理，兩份之間至少隔 IMPORT_GAP_MS。抓檔程式是掃到幾份就連續送幾份——
// IDEXX 主機補傳歷史紀錄時一次幾百份，全部擠進來會跟診所正在用的畫面搶資料庫。
// 在伺服器這一頭放慢，已經裝在診所的舊版抓檔程式不用重裝也受保護（它本來就是等上一份回應才送下一份）。
export const IMPORT_GAP_MS = 250;
let importQueue = Promise.resolve();
let lastImportAt = 0;

function paced(task) {
  const run = importQueue.then(async () => {
    const wait = IMPORT_GAP_MS - (Date.now() - lastImportAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      return await task();
    } finally {
      lastImportAt = Date.now();
    }
  });
  importQueue = run.catch(() => {});
  return run;
}

// 抓檔程式送的是檔案原本的位元組（Content-Type: application/xml），編碼由這裡照 XML 宣告判斷，
// 抓檔程式不必懂 XML——之後要修解析規則只改伺服器，不必動診所那台電腦。
labResultBridgeRouter.post(
  '/import',
  requireBridge,
  express.raw({ type: ['application/xml', 'text/xml'], limit: '2mb' }),
  async (req, res, next) => {
    try {
      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        return res.status(400).json({ message: '請以 application/xml 上傳檔案內容' });
      }
      let rawXml;
      let parsed;
      try {
        rawXml = decodeIdexxXml(req.body);
        parsed = parseIdexxResult(rawXml);
      } catch (err) {
        if (!(err instanceof IdexxParseError)) throw err;
        // 開單完成之類的訊息不是檢驗結果：回成功讓抓檔程式把檔案歸檔，不要一直重送。
        if (err.code === 'not_result') return res.json({ status: 'ignored', reason: err.message });
        return res.status(422).json({ message: err.message, code: err.code });
      }
      const fileName = uploadedFileName(req);
      const { imported, fill } = await paced(async () => {
        const stored = await importLabResult(parsed, { rawXml, fileName });
        return { imported: stored, fill: await autoFill(stored, parsed) };
      });
      // 新的或更正過的結果：工具欄「檢驗」的數字要跟著變（自動認出貓的就不會進待確認清單）。
      if (imported.status === 'created' || imported.status === 'updated') emitLabResultsUpdate();
      res.status(imported.status === 'created' ? 201 : 200).json({ status: imported.status, id: imported.id, fill });
    } catch (err) {
      next(err);
    }
  }
);

function heartbeatText(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function heartbeatDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

// 抓檔程式每分鐘回報一次。時間以伺服器收到的時刻為準，不採信診所電腦的時鐘。
labResultBridgeRouter.post('/heartbeat', requireBridge, async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const bridgeId = heartbeatText(body.bridgeId, 100);
    if (!bridgeId) return res.status(422).json({ message: '缺少 bridgeId' });
    const pendingFiles = Number.parseInt(body.pendingFiles, 10);
    await LabBridgeStatus.updateOne(
      { bridgeId },
      {
        $set: {
          hostname: heartbeatText(body.hostname, 100),
          version: heartbeatText(body.version, 50),
          resultsDir: heartbeatText(body.resultsDir),
          requestsDir: heartbeatText(body.requestsDir),
          startedAt: heartbeatDate(body.startedAt),
          lastSeenAt: new Date(),
          lastUploadAt: heartbeatDate(body.lastUploadAt),
          pendingFiles: Number.isInteger(pendingFiles) && pendingFiles >= 0 ? pendingFiles : 0,
          lastError: heartbeatText(body.lastError),
        },
      },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// 報到／離院通知（lib/idexxRequests.js）：抓檔程式每輪來拿待送的，原封寫進 InterLink 的 Requests 資料夾。
// 檔案內容已經照設定的編碼（Big5／UTF-8）編好，用 base64 傳，抓檔程式不必懂 XML 也不必懂編碼。
labResultBridgeRouter.get('/requests', requireBridge, async (req, res, next) => {
  try {
    const items = await pendingIdexxRequests();
    res.json({
      items: items.map((item) => ({
        id: String(item._id),
        fileName: item.fileName,
        body: Buffer.from(item.body).toString('base64'),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// 寫好檔案後回報；重複回報（網路斷掉後重送）也回成功。
labResultBridgeRouter.post('/requests/:id/delivered', requireBridge, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(422).json({ message: '通知編號不正確' });
    await markIdexxRequestDelivered(req.params.id, heartbeatText(req.body?.bridgeId, 100));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export const labResultsRouter = Router();

// 心跳每分鐘一次；超過這麼久沒收到就當作抓檔程式停了（留兩次漏掉的餘裕）。
export const BRIDGE_OFFLINE_AFTER_MS = 3 * 60_000;

labResultsRouter.get('/bridge-status', async (req, res, next) => {
  try {
    const now = Date.now();
    const items = await LabBridgeStatus.find().sort({ lastSeenAt: -1 }).lean();
    res.json({
      items: items.map((item) => ({
        ...item,
        online: now - new Date(item.lastSeenAt).getTime() < BRIDGE_OFFLINE_AFTER_MS,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// 移除一筆已經停掉的抓檔程式紀錄（換了電腦、改了名稱）。還在回報的不能移除——一分鐘後又會出現，只會讓人困惑。
labResultsRouter.delete('/bridge-status/:bridgeId', async (req, res, next) => {
  try {
    const bridge = await LabBridgeStatus.findOne({ bridgeId: req.params.bridgeId }).lean();
    if (bridge && Date.now() - new Date(bridge.lastSeenAt).getTime() < BRIDGE_OFFLINE_AFTER_MS) {
      return res.status(409).json({ message: '這台電腦還在回報，不能移除' });
    }
    // 已經被別台移除也算成功。
    await LabBridgeStatus.deleteOne({ bridgeId: req.params.bridgeId });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// 待確認清單的每一筆附上「檢驗當天」的掛號當候選。一次查完所有日期，走 scheduledAt 的索引。
async function withCandidates(items) {
  const dateOf = (item) => clinicToday(item.runAt ?? item.createdAt);
  const dates = [...new Set(items.map(dateOf))];
  if (!dates.length) return items;
  const visits = await Appointment.find({
    $or: dates.map((date) => ({ scheduledAt: { $gte: clinicDayStart(date), $lt: clinicDayStart(date, 1) } })),
  }).select('_id date time petId petName ownerName status').lean();
  return items.map((item) => ({
    ...item,
    candidates: rankCandidates(visits.filter((visit) => visit.date === dateOf(item)), item.patient?.name),
  }));
}

// 預設列出待確認（還沒確認是哪隻貓、也沒被忽略）的結果，附當天的候選掛號；帶 petId 則列那隻貓的。
// 新到舊，索引 {petId, runAt, _id} 接得上排序。
labResultsRouter.get('/', async (req, res, next) => {
  try {
    const petId = req.query.petId ? String(req.query.petId) : null;
    if (petId && !mongoose.isValidObjectId(petId)) return res.status(422).json({ message: '貓咪參數不正確' });
    const filter = petId ? { petId } : { petId: null, dismissedAt: null };
    const pagination = paginationOptions(req.query);
    const [items, total] = await Promise.all([
      LabResult.find(filter).sort({ runAt: -1, _id: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
      LabResult.countDocuments(filter),
    ]);
    res.json(paginatedPayload(petId ? items : await withCandidates(items), total, pagination));
  } catch (err) {
    next(err);
  }
});

function validId(req, res) {
  if (mongoose.isValidObjectId(req.params.id)) return true;
  res.status(422).json({ message: '檢驗結果參數不正確' });
  return false;
}

// 人選了是哪隻貓 → 照自動填入的規則填進那隻貓當天的看診，回傳填了什麼（lib/labResultApply.js）。
labResultsRouter.post('/:id/match', async (req, res, next) => {
  try {
    if (!validId(req, res)) return;
    const petId = String(req.body?.petId ?? '');
    if (!mongoose.isValidObjectId(petId)) return res.status(422).json({ message: '請選擇貓咪' });
    const fill = await matchManually(req.params.id, petId);
    emitLabResultsUpdate();
    res.json({ fill });
  } catch (err) {
    next(err);
  }
});

// 選錯貓：清掉剛才填進去、還沒被人改過的數值，結果回到待確認清單。
labResultsRouter.post('/:id/unmatch', async (req, res, next) => {
  try {
    if (!validId(req, res)) return;
    const undo = await unmatchLabResult(req.params.id);
    emitLabResultsUpdate();
    res.json(undo);
  } catch (err) {
    next(err);
  }
});

// 還沒處理的數值差異（醫師已填不同的值、IDEXX 沒有蓋掉）。「檢驗」面板列全部；健檢報告帶 appointmentId 只看那次看診。
labResultsRouter.get('/conflicts', async (req, res, next) => {
  try {
    const appointmentId = req.query.appointmentId ? String(req.query.appointmentId) : null;
    if (appointmentId && !mongoose.isValidObjectId(appointmentId)) return res.status(422).json({ message: '看診參數不正確' });
    res.json({ items: await openConflicts({ appointmentId }) });
  } catch (err) {
    next(err);
  }
});

// 比對視窗的選擇：body.overwrite 是要換成 IDEXX 值的欄位 key（「都不要」＝空陣列）。
labResultsRouter.post('/:id/conflicts/resolve', async (req, res, next) => {
  try {
    if (!validId(req, res)) return;
    const result = await resolveConflicts(req.params.id, req.body?.overwrite);
    emitLabResultsUpdate();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

labResultsRouter.post('/:id/dismiss', async (req, res, next) => {
  try {
    if (!validId(req, res)) return;
    await dismissLabResult(req.params.id);
    emitLabResultsUpdate();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
