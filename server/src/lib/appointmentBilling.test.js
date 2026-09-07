import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeBillingItem,
  sanitizeBillingItems,
  calculateBillingSubtotal,
  summarizeBillingItems,
} from './appointmentBilling.js';

describe('sanitizeBillingItem', () => {
  it('沒有名稱的項目視為無效，回傳 null', () => {
    assert.equal(sanitizeBillingItem({ name: '' }), null);
    assert.equal(sanitizeBillingItem({ name: '   ' }), null);
    assert.equal(sanitizeBillingItem({}), null);
  });

  it('自動以 quantity*unitPrice 計算 amount 並四捨五入', () => {
    const item = sanitizeBillingItem({ name: '驅蟲藥', quantity: 2, unitPrice: 150.5 });
    assert.equal(item.amount, 301);
  });

  it('amount 手動覆寫時優先於自動計算', () => {
    const item = sanitizeBillingItem({ name: '整批用藥', quantity: 3, unitPrice: 100, amount: 250 });
    assert.equal(item.amount, 250);
  });

  it('負數或非數字的 quantity/unitPrice 容錯為 0/預設值', () => {
    const item = sanitizeBillingItem({ name: '看診費', quantity: -5, unitPrice: 'abc' });
    assert.equal(item.quantity, 1); // 負數 quantity 無效，退回預設 1
    assert.equal(item.unitPrice, 0);
    assert.equal(item.amount, 0);
  });

  it('kind 限定 fee/medication，其餘值退回 fee', () => {
    assert.equal(sanitizeBillingItem({ name: 'x', kind: 'medication' }).kind, 'medication');
    assert.equal(sanitizeBillingItem({ name: 'x', kind: 'other' }).kind, 'fee');
    assert.equal(sanitizeBillingItem({ name: 'x' }).kind, 'fee');
  });

  it('dosage/instructions 只 trim，不因 kind 而清空', () => {
    const item = sanitizeBillingItem({ name: '看診費', kind: 'fee', dosage: '  一天一次  ', instructions: ' 飯後 ' });
    assert.equal(item.dosage, '一天一次');
    assert.equal(item.instructions, '飯後');
  });
});

describe('sanitizeBillingItems', () => {
  it('非陣列輸入回傳空陣列', () => {
    assert.deepEqual(sanitizeBillingItems(undefined), []);
    assert.deepEqual(sanitizeBillingItems(null), []);
    assert.deepEqual(sanitizeBillingItems('not-an-array'), []);
  });

  it('過濾掉沒有名稱的項目，保留其餘', () => {
    const items = sanitizeBillingItems([{ name: '看診費', quantity: 1, unitPrice: 500 }, { name: '' }, { name: '  ' }]);
    assert.equal(items.length, 1);
    assert.equal(items[0].name, '看診費');
  });
});

describe('calculateBillingSubtotal', () => {
  it('空清單回傳 0', () => {
    assert.equal(calculateBillingSubtotal([]), 0);
    assert.equal(calculateBillingSubtotal(undefined), 0);
  });

  it('加總多個項目的 amount', () => {
    assert.equal(calculateBillingSubtotal([{ amount: 300 }, { amount: 500 }, { amount: 0 }]), 800);
  });

  it('忽略無效的 amount 值', () => {
    assert.equal(calculateBillingSubtotal([{ amount: 300 }, { amount: -100 }, { amount: 'abc' }]), 300);
  });
});

describe('summarizeBillingItems', () => {
  it('空清單回傳空字串', () => {
    assert.equal(summarizeBillingItems([]), '');
    assert.equal(summarizeBillingItems(undefined), '');
  });

  it('項目數不超過 limit 時全部列出，不加「等」', () => {
    assert.equal(summarizeBillingItems([{ name: '驅蟲藥' }, { name: '看診費' }]), '驅蟲藥、看診費');
  });

  it('項目數超過 limit 時截斷並附註總數', () => {
    const items = [{ name: '驅蟲藥' }, { name: '看診費' }, { name: '抗生素' }, { name: '止痛藥' }];
    assert.equal(summarizeBillingItems(items, { limit: 3 }), '驅蟲藥、看診費、抗生素等 4 項');
  });

  it('忽略沒有名稱的項目', () => {
    assert.equal(summarizeBillingItems([{ name: '' }, { name: '看診費' }]), '看診費');
  });
});
