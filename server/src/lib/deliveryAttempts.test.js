import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deliveryAttemptPipeline } from './deliveryAttempts.js';

const stage = (pipeline, name, index = 0) => pipeline.filter((step) => name in step)[index][name];

describe('deliveryAttemptPipeline', () => {
  it('先合併成一次寄送，才篩結果、分頁', () => {
    const pipeline = deliveryAttemptPipeline({ event: 'queued' }, { page: 3, limit: 10 });
    const names = pipeline.map((step) => Object.keys(step)[0]);
    assert.ok(names.indexOf('$group') < names.lastIndexOf('$match'), '結果篩選要在合併之後');
    assert.deepEqual(stage(pipeline, '$match', 0), {});
    assert.deepEqual(stage(pipeline, '$match', 1), { event: 'queued' });
    assert.deepEqual(stage(pipeline, '$facet').items.slice(1), [{ $skip: 20 }, { $limit: 10 }]);
  });

  it('日期範圍看這次寄送最後有動靜的時間，用診所時區換算', () => {
    const pipeline = deliveryAttemptPipeline({ from: '2026-09-27', to: '2026-09-27' });
    assert.deepEqual(stage(pipeline, '$match', 1), {
      latestAt: { $gte: new Date('2026-09-26T16:00:00.000Z'), $lt: new Date('2026-09-27T16:00:00.000Z') },
    });
  });

  it('關鍵字與報告在合併前篩；不合法的報告 id 直接回空', () => {
    const pipeline = deliveryAttemptPipeline({ q: '豆豆', recordId: '507f1f77bcf86cd799439011' });
    const before = stage(pipeline, '$match', 0);
    assert.equal(String(before.recordId), '507f1f77bcf86cd799439011');
    assert.equal(before.$or.length, 3);
    assert.equal(deliveryAttemptPipeline({ recordId: 'nope' }), null);
  });
});
