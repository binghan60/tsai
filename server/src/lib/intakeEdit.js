// 櫃台在審核初診表時修改飼主填的內容。純邏輯：拿目前的 { owner, pet } 與這次送來的修改，
// 回傳合併、整理後的完整內容；不合法就丟 422。
// 只擋「掛號一定要有」的幾欄（飼主姓名、手機、貓咪名字），公開初診頁另外要求的地址、Email、品種等
// 不在這裡強制——櫃台改的是飼主填錯的地方，不該因為飼主漏填別欄就存不進去。

import { checkMobilePhone } from '../../../shared/phone.js';
import { checkCatBreed } from '../../../shared/catBreeds.js';

export const INTAKE_OWNER_FIELDS = ['name', 'phone', 'landline', 'email', 'address'];
export const INTAKE_PET_FIELDS = ['name', 'species', 'breed', 'color', 'sex', 'neutered', 'birthDate', 'birthDateEstimated', 'householdCatCount', 'diet', 'foods', 'foodsOther', 'feedingType', 'mealsPerDay', 'vaccineStatus', 'vaccineDate', 'medicalHistory', 'medicalHistoryOther', 'allergyStatus', 'allergyType', 'checkupStatus', 'checkupDate'];

const PET_TEXT_FIELDS = ['name', 'species', 'breed', 'color', 'diet', 'foodsOther', 'vaccineDate', 'medicalHistoryOther', 'allergyType', 'checkupDate'];
const PET_ENUMS = {
  sex: ['unknown', 'male', 'female'],
  neutered: ['unknown', 'yes', 'no'],
  feedingType: ['unknown', 'free', 'scheduled'],
  vaccineStatus: ['unknown', 'none', 'done'],
  allergyStatus: ['unknown', 'none', 'yes'],
  checkupStatus: ['unknown', 'none', 'done'],
};
const ENUM_LABELS = { sex: '性別', neutered: '結紮', feedingType: '放飯頻率', vaccineStatus: '疫苗', allergyStatus: '藥物過敏', checkupStatus: '健檢' };

function invalid(message) {
  return Object.assign(new Error(message), { status: 422 });
}

const text = (value) => String(value ?? '').trim();

function list(value, label) {
  if (!Array.isArray(value)) throw invalid(`${label}格式不正確`);
  return [...new Set(value.map(text).filter(Boolean))];
}

function optionalInteger(value, min, max, label) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw invalid(`${label}請填寫 ${min}–${max} 的整數`);
  return number;
}

function optionalDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(`${value}T00:00:00Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) throw invalid('出生日期格式不正確');
  if (date.getTime() > Date.now()) throw invalid('出生日期不能晚於今天');
  return date;
}

function normalizePetPatch(input) {
  const patch = {};
  for (const field of PET_TEXT_FIELDS) if (input[field] !== undefined) patch[field] = text(input[field]);
  for (const [field, values] of Object.entries(PET_ENUMS)) {
    if (input[field] === undefined) continue;
    if (!values.includes(input[field])) throw invalid(`${ENUM_LABELS[field]}選項不正確`);
    patch[field] = input[field];
  }
  if (input.foods !== undefined) patch.foods = list(input.foods, '主餐配菜');
  if (input.medicalHistory !== undefined) patch.medicalHistory = list(input.medicalHistory, '病史');
  if (input.householdCatCount !== undefined) patch.householdCatCount = optionalInteger(input.householdCatCount, 0, 99, '家中貓口');
  if (input.mealsPerDay !== undefined) patch.mealsPerDay = optionalInteger(input.mealsPerDay, 1, 20, '一日餐數');
  if (input.birthDate !== undefined) patch.birthDate = optionalDate(input.birthDate);
  if (input.birthDateEstimated !== undefined) patch.birthDateEstimated = Boolean(input.birthDateEstimated);
  return patch;
}

// 跟公開初診頁送出時同一套連動：沒勾「其他」就沒有其他說明、不是定食定量就沒有餐數……
// 否則選項改掉之後，舊的補充文字還會留在審核畫面上。
function reconcilePet(pet) {
  const next = { ...pet };
  if (!next.foods?.includes('其他')) next.foodsOther = '';
  if (next.feedingType !== 'scheduled') next.mealsPerDay = null;
  if (next.vaccineStatus !== 'done') next.vaccineDate = '';
  if (next.allergyStatus !== 'yes') next.allergyType = '';
  if (next.checkupStatus !== 'done') next.checkupDate = '';
  return next;
}

export function mergeIntakeEdit(current, body = {}) {
  if (body.owner !== undefined && (typeof body.owner !== 'object' || body.owner === null)) throw invalid('飼主資料格式不正確');
  if (body.pet !== undefined && (typeof body.pet !== 'object' || body.pet === null)) throw invalid('貓咪資料格式不正確');
  if (!body.owner && !body.pet) throw invalid('沒有要修改的內容');

  const owner = { ...current.owner };
  for (const field of INTAKE_OWNER_FIELDS) if (body.owner?.[field] !== undefined) owner[field] = text(body.owner[field]);
  const pet = reconcilePet({ ...current.pet, ...(body.pet ? normalizePetPatch(body.pet) : {}) });

  if (!owner.name) throw invalid('請填寫飼主姓名');
  if (!owner.phone) throw invalid('請填寫聯絡電話');
  const checkedPhone = checkMobilePhone(owner.phone, current.owner?.phone);
  if (checkedPhone.error) throw invalid(checkedPhone.error);
  owner.phone = checkedPhone.phone;
  if (owner.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner.email)) throw invalid('Email 格式不正確');
  if (!pet.name) throw invalid('請填寫貓咪名字');
  // 品種只收清單上的，存成 IDEXX 的英文名稱；沒動到的原文（改版前飼主自由輸入的）照收。
  const checkedBreed = checkCatBreed(pet.breed, current.pet?.breed);
  if (checkedBreed.error) throw invalid(checkedBreed.error);
  pet.breed = checkedBreed.breed;
  return { owner, pet };
}
