import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { emitAppointmentUpdate, emitPatientsUpdate, emitRecordsUpdate, initRealtime } from './realtime.js';
import { liveInvalidation } from './liveInvalidation.js';

describe('連動資料的即時通知', () => {
  const server = http.createServer();
  const io = initRealtime(server);
  const events = [];
  // 不連真的 socket：把廣播導到陣列，檢查「發了什麼、發給誰」。
  io.emit = (event, payload) => { events.push({ event, payload }); };
  io.to = (room) => ({ emit: (event, payload) => { events.push({ event, payload, room }); } });

  after(async () => {
    await io.close();
  });

  it('掛號有變：推到那一天的房間，同時全站廣播「這隻貓的日誌請重讀」（日誌是由掛號組成的）', () => {
    events.length = 0;
    emitAppointmentUpdate({ _id: 'apt-1', petId: 'pet-1', date: '2026-10-13' });
    assert.deepEqual(events, [
      { event: 'appointment:updated', payload: { _id: 'apt-1', petId: 'pet-1', date: '2026-10-13' }, room: 'appointments:2026-10-13' },
      { event: 'clinical-note:updated', payload: { petId: 'pet-1', appointmentId: 'apt-1' } },
    ]);
  });

  it('還沒建檔的初診（沒有 petId）不發日誌通知；petId 被 populate 成物件時取它的 _id', () => {
    events.length = 0;
    emitAppointmentUpdate({ _id: 'apt-2', petId: null, date: '2026-10-13' });
    assert.deepEqual(events.map((item) => item.event), ['appointment:updated']);
    events.length = 0;
    emitAppointmentUpdate({ _id: 'apt-3', petId: { _id: 'pet-9' }, date: '2026-10-13' });
    assert.deepEqual(events.at(-1), { event: 'clinical-note:updated', payload: { petId: 'pet-9', appointmentId: 'apt-3' } });
  });

  it('貓咪／報告的失效通知：短時間內多次合併成一次，而且延後發出（避開 transaction 還沒 commit）', async () => {
    events.length = 0;
    emitPatientsUpdate();
    emitPatientsUpdate();
    emitRecordsUpdate();
    emitPatientsUpdate();
    assert.deepEqual(events, [], '當下不發，等 transaction commit');
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.deepEqual(events.map((item) => item.event).sort(), ['patients:updated', 'records:updated']);
  });
});

describe('liveInvalidation plugin', () => {
  it('不管從哪裡寫（save、各種 query 更新與刪除）都通知，通知出錯不影響寫入', () => {
    const registered = [];
    const schema = { post: (...args) => registered.push(args) };
    let fired = 0;
    liveInvalidation(schema, () => { fired += 1; });
    const ops = registered.map(([op]) => op);
    for (const op of ['save', 'insertMany', 'deleteOne', 'updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndDelete', 'deleteMany']) {
      assert.ok(ops.includes(op), `${op} 有掛 hook`);
    }
    // deleteOne 同時涵蓋文件與查詢兩種寫法。
    assert.equal(registered.filter(([op]) => op === 'deleteOne').length, 2);
    for (const args of registered) args.at(-1)();
    assert.equal(fired, registered.length);

    const throwing = [];
    liveInvalidation({ post: (...args) => throwing.push(args) }, () => { throw new Error('socket down'); });
    assert.doesNotThrow(() => throwing[0].at(-1)());
  });
});
