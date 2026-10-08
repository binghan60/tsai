// PetCreatePage 的初始空白值，成功送出後用來重置表單。

export function emptyOwnerDraft() {
  return { name: '', phone: '', landline: '', email: '', address: '', notes: '' };
}

export function emptyPetDraft() {
  return {
    name: '',
    species: '貓',
    breed: '',
    color: '',
    sex: 'unknown',
    neutered: 'unknown',
    birthDate: '',
    birthDateEstimated: false,
    weightKg: null,
    householdCatCount: null,
    diet: '',
    foods: [],
    feedingType: 'unknown',
    mealsPerDay: null,
    vaccineStatus: 'unknown',
    vaccineDate: '',
    medicalHistory: [],
    medicalHistoryOther: '',
    allergyStatus: 'unknown',
    allergyType: '',
    checkupStatus: 'unknown',
    checkupDate: '',
    notes: '',
  };
}

// 「填過東西沒」：跟空白草稿逐欄比，不是看值是不是空字串——
// 預設值本身就不是空的（性別「未記錄」是 'unknown'、預估生日是 false），用「非空」判斷的話一打開就算改過。
// 文字前後空白不算，數字欄位清空後可能是 '' 或 null，兩者都算沒填。
function blank(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) return value.length ? value : null;
  return value;
}

function differs(draft, empty) {
  return Object.keys({ ...empty, ...draft }).some(key => JSON.stringify(blank(draft?.[key])) !== JSON.stringify(blank(empty[key])));
}

export function ownerDraftTouched(draft) {
  return differs(draft, emptyOwnerDraft());
}

export function petDraftTouched(draft) {
  return differs(draft, emptyPetDraft());
}
