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

// 診所只看貓；物種欄位是自由文字（預設「貓」），認不出的送 OTHER（DTD 規定必填）。
export function idexxSpecies(species) {
  const text = String(species ?? '').trim().toLowerCase();
  if (!text || ['貓', '猫', 'cat', 'feline'].includes(text)) return 'FELINE';
  if (['狗', '犬', 'dog', 'canine'].includes(text)) return 'CANINE';
  return 'OTHER';
}

// 性別＋結紮換成 IDEXX 的四種；任一邊不知道就不送（DTD 是選填）。
export function idexxGender(sex, neutered) {
  if (neutered !== 'yes' && neutered !== 'no') return null;
  if (sex === 'male') return neutered === 'yes' ? 'MALE_NEUTERED' : 'MALE_INTACT';
  if (sex === 'female') return neutered === 'yes' ? 'FEMALE_SPAYED' : 'FEMALE_INTACT';
  return null;
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

// 飼主姓名：中文名字拆不出姓和名，整個放進 last_name（IDEXX 主機通常以 last_name 顯示飼主）。到診所再看要不要調整。
function clientXml(owner) {
  if (!owner) return '';
  const id = owner._id ? ` client_id="${xmlText(owner._id)}"` : '';
  return `      <client${id}>\n        <first_name></first_name>\n        <last_name>${xmlText(owner.name)}</last_name>\n      </client>\n`;
}

// 品種不送：IDEXX 主機有自己的品種清單，自由文字的中文品種對不上。
function patientXml(pet, weightKg) {
  const gender = idexxGender(pet.sex, pet.neutered);
  const birth = idexxDate(pet.birthDate);
  const weight = weightText(weightKg);
  return [
    `      <patient patient_id="${xmlText(pet._id)}" patient_species="${idexxSpecies(pet.species)}"${gender ? ` patient_gender="${gender}"` : ''}>`,
    `        <patient_name>${xmlText(pet.name)}</patient_name>`,
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
