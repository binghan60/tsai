import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intakeSections } from './intakeDisplay.js';

const rowsOf = (sections, key) => Object.fromEntries(sections.find((section) => section.key === key).rows.map((row) => [row.label, row.value]));

test('初診表逐欄轉成審核用的文字，沒填的是空字串', () => {
  const sections = intakeSections({
    pet: { name: '豆花', sex: 'female', neutered: 'yes', birthDate: '2021-03-01', householdCatCount: 0, feedingType: 'scheduled', mealsPerDay: 2, allergyStatus: 'yes', allergyType: '盤尼西林', medicalHistory: ['腎臟'], medicalHistoryOther: '曾結石' },
    owner: { name: '王小姐', phone: '0912345678' },
  });
  const pet = rowsOf(sections, 'pet');
  assert.equal(pet['性別'], '母');
  assert.equal(pet['結紮'], '已結紮');
  assert.equal(pet['出生'], '西元 2021 年 3 月生');
  assert.equal(pet['家中貓口'], '0 隻', '0 隻是有填，不是沒填');
  assert.equal(pet['放飯頻率'], '定食定量，一日 2 餐');
  assert.equal(pet['花色'], '');
  const medical = rowsOf(sections, 'medical');
  assert.equal(medical['藥物過敏'], '有：盤尼西林');
  assert.equal(medical['病史'], '腎臟；曾結石');
  assert.equal(rowsOf(sections, 'owner')['市話'], '');
});
