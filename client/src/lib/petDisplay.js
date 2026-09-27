// 貓咪身分資訊的顯示規則。清單只寫「品種＋♂♀ 圖示」，標頭用規格欄（小標題在上、值在下）；
// 不用「·」把品種、性別、年齡串成一行——那樣讀起來像一串雜訊，也看不出哪個值是什麼。

export const SEX_LABELS = { male: '公', female: '母' };

export function sexLabel(sex) {
  return SEX_LABELS[sex] || '';
}

// neutered 存的是 'yes' / 'no' / 'unknown'；只有確定結紮才出標記。
export function isNeutered(neutered) {
  return neutered === 'yes' || neutered === true;
}

// 清單上的一行：品種，沒有品種時退回掛號時記的物種文字。
export function breedText(pet, fallback = '') {
  return String(pet?.breed || fallback || '').trim();
}

// 清單「提醒」欄的小標籤：藥物過敏（實心紅）、病史（紅框）、貓咪備註（琥珀，提到咬人／兇就叫「注意」）。
// 完整內容放在 title，滑過看；清單列高固定，不在列上展開長文字。
export function petReminders(pet) {
  if (!pet) return [];
  const tags = [];
  if (pet.allergyStatus === 'yes') tags.push({ key: 'allergy', label: '過敏', title: `藥物過敏：${pet.allergyType || '未註明藥物'}`, tone: 'allergy' });
  const history = [...(pet.medicalHistory ?? []).filter((item) => item && item !== '無'), pet.medicalHistoryOther].filter(Boolean);
  if (history.length) tags.push({ key: 'history', label: history[0], title: `病史：${history.join('、')}`, tone: 'history' });
  const notes = String(pet.notes ?? '').trim();
  if (notes) tags.push({ key: 'notes', label: /咬|兇|凶/.test(notes) ? '注意' : '備註', title: notes, tone: 'notes' });
  return tags;
}
