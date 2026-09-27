import { test } from 'node:test';
import assert from 'node:assert/strict';
import { followedPatch, initialFollowedFields, labOverrideKey, sanitizeOverriddenKeys, templateLabItems } from './recordVisitSync.js';

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

test('只把啟用中的檢驗項目當成跟隨欄位', () => {
  assert.deepEqual(templateLabItems(template).map((item) => item.key), ['wbc', 'urine']);
  assert.deepEqual(
    sanitizeOverriddenKeys(['weightKg', 'lab:wbc', 'lab:old', 'lab:glu', 'heartRate', 'weightKg'], template),
    ['weightKg', 'lab:wbc'],
  );
  assert.deepEqual(sanitizeOverriddenKeys('weightKg', template), []);
});

test('草稿初建時帶入看診的體重、體溫、回診日期與檢驗，並自動判讀', () => {
  const fields = initialFollowedFields(visit(), template);
  assert.equal(fields.weightKg, 4.2);
  assert.equal(fields.temperatureC, 38.6);
  assert.equal(fields.followUpDate.toISOString(), '2026-10-09T06:30:00.000Z');
  assert.deepEqual(fields.labFindings.map((f) => [f.key, f.value, f.status]), [['wbc', '22.4', 'abnormal']]);
  // 看診沒填的檢驗項目不會先塞一筆空的進報告。
  assert.equal(fields.labFindings.some((f) => f.key === 'urine'), false);
});

test('沒被覆寫的欄位跟著看診；覆寫過的不動；值相同就不回傳', () => {
  const record = {
    status: 'draft', overriddenKeys: ['temperatureC', labOverrideKey('wbc')],
    weightKg: 4.0, temperatureC: 39.9, followUpDate: new Date('2026-10-09T06:30:00.000Z'),
    labFindings: [{ key: 'wbc', label: 'WBC', value: '18', status: 'normal', statusSource: 'auto' }],
  };
  const patch = followedPatch(record, visit(), template);
  assert.deepEqual(Object.keys(patch), ['weightKg']);
  assert.equal(patch.weightKg, 4.2);
});

test('看診把值清空，報告也跟著清空並重設判讀', () => {
  const record = {
    status: 'draft', overriddenKeys: [], weightKg: 4.2, temperatureC: 38.6, followUpDate: null,
    labFindings: [{ key: 'wbc', label: 'WBC', value: '22.4', status: 'abnormal', statusSource: 'auto' }],
  };
  const patch = followedPatch(record, visit({ followUpDate: '', labValues: [] }), template);
  assert.deepEqual(Object.keys(patch), ['labFindings']);
  assert.deepEqual(patch.labFindings.map((f) => [f.key, f.value, f.status]), [['wbc', '', 'not_checked']]);
});

test('醫師手動選過的判讀不被自動判讀蓋掉；文字結果有內容就標異常；範本外的項目保留', () => {
  const record = {
    status: 'draft', overriddenKeys: [], weightKg: 4.2, temperatureC: 38.6, followUpDate: new Date('2026-10-09T06:30:00.000Z'),
    labFindings: [
      { key: 'wbc', label: 'WBC', value: '10', status: 'normal', statusSource: 'manual' },
      { key: 'retired', label: '舊項目', value: '1', status: 'normal', statusSource: 'auto' },
    ],
  };
  const patch = followedPatch(record, visit({ labValues: [{ key: 'wbc', value: '22.4' }, { key: 'urine', value: '少量結晶' }] }), template);
  const byKey = Object.fromEntries(patch.labFindings.map((f) => [f.key, f]));
  assert.equal(byKey.wbc.value, '22.4');
  assert.equal(byKey.wbc.status, 'normal', '醫師手動選的狀態保留');
  assert.equal(byKey.urine.status, 'abnormal');
  assert.equal(byKey.retired.value, '1');
});

test('已結案的報告不再同步', () => {
  assert.deepEqual(followedPatch({ status: 'finalized', weightKg: 1 }, visit(), template), {});
});
