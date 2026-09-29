import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseIdexxResult } from './idexxResult.js';
import { labResultContent, planLabResultImport } from './labResultImport.js';

const parsed = parseIdexxResult(readFileSync(new URL('../../test/fixtures/idexx/catalyst-one.xml', import.meta.url)));

// 模擬資料庫讀回來的樣子：欄位順序不同、多了 _id 與收檔紀錄，內容一樣。
function stored(overrides = {}) {
  const content = labResultContent(parsed);
  return {
    _id: 'lab-1',
    receiveCount: 1,
    petId: null,
    ...Object.fromEntries(Object.entries(content).reverse()),
    assays: content.assays.map((assay) => Object.fromEntries(Object.entries(assay).reverse())),
    ...overrides,
  };
}

describe('planLabResultImport', () => {
  it('第一次收到', () => {
    assert.equal(planLabResultImport(null, parsed), 'create');
  });

  it('IDEXX 重送（訊息編號與時間變了、內容一樣）只算重複', () => {
    const resend = { ...parsed, messageId: '99', messageAt: new Date('2030-01-01'), subType: 'Resend_of_Previous_Results' };
    assert.equal(planLabResultImport(stored(), resend), 'duplicate');
  });

  it('欄位順序與空值寫法不同不影響比對', () => {
    // Catalyst 這份沒有儀器備註：剛解析的是 []，資料庫舊文件可能根本沒有這個欄位。
    const existing = stored({ doctor: { lastName: 'vet', firstName: 'doctor' }, notes: undefined });
    assert.equal(planLabResultImport(existing, parsed), 'duplicate');
  });

  it('內容不同、訊息較新：以新的為準', () => {
    const revised = {
      ...parsed,
      messageAt: new Date(parsed.messageAt.getTime() + 60_000),
      subType: 'Replace_Previous_Results',
      assays: parsed.assays.map((assay) => (assay.code === 'BUN' ? { ...assay, value: '30' } : assay)),
    };
    assert.equal(planLabResultImport(stored(), revised), 'update');
  });

  it('內容不同、但訊息比已存的舊：不能蓋掉新版', () => {
    const older = {
      ...parsed,
      messageAt: new Date(parsed.messageAt.getTime() - 60_000),
      assays: parsed.assays.slice(0, 2),
    };
    assert.equal(planLabResultImport(stored(), older), 'stale');
  });

  it('任一邊沒有訊息時間就無從比較新舊，以收到的為準', () => {
    const changed = { ...parsed, messageAt: null, notes: ['新增的備註'] };
    assert.equal(planLabResultImport(stored(), changed), 'update');
  });
});
