import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import DeletedMedicalRecord from './DeletedMedicalRecord.js';

describe('deleted medical record audit snapshot', () => {
  it('寫進固定的 collection 名稱', () => {
    // 快照的價值在於「報告消失之後還查得到」，collection 名稱被 mongoose 自動複數化
    // 成別的名字會讓既有資料變成孤兒，所以第三個參數是刻意寫死的。
    assert.equal(DeletedMedicalRecord.collection.collectionName, 'deletedMedicalRecords');
  });

  it('姓名是冗餘欄位而不是 ref', () => {
    // 跟 DeliveryLog 同一套理由：報告與寵物都可能已經不存在，populate 一個
    // 不存在的文件是查不出東西的，所以刪除當下就要把名字抄一份下來。
    assert.equal(DeletedMedicalRecord.schema.path('petName').instance, 'String');
    assert.equal(DeletedMedicalRecord.schema.path('ownerName').instance, 'String');
    assert.equal(DeletedMedicalRecord.schema.path('petName').options.ref, undefined);
    assert.equal(DeletedMedicalRecord.schema.path('petId').options.ref, undefined);
    assert.equal(DeletedMedicalRecord.schema.path('recordId').options.ref, undefined);
  });

  it('快照不套用今天的 schema', () => {
    // 表單結構是使用者自訂的，而快照的意義是「當時原封不動的樣子」，
    // 不是「符合今天 schema 的樣子」——所以型別必須是 Mixed。
    assert.equal(DeletedMedicalRecord.schema.path('snapshot').instance, 'Mixed');
  });

  it('保留刪除當下的生命週期與寄送狀態', () => {
    // 回答「這份被刪的報告當時走到哪一步」，兩個維度都要留。
    assert.equal(DeletedMedicalRecord.schema.path('status').instance, 'String');
    assert.equal(DeletedMedicalRecord.schema.path('deliveryStatus').instance, 'String');
  });

  it('索引接得上清單排序與回查', () => {
    const indexes = DeletedMedicalRecord.schema.indexes().map(([fields]) => fields);
    assert.ok(indexes.some((fields) => fields.deletedAt === -1 && fields._id === -1));
    assert.ok(indexes.some((fields) => fields.recordId === 1));
  });
});
