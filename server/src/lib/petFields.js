// 貓咪資料可以由使用者填寫的欄位（新增／修改貓咪、連同新飼主一起建立時共用）。
// 不在這張表上的（ownerId、legacyMedicalRecordNumber、relationVersion）不能從請求內容寫入。
export const PET_FIELDS = [
  'name',
  'species',
  'breed',
  'color',
  'sex',
  'neutered',
  'birthDate',
  'birthDateEstimated',
  'weightKg',
  'householdCatCount',
  'diet',
  'foods',
  'foodsOther',
  'feedingType',
  'mealsPerDay',
  'vaccineStatus',
  'vaccineDate',
  'medicalHistory',
  'medicalHistoryOther',
  'allergyStatus',
  'allergyType',
  'checkupStatus',
  'checkupDate',
  'notes',
];

export function pickPetFields(body) {
  return Object.fromEntries(PET_FIELDS.filter((field) => body?.[field] !== undefined).map((field) => [field, body[field]]));
}
