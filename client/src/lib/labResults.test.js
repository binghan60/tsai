import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bridgeStatusLine, fillMessage, instrumentLabel, visitStatusLabel } from './labResults.js';

describe('bridgeStatusLine：抓檔程式狀態', () => {
  const now = new Date('2026-10-04T03:00:00Z');
  const base = { bridgeId: 'FRONT-DESK', lastSeenAt: '2026-10-04T02:58:00Z', pendingFiles: 0, lastError: '' };

  it('正常：綠色，寫最後回報時間', () => {
    assert.deepEqual(bridgeStatusLine({ ...base, online: true }, now), {
      tone: 'success', text: '診所電腦（FRONT-DESK）連線中', detail: '最後回報：2 分鐘前',
    });
  });

  it('超過三分鐘沒回報：紅色，講明後果', () => {
    const line = bridgeStatusLine({ ...base, online: false, lastSeenAt: '2026-10-04T02:25:00Z' }, now);
    assert.equal(line.tone, 'danger');
    assert.match(line.text, /沒有回報，新的檢驗結果進不來/);
    assert.equal(line.detail, '最後回報：35 分鐘前');
  });

  it('還連著但上傳卡住：橙色，帶出卡了幾個檔案與錯誤', () => {
    const line = bridgeStatusLine({ ...base, online: true, pendingFiles: 3, lastError: 'HTTP 401：密鑰不正確' }, now);
    assert.equal(line.tone, 'warning');
    assert.equal(line.detail, '3 個檔案還沒上傳：HTTP 401：密鑰不正確');
  });
});

describe('instrumentLabel', () => {
  it('認得的儀器加上用途，名稱去掉底線', () => {
    assert.deepEqual(instrumentLabel('Catalyst_One'), { purpose: '生化', name: 'Catalyst One' });
    assert.deepEqual(instrumentLabel('IDEXX_inVue_Dx'), { purpose: '細胞學', name: 'inVue Dx' });
    assert.deepEqual(instrumentLabel('SNAP'), { purpose: '快篩', name: 'SNAP' });
    assert.deepEqual(instrumentLabel('ProCyte_Dx'), { purpose: '血球', name: 'ProCyte Dx' });
  });

  it('沒見過的儀器照樣顯示原名，只是沒有用途', () => {
    assert.deepEqual(instrumentLabel('New_Analyzer'), { purpose: '', name: 'New Analyzer' });
  });
});

describe('visitStatusLabel', () => {
  it('用語跟掛號台流程列一致', () => {
    assert.equal(visitStatusLabel('scheduled'), '待報到');
    assert.equal(visitStatusLabel('arrived'), '在院');
    assert.equal(visitStatusLabel('pending_checkout'), '待櫃台處理');
    assert.equal(visitStatusLabel('completed'), '已完成');
  });
});

describe('fillMessage：確認之後告訴使用者發生了什麼', () => {
  it('填進去了就列出填了哪些，有衝突一併說明', () => {
    assert.deepEqual(fillMessage({ status: 'applied', filled: ['血糖', 'BUN'], conflicts: 0 }, '牛奶'), {
      type: 'success', message: '已填進牛奶的健檢報告：血糖、BUN',
    });
    assert.match(fillMessage({ status: 'applied', filled: ['血糖'], conflicts: 2 }, '牛奶').message, /2 項跟報告上已填的值不同，沒有蓋掉/);
  });

  it('沒填進去一定要講原因', () => {
    assert.match(fillMessage({ status: 'applied', filled: [], unmapped: 3 }, '牛奶').message, /沒有對應這些 IDEXX 檢驗別與代號，沒有填入/);
    assert.match(fillMessage({ status: 'applied', filled: [], unmapped: 1, unmappedCodes: ['Catalyst_One・RBC'] }, '牛奶').message, /（Catalyst_One・RBC）/);
    assert.match(fillMessage({ status: 'no_visit' }, '牛奶').message, /沒有掛號/);
    assert.match(fillMessage({ status: 'no_template' }, '牛奶').message, /沒有選健檢表單/);
    assert.equal(fillMessage({ status: 'error', message: 'x' }, '牛奶').type, 'error');
  });
});
