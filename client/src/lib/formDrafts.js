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
