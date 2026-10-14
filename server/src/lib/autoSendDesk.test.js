import { afterEach, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import Appointment from '../models/Appointment.js';
import MedicalRecord from '../models/MedicalRecord.js';
import { runAutoSends } from './reportDelivery.js';
import { rootIdsAwaitingDesk } from './recordDeskStatus.js';

// 自動寄送等櫃台完成處理：醫師看完診就先結案、勾了自動寄送，飼主到櫃台才說不要寄。

function query(read) {
  const q = {
    select: () => q, sort: () => q, limit: () => q, lean: () => q, populate: () => q,
    then: (resolve, reject) => Promise.resolve().then(read).then(resolve, reject),
  };
  return q;
}

afterEach(() => mock.restoreAll());

test('連著看診、櫃台還沒完成處理的報告算「等櫃台」；修訂版沿根報告找同一筆看診', async () => {
  mock.method(Appointment, 'find', (filter) => {
    assert.deepEqual(filter.recordId.$in, ['r1', 'r2']);
    assert.equal(filter.deskCompletedAt, null);
    return query(() => [{ recordId: 'r2' }]);
  });
  const waiting = await rootIdsAwaitingDesk([{ _id: 'r1' }, { _id: 'v2', revisionRootId: 'r2' }]);
  assert.deepEqual([...waiting], ['r2']);
});

test('排著的自動寄送跳過還在等櫃台的，其他照寄', async () => {
  mock.method(MedicalRecord, 'find', () => query(() => [
    { _id: 'waiting', revisionRootId: null },
    { _id: 'ready', revisionRootId: null },
    { _id: 'standalone', revisionRootId: null },
  ]));
  mock.method(Appointment, 'find', () => query(() => [{ recordId: 'waiting' }]));
  const attempted = [];
  // 寄送的第一步是搶下 autoSendRequestedAt；這裡記下有誰被搶，回 null＝別人已經處理，不往下寄。
  mock.method(MedicalRecord, 'findOneAndUpdate', (filter) => {
    attempted.push(filter._id);
    return query(() => null);
  });
  await runAutoSends();
  assert.deepEqual(attempted, ['ready', 'standalone']);
});
