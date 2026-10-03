import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fillMessage, instrumentLabel, visitStatusLabel } from './labResults.js';

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
    assert.match(fillMessage({ status: 'applied', filled: [], unmapped: 3 }, '牛奶').message, /沒有對應這些項目的 IDEXX 代號/);
    assert.match(fillMessage({ status: 'no_visit' }, '牛奶').message, /沒有掛號/);
    assert.match(fillMessage({ status: 'no_template' }, '牛奶').message, /沒有選健檢表單/);
    assert.equal(fillMessage({ status: 'error', message: 'x' }, '牛奶').type, 'error');
  });
});
