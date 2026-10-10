// 使用手冊（docs/manual/）的截圖：用假資料把前端跑起來，一張一張截下來並畫上編號標記。
// 不連資料庫、不啟動使用者的 dev server（vite 開在隨機 port）。資料在 scripts/manual-fixtures.mjs。
//
//   npm run manual:screenshots            產生全部截圖
//   npm run manual:screenshots -- 掛號台   只產生檔名含「掛號台」的那幾張（除錯用）
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createServer } from 'vite';
import express from '../../server/node_modules/express/index.js';
import puppeteer from '../../server/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
import { Server } from '../../server/node_modules/socket.io/dist/index.js';
import MedicalRecord from '../../server/src/models/MedicalRecord.js';
import { serializeTemplate, serializeTemplateSummary } from '../../server/src/lib/formTemplate.js';
import { composeReportSections } from '../../server/src/lib/reportSections.js';
import { visitOverlay } from '../../server/src/lib/recordVisitLink.js';
import { historyEntry } from '../../server/src/lib/historyValues.js';
import { applyWorkflowAction } from '../../server/src/lib/appointmentWorkflow.js';
import { buildFixtures } from './manual-fixtures.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = fileURLToPath(new URL('../../docs/manual/images/', import.meta.url));
const only = process.argv[2] ?? '';
const F = buildFixtures();
const { today, appointments: A, pets: P } = F;

// ── 假 API ──
const api = express();
api.use(express.json());
const same = (a, b) => String(a ?? '') === String(b ?? '');
const paged = (items, query, defaultLimit = 25) => {
  const limit = Number(query.limit) || defaultLimit;
  const page = Number(query.page) || 1;
  return { items: items.slice((page - 1) * limit, page * limit), total: items.length, page, limit, totalPages: Math.max(Math.ceil(items.length / limit), 1) };
};
const findAppointment = (id) => F.allAppointments.find((item) => same(item._id, id)) ?? (same(F.intakeCodeAppointment._id, id) ? F.intakeCodeAppointment : null);
const petList = Object.values(P);
const ownerById = (id) => Object.values(F.owners).find((owner) => same(owner._id, id));
const templateJson = JSON.parse(JSON.stringify(F.templateDoc.toJSON()));

api.get('/auth/me', (req, res) => res.json({ username: 'clinic' }));
api.post('/chat/messages', (req, res) => res.status(201).json({ _id: 'x', ...req.body, createdAt: new Date() }));
api.get('/chat/messages', (req, res) => res.json({ items: F.chatMessages }));
api.get('/pinned-pets', (req, res) => res.json({ items: F.pinnedPets }));
api.get('/todos', (req, res) => res.json({ items: F.todos }));
api.get('/text-templates', (req, res) => res.json([]));
api.get('/text-templates/fields', (req, res) => res.json([]));
api.get('/settings/form-templates', (req, res) => res.json([serializeTemplateSummary(F.templateDoc)]));
api.get('/settings/form-templates/:id', (req, res) => res.json(serializeTemplate(F.templateDoc, { includeDisabled: req.query.includeDisabled === '1' })));
api.get('/settings/appointment-settings', (req, res) => res.json({ defaultAppointmentTemplateId: F.templateId }));
api.get('/dashboard', (req, res) => res.json({}));

api.get('/appointments', (req, res) => {
  const date = req.query.date || today;
  const items = F.allAppointments.filter((item) => item.date === date).sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  const notes = (key, list) => Object.fromEntries(list.filter((doc) => doc.notes).map((doc) => [String(doc._id), doc.notes]));
  const labResultCounts = {};
  for (const result of F.labResults) if (result.appointmentId) labResultCounts[result.appointmentId] = (labResultCounts[result.appointmentId] ?? 0) + 1;
  res.json({ items, date, patientNotes: { pets: notes('pets', petList), owners: notes('owners', Object.values(F.owners)) }, labResultCounts });
});
api.get('/appointments/search', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const items = q ? F.allAppointments.filter((item) => [item.petName, item.ownerName, item.ownerPhone, item.reason].some((text) => String(text).includes(q))) : [];
  res.json(paged(items.sort((a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt)), req.query, 10));
});
api.get('/appointments/intake-codes', (req, res) => res.json({ items: [F.intakeCodeAppointment] }));
api.get('/appointments/:id', (req, res) => res.json(findAppointment(req.params.id)));
api.post('/appointments/:id/check-in', (req, res) => {
  const item = findAppointment(req.params.id);
  Object.assign(item, { status: 'arrived', checkinNumber: 6, checkinNumberHistory: [6], checkedInAt: F.now, latenessMinutes: 0, __v: (item.__v ?? 0) + 1 });
  res.json(item);
});
api.post('/appointments/:id/workflow/:action', (req, res) => {
  const item = findAppointment(req.params.id);
  try {
    applyWorkflowAction(item, req.params.action, req.body, F.now, { labItems: F.labItems });
    item.__v = (item.__v ?? 0) + 1;
    res.json(item);
  } catch (err) { res.status(err.status || 500).json({ message: err.message }); }
});

api.get('/pets', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const items = petList.filter((pet) => !q || pet.name.includes(q) || ownerById(pet.ownerId)?.name.includes(q)).map((pet) => ({ ...pet, ownerId: ownerById(pet.ownerId) }));
  res.json(paged(items, req.query, 10));
});
const notesOf = (petId, exclude) => F.clinicalNotes
  .filter((note) => same(note.petId, petId) && (!exclude || !same(note.appointmentId, exclude)))
  .sort((a, b) => new Date(b.entryDate) - new Date(a.entryDate));
api.get('/pets/:id', (req, res) => {
  const pet = petList.find((item) => same(item._id, req.params.id));
  const notes = notesOf(pet._id);
  res.json({ ...F.petWithOwner(pet), medicalRecords: [], recordPagination: { total: 0, page: 1, limit: 10, totalPages: 1 }, clinicalNotes: notes.slice(0, 10), notePagination: { total: notes.length, page: 1, limit: 10, totalPages: 1 } });
});
api.get('/pets/:id/clinical-notes', (req, res) => res.json(paged(notesOf(req.params.id, req.query.excludeAppointmentId), req.query, 10)));
api.get('/pets/:id/attendance', (req, res) => res.json(F.attendanceFor(req.params.id)));
api.get('/pets/:id/records', (req, res) => res.json(paged([], req.query)));
api.get('/pets/:id/records/finalized-sources', (req, res) => res.json([]));
api.get('/pets/:id/records/previous-values', (req, res) => {
  const previous = { _id: 'prev', visitDate: new Date(`${F.historyDocs[3].date}T00:00:00+08:00`), examType: '例行健檢' };
  const byKey = Object.fromEntries([['cre', '1.9', 'mg/dL'], ['bun', '29', 'mg/dL'], ['sdma', '13', 'μg/dL'], ['glucose', '110', 'mg/dL']].map(([key, value, unit]) => {
    const item = F.labItems.find((lab) => lab.key === key);
    return [key, historyEntry(previous, { key, label: item.label, type: 'lab', value, unit, status: 'normal' })];
  }));
  res.json({ byKey, byLabel: {} });
});
api.get('/owners/:id/attendance', (req, res) => res.json({ counts: { owner: { lateCount: 0, lastLateDate: null, noShowCount: 0, lastNoShowDate: null } } }));

function recordPayload(id) {
  const raw = Object.values(F.records).find((record) => same(record._id, id));
  const visit = F.allAppointments.find((item) => same(item.recordId, raw._id));
  const doc = new MedicalRecord(raw);
  if (visit) doc.set(visitOverlay(doc, visit, templateJson));
  const pet = F.petWithOwner(petList.find((item) => same(item._id, raw.petId)));
  return { ...JSON.parse(JSON.stringify(doc.toJSON())), petId: pet, sections: composeReportSections(doc, F.templateDoc), deliveryStatus: 'not_sent', visitLink: visit ? { appointmentId: visit._id, date: visit.date } : null };
}
api.get('/records/:id', (req, res) => res.json(recordPayload(req.params.id)));
api.put('/records/:id', (req, res) => res.json(recordPayload(req.params.id)));

const ACTIVE = ['review', 'approved', 'ready'];
api.get('/medications', (req, res) => {
  const status = req.query.status || 'active';
  const pool = F.medications.filter((order) => !req.query.petId || same(order.petId, req.query.petId));
  const items = pool.filter((order) => status === 'all' || (status === 'active' ? ACTIVE.includes(order.status) : order.status === status))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(({ history, ...order }) => order);
  const counts = {};
  for (const order of pool) counts[order.status] = (counts[order.status] ?? 0) + 1;
  res.json({ ...paged(items, req.query, 20), counts });
});
api.get('/medications/:id', (req, res) => res.json(F.medications.find((order) => same(order._id, req.params.id))));

api.get('/lab-results/bridge-status', (req, res) => res.json({
  items: [{ bridgeId: '櫃台電腦', lastSeenAt: new Date(F.now.getTime() - 40_000), lastUploadAt: new Date(F.now.getTime() - 6 * 60_000), pendingFiles: 0, lastError: '', version: '1.1.1', online: true }],
  labRequest: { enabled: true },
}));
api.get('/lab-results/conflicts', (req, res) => res.json({ items: F.conflictGroups(req.query.appointmentId) }));
// 截圖只示範畫面，不真的改資料：比對視窗按下去回「沒有覆蓋」，下一張照樣看得到差異。
api.post('/lab-results/:id/conflicts/resolve', (req, res) => res.json({ overwritten: [] }));
api.get('/lab-results', (req, res) => {
  if (req.query.petId) {
    const items = F.labResults.filter((result) => same(result.petId, req.query.petId)
      && ((!req.query.date && !req.query.appointmentId) || (req.query.date && String(result.runAt).length && new Date(result.runAt).toISOString().slice(0, 10) <= req.query.date) || same(result.appointmentId, req.query.appointmentId)));
    return res.json(paged(items, req.query));
  }
  res.json(paged(F.pendingLabResults(), req.query));
});

api.get('/intake-submissions', (req, res) => {
  const items = (req.query.status ?? 'pending') === 'pending' ? [{ ...F.intakeSubmission, linkedAppointmentId: A.pudding }] : [];
  res.json({ items, total: items.length });
});
api.get('/intake-submissions/:id', (req, res) => res.json(F.intakeSubmission));
api.get('/delivery-logs', (req, res) => res.json({ ...paged(F.deliveryLogs, req.query, 10) }));
api.use((req, res) => {
  console.warn('[未提供的假 API]', req.method, req.originalUrl);
  res.json({ items: [] });
});

// ── 瀏覽器 ──
const vite = await createServer({ root, configFile: `${root}/vite.config.js`, logLevel: 'warn', define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api') }, server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'manual-fixtures', configureServer(server) { server.middlewares.use('/api', api); } }] });
const io = new Server(vite.httpServer);
io.on('connection', (socket) => { socket.on('join-day', (day) => socket.join(`appointments:${day}`)); });
await vite.listen();
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;

const VIEWPORT = { width: 1440, height: 920, deviceScaleFactor: 2 };
let browser;
const failures = [];

// 頁面裡的小工具：照文字找元素、畫編號標記。標記畫在 body 上（絕對定位），不改動頁面本身的版面。
function installHelpers(fixedNow) {
  const offset = fixedNow - Date.now();
  const RealDate = Date;
  class ClinicDate extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(RealDate.now() + offset); }
    static now() { return RealDate.now() + offset; }
  }
  globalThis.Date = ClinicDate;
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  // text 以「=」開頭＝整段文字完全相同，否則是包含。
  const matches = (node, text) => {
    if (!text) return true;
    const content = node.textContent.replace(/\s+/g, ' ').trim();
    return text.startsWith('=') ? content === text.slice(1) : content.includes(text);
  };
  // 同時符合的外層與內層取最內層（外層容器的文字一定也包含它）。
  window.__find = (selector, text, closest) => {
    const found = [...document.querySelectorAll(selector)].filter((node) => visible(node) && matches(node, text));
    const el = found.find((node) => !found.some((other) => other !== node && node.contains(other))) ?? null;
    return el && closest ? el.closest(closest) : el;
  };
  window.__mark = (targets) => {
    document.querySelectorAll('[data-manual-mark]').forEach((node) => node.remove());
    for (const { el, n, place = 'tl', label } of targets) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const ring = document.createElement('div');
      ring.dataset.manualMark = '';
      Object.assign(ring.style, { position: 'fixed', left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px`, border: '3px solid #e8590c', borderRadius: '10px', zIndex: 2147483646, pointerEvents: 'none', boxSizing: 'border-box' });
      const badge = document.createElement('div');
      badge.dataset.manualMark = '';
      badge.textContent = String(label ?? n);
      const left = place.includes('r') ? r.right - 10 : r.left - 14;
      const top = place.includes('b') ? r.bottom - 10 : r.top - 14;
      Object.assign(badge.style, { position: 'fixed', left: `${left}px`, top: `${top}px`, width: '26px', height: '26px', borderRadius: '50%', background: '#e8590c', color: '#fff', font: '700 15px/26px system-ui, sans-serif', textAlign: 'center', zIndex: 2147483647, pointerEvents: 'none', boxShadow: '0 0 0 3px #fff' });
      document.body.append(ring);
      if (label !== '') document.body.append(badge);
    }
  };
}

async function newPage(identity) {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.evaluateOnNewDocument(installHelpers, F.now.getTime());
  await page.evaluateOnNewDocument((who) => { localStorage.setItem('clinic.staffIdentity', who); localStorage.setItem('theme', 'light'); }, identity);
  page.on('pageerror', (error) => console.error('[頁面錯誤]', error.message));
  page.setDefaultTimeout(12000);
  return page;
}

const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));
async function go(page, path, readyText) {
  lastPage = page;
  await page.bringToFront();
  await page.goto(`${origin}${path}`);
  if (readyText) await page.waitForFunction((text) => document.body.innerText.includes(text), {}, readyText);
  await page.evaluate(() => document.fonts.ready);
  await settle();
}
async function waitText(page, text) {
  await page.waitForFunction((value) => document.body.innerText.includes(value), {}, text);
}
async function el(page, selector, text, closest) {
  await page.waitForFunction((s, t, c) => Boolean(window.__find(s, t, c)), {}, selector, text ?? '', closest ?? '');
  return page.evaluateHandle((s, t, c) => window.__find(s, t, c), selector, text ?? '', closest ?? '');
}
async function click(page, selector, text, closest) {
  const handle = await el(page, selector, text, closest);
  await handle.click();
  await handle.dispose();
  await settle(500);
}
// targets：[[selector, text?, closest?, place?, label?], …]，依序編號 1、2、3…；label 給空字串＝只畫框、不標數字。
async function mark(page, targets) {
  const handles = [];
  for (const [selector, text, closest, place, label] of targets) handles.push({ handle: await el(page, selector, text, closest), place, label });
  await page.evaluate((...items) => {
    const list = [];
    for (let i = 0; i < items.length; i += 3) list.push({ el: items[i], n: i / 3 + 1, place: items[i + 1], label: items[i + 2] ?? undefined });
    window.__mark(list);
  }, ...handles.flatMap(({ handle, place, label }) => [handle, place ?? 'tl', label ?? null]));
}
async function unmark(page) { await page.evaluate(() => window.__mark([])); }

// 截圖：clip 是元素（或選擇器、或幾個元素合起來的範圍）時裁到它的範圍外加留白；沒給就是整個畫面。
async function unionBox(handles) {
  const boxes = (await Promise.all(handles.map((handle) => handle.boundingBox()))).filter(Boolean);
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
async function shot(page, name, clip = null, pad = 18) {
  let options = {};
  if (clip) {
    const handles = Array.isArray(clip) ? clip : [typeof clip === 'string' ? await page.$(clip) : clip];
    const box = await unionBox(handles);
    const x = Math.max(box.x - pad, 0);
    const y = Math.max(box.y - pad, 0);
    options.clip = { x, y, width: Math.min(box.width + pad * 2, VIEWPORT.width - x), height: Math.min(box.height + pad * 2, page.viewport().height - y) };
  }
  await page.screenshot({ path: join(outDir, `${name}.webp`), type: 'webp', quality: 80, ...options });
  console.log('  ✓', name);
}
let lastPage = null;
async function step(name, fn) {
  if (only && !name.includes(only)) return;
  console.log(name);
  try { await fn(); } catch (err) {
    failures.push(name);
    console.error(`  ✗ ${name}`, err.message);
    if (lastPage) {
      const text = await lastPage.evaluate(() => document.body.innerText).catch(() => '');
      console.error(`  畫面上的文字（${lastPage.url()}）：\n${text.replace(/\n+/g, ' / ').slice(0, 1500)}`);
      await lastPage.screenshot({ path: join(outDir, `_failed-${name}.png`) }).catch(() => {});
    }
  }
}

try {
  await mkdir(outDir, { recursive: true });
  if (!only) await rm(outDir, { recursive: true, force: true }).then(() => mkdir(outDir, { recursive: true }));
  browser = await puppeteer.launch({ headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  const desk = await newPage('front_desk');
  const vet = await newPage('vet');
  const timeline = `article[data-appointment="${A.orange._id}"]`;

  await step('01-掛號台', async () => {
    await desk.setViewport({ ...VIEWPORT, height: 1250 });
    await go(desk, `/reception?date=${today}`, '今日看診');
    await mark(desk, [
      ['[aria-label="今日流程"]'],
      ['[aria-label="需要注意"]'],
      [timeline],
      [`article[data-appointment="${A.milk._id}"] button`, '處理', null, 'tr'],
      [`article[data-appointment="${A.pudding._id}"]`],
    ]);
    await shot(desk, '01-reception');
    await unmark(desk);
    await desk.setViewport(VIEWPORT);
  });

  await step('02-掛號視窗-保證金', async () => {
    await go(desk, `/reception?date=${today}`, '今日看診');
    await click(desk, 'button', '=掛號');
    await desk.waitForSelector('#dialog-pet-search');
    await desk.type('#dialog-pet-search', '小橘');
    await click(desk, '[role="dialog"] button', '小橘米克斯');
    await waitText(desk, '保證金');
    const dialog = await el(desk, '[role="dialog"]');
    await mark(desk, [
      ['[role="dialog"] table', '遲到', 'div'],
      ['[role="dialog"] div.bg-warning-surface', '約診前要先收保證金', null, 'tr'],
    ]);
    await shot(desk, '02-booking-deposit', dialog, 0);
    await unmark(desk);
    await desk.keyboard.press('Escape');
  });

  await step('03-初診審核', async () => {
    await go(desk, `/reception?date=${today}`, '今日看診');
    await click(desk, 'aside[aria-label="工具欄"] button', '初診');
    await waitText(desk, '許家瑜');
    await click(desk, 'section button', '布丁');
    await waitText(desk, '掛號安排');
    const panel = await el(desk, 'section[aria-label]', '掛號安排');
    await shot(desk, '03-intake-review', panel, 0);
    await desk.keyboard.press('Escape');
  });

  await step('04-一鍵報到', async () => {
    await go(desk, `/reception?date=${today}`, '今日看診');
    await click(desk, `article[data-appointment="${A.lucky._id}"] button`, '報到');
    await waitText(desk, '復原');
    await mark(desk, [[`article[data-appointment="${A.lucky._id}"]`], ['[aria-live="polite"] > *', '復原', null, 'tr']]);
    await shot(desk, '04-check-in');
    await unmark(desk);
    Object.assign(A.lucky, { status: 'scheduled', checkinNumber: null, checkedInAt: null });
  });

  await step('05-診療台', async () => {
    await go(vet, `/appointments?date=${today}`, '今日病患');
    await vet.click(`[role="button"][aria-label^="開啟 豆豆"]`);
    await vet.waitForSelector('[aria-label="豆豆 看診工作區"]');
    await settle(800);
    await mark(vet, [
      ['[role="button"][aria-label^="開啟 豆豆"]'],
      ['[role="button"][aria-label^="開啟 咪咪"]'],
      ['[role="button"][aria-label^="開啟 小橘"]'],
      ['[aria-label="豆豆 看診工作區"]', null, null, 'tr'],
    ]);
    await shot(vet, '05-vet-console');
    await unmark(vet);
  });

  await step('06-看診工作區', async () => {
    // 工作區是撐滿畫面高度、內部捲動；把畫面拉高，紀錄欄位才會全部畫出來。
    await vet.setViewport({ ...VIEWPORT, height: 2600 });
    await go(vet, `/appointments?date=${today}`, '今日病患');
    await vet.click('[role="button"][aria-label^="開啟 豆豆"]');
    await vet.waitForSelector('[aria-label="豆豆 看診工作區"]');
    await settle(800);
    await mark(vet, [
      ['h3', '=本次簡易紀錄', 'div', 'tr'],
      ['h3', '=藥單', 'div', 'tr'],
      ['label', '=內部備註', 'div', 'tr'],
      ['label', '=請轉告飼主', 'div', 'tr'],
    ]);
    const top = await el(vet, 'section[aria-labelledby^="note-heading"]');
    const bottom = await el(vet, 'section[aria-labelledby^="handoff-heading"]');
    await shot(vet, '06-visit-fields', [top, bottom], 26);
    await unmark(vet);
    await vet.setViewport(VIEWPORT);
  });

  await step('07-看診工作區-底部', async () => {
    await go(vet, `/appointments?date=${today}`, '今日病患');
    await vet.click('[role="button"][aria-label^="開啟 豆豆"]');
    await vet.waitForSelector('[aria-label="豆豆 看診工作區"]');
    await settle(800);
    const footer = await el(vet, '[aria-label="豆豆 看診工作區"] footer');
    await mark(vet, [
      ['[aria-label="豆豆 看診工作區"] footer span, [aria-label="豆豆 看診工作區"] footer div', '已送 IDEXX'],
      ['[aria-label="豆豆 看診工作區"] footer button', '開啟健檢報告'],
      ['[aria-label="豆豆 看診工作區"] footer button', '取消看診'],
      ['[aria-label="豆豆 看診工作區"] footer button', '送交櫃台', null, 'tr'],
    ]);
    await shot(vet, '07-visit-actions', footer, 22);
    await unmark(vet);
  });

  await step('08-檢驗報告與燈號', async () => {
    // 畫面拉高，燈號的明細才會往下展開、整份放得進畫面。
    await vet.setViewport({ ...VIEWPORT, height: 2200 });
    await go(vet, `/appointments?date=${today}`, '今日病患');
    await vet.click('[role="button"][aria-label^="開啟 豆豆"]');
    await vet.waitForSelector('[aria-label="豆豆 看診工作區"]');
    await settle(800);
    const trigger = await el(vet, '[aria-label="豆豆 看診工作區"] button', '跟報告不同');
    await trigger.click();
    await waitText(vet, '健檢報告填入狀態');
    await settle(400);
    const heading = await el(vet, 'h3', '=檢驗報告', 'div');
    const pop = await el(vet, '[role="dialog"]', '健檢報告填入狀態');
    const workspace = await el(vet, '[aria-label="豆豆 看診工作區"]');
    const [top, bottom, area] = await Promise.all([heading.boundingBox(), pop.boundingBox(), workspace.boundingBox()]);
    {
      await vet.screenshot({ path: join(outDir, '08-lab-status.webp'), type: 'webp', quality: 80, clip: { x: area.x, y: top.y - 18, width: area.width, height: bottom.y + bottom.height + 18 - (top.y - 18) } });
      console.log('  ✓ 08-lab-status');
    }
    await vet.keyboard.press('Escape');
    await vet.setViewport(VIEWPORT);
  });

  await step('09-比對視窗', async () => {
    await go(vet, `/records/${F.records.bean._id}/edit`, '引用本次看診');
    await waitText(vet, '覆蓋勾選的');
    const dialog = await el(vet, '[role="dialog"]');
    await shot(vet, '09-lab-conflict', dialog, 0);
    await click(vet, '[role="dialog"] button', '=都不要');
  });

  await step('10-健檢報告-引用看診', async () => {
    await go(vet, `/records/${F.records.bean._id}/edit`, '引用本次看診');
    await waitText(vet, '覆蓋勾選的');
    await vet.keyboard.press('Escape');
    await settle();
    await mark(vet, [
      ['div', '體重、體溫、檢驗數值'],
      ['button', '跟報告不同', null, 'tr'],
      ['div', '回診日期', null, 'tr'],
      ['button', '套用預填模板', null, 'tr'],
    ]);
    await shot(vet, '10-record-visit-link');
    await unmark(vet);
  });

  await step('11-櫃台處理視窗', async () => {
    await desk.setViewport({ ...VIEWPORT, height: 1080 });
    await go(desk, `/reception?date=${today}`, '今日看診');
    await click(desk, '[aria-label="處理 奶茶"]');
    await waitText(desk, '完成處理');
    const dialog = await el(desk, '[role="dialog"]');
    // 這個視窗自己就有 ①②③ 編號，只畫框、不再疊數字。
    await mark(desk, [
      ['[role="dialog"] label', '上傳影像', null, 'tl', ''],
      ['[role="dialog"] button', '完成處理', null, 'tr', ''],
    ]);
    await shot(desk, '11-handoff-sheet', dialog, 0);
    await unmark(desk);
    await desk.keyboard.press('Escape');
    await desk.setViewport(VIEWPORT);
  });

  await step('12-藥單', async () => {
    await go(desk, '/medications', '藥單');
    await waitText(desk, '奶茶');
    await mark(desk, [
      ['[data-medication-row]', '奶茶'],
      ['[data-medication-row] button', '完成包藥', null, 'tr'],
      ['[data-medication-row]', '雪球'],
    ]);
    const card = await el(desk, 'section, div', '第 1');
    await shot(desk, '12-medications', card, 20);
    await unmark(desk);
  });

  await step('13-病歷日誌', async () => {
    await vet.setViewport({ ...VIEWPORT, height: 2200 });
    await go(vet, `/pets/${P.bean._id}`, '病歷日誌');
    await waitText(vet, 'IDEXX 檢驗');
    // 從頁籤那一排截到「領藥紀錄」那張日誌卡片（整張卡片寬度）。
    const tabs = await el(vet, 'article', '看診紀錄');
    const medNote = await el(vet, 'article', '領藥紀錄');
    await mark(vet, [
      ['div', '看診紀錄', null, 'tr'],
      ['div', '領藥紀錄', null, 'tr'],
    ]);
    await shot(vet, '13-journal', [tabs, medNote], 20);
    await unmark(vet);
    await vet.setViewport(VIEWPORT);
  });

  await step('14-出席紀錄', async () => {
    await go(desk, `/pets/${P.orange._id}`, '出席紀錄');
    await click(desk, '[role="tab"], button', '出席紀錄');
    await waitText(desk, '下雨不方便出門');
    await mark(desk, [
      ['div, span, button', '遲到 2 次'],
      ['div, span', '約診需收保證金'],
    ]);
    await shot(desk, '14-attendance');
    await unmark(desk);
  });

  await step('15-寄送歷程', async () => {
    await go(desk, '/records/deliveries', '寄送紀錄');
    await waitText(desk, '退信');
    await mark(desk, [['.desktop-data-row', '退信'], ['.desktop-data-row', '結果待確認']]);
    const card = await el(desk, 'section, div', '第 1');
    await shot(desk, '15-deliveries', card, 20);
    await unmark(desk);
  });

  await step('16-檢驗面板', async () => {
    await go(desk, `/reception?date=${today}`, '今日看診');
    await click(desk, 'aside[aria-label="工具欄"] button', '檢驗');
    await waitText(desk, '確認是');
    const header = await el(desk, 'section[aria-label] header', '選好是哪隻貓');
    const last = await el(desk, 'section[aria-label] li', '確認是咪咪');
    await mark(desk, [
      ['section[aria-label] header [aria-label*="診所電腦"]', null, null, 'tr'],
      ['section[aria-label] li', '豆豆'],
      ['section[aria-label] li button', '確認是咪咪', null, 'tr'],
    ]);
    await shot(desk, '16-lab-panel', [header, last], 16);
    await unmark(desk);
  });

  await step('17-聊天', async () => {
    await go(desk, `/reception?date=${today}`, '今日看診');
    await click(desk, 'aside[aria-label="工具欄"] button', '聊天');
    await waitText(desk, '磨粉');
    const panel = await el(desk, 'section[aria-label="內部聊天"]');
    await shot(desk, '17-chat', panel, 0);
  });

  await step('18-待辦', async () => {
    await go(desk, `/reception?date=${today}`, '今日看診');
    await click(desk, 'aside[aria-label="工具欄"] button', '待辦');
    await waitText(desk, '上傳影像');
    const header = await el(desk, 'section[aria-label] header', '院內共用');
    const last = await el(desk, 'section[aria-label] li', '上傳影像');
    await shot(desk, '18-todos', [header, last], 16);
  });
} finally {
  await browser?.close();
  io.close();
  await vite.close();
}
if (failures.length) {
  console.error(`\n${failures.length} 張沒有產生：${failures.join('、')}`);
  process.exitCode = 1;
}
