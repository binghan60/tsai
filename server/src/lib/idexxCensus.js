// 報到時把貓咪送到 IDEXX 主機的在院清單（純邏輯，資料庫那一半在 lib/idexxRequests.js）。
//
// 流程：醫師或櫃台按「送 IDEXX」→ 這裡組好 XML、存進 idexxRequests 排隊 → 診所電腦上的抓檔程式每輪來拿、
// 原封寫進 C:\IDEXX Interlink\Requests\ → InterLink 送到 IDEXX 主機 → 貓咪出現在主機清單。
// 技術員從清單點那隻貓跑檢驗，結果帶著同一個 patient_id（貓咪的 _id）回來，就能自動認貓（labResultApply 的 matchByPatientId）。
// 取消送 IDEXX或離開診所（櫃台完成、取消、取消報到）時送離院／取消，主機清單才不會越堆越多。
//
// IDEXX 規格有兩種訊息都能讓貓咪出現在主機上，台灣這邊實際用哪一種要到診所才知道，所以兩種都做、由伺服器設定切換：
//   census       Census_Notice in / out（census_20.dtd）：只是「這隻貓在院內」
//   work_request Work_Request New / Cancel（work_request_20.dtd）：IDEXX 台灣給的範例是這一種，檢驗項目留空
import { holdsCheckinNumber } from './appointmentStatus.js';
import { CLINIC_TIMEZONE, clinicToday } from './clinicTime.js';

// 這筆掛號現在能不能送 IDEXX：報到之後、櫃台完成之前，而且已經建檔（初診報到時才有 petId）。
export function canRequestLab(appointment) {
  return Boolean(appointment?.petId) && holdsCheckinNumber(appointment?.status);
}

// 這隻貓現在該不該在 IDEXX 主機的清單上：有人按了「送 IDEXX」（labRequestedAt），而且還在院內。
// 報到本身不算——不是每次看診都驗血。
export function inClinic(appointment) {
  return canRequestLab(appointment) && Boolean(appointment?.labRequestedAt);
}

// 依上一份送出的通知決定這次要不要送、送哪一種。同一個狀態重複呼叫不會重複送，所以每個會改變狀態的地方放心呼叫。
export function nextCensusKind(lastKind, isInClinic) {
  if (isInClinic && lastKind !== 'in') return 'in';
  if (!isInClinic && lastKind === 'in') return 'out';
  return null;
}

// 診所只看貓：除非物種欄位明寫是狗，一律送 FELINE。
// 物種欄位是自由文字，原本認不出的（「貓咪」「米克斯貓」…）送 OTHER，結果主機上看不到是貓、參考範圍也套不上。
export function idexxSpecies(species) {
  const text = String(species ?? '').trim().toLowerCase();
  if (/狗|犬|dog|canine/.test(text) && !/貓|猫|cat|feline/.test(text)) return 'CANINE';
  return 'FELINE';
}

// 性別＋結紮換成 IDEXX 的四種。IDEXX 沒有「不知道有沒有結紮」這個選項：
// 知道性別、結紮沒記錄時送「未結紮」那一種（主機上顯示成單純的公／母）——整個不送的話主機上連性別都是空的。
// 性別不知道才不送（DTD 是選填）。
export function idexxGender(sex, neutered) {
  if (sex === 'male') return neutered === 'yes' ? 'MALE_NEUTERED' : 'MALE_INTACT';
  if (sex === 'female') return neutered === 'yes' ? 'FEMALE_SPAYED' : 'FEMALE_INTACT';
  return null;
}

// 品種：IDEXX 主機有自己的品種清單（英文名稱，貓 56 種），系統裡的品種是自由輸入的中文。
// 這裡把常見的中文寫法對到 IDEXX 的名稱；本來就打英文、而且在清單上的照送；對不到的不送（主機上留白，技術員自己選）。
// 順序有意義：比較長、比較明確的寫在前面（「異國短毛」要在「短毛」之前）。
const IDEXX_CAT_BREEDS = [
  'Abyssinian', 'American Bobtail', 'American Curl', 'American Shorthair', 'American Wirehair', 'Balinese', 'Bengal', 'Birman', 'Bombay',
  'British Shorthair', 'Burmese', 'Chartreux', 'Colorpoint Shorthair', 'Cornish Rex', 'Devon Rex', 'Domestic Longhair', 'Domestic Shorthair',
  'Egyptian Mau', 'European Burmese', 'Exotic', 'Exotic Shorthair', 'Havana Brown', 'Himalayan', 'Japanese', 'Japanese Bobtail', 'Korat', 'LaPerm',
  'Maine Coon', 'Manx', 'Mixed', 'Munchkin', 'Nebelung', 'Norwegian Forest Cat', 'Ocicat', 'Oriental', 'Other', 'Persian', 'Pixie-Bob', 'RagaMuffin',
  'Ragdoll', 'Russian Blue', 'Savannah', 'Scottish Fold', 'Selkirk Rex', 'Siamese', 'Siberian', 'Singapura', 'Snowshoe', 'Sokoke', 'Somali', 'Sphynx',
  'Tonkinese', 'Toyger', 'Turkish Angora', 'Turkish Van',
];
const BREED_KEYWORDS = [
  [/米克斯|混種|混血|mix/i, 'Mixed'],
  [/異國短毛|異短|加菲/, 'Exotic Shorthair'],
  [/英國短毛|英短/, 'British Shorthair'],
  [/美國短毛|美短/, 'American Shorthair'],
  [/美國捲耳|捲耳|卷耳/, 'American Curl'],
  [/布偶/, 'Ragdoll'],
  [/曼赤肯|曼基康|短腿/, 'Munchkin'],
  [/金吉拉|波斯/, 'Persian'],
  [/喜馬拉雅/, 'Himalayan'],
  [/緬因/, 'Maine Coon'],
  [/暹羅|暹邏/, 'Siamese'],
  [/俄羅斯藍|俄藍/, 'Russian Blue'],
  [/阿比西尼亞/, 'Abyssinian'],
  [/索馬利/, 'Somali'],
  [/無毛|斯芬克斯|史芬克斯/, 'Sphynx'],
  [/摺耳|折耳/, 'Scottish Fold'],
  [/孟加拉|豹貓/, 'Bengal'],
  [/挪威森林/, 'Norwegian Forest Cat'],
  [/西伯利亞/, 'Siberian'],
  [/伯曼/, 'Birman'],
  [/緬甸/, 'Burmese'],
  [/孟買/, 'Bombay'],
  [/東方/, 'Oriental'],
  [/德文/, 'Devon Rex'],
  [/柯尼斯|康沃爾/, 'Cornish Rex'],
  [/安哥拉/, 'Turkish Angora'],
  [/土耳其梵/, 'Turkish Van'],
  [/新加坡/, 'Singapura'],
  [/東奇尼/, 'Tonkinese'],
  [/沙特爾/, 'Chartreux'],
  [/日本短尾/, 'Japanese Bobtail'],
  [/長毛家貓|家貓長毛/, 'Domestic Longhair'],
  [/短毛家貓|家貓短毛|家貓/, 'Domestic Shorthair'],
];

export function idexxBreed(breed) {
  const text = String(breed ?? '').trim();
  if (!text) return '';
  const exact = IDEXX_CAT_BREEDS.find((name) => name.toLowerCase() === text.toLowerCase());
  if (exact) return exact;
  return BREED_KEYWORDS.find(([pattern]) => pattern.test(text))?.[1] ?? '';
}

function clinicParts(instant) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CLINIC_TIMEZONE, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3,
  }).formatToParts(instant);
  const value = (type) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    year: value('year'), month: value('month'), day: value('day'),
    hour: Number(value('hour')) % 24, minute: value('minute'), second: value('second'), ms: value('fractionalSecond'),
  };
}

// IDEXX 的日期格式 MM/DD/YYYY；生日照診所時區取那一天。
export function idexxDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const [year, month, day] = clinicToday(date).split('-');
  return `${month}/${day}/${year}`;
}

// 訊息時間跟範例一樣是診所牆上時間、12 小時制：05/24/2024 05:21:43 PM。
export function idexxDateTime(instant) {
  const { year, month, day, hour, minute, second } = clinicParts(instant);
  const hour12 = String(hour % 12 || 12).padStart(2, '0');
  return `${month}/${day}/${year} ${hour12}:${minute}:${second} ${hour < 12 ? 'AM' : 'PM'}`;
}

// 訊息編號＝檔名。範例是純數字（飼主編號＋時間），IDEXX 主機能不能吃英文字母不確定，所以只用數字：
// 診所時間到毫秒再加三位亂數，同一毫秒兩隻貓報到也不會撞。
export function idexxMessageId(instant, random = Math.random) {
  const { year, month, day, hour, minute, second, ms } = clinicParts(instant);
  const suffix = String(Math.floor(random() * 1000)).padStart(3, '0');
  return `${year}${month}${day}${String(hour).padStart(2, '0')}${minute}${second}${ms}${suffix}`;
}

// 控制字元 XML 1.0 不收，一併拿掉。
export function xmlText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    .trim();
}

function weightText(value) {
  const number = Number(value);
  // IDEXX 自己沒量體重時送 0，我們沒有就不送。
  return Number.isFinite(number) && number > 0 ? String(Math.round(number * 100) / 100) : '';
}

// 飼主姓名拆成姓、名：IDEXX 主機的畫面是「姓」「名字」兩格（last_name／first_name），系統裡只有一個全名欄位。
//   中文（2～4 個字）：第一個字是姓，其餘是名；常見複姓兩個字。
//   有空白的（英文名 Stanley Wang）：最後一段是姓，前面是名。
//   其他拆不出來的（單名一個字、公司名、五個字以上）：整個放姓。
const COMPOUND_SURNAMES = ['歐陽', '司馬', '上官', '諸葛', '司徒', '端木', '皇甫', '尉遲', '公孫', '慕容', '長孫', '宇文', '夏侯', '令狐', '東方', '范姜', '張簡'];

export function splitOwnerName(name) {
  const text = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return { lastName: '', firstName: '' };
  if (text.includes(' ')) {
    const parts = text.split(' ');
    return { lastName: parts.at(-1), firstName: parts.slice(0, -1).join(' ') };
  }
  const chars = [...text];
  if (chars.length >= 2 && chars.length <= 4 && chars.every((char) => /\p{Script=Han}/u.test(char))) {
    const compound = chars.length >= 3 && COMPOUND_SURNAMES.includes(chars.slice(0, 2).join(''));
    const cut = compound ? 2 : 1;
    return { lastName: chars.slice(0, cut).join(''), firstName: chars.slice(cut).join('') };
  }
  return { lastName: text, firstName: '' };
}

function clientXml(owner) {
  if (!owner) return '';
  const id = owner._id ? ` client_id="${xmlText(owner._id)}"` : '';
  const { lastName, firstName } = splitOwnerName(owner.name);
  return `      <client${id}>\n        <first_name>${xmlText(firstName)}</first_name>\n        <last_name>${xmlText(lastName)}</last_name>\n      </client>\n`;
}

// DTD 規定的順序：patient_name → patient_breed → patient_birth_dt → patient_weight。
function patientXml(pet, weightKg) {
  const gender = idexxGender(pet.sex, pet.neutered);
  const breed = idexxBreed(pet.breed);
  const birth = idexxDate(pet.birthDate);
  const weight = weightText(weightKg);
  return [
    `      <patient patient_id="${xmlText(pet._id)}" patient_species="${idexxSpecies(pet.species)}"${gender ? ` patient_gender="${gender}"` : ''}>`,
    `        <patient_name>${xmlText(pet.name)}</patient_name>`,
    breed ? `        <patient_breed>${xmlText(breed)}</patient_breed>` : '',
    birth ? `        <patient_birth_dt>${birth}</patient_birth_dt>` : '',
    weight ? `        <patient_weight patient_weight_uom="kgs">\n          <weight>${weight}</weight>\n        </patient_weight>` : '',
    '      </patient>',
  ].filter(Boolean).join('\n') + '\n';
}

// 組一份要寫進 Requests 資料夾的 XML（字串；編碼由呼叫端照 encoding 轉成位元組）。
// kind：'in' 到院、'out' 離院。appointmentId 當 Work_Request 的單號，到院與離院用同一張。
export function buildIdexxRequestXml({ mode, kind, messageId, now, encoding, appointmentId, pet, owner, weightKg }) {
  const census = mode === 'census';
  const dtd = census ? 'census_20.dtd' : 'work_request_20.dtd';
  const type = census ? 'Census_Notice' : 'Work_Request';
  const subType = census ? kind : kind === 'in' ? 'New' : 'Cancel';
  const subject = clientXml(owner) + patientXml(pet, weightKg);
  const body = census
    ? `    <census_notice census_notice_reason="inclinic">\n${subject}    </census_notice>\n`
    : `    <work_request requisition_number="${xmlText(appointmentId)}">\n${subject}${
      kind === 'in' ? '      <service_add>\n        <service_cd></service_cd>\n      </service_add>\n' : ''
    }    </work_request>\n`;
  return `<?xml version="1.0" encoding="${encoding === 'utf-8' ? 'UTF-8' : 'Big5'}"?>
<!DOCTYPE message SYSTEM "${dtd}">
<message message_id="${messageId}" message_dt="${idexxDateTime(now)}" message_type="${type}" message_sub_type="${subType}" message_dtd_version_number="2.0">
  <header>
    <from_application_id></from_application_id>
    <to_application_id></to_application_id>
  </header>
  <body>
${body}  </body>
</message>
`;
}
