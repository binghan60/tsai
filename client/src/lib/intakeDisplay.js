// 公開初診表（飼主填的）送進來的內容，在櫃台審核時怎麼讀。
// 審核畫面、初診面板、初診審核頁共用這份，不要各自再寫一次對照表。

// 公開初診頁的勾選項目；櫃台審核時修改也用同一份，兩邊的選項才不會各說各話。
export const INTAKE_FOOD_OPTIONS = ['主食罐', '副食罐', '鮮食', '生肉', '乾糧', '其他'];
// 「無」排第一、跟其他病史互斥（shared/intakeRequired.js 的 toggleMedicalHistory）；醫療警示要濾掉它（petDisplay 的 medicalHistoryText），不然「無」會變成紅字病史。
export const INTAKE_HISTORY_OPTIONS = [INTAKE_HISTORY_NONE, '心臟病', '腎臟病', '糖尿病', '愛滋病', '白血病', '貓瘟', '冠狀病毒', '泌尿系統問題'];
// 花色是自由文字，這份只是輸入時的建議（IntakeSuggestInput）。品種不是：只能從 shared/catBreeds.js 的清單選（BreedSelect）。
export const INTAKE_COLOR_SUGGESTIONS = ['橘', '橘白', '虎斑', '白底虎斑', '三花', '玳瑁', '賓士（黑白）', '黑', '白', '灰', '重點色'];

import { birthDateLabel } from './datetime.js';
import { catBreedLabel } from '../../../shared/catBreeds.js';
import { INTAKE_HISTORY_NONE } from '../../../shared/intakeRequired.js';

const blank = (value) => value === null || value === undefined || value === '';

function feeding(pet) {
  if (pet?.feedingType === 'free') return '任食';
  if (pet?.feedingType === 'scheduled') return `定食定量${pet.mealsPerDay ? `，一日 ${pet.mealsPerDay} 餐` : ''}`;
  return '';
}

function joined(list, other, separator = '、') {
  return [list?.join(separator), other].filter(Boolean).join('；');
}

// 回傳 [{ title, rows: [{ label, value }] }]；沒填的欄位值是空字串，畫面留白。
export function intakeSections(submission) {
  const pet = submission?.pet ?? {};
  const owner = submission?.owner ?? {};
  return [
    {
      key: 'pet',
      title: '貓咪',
      rows: [
        { label: '名字', value: pet.name },
        { label: '性別', value: { male: '公', female: '母' }[pet.sex] },
        { label: '結紮', value: { yes: '已結紮', no: '未結紮' }[pet.neutered] },
        { label: '出生', value: birthDateLabel(pet.birthDate, { estimated: pet.birthDateEstimated }) },
        { label: '品種', value: catBreedLabel(pet.breed) },
        { label: '花色', value: pet.color },
        { label: '家中貓口', value: blank(pet.householdCatCount) ? '' : `${pet.householdCatCount} 隻` },
        { label: '主餐配菜', value: [pet.foods?.join('、'), pet.foodsOther ? `（${pet.foodsOther}）` : ''].filter(Boolean).join('') },
        { label: '放飯頻率', value: feeding(pet) },
      ],
    },
    {
      key: 'medical',
      title: '醫療紀錄',
      rows: [
        { label: '疫苗', value: pet.vaccineStatus === 'done' ? `已注射 ${pet.vaccineDate || ''}`.trim() : pet.vaccineStatus === 'none' ? '未注射' : '' },
        { label: '病史', value: joined(pet.medicalHistory, pet.medicalHistoryOther) },
        { label: '藥物過敏', value: pet.allergyStatus === 'yes' ? `有${pet.allergyType ? `：${pet.allergyType}` : ''}` : pet.allergyStatus === 'none' ? '無過敏' : '' },
        { label: '健檢', value: pet.checkupStatus === 'done' ? `有 ${pet.checkupDate || ''}`.trim() : pet.checkupStatus === 'none' ? '未健檢' : '' },
      ],
    },
    {
      key: 'owner',
      title: '飼主',
      rows: [
        { label: '姓名', value: owner.name },
        { label: '手機', value: owner.phone, mono: true },
        { label: '市話', value: owner.landline, mono: true },
        { label: 'Email', value: owner.email },
        { label: '地址', value: owner.address },
      ],
    },
  ].map((section) => ({ ...section, rows: section.rows.map((row) => ({ ...row, value: blank(row.value) ? '' : String(row.value) })) }));
}
