// PetCreatePage 的初始空白值，成功送出後用來重置表單。

export function emptyOwnerDraft() {
  return { name: '', phone: '', email: '', address: '' };
}

export function emptyPetDraft() {
  return {
    name: '',
    species: '貓',
    breed: '',
    sex: 'unknown',
    neutered: 'unknown',
    birthDate: '',
    birthDateEstimated: false,
    weightKg: null,
    allergies: '',
    chronicConditions: '',
    currentMedications: '',
    notes: '',
  };
}
