import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intakePetIssues, toggleMedicalHistory } from '../../../shared/intakeRequired.js';

const complete = {
  color: '橘白', householdCatCount: '2', foods: ['乾糧'], foodsOther: '', feedingType: 'free', mealsPerDay: '',
  vaccineStatus: 'none', vaccineDate: '', medicalHistory: ['無'], medicalHistoryOther: '',
  allergyStatus: 'none', allergyType: '', checkupStatus: 'none', checkupDate: '',
};

test('全部填好沒有錯誤', () => {
  assert.deepEqual(intakePetIssues(complete), {});
});

test('空白表單：每一組都要填，順序跟畫面一樣', () => {
  assert.deepEqual(Object.keys(intakePetIssues({ feedingType: 'unknown', vaccineStatus: 'unknown', allergyStatus: 'unknown', checkupStatus: 'unknown' })), [
    'color', 'householdCatCount', 'foods', 'feedingType', 'vaccineStatus', 'medicalHistory', 'allergyStatus', 'checkupStatus',
  ]);
});

test('選了「有」就要填補充欄', () => {
  const issues = intakePetIssues({
    ...complete, foods: ['其他'], feedingType: 'scheduled', vaccineStatus: 'done', medicalHistory: [], historyOther: true,
    allergyStatus: 'yes', checkupStatus: 'done',
  });
  assert.deepEqual(Object.keys(issues), ['foodsOther', 'mealsPerDay', 'vaccineDate', 'medicalHistoryOther', 'allergyType', 'checkupDate']);
});

test('家中貓口至少 1 隻', () => {
  assert.ok(intakePetIssues({ ...complete, householdCatCount: '0' }).householdCatCount);
  assert.equal(intakePetIssues({ ...complete, householdCatCount: 1 }).householdCatCount, undefined);
});

test('後端沒有 historyOther：只寫了其他病史也算填了', () => {
  assert.equal(intakePetIssues({ ...complete, medicalHistory: [], medicalHistoryOther: '甲狀腺' }).medicalHistory, undefined);
  assert.ok(intakePetIssues({ ...complete, medicalHistory: [] }).medicalHistory);
});

test('病史「無」跟其他項目互斥', () => {
  assert.deepEqual(toggleMedicalHistory(['心臟病', '貓瘟'], '無', true), ['無']);
  assert.deepEqual(toggleMedicalHistory(['無'], '心臟病', true), ['心臟病']);
  assert.deepEqual(toggleMedicalHistory(['心臟病', '貓瘟'], '貓瘟', false), ['心臟病']);
});
