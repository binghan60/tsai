// Opt-in browser smoke test with isolated, in-memory API fixtures. Never connects to MongoDB.
// 走一遍現在的看診流程：診療台開工作區 → 開始看診 → 自動存檔 → 遠端更新與衝突 →
// 送交櫃台 → 掛號台處理視窗完成處理；另外檢查右側工具欄面板、明暗主題、窄螢幕與登出。
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import express from '../../server/node_modules/express/index.js';
import puppeteer from '../../server/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
import { Server } from '../../server/node_modules/socket.io/dist/index.js';
import { applyWorkflowAction, assertWorkflowVersion } from '../../server/src/lib/appointmentWorkflow.js';
import { templateLabItems } from '../../shared/labValues.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const id = '507f1f77bcf86cd799439011';
const petId = '507f1f77bcf86cd799439012';
const templateId = '507f1f77bcf86cd799439013';
const date = '2026-09-07';
const template = {
  _id: templateId,
  name: '一般健檢',
  sections: [{ key: 'labs', label: '檢驗', items: [{ key: 'wbc', label: 'WBC 白血球', type: 'lab', unit: '×10³/µL', referenceMin: 5.5, referenceMax: 19.5 }] }],
};
const fixture = {
  _id: id, petId, templateId, __v: 0, workflowVersion: 2, date, time: '10:00', scheduledAt: `${date}T02:00:00Z`, checkedInAt: new Date().toISOString(),
  checkinNumber: 3, petName: '豆豆', ownerName: '王小姐', ownerPhone: '0912345678', species: '貓', reason: '皮膚複診', status: 'arrived', visitType: 'return',
  visitNote: '', specialCareNote: '', followUpReason: '', followUpRecommendation: '', labValues: [],
};
const appointments = [fixture, { ...fixture, _id: '507f1f77bcf86cd799439014', petName: '咪咪', time: '11:00', scheduledAt: `${date}T03:00:00Z`, status: 'scheduled', checkedInAt: null, checkinNumber: null }];
let io;
let logoutCount = 0;
const broadcast = (appointment) => io.to(`appointments:${appointment.date}`).emit('appointment:updated', appointment);
const api = express();
api.use(express.json());
api.get('/auth/me', (_req, res) => res.json({ username: 'browser-test' }));
api.post('/auth/logout', (_req, res) => { logoutCount += 1; res.json({ ok: true }); });
api.get('/chat/messages', (_req, res) => res.json({ items: [] }));
api.get('/pinned-pets', (_req, res) => res.json({ items: [] }));
api.get('/todos', (_req, res) => res.json({ items: [] }));
api.get('/medications', (_req, res) => res.json({ items: [], counts: {}, total: 0, totalPages: 1 }));
api.get('/intake-submissions', (_req, res) => res.json({ items: [] }));
api.get('/text-templates', (_req, res) => res.json([]));
api.get('/settings/form-templates', (_req, res) => res.json([{ _id: templateId, name: template.name }]));
api.get('/settings/form-templates/:id', (_req, res) => res.json(template));
api.get('/settings/appointment-settings', (_req, res) => res.json({ defaultAppointmentTemplateId: templateId }));
api.get('/appointments', (req, res) => res.json({ items: appointments.filter((p) => p.date === req.query.date), patientNotes: { pets: {}, owners: {} } }));
api.get('/appointments/:id', (req, res) => res.json(appointments.find((p) => p._id === req.params.id)));
api.get('/pets/:id/clinical-notes', (_req, res) => res.json({ items: [], totalPages: 1 }));
api.get('/pets/:id', (_req, res) => res.json({ _id: petId, name: '豆豆', breed: '米克斯', sex: 'male', neutered: 'yes', ownerId: { _id: 'o1', name: '王小姐', phone: '0912345678' } }));
api.post('/appointments/:id/workflow/:action', (req, res) => {
  try {
    const p = appointments.find((item) => item._id === req.params.id);
    assertWorkflowVersion(p, req.body.version);
    applyWorkflowAction(p, req.params.action, req.body, new Date(), { labItems: templateLabItems(template) });
    p.__v += 1;
    broadcast(p);
    res.json(p);
  } catch (err) { res.status(err.status || 500).json({ message: err.message }); }
});
api.post('/chat/messages', (_req, res) => res.status(201).json({}));
const vite = await createServer({ root, configFile: `${root}/vite.config.js`, define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api') }, server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'isolated-clinic-fixtures', configureServer(server) { server.middlewares.use('/api', api); } }] });
io = new Server(vite.httpServer);
io.on('connection', (socket) => { socket.on('join-day', (day) => socket.join(`appointments:${day}`)); socket.on('leave-day', (day) => socket.leave(`appointments:${day}`)); });
await vite.listen();
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
let browser;
try {
  browser = await puppeteer.launch({ headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  const errors = [];
  const doctor = await browser.newPage();
  const desk = await browser.newPage();
  for (const page of [doctor, desk]) {
    page.on('pageerror', (error) => { errors.push(error.message); console.error('PAGE ERROR', error.stack || error.message); });
    page.setDefaultTimeout(10000);
    page.setDefaultNavigationTimeout(15000);
    await page.setViewport({ width: 1920, height: 1080 });
  }
  await doctor.evaluateOnNewDocument(() => localStorage.setItem('clinic.staffIdentity', 'vet'));
  await desk.evaluateOnNewDocument(() => localStorage.setItem('clinic.staffIdentity', 'front_desk'));
  const find = (page, predicate, arg) => page.waitForFunction(predicate, { polling: 100 }, arg);
  // 按鈕靠文字或 aria-label 找（圖示按鈕只有 aria-label）。
  const click = async (page, text) => {
    await page.bringToFront();
    const match = (value) => [...document.querySelectorAll('button,a,[role="button"],[role="menuitem"]')].find((e) => (e.textContent.trim() === value || e.getAttribute('aria-label') === value) && !e.disabled && e.getBoundingClientRect().height);
    await page.waitForFunction(new Function('value', `return (${match.toString()})(value)`), { polling: 100 }, text);
    const element = await page.evaluateHandle(new Function('value', `return (${match.toString()})(value)`), text);
    await element.asElement().click();
    await element.dispose();
  };
  const bodyHas = (page, text) => find(page, (value) => document.body.textContent.includes(value), text);

  // ── 診療台：開工作區、開始看診、自動存檔 ──
  await doctor.goto(`${origin}/appointments?date=${date}`);
  await click(doctor, '開啟 豆豆');
  await doctor.waitForSelector('[aria-label="豆豆 看診工作區"]');
  assert.equal(await doctor.evaluate(() => document.body.textContent.includes('給櫃台的交辦')), false, 'handoff note field is gone');
  await click(doctor, '開始看診');
  await find(doctor, () => document.querySelector('[contenteditable][aria-label="本次簡易紀錄"]')?.getAttribute('contenteditable') === 'true');
  await doctor.type('[contenteditable][aria-label="本次簡易紀錄"]', '今日紀錄：皮膚搔癢改善。');
  await find(doctor, () => document.querySelector('[aria-label="豆豆 看診工作區"] footer').textContent.includes('已儲存'));
  assert.match(fixture.visitNote, /皮膚搔癢改善/);
  console.log('Visit started and the note autosaved');

  // 檢驗數值改在健檢報告填寫頁輸入，診療台不再有檢驗區塊。
  assert.equal(await doctor.$(`#visit-lab-wbc-${id}`), null, 'lab value block is gone from the workspace');
  await doctor.screenshot({ path: join(tmpdir(), 'clinic-workspace.png') });

  // 遠端改了別的欄位：本機正在打的字留著、不算衝突。
  await doctor.type('[contenteditable][aria-label="本次簡易紀錄"]', '本機補充');
  fixture.specialCareNote = '傷口勿舔舐'; fixture.__v += 1; broadcast(fixture);
  await find(doctor, () => document.querySelector(`[id^="visit-specialCareNote-"]`)?.value === '傷口勿舔舐');
  assert.match(await doctor.$eval('[contenteditable][aria-label="本次簡易紀錄"]', (e) => e.textContent), /本機補充/);
  await find(doctor, () => document.querySelector('[aria-label="豆豆 看診工作區"] footer').textContent.includes('已儲存'));
  // 同一欄兩邊都改：要人決定。
  await doctor.type('[contenteditable][aria-label="本次簡易紀錄"]', '需核對的本機紀錄');
  fixture.visitNote = '另一端修改的紀錄'; fixture.__v += 1; broadcast(fixture);
  await bodyHas(doctor, '這筆看診資料與其他更新衝突');
  await click(doctor, '保留我的修改');
  await find(doctor, () => document.querySelector('[aria-label="豆豆 看診工作區"] footer').textContent.includes('已儲存'));
  assert.match(fixture.visitNote, /需核對的本機紀錄/);
  console.log('Remote updates keep local typing; conflicting edits need a decision');

  await click(doctor, '完成看診，送交櫃台');
  await find(doctor, () => !document.querySelector('[aria-label="豆豆 看診工作區"]'));
  assert.equal(fixture.status, 'pending_checkout');
  await doctor.screenshot({ path: join(tmpdir(), 'clinic-console.png') });

  // ── 掛號台：處理視窗完成處理 ──
  await desk.goto(`${origin}/reception?date=${date}`);
  await click(desk, '處理 豆豆');
  await bodyHas(desk, '請轉告飼主');
  await bodyHas(desk, '傷口勿舔舐');
  await desk.screenshot({ path: join(tmpdir(), 'clinic-handoff-sheet.png') });  assert.equal(await desk.evaluate(() => document.body.textContent.includes('醫師交辦')), false, 'handoff sheet has no handoff-note section');
  await click(desk, '完成處理');
  await find(desk, () => !document.querySelector('[aria-label="關閉處理視窗"]'));
  assert.equal(fixture.status, 'completed');
  console.log('Desk completed the handoff');

  // ── 右側工具欄：面板不遮擋背景、再按一次收起 ──
  await click(desk, '暫存區');
  await desk.waitForSelector('section[aria-label="暫存區"]');
  await click(desk, '暫存區');
  await desk.waitForSelector('section[aria-label="暫存區"]', { hidden: true });
  await click(desk, '內部聊天（未讀）');
  await desk.waitForSelector('section[aria-label="內部聊天"]');
  await desk.screenshot({ path: join(tmpdir(), 'clinic-reception-panel.png') });
  await desk.keyboard.press('Escape');

  // ── 明暗主題 ──
  const wasDark = await desk.evaluate(() => document.documentElement.classList.contains('dark'));
  await click(desk, '設定：身分、主題、通知、登出');
  await click(desk, wasDark ? '切換成淺色' : '切換成深色');
  assert.equal(await desk.evaluate(() => document.documentElement.classList.contains('dark')), !wasDark);
  await desk.screenshot({ path: join(tmpdir(), `clinic-reception-${wasDark ? 'light' : 'dark'}.png`), fullPage: true });

  // ── 窄螢幕不橫向捲動 ──
  await desk.setViewport({ width: 390, height: 844 });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const overflow = await desk.evaluate(() => [...document.querySelectorAll('body *')]
    .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && el.getBoundingClientRect().width > 0)
    .filter((el) => ![...el.children].some((child) => child.getBoundingClientRect().right > window.innerWidth + 1))
    .slice(0, 5)
    .map((el) => { const chain = []; let node = el; for (let i = 0; i < 7 && node; i += 1, node = node.parentElement) chain.push(`${node.tagName.toLowerCase()}[${(node.getAttribute('class') || '').slice(0, 60)}] w=${Math.round(node.getBoundingClientRect().width)}`); return chain.join(' < '); }));
  if (overflow.length) console.error('Overflowing at 390px:', overflow);
  await find(desk, () => document.documentElement.scrollWidth <= window.innerWidth + 1);
  await desk.screenshot({ path: join(tmpdir(), 'clinic-reception-mobile.png'), fullPage: true });

  // ── 登出 ──
  await doctor.bringToFront();
  await click(doctor, '設定：身分、主題、通知、登出');
  assert.equal(logoutCount, 0, 'opening settings does not log out');
  await click(doctor, '登出');
  await find(doctor, () => location.pathname === '/login');
  assert.equal(logoutCount, 1);
  assert.deepEqual(errors, []);
  console.log('PASS: 看診工作區、自動存檔、遠端更新與衝突、送交櫃台、完成處理、工具欄面板、明暗主題、窄螢幕與登出。');
  console.log(`Screenshots in ${tmpdir()} (clinic-*.png)`);
} catch (error) {
  console.error(error);
  for (const [index, page] of (await browser.pages()).entries()) {
    await page.bringToFront();
    console.error('Page:', page.url(), (await page.evaluate(() => document.body.innerText)).slice(-1500));
    await page.screenshot({ path: join(tmpdir(), `clinic-workflow-${index}.png`) });
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  io.disconnectSockets(true);
  io.engine.close();
  await vite.close();
}
