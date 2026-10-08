// 公開初診頁的必填規則：除了市話，每一欄都要填（使用者要求）。前端逐欄顯示錯誤，後端擋舊分頁送來的不完整資料，兩邊共用這一份。
// 名字、性別、生日、品種、結紮與飼主欄位的規則原本就寫在初診頁與 routes/intakeSubmissions.js，這裡只管其餘的貓咪欄位。
//
// 「有」的那一項連帶後面的補充欄一起必填：勾了主餐「其他」要寫是什麼、已注射要選年份、有過敏要寫藥物……
// 病史沒有的勾「無」（INTAKE_HISTORY_NONE），跟其他病史互斥（toggleMedicalHistory）。
//
// pet.historyOther：初診頁的「其他」病史是獨立的勾選框，勾了卻沒寫內容要提醒；
// 後端收到的資料沒有這個欄位，沒傳就看 medicalHistoryOther 有沒有內容。

export const INTAKE_HISTORY_NONE = '無';

const text = (value) => String(value ?? '').trim();
const integerBetween = (value, min, max) => /^\d+$/.test(String(value ?? '').trim()) && Number(value) >= min && Number(value) <= max;

// 回傳 { 欄位: 錯誤訊息 }，依畫面上的順序；全部填好回空物件。
export function intakePetIssues(pet = {}) {
  const issues = {};
  const foods = Array.isArray(pet.foods) ? pet.foods : [];
  const history = Array.isArray(pet.medicalHistory) ? pet.medicalHistory.filter(Boolean) : [];
  const historyOther = pet.historyOther ?? Boolean(text(pet.medicalHistoryOther));

  if (!text(pet.color)) issues.color = '請填寫花色';
  if (!integerBetween(pet.householdCatCount, 1, 99)) issues.householdCatCount = '請填寫家中有幾隻貓（1–99）';
  if (!foods.length) issues.foods = '請至少勾選一項主餐配菜';
  else if (foods.includes('其他') && !text(pet.foodsOther)) issues.foodsOther = '請填寫其他主餐配菜';
  if (!['free', 'scheduled'].includes(pet.feedingType)) issues.feedingType = '請選擇放飯頻率';
  else if (pet.feedingType === 'scheduled' && !integerBetween(pet.mealsPerDay, 1, 20)) issues.mealsPerDay = '請填寫每日 1–20 餐的整數';
  if (!['none', 'done'].includes(pet.vaccineStatus)) issues.vaccineStatus = '請選擇疫苗狀況';
  else if (pet.vaccineStatus === 'done' && !text(pet.vaccineDate)) issues.vaccineDate = '請選最後注射的年份';
  if (!history.length && !historyOther) issues.medicalHistory = `請勾選病史，沒有就勾「${INTAKE_HISTORY_NONE}」`;
  else if (historyOther && !text(pet.medicalHistoryOther)) issues.medicalHistoryOther = '請填寫其他病史';
  if (!['none', 'yes'].includes(pet.allergyStatus)) issues.allergyStatus = '請選擇有沒有藥物過敏';
  else if (pet.allergyStatus === 'yes' && !text(pet.allergyType)) issues.allergyType = '請填寫過敏的藥物';
  if (!['none', 'done'].includes(pet.checkupStatus)) issues.checkupStatus = '請選擇健檢狀況';
  else if (pet.checkupStatus === 'done' && !text(pet.checkupDate)) issues.checkupDate = '請選上次健檢的年份';
  return issues;
}

// 勾「無」就清掉其他病史；勾了任何一項病史就拿掉「無」。
export function toggleMedicalHistory(list, option, checked) {
  const next = new Set(list ?? []);
  if (!checked) {
    next.delete(option);
    return [...next];
  }
  if (option === INTAKE_HISTORY_NONE) return [INTAKE_HISTORY_NONE];
  next.delete(INTAKE_HISTORY_NONE);
  next.add(option);
  return [...next];
}
