import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeIntakeEdit } from './intakeEdit.js';

const current = () => ({
  owner: { name: '王小明', phone: '0912345678', landline: '', email: 'a@b.co', address: '台北市' },
  pet: {
    name: '豆豆', species: '貓', breed: '米克斯', sex: 'male', neutered: 'yes', birthDate: null,
    foods: ['乾糧', '其他'], foodsOther: '雞胸肉', feedingType: 'scheduled', mealsPerDay: 2,
    vaccineStatus: 'done', vaccineDate: '2026-01', medicalHistory: [], medicalHistoryOther: '',
    allergyStatus: 'yes', allergyType: '盤尼西林', checkupStatus: 'none', checkupDate: '', householdCatCount: 1,
  },
});

describe('mergeIntakeEdit', () => {
  it('只改送來的欄位，其餘保留', () => {
    const { owner, pet } = mergeIntakeEdit(current(), { owner: { phone: ' 0987654321 ' } });
    assert.equal(owner.phone, '0987654321');
    assert.equal(owner.name, '王小明');
    assert.equal(pet.name, '豆豆');
  });

  it('選項改掉時一併清掉對應的補充內容', () => {
    const { pet } = mergeIntakeEdit(current(), { pet: { foods: ['乾糧'], feedingType: 'free', vaccineStatus: 'none', allergyStatus: 'none' } });
    assert.equal(pet.foodsOther, '');
    assert.equal(pet.mealsPerDay, null);
    assert.equal(pet.vaccineDate, '');
    assert.equal(pet.allergyType, '');
  });

  it('數字與日期欄位：空值存 null、日期字串轉 Date', () => {
    const { pet } = mergeIntakeEdit(current(), { pet: { householdCatCount: '', birthDate: '2024-03-01' } });
    assert.equal(pet.householdCatCount, null);
    assert.equal(pet.birthDate.toISOString(), '2024-03-01T00:00:00.000Z');
  });

  it('必填欄位清空或格式錯誤回 422', () => {
    for (const body of [{ owner: { name: ' ' } }, { owner: { phone: '' } }, { pet: { name: '' } }, { owner: { email: 'bad' } }, { pet: { sex: 'x' } }, { pet: { mealsPerDay: 0 } }, {}]) {
      assert.throws(() => mergeIntakeEdit(current(), body), (err) => err.status === 422);
    }
  });
});
