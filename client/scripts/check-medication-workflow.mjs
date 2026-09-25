// Isolated browser exercise: real medication routes/models with in-memory persistence.
// No connection to the clinic database; all fixtures disappear when this process ends.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import express from '../../server/node_modules/express/index.js';
import puppeteer from '../../server/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
import MedicationOrder from '../../server/src/models/MedicationOrder.js';
import Pet from '../../server/src/models/Pet.js';
import medicationsRouter from '../../server/src/routes/medications.js';
import { initRealtime } from '../../server/src/lib/realtime.js';

process.env.AUTH_ENABLED = 'false';
const root = fileURLToPath(new URL('..', import.meta.url));
const petId = '507f1f77bcf86cd799439011';
const ownerId = '507f1f77bcf86cd799439012';
const patient = { _id: petId, name: '安安', medicalRecordNumber: 'P001', ownerId: { _id: ownerId, name: '陳小姐', phone: '0912345678' } };
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
  async function waitRow(page, status) { await page.waitForFunction(status => [...document.querySelectorAll('tbody tr')].some(row => row.textContent.includes('安安') && row.textContent.includes(status)), {}, status); }
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
  // 「藥單」是頁首 chip（文字是「藥單」加上待辦徽章數字，所以用 prefix 比對）；
  // 「領藥」在面板內的清單工具列上，不再是頁首的獨立按鈕。
  async function openMedicationPanel(page) { await clickPrefix(page, '藥單'); }
  // 每份清單只顯示一個階段，所以藥單一往前走，還要看它的那一端就得自己切格子。
  // 階段鈕的文字帶著筆數（「待包藥 1」），用 prefix 比對。
  async function stage(page, label) { await clickPrefix(page, label); }
  await doctor.goto(`${origin}/appointments?tab=medications`);
  await desk.goto(`${origin}/reception?tab=medications`);
  // 頁首的「領藥」直接開建立表單的獨立 Modal（createOnly），不必先開藥單面板。
  await click(desk, '領藥');
  // 欄位一開始就全部展開，不必等選好寵物。
  for (const id of ['#med-condition', '#med-note', '#med-prescription']) {
    assert.notEqual(await desk.$(id), null, `${id} is visible before a pet is picked`);
  }
  assert.equal(await desk.evaluate(() => document.body.innerText.includes('歷次病歷日誌')), true, 'notes panel is on the right before a pet is picked');
  await desk.type('#med-pet-search', '安安');
  await clickPrefix(desk, '安安');
  assert.notEqual(await desk.$('#med-prescription'), null, 'desk registration has the same prescription field as the doctor');
  // 選好寵物，右欄的歷次病歷日誌就要直接列出內容，不能還得手動展開。
  await desk.waitForFunction(() => document.body.innerText.includes('上次回診：精神正常'));
  assert.equal(await desk.evaluate(() => [...document.querySelectorAll('button')].some(el => el.textContent.trim() === '返回清單')), false, 'create-only modal has no list to return to');
  await desk.type('#med-condition', '食慾下降，精神正常');
  await desk.type('#med-prescription', '櫃台先寫的藥單');
  await click(desk, '建立並送醫師確認');
  await desk.waitForSelector('#med-condition', { hidden: true });
  // 建立成功後 Modal 自己關掉；藥單面板另外開，後面要在櫃台端看清單。
  await openMedicationPanel(desk);
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
  await click(desk, '返回清單'); await closed(desk);
  await stage(doctor, '待醫師確認'); await open(doctor); await click(doctor, '確認藥單並送交包藥'); await closed(doctor);
  await stage(desk, '待包藥'); await waitRow(desk, '待包藥'); await open(desk);
  await click(desk, '完成重新包藥'); await click(desk, '確認'); await closed(desk);
  await stage(desk, '待領藥'); await open(desk); await click(desk, '確認領藥'); await click(desk, '確認'); await closed(desk);
  assert.equal(orders.get(String(created._id)).status, 'collected');
  // 已領藥的歷史：/medications 全頁版（stages ready+collected）看得到，頁首的藥單面板最後一個分頁也是「已領藥」。
  await desk.goto(`${origin}/medications`);
  await click(desk, '已領藥 2');
  await desk.waitForFunction(() => document.querySelectorAll('tbody tr').length === 2);
  await fill(desk, '[aria-label="搜尋藥單"]', '0912345678');
  await desk.click('[aria-label="搜尋搜尋藥單"]');
  await desk.waitForFunction(() => document.querySelectorAll('tbody tr').length === 2);
  await desk.goto(`${origin}/reception`);
  await openMedicationPanel(desk);
  await stage(desk, '已領藥');
  await desk.waitForFunction(() => document.querySelectorAll('[aria-label="藥單工作區"] tbody tr').length === 2);
  assert.equal(await desk.evaluate(() => [...document.querySelectorAll('[aria-label="藥單工作區"] button')].some(el => el.getAttribute('aria-label')?.startsWith('完成 '))), false, 'collected orders have no complete button');
  // 面板裡的「領藥」在工作區的清單工具列上；頁首另有一顆同名的鈕（開獨立 Modal），所以限定範圍。
  await desk.waitForFunction(() => [...document.querySelectorAll('[aria-label="藥單工作區"] button')].some(el => el.textContent.trim() === '領藥'));
  await (await desk.evaluateHandle(() => [...document.querySelectorAll('[aria-label="藥單工作區"] button')].find(el => el.textContent.trim() === '領藥'))).asElement().asLocator().click();
  await desk.type('#med-pet-search', '安安');
  await clickPrefix(desk, '安安');
  await desk.type('#med-condition', '飼主來電續藥');
  await click(desk, '返回清單'); await click(desk, '取消');
  // 病況是可上色的編輯器（contenteditable），沒有 value，讀畫面上的文字。
  assert.equal(await desk.$eval('#med-condition', el => el.textContent), '飼主來電續藥', 'cancel discard retains draft');
  await click(desk, '建立並送醫師確認'); await closed(desk);
  await click(desk, '待醫師確認 1'); await open(desk);
  await click(desk, '取消藥單');
  await click(desk, '確認'); await closed(desk);
  // 已取消沒有自己的分頁（那顆只在不限制 stages 時出現），只有「全部」看得到；歷史紀錄則直接查資料。
  assert.equal([...orders.values()].find(item => item.status === 'cancelled').history.at(-1).reason, '');
  await stage(desk, '全部');
  await desk.waitForFunction(() => document.querySelectorAll('[aria-label="藥單工作區"] tbody tr').length === 3);
  assert.equal(await desk.evaluate(() => [...document.querySelectorAll('[aria-label="藥單工作區"] tbody tr')].filter(row => row.textContent.includes('已取消')).length), 1, 'all tab includes the cancelled order');
  await desk.setViewport({ width: 390, height: 844 });
  await desk.screenshot({ path: join(tmpdir(), 'tsai-medications-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: 櫃檯登記、跨日、醫師修改與確認、即時同步、包藥、過期版本阻擋、重包、已領藥與歷史搜尋。');
  console.log(`Screenshots: ${join(tmpdir(), 'tsai-medications-reception.png')}, ${join(tmpdir(), 'tsai-medications-mobile.png')}`);
} finally {
  await browser?.close();
  await new Promise(resolve => io.close(resolve));
  await vite.close();
}
