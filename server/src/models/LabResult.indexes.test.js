import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import LabResult from './LabResult.js';
import MedicationOrder from './MedicationOrder.js';

// 工具欄的數字（藥單各階段筆數、檢驗待確認、未處理的差異）每台裝置、每次事件都會查，
// 靠這幾條索引只看索引鍵、不讀文件；誰把它們刪掉，查詢會退回掃整個只增不減的 collection。
const hasIndex = (model, key, partial = false) => model.schema.indexes().some(([fields, options]) =>
  JSON.stringify(fields) === JSON.stringify(key) && Boolean(options?.partialFilterExpression) === partial);

describe('工具欄數字用到的索引', () => {
  it('檢驗待確認：petId＋dismissedAt＋檢驗時間', () => {
    assert.ok(hasIndex(LabResult, { petId: 1, dismissedAt: 1, runAt: -1, _id: -1 }));
  });
  it('未處理的差異：只收 conflictsOpen 的部分索引，依檢驗時間排序', () => {
    assert.ok(hasIndex(LabResult, { runAt: -1, _id: -1 }, true));
    const [, options] = LabResult.schema.indexes().find(([fields, opt]) => JSON.stringify(fields) === '{"runAt":-1,"_id":-1}' && opt?.partialFilterExpression);
    assert.deepEqual(options.partialFilterExpression, { conflictsOpen: true });
  });
  it('藥單各階段筆數 hint 指向的 {status, createdAt} 索引存在', () => {
    assert.ok(hasIndex(MedicationOrder, { status: 1, createdAt: -1 }));
  });
});
