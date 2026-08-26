// 掛號與候診頁的純邏輯：分組、排序、狀態判斷。抽出來是因為這些規則之後很容易改
// （診間時段、要不要多一個時段），而頁面元件本身測不到——npm test 只涵蓋這個資料夾。
//
// 時間軸目前假設瀏覽器時區就是診所所在時區（前台電腦就在診所裡），
// 不像後端 clinicTime.js 需要處理伺服器可能跑在別的時區。

// 診間時段，目前先寫死；之後如果要讓時段可設定，這裡就是要抽換的地方。
export const SESSIONS = [
  { id: 'morning', label: '上午診', start: '10:00', end: '11:30' },
  { id: 'afternoon', label: '下午診', start: '14:00', end: '19:30' },
];

export const SURGERY_BLOCK = { label: '手術時間', start: '11:30', end: '14:00' };

function parseTimeToMinutes(value) {
  const [hour, minute] = String(value).split(':').map(Number);
  return hour * 60 + minute;
}

function timeOfDayMinutes(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// 這頁上有兩種順序，必須分開呈現，否則同一份清單會同時想表達兩件事。
//
// 報到之後，預約時間就不再決定任何事——人已經在診所裡，決定誰先看的是候診序號。
// 所以 waiting 從時間軸抽出來自成一區、依 checkinNumber 排；時間軸只留還沒到的人，
// 它的軸就純粹是時間。混在一起時，候診中的人會被釘在自己的預約時間上，
// 旁邊卻掛著一個跟那個位置無關的號碼，連調整順序的按鈕都會被讀成在拖時間。
//
// 已取消與未到各自集中到最下面。已完成的看診直接從這頁消失（不是留著變灰）——
// 保持佇列乾淨，這頁只服務「今天還要處理的事」。
export function splitAppointmentsByQueueState(appointments) {
  const waiting = [];
  const scheduled = [];
  const cancelled = [];
  const noShow = [];
  for (const appointment of appointments ?? []) {
    if (appointment.status === 'arrived') waiting.push(appointment);
    else if (appointment.status === 'scheduled') scheduled.push(appointment);
    else if (appointment.status === 'cancelled') cancelled.push(appointment);
    else if (appointment.status === 'no_show') noShow.push(appointment);
  }
  // 佇列位置就是看診順序，跟預約時間無關。還沒配到號碼的排最後。
  const position = (item) => (Number.isInteger(item.checkinNumber) ? item.checkinNumber : Number.MAX_SAFE_INTEGER);
  waiting.sort((a, b) => position(a) - position(b));
  return { waiting, scheduled, cancelled, noShow };
}

// 身分是否已經確定（回診＝已知道是哪隻寵物；初診＝petId 還是空的）。
// 決定頭像/名字要不要用「未確認」的灰階樣式，以及按「報到」要不要跳窗核對身分。
export function isIdentityConfirmed(appointment) {
  return Boolean(appointment?.petId);
}

// 這個時間點該落在哪個時段。落在時段之間（例如手術時間）或超出全部時段時，
// 併入下一個還沒開始/最後一個時段，避免那筆掛號在畫面上直接消失。
export function assignSessionIndex(minutes, sessions = SESSIONS) {
  for (let index = 0; index < sessions.length; index += 1) {
    if (minutes < parseTimeToMinutes(sessions[index].end)) return index;
  }
  return sessions.length - 1;
}

// 依時段分組；假設 appointments 已經依 scheduledAt 由小到大排序（API 回傳就是這個順序），
// 分組後每組內的相對順序會維持不變。
export function groupBySession(appointments, sessions = SESSIONS) {
  const groups = sessions.map((session) => ({ session, items: [] }));
  for (const appointment of appointments ?? []) {
    const minutes = timeOfDayMinutes(new Date(appointment.scheduledAt));
    groups[assignSessionIndex(minutes, sessions)].items.push(appointment);
  }
  return groups;
}

// 「現在」指示線在某個時段的清單裡該插在第幾個位置（插在這個 index 之前）。
export function nowIndexInSession(items, now = new Date()) {
  const minutes = timeOfDayMinutes(now);
  let index = 0;
  while (index < items.length && timeOfDayMinutes(new Date(items[index].scheduledAt)) <= minutes) {
    index += 1;
  }
  return index;
}
