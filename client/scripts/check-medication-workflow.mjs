// Isolated browser exercise: real medication routes/models with in-memory persistence.
// No connection to the clinic database; all fixtures disappear when this process ends.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import express from '../../server/node_modules/express/index.js';
import puppeteer from '../../server/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
import mongoose from '../../server/node_modules/mongoose/index.js';
import MedicationOrder from '../../server/src/models/MedicationOrder.js';
import ClinicalNote from '../../server/src/models/ClinicalNote.js';
import Pet from '../../server/src/models/Pet.js';
import medicationsRouter from '../../server/src/routes/medications.js';
import { initRealtime } from '../../server/src/lib/realtime.js';

process.env.AUTH_ENABLED = 'false';
const root = fileURLToPath(new URL('..', import.meta.url));
const petId = '507f1f77bcf86cd799439011';
const ownerId = '507f1f77bcf86cd799439012';
const patient = { _id: petId, name: '安安', ownerId: { _id: ownerId, name: '陳小姐', phone: '0912345678' } };
const orders = new Map();
const seed = new MedicationOrder({ petId, ownerId, petName: '安安', ownerName: '陳小姐', ownerPhone: '0912345678', prescription: '上次醫師確認的藥單', status: 'collected', __v: 0, createdAt: new Date('2026-09-01T00:00:00Z') });
orders.set(String(seed._id), seed.toObject());
const matches = (item, filter) => Object.entries(filter).every(([key, value]) => {
  if (key === '$or') return value.some(part => Object.entries(part).some(([field, pattern]) => pattern.test(item[field] || '')));
  if (value?.$in) return value.$in.includes(item[key]);
  return String(item[key]) === String(value);
});
MedicationOrder.find = filter => {
  let found = [...orders.values()].filter(item => matches(item, filter));
  const chain = {
    select() { return chain; },
    sort(sort) { found.sort((a, b) => (new Date(a.createdAt) - new Date(b.createdAt)) * sort.createdAt); return chain; },
    skip(count) { found = found.slice(count); return chain; },
    async limit(count) { return found.slice(0, count).map(({ history, ...item }) => item); },
  };
  return chain;
};
MedicationOrder.findById = async id => orders.has(String(id)) ? MedicationOrder.hydrate(structuredClone(orders.get(String(id)))) : null;
MedicationOrder.countDocuments = async filter => [...orders.values()].filter(item => matches(item, filter)).length;
MedicationOrder.aggregate = async () => Object.entries([...orders.values()].reduce((counts, item) => { counts[item.status] = (counts[item.status] || 0) + 1; return counts; }, {})).map(([_id, count]) => ({ _id, count }));
MedicationOrder.prototype.save = async function () {
  await this.validate();
  const existing = orders.get(String(this._id));
  if (existing && existing.__v !== this.__v) throw Object.assign(new Error('version conflict'), { status: 409 });
  this.__v = existing ? this.__v + 1 : 0;
  this.createdAt ||= new Date('2026-09-18T01:00:00Z');
  this.updatedAt = new Date();
  // JSON roundtrip preserves ObjectId values when hydrated again.
  orders.set(String(this._id), JSON.parse(JSON.stringify(this.toObject())));
  return this;
};
Pet.findById = () => ({ populate: async () => patient });
// 藥單與它的病歷日誌在同一個 transaction 裡存（routes/medications.js 的 saveWithJournal）。
// 這裡沒有資料庫：transaction 直接執行 callback，日誌的寫入只記下來不落地。
const journalWrites = [];
mongoose.startSession = async () => ({ withTransaction: async (fn) => fn({}), endSession: async () => {} });
ClinicalNote.deleteOne = async (filter) => { journalWrites.push({ op: 'delete', filter }); return { deletedCount: 0 }; };
ClinicalNote.findOneAndUpdate = async (filter) => { journalWrites.push({ op: 'upsert', filter }); return {}; };
const api = express();
api.use(express.json());
api.use((req, res, next) => { req.user = { username: '測試帳號' }; next(); });
api.use('/medications', medicationsRouter);
api.get('/auth/me', (req, res) => res.json({ username: '測試帳號' }));
api.get('/pets', (req, res) => res.json({ items: [patient] }));
api.get('/pets/:id/clinical-notes', (req, res) => res.json({ items: [{ _id: 'note', content: '上次回診：精神正常', entryDate: '2026-09-01' }] }));
api.get('/settings/form-templates', (req, res) => res.json([]));
api.get('/settings/appointment-settings', (req, res) => res.json({}));
api.get('/text-templates', (req, res) => res.json({ items: [] }));
api.get('/appointments', (req, res) => res.json({ items: [], patientNotes: {} }));
api.get('/chat/messages', (req, res) => res.json({ items: [] }));
api.get('/pinned-pets', (req, res) => res.json({ items: [] }));
api.get('/intake-submissions', (req, res) => res.json({ items: [], total: 0 }));
api.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message }));
const vite = await createServer({ root, configFile: `${root}/vite.config.js`, define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api') }, server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'medication-fixtures', configureServer(server) { server.middlewares.use('/api', api); } }] });
const io = initRealtime(vite.httpServer);
await vite.listen();
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
let browser;
try {
  browser = await puppeteer.launch({ headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  const errors = [];
  const doctor = await browser.newPage();
  const desk = await browser.newPage();
  for (const page of [doctor, desk]) {
    page.on('pageerror', err => errors.push(err.message));
    page.on('response', async response => { if (response.status() >= 400) console.error('HTTP', response.status(), response.url(), await response.text()); });
    page.setDefaultTimeout(12000);
    await page.setViewport({ width: 1600, height: 1000 });
  }
  // 藥單面板看的階段依裝置身分決定（醫師看待確認、櫃台看包藥與領藥），身分存在 localStorage。
  await desk.evaluateOnNewDocument(() => localStorage.setItem('clinic.staffIdentity', 'front_desk'));
  await doctor.evaluateOnNewDocument(() => localStorage.setItem('clinic.staffIdentity', 'vet'));
  async function click(page, text) {
    await page.bringToFront();
    await page.waitForFunction(text => [...document.querySelectorAll('button')].some(el => el.textContent.trim() === text && !el.disabled && el.getBoundingClientRect().height), {}, text);
    const handle = await page.evaluateHandle(text => [...document.querySelectorAll('button')].find(el => el.textContent.trim() === text && !el.disabled && el.getBoundingClientRect().height), text);
    await handle.asElement().asLocator().click(); await handle.dispose();
  }
  async function clickPrefix(page, text) {
    await page.bringToFront();
    await page.waitForFunction(text => [...document.querySelectorAll('button')].some(el => el.textContent.trim().startsWith(text) && !el.disabled && el.getBoundingClientRect().height), {}, text);
    const handle = await page.evaluateHandle(text => [...document.querySelectorAll('button')].find(el => el.textContent.trim().startsWith(text) && !el.disabled && el.getBoundingClientRect().height), text);
    await handle.asElement().asLocator().click(); await handle.dispose();
  }
  // 清單列上的按鈕靠 aria-label 辨識（文字只有「完成」「修改」，同一頁會有很多顆）。
  async function clickLabel(page, label) {
    await page.bringToFront();
    await page.waitForFunction(label => [...document.querySelectorAll('button')].some(el => el.getAttribute('aria-label') === label && !el.disabled && el.getBoundingClientRect().height), {}, label);
    const handle = await page.evaluateHandle(label => [...document.querySelectorAll('button')].find(el => el.getAttribute('aria-label') === label && !el.disabled && el.getBoundingClientRect().height), label);
    await handle.asElement().asLocator().click(); await handle.dispose();
  }
  async function fill(page, selector, text) { await page.click(selector); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.type(selector, text); }
  // 面板版是卡片清單、全頁版是表格，兩者的列都帶 data-medication-row。
  async function waitRow(page, status) { await page.waitForFunction(status => [...document.querySelectorAll('[data-medication-row]')].some(row => row.textContent.includes('安安') && row.textContent.includes(status)), {}, status); }
  const rowCount = (page) => page.evaluate(() => document.querySelectorAll('[data-medication-row]').length);
  async function open(page) {
    await page.bringToFront();
    // 切換階段後清單是非同步重抓的，不等就會在列還沒畫出來時拿到 null。
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(el => ['開啟', '修改'].some(prefix => el.getAttribute('aria-label')?.startsWith(`${prefix} 安安`))));
    const handle = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(el => ['開啟', '修改'].some(prefix => el.getAttribute('aria-label')?.startsWith(`${prefix} 安安`))));
    await handle.asElement().asLocator().click(); await handle.dispose();
    await page.waitForSelector('#med-prescription');
  }
  async function closed(page) {
    try { await page.waitForSelector('#med-prescription', { hidden: true }); }
    catch (err) { console.error(await page.evaluate(() => document.body.innerText)); throw err; }
  }
  // 「藥單」是右側工具欄的按鈕（文字是「藥單」加上待辦徽章數字，所以用 prefix 比對）。
  async function openMedicationPanel(page) { await clickPrefix(page, '藥單'); await page.waitForSelector('[aria-label="藥單工作區"]'); }
  // 每份清單只顯示一個階段，所以藥單一往前走，還要看它的那一端就得自己切格子。
  // 面板裡的階段頁籤平分一列（上面數字、下面短標籤），全名與筆數在 aria-label（「待醫師確認 1 筆」），
  // 全頁版的頁籤則是文字「待包藥 1」——兩種都用 prefix 比對。
  async function stage(page, label) {
    await page.bringToFront();
    const find = (text) => [...document.querySelectorAll('[role="tab"]')]
      .find((el) => (el.getAttribute('aria-label') || el.textContent).trim().startsWith(text) && !el.disabled && el.getBoundingClientRect().height);
    await page.waitForFunction(`(${find})(${JSON.stringify(label)})`);
    const handle = await page.evaluateHandle(`(${find})(${JSON.stringify(label)})`);
    await handle.asElement().asLocator().click(); await handle.dispose();
  }
  await doctor.goto(`${origin}/appointments?tab=medications`);
  await desk.goto(`${origin}/reception?tab=medications`);
  // 新增藥單從右側工具欄的藥單面板進去：清單工具列上的「新增藥單」推入新增表單。
  await openMedicationPanel(desk);
  await desk.waitForFunction(() => [...document.querySelectorAll('[aria-label="藥單工作區"] button')].some(el => el.textContent.trim() === '新增藥單'));
  await (await desk.evaluateHandle(() => [...document.querySelectorAll('[aria-label="藥單工作區"] button')].find(el => el.textContent.trim() === '新增藥單'))).asElement().asLocator().click();
  // 欄位一開始就全部展開，不必等選好貓咪。
  for (const id of ['#med-condition', '#med-note', '#med-prescription']) {
    assert.notEqual(await desk.$(id), null, `${id} is visible before a pet is picked`);
  }
  assert.equal(await desk.evaluate(() => document.body.innerText.includes('歷次病歷日誌')), true, 'notes panel is on the right before a pet is picked');
  await desk.type('#med-pet-search', '安安');
  await clickPrefix(desk, '安安');
  assert.notEqual(await desk.$('#med-prescription'), null, 'desk registration has the same prescription field as the doctor');
  // 選好貓咪，右欄的歷次病歷日誌就要直接列出內容，不能還得手動展開。
  await desk.waitForFunction(() => document.body.innerText.includes('上次回診：精神正常'));
  assert.equal(await desk.evaluate(() => [...document.querySelectorAll('button')].some(el => el.textContent.trim() === '返回清單')), false, 'create-only view has no list toggle of its own');
  await desk.type('#med-condition', '食慾下降，精神正常');
  await desk.type('#med-prescription', '櫃台先寫的藥單');
  await click(desk, '建立並送醫師確認');
  await desk.waitForSelector('#med-condition', { hidden: true });
  // 建立成功後退回藥單面板的清單（面板本身還開著）；醫師端另外打開工具欄的藥單。
  await desk.waitForSelector('[aria-label="藥單工作區"]');
  await openMedicationPanel(doctor);
  await waitRow(doctor, '待醫師確認');
  const created = [...orders.values()].find(item => item.status === 'review');
  assert.ok(created, 'desk registration persisted');
  assert.equal(created.appointmentId, null);
  assert.equal(created.prescription, '櫃台先寫的藥單', 'desk-entered prescription is saved for the doctor to review');
  assert.ok(new Date(created.createdAt) < new Date('2026-09-19'), 'old pending orders remain visible across dates');
  await open(doctor);
  await fill(doctor, '#med-prescription', '醫師修改後的新藥單\n第二行交代');
  await click(doctor, '確認藥單並送交包藥'); await closed(doctor);
  await waitRow(desk, '待包藥');
  await open(desk); await click(desk, '提出意見');
  await desk.type('#med-return', '劑量請再確認'); await click(desk, '送回醫師重審'); await closed(desk);
  await waitRow(doctor, '待醫師確認'); await open(doctor);
  await click(doctor, '確認藥單並送交包藥'); await closed(doctor);
  await waitRow(desk, '待包藥');
  // 清單上的「完成」：不必先點進詳情，一顆按鈕加一道確認就完成包藥。
  await clickLabel(desk, '完成 安安 的包藥');
  assert.equal(await desk.$('#med-prescription'), null, 'list-level complete does not open the detail view');
  await click(desk, '確認');
  await stage(desk, '待領藥'); await waitRow(desk, '待領藥');
  assert.equal(orders.get(String(created._id)).status, 'ready', 'list complete advances the order to ready');
  await desk.screenshot({ path: join(tmpdir(), 'tsai-medications-reception.png'), fullPage: true });

  // Keep an old ready order open at the desk while the doctor changes it.
  await open(desk);
  await stage(doctor, '待領藥'); await waitRow(doctor, '待領藥'); await open(doctor);
  await fill(doctor, '#med-prescription', '重新確認的藥單');
  await click(doctor, '修改並重新送審'); await click(doctor, '確認'); await closed(doctor);
  await desk.waitForFunction(() => document.body.textContent.includes('藥單已被其他工作台更新'));
  assert.equal(await desk.$eval('button', () => [...document.querySelectorAll('button')].find(el => el.textContent.trim() === '確認領藥').disabled), true);
  await click(desk, '載入最新藥單'); await click(desk, '確認');
  await desk.waitForFunction(() => document.body.textContent.includes('藥單在包藥完成後曾修改'));
  await clickLabel(desk, '返回清單'); await closed(desk);
  await stage(doctor, '待醫師確認'); await open(doctor); await click(doctor, '確認藥單並送交包藥'); await closed(doctor);
  await stage(desk, '待包藥'); await waitRow(desk, '待包藥'); await open(desk);
  await click(desk, '完成重新包藥'); await click(desk, '確認'); await closed(desk);
  await stage(desk, '待領藥'); await open(desk); await click(desk, '確認領藥'); await click(desk, '確認'); await closed(desk);
  assert.equal(orders.get(String(created._id)).status, 'collected');
  // 已領藥的歷史：/medications 全頁版（全部階段，跟面板同一套）看得到，頁首的藥單面板最後一個分頁也是「已領藥」。
  await desk.goto(`${origin}/medications`);
  await stage(desk, '已領藥');
  await desk.waitForFunction(() => document.querySelectorAll('[data-medication-row]').length === 2);
  await fill(desk, '[aria-label="搜尋藥單"]', '0912345678');
  await desk.keyboard.press('Enter');
  await desk.waitForFunction(() => document.querySelectorAll('[data-medication-row]').length === 2);
  await desk.goto(`${origin}/reception`);
  await openMedicationPanel(desk);
  await stage(desk, '已領藥');
  await desk.waitForFunction(() => document.querySelectorAll('[aria-label="藥單工作區"] [data-medication-row]').length === 2);
  assert.equal(await desk.evaluate(() => [...document.querySelectorAll('[aria-label="藥單工作區"] button')].some(el => el.getAttribute('aria-label')?.startsWith('完成 '))), false, 'collected orders have no complete button');
  // 面板清單工具列上的「新增藥單」推入新增表單（限定在面板裡找）。
  await desk.waitForFunction(() => [...document.querySelectorAll('[aria-label="藥單工作區"] button')].some(el => el.textContent.trim() === '新增藥單'));
  await (await desk.evaluateHandle(() => [...document.querySelectorAll('[aria-label="藥單工作區"] button')].find(el => el.textContent.trim() === '新增藥單'))).asElement().asLocator().click();
  await desk.type('#med-pet-search', '安安');
  await clickPrefix(desk, '安安');
  await desk.type('#med-condition', '飼主來電續藥');
  // 從新增表單按返回：有未儲存內容先問，按「取消」留在表單上、草稿還在。
  await clickLabel(desk, '返回藥單'); await click(desk, '取消');
  // 病況是可上色的編輯器（contenteditable），沒有 value，讀畫面上的文字。
  assert.equal(await desk.$eval('#med-condition', el => el.textContent), '飼主來電續藥', 'cancel discard retains draft');
  await click(desk, '建立並送醫師確認'); await closed(desk);
  await stage(desk, '待醫師確認'); await open(desk);
  await click(desk, '取消藥單');
  await click(desk, '確認'); await closed(desk);
  // 已取消沒有自己的分頁（那顆只在不限制 stages 時出現），只有「全部」看得到；歷史紀錄則直接查資料。
  assert.equal([...orders.values()].find(item => item.status === 'cancelled').history.at(-1).reason, '');
  await stage(desk, '全部');
  await desk.waitForFunction(() => document.querySelectorAll('[aria-label="藥單工作區"] [data-medication-row]').length === 3);
  assert.equal(await desk.evaluate(() => [...document.querySelectorAll('[aria-label="藥單工作區"] [data-medication-row]')].filter(row => row.textContent.includes('已取消')).length), 1, 'all tab includes the cancelled order');
  assert.ok(await rowCount(desk) >= 3);
  await desk.setViewport({ width: 390, height: 844 });
  await desk.screenshot({ path: join(tmpdir(), 'tsai-medications-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: 櫃台登記、跨日、醫師修改與確認、即時同步、包藥、過期版本阻擋、重包、已領藥與歷史搜尋。');
  console.log(`Screenshots: ${join(tmpdir(), 'tsai-medications-reception.png')}, ${join(tmpdir(), 'tsai-medications-mobile.png')}`);
} catch (error) {
  console.error(error);
  for (const [index, page] of (await browser?.pages() ?? []).entries()) {
    console.error('Page:', page.url(), (await page.evaluate(() => document.body.innerText).catch(() => '')).slice(-1500));
    await page.screenshot({ path: join(tmpdir(), `tsai-medications-failure-${index}.png`) }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(resolve => io.close(resolve));
  await vite.close();
}
