import { after, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import mongoose from 'mongoose';
import { app } from '../app.js';
import Appointment from '../models/Appointment.js';
import ClinicalNote from '../models/ClinicalNote.js';
import LabResult from '../models/LabResult.js';
import MedicalRecord from '../models/MedicalRecord.js';
import FormTemplate from '../models/FormTemplate.js';

// 報到建立的健檢報告草稿引用看診：讀的時候疊上看診值、改的時候寫回看診、草稿本身不存那幾欄。
const appointmentId = '507f1f77bcf86cd799439021';
const recordId = '507f1f77bcf86cd799439022';
const unlinkedId = '507f1f77bcf86cd799439023';
const petId = '507f1f77bcf86cd799439024';
const templateId = '507f1f77bcf86cd799439025';
const template = {
  _id: templateId, version: 1, name: '一般健檢',
  sections: [{ key: 'labs', title: '檢驗', presentation: 'table', items: [
    { key: 'wbc', label: 'WBC', type: 'lab', unit: '×10³/µL', referenceMin: 5.5, referenceMax: 19.5 },
    { key: 'alt', label: 'ALT', type: 'lab', unit: 'U/L', referenceMin: 12, referenceMax: 130 },
  ] }],
};

const clone = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

// 可以 await、也可以接 .select()／.populate()／.lean()／.session() 的假查詢。
function query(read) {
  const q = {
    select: () => q, populate: () => q, lean: () => q, session: () => q,
    then: (resolve, reject) => Promise.resolve().then(read).then(resolve, reject),
  };
  return q;
}

describe('健檢報告草稿引用看診', () => {
  let server, origin, appointments, records, diary;
  before(async () => {
    server = app.listen(0, '127.0.0.1');
    if (!server.listening) await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}/api/records`;
  });
  after(async () => { mock.restoreAll(); await new Promise((resolve) => server.close(resolve)); });
  beforeEach(() => {
    mock.restoreAll();
    appointments = new Map([[appointmentId, {
      _id: appointmentId, petId, templateId, recordId, __v: 3, date: '2026-09-07', time: '10:00',
      scheduledAt: new Date('2026-09-07T02:00:00Z'), status: 'arrived', petName: '豆豆', reason: '健檢',
      weightKg: 4.2, temperatureC: 38.6, followUpDate: '2026-10-09', followUpTime: '14:30',
      labValues: [{ key: 'wbc', label: 'WBC', value: '22.4', unit: '×10³/µL', referenceMin: 5.5, referenceMax: 19.5 }],
    }]]);
    const draft = (id) => ({
      _id: id, petId: null, templateId, status: 'draft', __v: 2, chiefComplaint: '',
      weightKg: null, temperatureC: null, followUpDate: null,
      labFindings: [{ key: 'wbc', label: 'WBC', value: '', status: 'not_checked', statusSource: 'auto', note: '重抽一次' }],
    });
    records = new Map([[recordId, draft(recordId)], [unlinkedId, draft(unlinkedId)]]);
    diary = new Map();

    const appointmentDoc = (raw) => {
      if (!raw) return null;
      const doc = new Appointment(raw);
      doc.save = async ({ session } = {}) => {
        assert.ok(session, '寫回看診要在 transaction 裡');
        await doc.validate();
        doc.__v = (doc.__v || 0) + 1;
        appointments.set(String(doc._id), doc.toObject());
        return doc;
      };
      return doc;
    };
    mock.method(mongoose, 'startSession', async () => ({
      withTransaction: async (callback) => {
        const copy = (map) => new Map([...map].map(([key, value]) => [key, clone(value)]));
        const snapshot = { appointments: copy(appointments), records: copy(records), diary: copy(diary) };
        try { return await callback({}); } catch (err) { ({ appointments, records, diary } = snapshot); throw err; }
      },
      endSession: async () => {},
    }));
    mock.method(Appointment, 'findOne', (filter) => query(() => [...appointments.values()].find((item) => String(item.recordId) === String(filter.recordId)) ?? null));
    mock.method(Appointment, 'findById', (key) => query(() => appointmentDoc(appointments.get(String(key)))));
    mock.method(FormTemplate, 'findById', () => query(() => template));
    mock.method(LabResult, 'find', () => ({ select: () => ({ sort: () => ({ session: () => ({ lean: async () => [] }) }) }) }));
    mock.method(MedicalRecord, 'findById', (key) => query(() => (records.has(String(key)) ? new MedicalRecord(records.get(String(key))) : null)));
    mock.method(MedicalRecord, 'findOneAndUpdate', (filter, update) => query(() => {
      const current = records.get(String(filter._id));
      if (!current || current.status !== filter.status || current.__v !== filter.__v) return null;
      const next = { ...current, ...clone(update.$set), __v: current.__v + (update.$inc?.__v ?? 0) };
      records.set(String(filter._id), next);
      return new MedicalRecord(next);
    }));
    mock.method(ClinicalNote, 'findOneAndUpdate', async (filter, update) => { diary.set(String(filter.appointmentId), update.$set); });
    mock.method(ClinicalNote, 'deleteOne', (filter) => ({ session: async () => { diary.delete(String(filter.appointmentId)); } }));
  });

  const put = async (id, body) => {
    const response = await fetch(`${origin}/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };

  it('讀草稿時疊上看診的值，並回 visitLink', async () => {
    const response = await fetch(`${origin}/${recordId}`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.visitLink, { appointmentId, date: '2026-09-07' });
    assert.equal(body.weightKg, 4.2);
    assert.equal(body.followUpDate, '2026-10-09T06:30:00.000Z');
    const wbc = body.labFindings.find((finding) => finding.key === 'wbc');
    assert.deepEqual([wbc.value, wbc.status, wbc.note], ['22.4', 'abnormal', '重抽一次']);
    assert.equal(records.get(recordId).weightKg, null, '只是讀，草稿本身沒被寫入');
  });

  it('報告上改的值寫回看診與病歷日誌，草稿不存', async () => {
    const saved = await put(recordId, {
      expectedVersion: 2, chiefComplaint: '食慾差', weightKg: 9, temperatureC: 40,
      labFindings: [{ key: 'wbc', value: '1', status: 'not_checked', statusSource: 'auto', note: '重抽一次' }],
      visitEdits: { weightKg: 4.5, labValues: { alt: '90' } },
    });
    assert.equal(saved.status, 200);
    const visit = appointments.get(appointmentId);
    assert.equal(visit.weightKg, 4.5);
    assert.equal(visit.temperatureC, 38.6, '沒放進 visitEdits 的舊畫面值不會蓋掉看診');
    assert.deepEqual(visit.labValues.map((lab) => [lab.key, lab.value]), [['wbc', '22.4'], ['alt', '90']]);
    assert.equal(visit.__v, 4);
    assert.ok(diary.has(appointmentId), '看診有內容就有病歷日誌');

    const stored = records.get(recordId);
    assert.deepEqual([stored.weightKg, stored.temperatureC, stored.chiefComplaint], [null, null, '食慾差']);
    assert.equal(stored.labFindings.find((finding) => finding.key === 'wbc').value, '');
    // 回應帶著看診的最新值。
    assert.equal(saved.body.weightKg, 4.5);
    assert.equal(saved.body.temperatureC, 38.6);
    assert.equal(saved.body.labFindings.find((finding) => finding.key === 'alt').value, '90');
  });

  it('沒有 visitEdits 就不動看診', async () => {
    const saved = await put(recordId, { expectedVersion: 2, weightKg: 9 });
    assert.equal(saved.status, 200);
    assert.equal(appointments.get(appointmentId).__v, 3);
    assert.equal(saved.body.weightKg, 4.2);
  });

  it('報告版本衝突時看診那邊也回滾', async () => {
    const saved = await put(recordId, { expectedVersion: 1, visitEdits: { weightKg: 5 } });
    assert.equal(saved.status, 409);
    assert.equal(appointments.get(appointmentId).weightKg, 4.2);
    assert.equal(appointments.get(appointmentId).__v, 3);
  });

  it('檢驗項目不在看診的表單裡就擋下，報告也不存', async () => {
    const saved = await put(recordId, { expectedVersion: 2, chiefComplaint: '改了', visitEdits: { labValues: { glu: '100' } } });
    assert.equal(saved.status, 422);
    assert.equal(records.get(recordId).chiefComplaint, '');
  });

  it('沒連著看診的草稿照舊存自己的值', async () => {
    const saved = await put(unlinkedId, { expectedVersion: 2, weightKg: 4.8, visitEdits: { weightKg: 1 } });
    assert.equal(saved.status, 200);
    assert.equal(records.get(unlinkedId).weightKg, 4.8);
    assert.equal(saved.body.visitLink, null);
    assert.equal(appointments.get(appointmentId).__v, 3);
  });
});
