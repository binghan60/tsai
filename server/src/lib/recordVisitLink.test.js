import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyVisitEdits, hasVisitEdits, stripVisitFields, templateLabItems, visitOverlay } from './recordVisitLink.js';

const template = {
  sections: [
    { key: 'basic', items: [{ key: 'weightKg', type: 'measurement' }] },
    { key: 'labs', items: [
      { key: 'wbc', label: 'WBC', type: 'lab', unit: '×10³/µL', referenceMin: 5.5, referenceMax: 19.5 },
      { key: 'urine', label: '尿沉渣', type: 'lab', numeric: false },
      { key: 'old', label: '停用項目', type: 'lab', enabled: false },
    ] },
    { key: 'hidden', enabled: false, items: [{ key: 'glu', label: 'GLU', type: 'lab' }] },
  ],
};
const visit = (extra = {}) => ({
  weightKg: 4.2, temperatureC: 38.6, followUpDate: '2026-10-09', followUpTime: '14:30',
  labValues: [{ key: 'wbc', value: '22.4' }], ...extra,
});

test('檢驗項目只看啟用中的區塊與項目', () => {
  assert.deepEqual(templateLabItems(template).map((item) => item.key), ['wbc', 'urine']);
});

test('讀草稿時直接引用看診的體重、體溫、回診日期與檢驗，並自動判讀', () => {
  const overlay = visitOverlay({ labFindings: [] }, visit(), template);
  assert.equal(overlay.weightKg, 4.2);
  assert.equal(overlay.temperatureC, 38.6);
  assert.equal(overlay.followUpDate.toISOString(), '2026-10-09T06:30:00.000Z');
  assert.deepEqual(overlay.labFindings.map((f) => [f.key, f.value, f.status]), [['wbc', '22.4', 'abnormal']]);
  // 看診沒填的檢驗項目不會先塞一筆空的進報告。
  assert.equal(overlay.labFindings.some((f) => f.key === 'urine'), false);
});

test('檢驗的手動判讀與備註是報告自己的內容，只有數值來自看診', () => {
  const record = { labFindings: [
    { key: 'wbc', value: '', status: 'normal', statusSource: 'manual', note: '重抽一次' },
    { key: 'urine', value: '', status: 'not_checked', statusSource: 'auto', note: '' },
    { key: 'retired', value: '1', status: 'normal', note: '' },
  ] };
  const overlay = visitOverlay(record, visit({ labValues: [{ key: 'wbc', value: '22.4' }, { key: 'urine', value: '少量結晶' }] }), template);
  const byKey = Object.fromEntries(overlay.labFindings.map((f) => [f.key, f]));
  assert.deepEqual([byKey.wbc.value, byKey.wbc.status, byKey.wbc.note], ['22.4', 'normal', '重抽一次']);
  assert.deepEqual([byKey.urine.value, byKey.urine.status], ['少量結晶', 'abnormal']);
  // 範本裡已經拿掉的項目照原樣留著。
  assert.equal(byKey.retired.value, '1');
});

test('看診清空了，報告上也跟著空', () => {
  const overlay = visitOverlay({ labFindings: [{ key: 'wbc', value: '', status: 'abnormal', statusSource: 'auto' }] }, visit({ weightKg: null, followUpDate: '', labValues: [] }), template);
  assert.equal(overlay.weightKg, null);
  assert.equal(overlay.followUpDate, null);
  assert.deepEqual(overlay.labFindings.map((f) => [f.key, f.value, f.status]), [['wbc', '', 'not_checked']]);
});

test('存草稿時看診的欄位一律不存，檢驗只清數值、留狀態與備註', () => {
  const stripped = stripVisitFields({
    weightKg: 4, temperatureC: 38, followUpDate: new Date(), chiefComplaint: '嘔吐',
    labFindings: [{ key: 'wbc', value: '9', status: 'normal', note: '備註' }, { key: 'custom', value: '留著' }],
  }, template);
  assert.deepEqual([stripped.weightKg, stripped.temperatureC, stripped.followUpDate, stripped.chiefComplaint], [null, null, null, '嘔吐']);
  assert.deepEqual(stripped.labFindings, [{ key: 'wbc', value: '', status: 'normal', note: '備註' }, { key: 'custom', value: '留著' }]);
  // 沒送的欄位不會被補成 null。
  assert.equal('weightKg' in stripVisitFields({ chiefComplaint: 'x' }, template), false);
});

test('報告上改的值寫回看診；只帶有改的欄位', () => {
  assert.equal(hasVisitEdits(undefined), false);
  assert.equal(hasVisitEdits({ labValues: {} }), false);
  assert.equal(hasVisitEdits({ weightKg: null }), true);

  const appointment = { weightKg: 4.2, temperatureC: 38.6, labValues: [{ key: 'wbc', label: 'WBC', value: '22.4' }] };
  applyVisitEdits(appointment, { weightKg: '4.35', labValues: { urine: '少量結晶' } }, templateLabItems(template));
  assert.equal(appointment.weightKg, 4.35);
  assert.equal(appointment.temperatureC, 38.6, '沒帶的欄位不動');
  assert.deepEqual(appointment.labValues.map((lab) => [lab.key, lab.value]), [['wbc', '22.4'], ['urine', '少量結晶']]);

  assert.throws(() => applyVisitEdits(appointment, { weightKg: -1 }, []), /非負數/);
  assert.throws(() => applyVisitEdits(appointment, { labValues: { glu: '100' } }, templateLabItems(template)), /不在這次掛號的表單裡/);
});
