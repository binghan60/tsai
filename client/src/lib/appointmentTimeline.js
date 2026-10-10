// 掛號與候診頁的純邏輯：分組、排序、狀態判斷。抽出來是因為這些規則之後很容易改
// （診間時段、要不要多一個時段），而頁面元件本身測不到——npm test 只涵蓋這個資料夾。
//
// 時間軸目前假設瀏覽器時區就是診所所在時區（前台電腦就在診所裡），
// 不像後端 clinicTime.js 需要處理伺服器可能跑在別的時區。

// 診間時段，目前先寫死；之後如果要讓時段可設定，這裡就是要抽換的地方。
export const SESSIONS = [
  { id: 'morning', label: '上午診', start: '10:00', end: '11:45' },
  { id: 'afternoon', label: '下午診', start: '14:00', end: '19:30' },
];

// 上午診與下午診之間的空檔（午休）。手術只是掛號上的標記、不佔專屬時段，這段不開放掛號。
export const MIDDAY_BREAK = { label: '午休', start: '11:45', end: '14:00' };

function parseTimeToMinutes(value) {
  const [hour, minute] = String(value).split(':').map(Number);
  return hour * 60 + minute;
}

function timeOfDayMinutes(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// 時間軸只放還在進行的掛號（待報到、在院、待櫃台處理），依預約時間排；已完成與未到／取消另外收在下面。
export function appointmentsForTimeline(appointments) {
  return (appointments ?? [])
    .filter((appointment) => ['scheduled', 'arrived', 'pending_checkout'].includes(appointment.status))
    .sort((a, b) => new Date(a.scheduledAt || 0) - new Date(b.scheduledAt || 0));
}

// 身分是否已經確定（回診＝已知道是哪隻貓咪；初診在初診表審核通過前 petId 是空的）。
// 決定頭像要不要用「未確認」的灰階樣式。
export function isIdentityConfirmed(appointment) {
  return Boolean(appointment?.petId);
}

// 這個時間點該落在哪個時段。落在時段之間（午休）或超出全部時段時，
// 併入下一個還沒開始/最後一個時段，避免那筆掛號在畫面上直接消失。
// 時段的 end 是「最後一個可約的開始時間」（上午診 11:45），所以 end 當下還屬於該時段。
export function assignSessionIndex(minutes, sessions = SESSIONS) {
  for (let index = 0; index < sessions.length; index += 1) {
    if (minutes <= parseTimeToMinutes(sessions[index].end)) return index;
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
