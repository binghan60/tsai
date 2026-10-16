import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { visitMilestones } from './visitProgress.js';

// 10:12、10:31、10:39、10:50 台北
const checkedInAt = '2026-10-16T02:12:00.000Z';
const visitStartedAt = '2026-10-16T02:31:00.000Z';
const handoffAt = '2026-10-16T02:39:00.000Z';
const deskCompletedAt = '2026-10-16T02:50:00.000Z';
const now = new Date('2026-10-16T02:43:00.000Z');

const states = (steps) => steps.map((step) => step.state);

describe('visitMilestones', () => {
  it('看診中：報到完成、開始看診是現在這一步，寫經過多久', () => {
    const steps = visitMilestones({ checkedInAt, visitStartedAt }, now);
    assert.deepEqual(states(steps), ['done', 'active', 'pending', 'pending']);
    assert.equal(steps[0].time, '10:12');
    assert.equal(steps[1].label, '看診中');
    assert.equal(steps[1].time, '10:31');
    assert.equal(steps[1].elapsed, '12 分');
    assert.equal(steps[2].time, '');
    assert.equal(steps[0].elapsed, '');
  });

  it('剛報到：候診中', () => {
    const steps = visitMilestones({ checkedInAt }, now);
    assert.deepEqual(states(steps), ['active', 'pending', 'pending', 'pending']);
    assert.equal(steps[0].label, '候診中');
    assert.equal(steps[0].elapsed, '31 分');
  });

  it('四步都有時間：全部完成、沒有進行中', () => {
    const steps = visitMilestones({ checkedInAt, visitStartedAt, handoffAt, deskCompletedAt }, now);
    assert.deepEqual(states(steps), ['done', 'done', 'done', 'done']);
    assert.equal(steps[3].label, '完成處理');
  });

  it('還沒報到：全部未到', () => {
    assert.deepEqual(states(visitMilestones({}, now)), ['pending', 'pending', 'pending', 'pending']);
    assert.deepEqual(states(visitMilestones(null, now)), ['pending', 'pending', 'pending', 'pending']);
  });

  it('中間斷掉的里程碑之後一律當還沒到', () => {
    const steps = visitMilestones({ checkedInAt, handoffAt }, now);
    assert.deepEqual(states(steps), ['active', 'pending', 'pending', 'pending']);
    assert.equal(steps[2].time, '');
  });

  it('不是今天開始的只寫時刻、不寫經過多久', () => {
    const steps = visitMilestones({ checkedInAt, visitStartedAt }, new Date('2026-10-17T02:00:00.000Z'));
    assert.equal(steps[1].elapsed, '');
  });
});
