// 新增飼主／寵物的 Modal 關閉時不清空使用者填到一半的內容，
// 草稿由開啟它的頁面保管（Modal 本身是 v-if 掛載，關掉就整個卸載），
// 只有在真的新增成功之後才重置回這裡的空白值。

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
