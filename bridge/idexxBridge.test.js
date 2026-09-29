import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ARCHIVE_DIR,
  FAILED_DIR,
  archivePath,
  heartbeatPayload,
  isSettled,
  normalizeConfig,
  outcomeFor,
  processFolder,
} from './idexxBridge.js';

describe('isSettled：InterLink 寫完了沒', () => {
  const now = 100_000;
  it('第一次看到的檔案先不動', () => {
    assert.equal(isSettled(undefined, { size: 10, mtimeMs: 0 }, now, 3000), false);
  });
  it('大小或時間還在變就是還在寫', () => {
    assert.equal(isSettled({ size: 5, mtimeMs: 0 }, { size: 10, mtimeMs: 0 }, now, 3000), false);
    assert.equal(isSettled({ size: 10, mtimeMs: 0 }, { size: 10, mtimeMs: 1 }, now, 3000), false);
  });
  it('兩輪都沒變、而且靜止超過 settle 時間才上傳', () => {
    assert.equal(isSettled({ size: 10, mtimeMs: 99_000 }, { size: 10, mtimeMs: 99_000 }, now, 3000), false);
    assert.equal(isSettled({ size: 10, mtimeMs: 90_000 }, { size: 10, mtimeMs: 90_000 }, now, 3000), true);
  });
  it('空檔案不算寫完', () => {
    assert.equal(isSettled({ size: 0, mtimeMs: 0 }, { size: 0, mtimeMs: 0 }, now, 3000), false);
  });
});

describe('outcomeFor：依伺服器回應決定檔案去處', () => {
  const failAfter = 30 * 60_000;
  it('伺服器收下（不管是新的、重複還是忽略）就歸檔', () => {
    assert.equal(outcomeFor({ status: 201 }, 0, failAfter), 'archive');
    assert.equal(outcomeFor({ status: 200 }, 0, failAfter), 'archive');
  });
  it('讀不了先重試，太久還是讀不了才放棄', () => {
    assert.equal(outcomeFor({ status: 422 }, 60_000, failAfter), 'retry');
    assert.equal(outcomeFor({ status: 422 }, failAfter, failAfter), 'fail');
  });
  it('連不上、密鑰錯、伺服器錯誤都不是檔案的錯，一直重試', () => {
    assert.equal(outcomeFor(null, failAfter * 10, failAfter), 'retry');
    assert.equal(outcomeFor({ status: 0 }, failAfter * 10, failAfter), 'retry');
    assert.equal(outcomeFor({ status: 401 }, failAfter * 10, failAfter), 'retry');
    assert.equal(outcomeFor({ status: 503 }, failAfter * 10, failAfter), 'retry');
    assert.equal(outcomeFor({ status: 500 }, failAfter * 10, failAfter), 'retry');
  });
});

describe('archivePath', () => {
  const now = new Date(2026, 8, 29, 14, 30, 0);
  it('已上傳依月份分資料夾', () => {
    assert.equal(archivePath('C:\\IDEXX\\Results', ARCHIVE_DIR, 'a.xml', now, () => false),
      path.join('C:\\IDEXX\\Results', ARCHIVE_DIR, '2026-09', 'a.xml'));
  });
  it('同名不覆蓋，加上時間', () => {
    const target = archivePath('C:\\IDEXX\\Results', ARCHIVE_DIR, 'a.xml', now, () => true);
    assert.match(path.basename(target), /^a-\d{8}T\d{6}\.xml$/);
  });
});

describe('normalizeConfig', () => {
  it('缺欄位時一次列出所有問題', () => {
    assert.throws(() => normalizeConfig({}), /serverUrl[\s\S]*token[\s\S]*resultsDir/);
  });
  it('補上預設值、去掉網址結尾的斜線', () => {
    const config = normalizeConfig({ serverUrl: 'http://localhost:3000/', token: 'x'.repeat(32), resultsDir: 'C:\\IDEXX\\Results' });
    assert.equal(config.serverUrl, 'http://localhost:3000');
    assert.equal(config.pollSeconds, 10);
  });
});

describe('heartbeatPayload', () => {
  const config = normalizeConfig({ serverUrl: 'http://x.test', token: 'x'.repeat(32), resultsDir: 'C:\\Data' });
  const state = {
    startedAt: new Date('2026-09-30T01:00:00Z'),
    lastUploadAt: new Date('2026-09-30T02:00:00Z'),
    pendingFiles: 3,
    lastError: 'fetch failed',
  };

  it('沒設定名稱就用電腦名稱當識別', () => {
    const payload = heartbeatPayload(config, state, { hostname: 'FRONT-DESK', version: '1.0.0' });
    assert.deepEqual(payload, {
      bridgeId: 'FRONT-DESK',
      hostname: 'FRONT-DESK',
      version: '1.0.0',
      resultsDir: 'C:\\Data',
      startedAt: '2026-09-30T01:00:00.000Z',
      lastUploadAt: '2026-09-30T02:00:00.000Z',
      pendingFiles: 3,
      lastError: 'fetch failed',
    });
  });

  it('設定檔有 name 就用它；還沒上傳過任何檔案時是 null', () => {
    const payload = heartbeatPayload({ ...config, name: '櫃台電腦' }, { startedAt: state.startedAt }, { hostname: 'PC' });
    assert.equal(payload.bridgeId, '櫃台電腦');
    assert.equal(payload.lastUploadAt, null);
    assert.equal(payload.pendingFiles, 0);
  });
});

describe('processFolder：實際在暫存資料夾裡跑一輪', () => {
  let dir;
  let config;
  const oldTime = new Date(Date.now() - 60 * 60_000);

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'idexx-bridge-'));
    config = normalizeConfig({ serverUrl: 'http://example.test', token: 'x'.repeat(32), resultsDir: dir });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function drop(name, content = '<message/>', time = oldTime) {
    const file = path.join(dir, name);
    writeFileSync(file, content);
    utimesSync(file, time, time);
    return file;
  }

  it('新檔要等下一輪確認寫完才上傳，成功後移到已上傳', async () => {
    drop('娜娜.xml');
    const seen = new Map();
    const uploaded = [];
    const upload = async (_config, file) => { uploaded.push(path.basename(file)); return { status: 201, body: { status: 'created' } }; };

    const first = await processFolder(config, { seen, upload });
    assert.equal(first.waiting, 1);
    assert.deepEqual(uploaded, []);

    const second = await processFolder(config, { seen, upload });
    assert.equal(second.archived, 1);
    assert.deepEqual(uploaded, ['娜娜.xml']);
    assert.equal(existsSync(path.join(dir, '娜娜.xml')), false);
    const [month] = readdirSync(path.join(dir, ARCHIVE_DIR));
    assert.deepEqual(readdirSync(path.join(dir, ARCHIVE_DIR, month)), ['娜娜.xml']);
  });

  it('連不上伺服器時檔案留在原地，這一輪停下', async () => {
    drop('a.xml');
    drop('b.xml');
    const seen = new Map();
    let calls = 0;
    const upload = async () => { calls += 1; return { status: 0, body: null, error: 'fetch failed' }; };
    await processFolder(config, { seen, upload });
    const summary = await processFolder(config, { seen, upload });
    assert.equal(calls, 1);
    assert.equal(summary.error, 'fetch failed');
    assert.equal(summary.pending, 2);
    assert.deepEqual(readdirSync(dir).sort(), ['a.xml', 'b.xml']);
  });

  it('伺服器一直讀不了、放太久的檔案移到無法讀取', async () => {
    drop('broken.xml');
    const seen = new Map();
    const upload = async () => ({ status: 422, body: { message: 'XML 不完整' } });
    await processFolder(config, { seen, upload });
    const summary = await processFolder(config, { seen, upload });
    assert.equal(summary.failed, 1);
    assert.deepEqual(readdirSync(path.join(dir, FAILED_DIR)), ['broken.xml']);
  });

  it('只處理 xml，不碰其他檔案與子資料夾', async () => {
    drop('report.pdf');
    drop('a.xml');
    const seen = new Map();
    const uploaded = [];
    const upload = async (_config, file) => { uploaded.push(path.basename(file)); return { status: 200, body: { status: 'duplicate' } }; };
    await processFolder(config, { seen, upload });
    await processFolder(config, { seen, upload });
    assert.deepEqual(uploaded, ['a.xml']);
    assert.ok(existsSync(path.join(dir, 'report.pdf')));
  });
});
