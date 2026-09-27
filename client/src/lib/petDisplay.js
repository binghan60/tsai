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
