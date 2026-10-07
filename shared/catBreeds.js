// 貓咪品種清單：IDEXX 主機支援的 55 種（來自 IDEXX 給的 `Breed names.xlsx`）。
// 品種欄位只收這份清單上的品種，不再自由輸入——飼主打的「虎斑」「不知道」「mix 的」
// 送到 IDEXX 主機對不到品種，技術員得自己重選。前後端、公開初診頁共用這一份。
//
// **資料庫存的是 IDEXX 的英文名稱（idexx），畫面上一律轉成中文（label）顯示。**
// 舊系統就是這樣存的：匯入的兩萬多隻裡，品種是 `Mixed`、`British Shorthair`、`Ragdoll` 這種英文，
// 而且寫法跟 IDEXX 清單一模一樣——存英文，這些舊資料直接就是清單上的值，不必遷移；送 IDEXX 也不用再轉。
// 顯示用 catBreedLabel()；清單上沒有的舊值（狗的品種、`Chinchilla`、`Unknown`…）照原文顯示。
// aliases 是下拉選單打字篩選用的俗稱與簡稱（英短、加菲、豹貓…），不會被存進資料。
// 排序：診所常見的在前，其餘照 IDEXX 的英文字母順序，「其他」放最後。
export const CAT_BREEDS = [
  { label: '米克斯', idexx: 'Mixed', aliases: ['混種', '混血', 'mix'] },
  { label: '英國短毛貓', idexx: 'British Shorthair', aliases: ['英短'] },
  { label: '美國短毛貓', idexx: 'American Shorthair', aliases: ['美短'] },
  { label: '布偶貓', idexx: 'Ragdoll', aliases: [] },
  { label: '蘇格蘭摺耳貓', idexx: 'Scottish Fold', aliases: ['摺耳', '折耳'] },
  { label: '異國短毛貓', idexx: 'Exotic Shorthair', aliases: ['異短', '加菲'] },
  { label: '波斯貓', idexx: 'Persian', aliases: ['金吉拉'] },
  { label: '曼赤肯貓', idexx: 'Munchkin', aliases: ['曼基康', '短腿'] },
  { label: '緬因貓', idexx: 'Maine Coon', aliases: [] },
  { label: '俄羅斯藍貓', idexx: 'Russian Blue', aliases: ['俄藍'] },
  { label: '暹羅貓', idexx: 'Siamese', aliases: ['暹邏'] },
  { label: '孟加拉貓', idexx: 'Bengal', aliases: ['豹貓'] },
  { label: '阿比西尼亞貓', idexx: 'Abyssinian', aliases: [] },
  { label: '斯芬克斯貓', idexx: 'Sphynx', aliases: ['無毛', '史芬克斯'] },
  { label: '美國短尾貓', idexx: 'American Bobtail', aliases: [] },
  { label: '美國捲耳貓', idexx: 'American Curl', aliases: ['捲耳', '卷耳'] },
  { label: '美國硬毛貓', idexx: 'American Wirehair', aliases: ['剛毛'] },
  { label: '峇里貓', idexx: 'Balinese', aliases: ['巴里'] },
  { label: '伯曼貓', idexx: 'Birman', aliases: [] },
  { label: '孟買貓', idexx: 'Bombay', aliases: [] },
  { label: '緬甸貓', idexx: 'Burmese', aliases: [] },
  { label: '沙特爾貓', idexx: 'Chartreux', aliases: ['夏特爾'] },
  { label: '重點色短毛貓', idexx: 'Colorpoint Shorthair', aliases: [] },
  { label: '柯尼斯捲毛貓', idexx: 'Cornish Rex', aliases: ['康沃爾'] },
  { label: '德文捲毛貓', idexx: 'Devon Rex', aliases: [] },
  { label: '長毛家貓', idexx: 'Domestic Longhair', aliases: ['家貓長毛'] },
  { label: '短毛家貓', idexx: 'Domestic Shorthair', aliases: ['家貓短毛'] },
  { label: '埃及貓', idexx: 'Egyptian Mau', aliases: [] },
  { label: '歐洲緬甸貓', idexx: 'European Burmese', aliases: [] },
  { label: '異國貓', idexx: 'Exotic', aliases: [] },
  { label: '哈瓦那棕貓', idexx: 'Havana Brown', aliases: [] },
  { label: '喜馬拉雅貓', idexx: 'Himalayan', aliases: [] },
  { label: '日本貓', idexx: 'Japanese', aliases: [] },
  { label: '日本短尾貓', idexx: 'Japanese Bobtail', aliases: [] },
  { label: '科拉特貓', idexx: 'Korat', aliases: ['呵叻'] },
  { label: '拉邦貓', idexx: 'LaPerm', aliases: ['拉波'] },
  { label: '曼島貓', idexx: 'Manx', aliases: [] },
  { label: '尼比龍貓', idexx: 'Nebelung', aliases: [] },
  { label: '挪威森林貓', idexx: 'Norwegian Forest Cat', aliases: [] },
  { label: '歐西貓', idexx: 'Ocicat', aliases: [] },
  { label: '東方貓', idexx: 'Oriental', aliases: [] },
  { label: '精靈短尾貓', idexx: 'Pixie-Bob', aliases: [] },
  { label: '襤褸貓', idexx: 'RagaMuffin', aliases: [] },
  { label: '薩凡納貓', idexx: 'Savannah', aliases: [] },
  { label: '塞爾凱克捲毛貓', idexx: 'Selkirk Rex', aliases: [] },
  { label: '西伯利亞貓', idexx: 'Siberian', aliases: [] },
  { label: '新加坡貓', idexx: 'Singapura', aliases: [] },
  { label: '雪鞋貓', idexx: 'Snowshoe', aliases: [] },
  { label: '索科克貓', idexx: 'Sokoke', aliases: [] },
  { label: '索馬利貓', idexx: 'Somali', aliases: [] },
  { label: '東奇尼貓', idexx: 'Tonkinese', aliases: [] },
  { label: '玩具虎貓', idexx: 'Toyger', aliases: [] },
  { label: '土耳其安哥拉貓', idexx: 'Turkish Angora', aliases: ['安哥拉'] },
  { label: '土耳其梵貓', idexx: 'Turkish Van', aliases: [] },
  { label: '其他', idexx: 'Other', aliases: ['不確定', '不知道', '不清楚'] },
];

// 找不到品種時給飼主的兩個退路：下拉選單沒有符合的項目時直接列出這兩個。
export const CAT_BREED_FALLBACKS = ['Mixed', 'Other'];

export const CAT_BREED_ERROR = '品種請從清單選擇';

const text = (value) => String(value ?? '').trim();
const fold = (value) => text(value).toLowerCase().replace(/\s+/g, '');

// 英文名稱不分大小寫與空白（舊資料有 `mixed`）；中文名稱也認得——改版中途存過中文的幾筆、
// 以及測試資料，不必另外處理。俗稱（英短）不算，那只是篩選用的。
const BY_NAME = new Map();
for (const breed of CAT_BREEDS) {
  BY_NAME.set(fold(breed.idexx), breed);
  BY_NAME.set(fold(breed.label), breed);
}

export function findCatBreed(value) {
  return BY_NAME.get(fold(value)) ?? null;
}

export function isCatBreed(value) {
  return BY_NAME.has(fold(value));
}

// 顯示用：清單上的品種回中文名稱，其餘（舊資料的自由文字、狗的品種）照原文。
export function catBreedLabel(value) {
  return findCatBreed(value)?.label ?? text(value);
}

// 回傳 { breed: 要存的值, error }。清單上的一律整理成 IDEXX 的英文名稱；空值不算錯（必填與否由呼叫端決定）。
// previous 是原本存的值：沒改動就照收——舊系統匯入的資料裡有清單以外的品種（狗、`Chinchilla`、`Unknown`），
// 不能因為順手改了體重或備註就被擋下來；真的改了品種才要求是清單上的。
export function checkCatBreed(value, previous) {
  const raw = text(value);
  if (!raw) return { breed: '', error: '' };
  const listed = findCatBreed(raw);
  if (listed) return { breed: listed.idexx, error: '' };
  if (previous !== undefined && previous !== null && raw === text(previous)) return { breed: raw, error: '' };
  return { breed: raw, error: CAT_BREED_ERROR };
}

// 打字篩選：中文名稱、俗稱、IDEXX 英文名稱任一個包含關鍵字就算；
// 反過來關鍵字裡帶著名稱或俗稱也算（「金吉拉貓」找得到波斯貓、「虎斑米克斯」找得到米克斯）。
// 沒有關鍵字回傳整份清單；順序一律照 CAT_BREEDS。
export function filterCatBreeds(query) {
  const keyword = fold(query);
  if (!keyword) return CAT_BREEDS;
  return CAT_BREEDS.filter((breed) => {
    const names = [breed.label, breed.label.replace(/貓$/, ''), ...breed.aliases].map(fold);
    if (fold(breed.idexx).includes(keyword)) return true;
    return names.some((name) => name.includes(keyword) || (name.length >= 2 && keyword.includes(name)));
  });
}
