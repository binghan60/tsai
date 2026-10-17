import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { app } from '../app.js';
import Appointment from '../models/Appointment.js';
import Hospitalization from '../models/Hospitalization.js';
import IdexxRequest from '../models/IdexxRequest.js';
import LabResult from '../models/LabResult.js';

describe('POST /api/appointments/:id/lab-request', () => {
  let server;
  let origin;
  const original = { mode: process.env.IDEXX_CENSUS_MODE, findById: Appointment.findById, requestFindOne: IdexxRequest.findOne, labExists: LabResult.exists, stayExists: Hospitalization.exists };
  const id = '64b000000000000000000001';

  before(async () => {
    server = app.listen(0, '127.0.0.1');
    if (!server.listening) await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(() => {
    if (original.mode === undefined) delete process.env.IDEXX_CENSUS_MODE;
    else process.env.IDEXX_CENSUS_MODE = original.mode;
    Appointment.findById = original.findById;
    IdexxRequest.findOne = original.requestFindOne;
    LabResult.exists = original.labExists;
    Hospitalization.exists = original.stayExists;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  function post(body) {
    return fetch(`${origin}/api/appointments/${id}/lab-request`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
    });
  }

  function mockAppointment(fields) {
    const appointment = {
      _id: id, __v: 0, date: '2026-10-06', petName: '牛奶', labRequestedAt: null, saved: 0,
      ...fields,
      async save() { this.saved += 1; },
    };
    Appointment.findById = async () => appointment;
    // 這裡只測掛號本身；通知排隊在 idexxRequests.test.js 測，讓它查到「上一份已經是同一種」就不會往下建。
    IdexxRequest.findOne = () => ({ sort: () => ({ lean: async () => ({ kind: appointment.labRequestedAt ? 'in' : 'out', createdAt: new Date('2026-10-06T06:00:00Z') }) }) });
    LabResult.exists = async () => null;
    Hospitalization.exists = async () => null;
    return appointment;
  }

  it('伺服器沒開這個功能：409，不碰掛號', async () => {
    delete process.env.IDEXX_CENSUS_MODE;
    Appointment.findById = async () => { throw new Error('不該查'); };
    assert.equal((await post({ requested: true })).status, 409);
  });

  it('還沒報到、或櫃台已經完成的不能送', async () => {
    process.env.IDEXX_CENSUS_MODE = 'work_request';
    mockAppointment({ petId: 'p1', status: 'scheduled' });
    assert.equal((await post({ requested: true })).status, 422);
    mockAppointment({ petId: 'p1', status: 'completed' });
    assert.equal((await post({ requested: true })).status, 422);
    mockAppointment({ petId: null, status: 'arrived' });
    assert.equal((await post({ requested: true })).status, 422);
  });

  it('送 IDEXX 記下時間；重複按不重設；取消送 IDEXX 清掉', async () => {
    process.env.IDEXX_CENSUS_MODE = 'work_request';
    const appointment = mockAppointment({ petId: 'p1', status: 'arrived' });
    assert.equal((await post({ requested: true })).status, 200);
    const first = appointment.labRequestedAt;
    assert.ok(first instanceof Date);
    assert.equal((await post({})).status, 200);
    assert.equal(appointment.labRequestedAt, first);
    assert.equal((await post({ requested: false })).status, 200);
    assert.equal(appointment.labRequestedAt, null);
    assert.equal(appointment.saved, 3);
  });

  it('收了住院、住院還在進行：櫃台完成處理之後也能送；住院結束就不行', async () => {
    process.env.IDEXX_CENSUS_MODE = 'work_request';
    const appointment = mockAppointment({ petId: 'p1', status: 'completed', hospitalizationId: '64b0000000000000000000aa' });
    assert.equal((await post({ requested: true })).status, 422);
    Hospitalization.exists = async () => ({ _id: 'stay' });
    assert.equal((await post({ requested: true })).status, 200);
    assert.ok(appointment.labRequestedAt instanceof Date);
  });

  it('上一張單驗完（結果回來了）再按才當成再送一張，還沒驗完重複按不重設', async () => {
    process.env.IDEXX_CENSUS_MODE = 'work_request';
    const firstAt = new Date('2026-10-06T05:00:00Z');
    const appointment = mockAppointment({ petId: 'p1', status: 'arrived', labRequestedAt: firstAt });
    assert.equal((await post({ requested: true })).status, 200);
    assert.equal(appointment.labRequestedAt, firstAt, '還沒有結果：不動');
    LabResult.exists = async () => ({ _id: 'lab-1' });
    assert.equal((await post({ requested: true })).status, 200);
    assert.ok(appointment.labRequestedAt > firstAt, '驗完了：重設成現在，之後會再排一份到院通知');
  });

  it('別台已經改過這筆掛號（版本不符）：409', async () => {
    process.env.IDEXX_CENSUS_MODE = 'census';
    mockAppointment({ petId: 'p1', status: 'arrived', __v: 3 });
    assert.equal((await post({ requested: true, version: 2 })).status, 409);
  });
});
