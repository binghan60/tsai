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
// 報到之後，預約時間就不再決定任何事——人已經在診所裡，候診順序依實際報到時間。
// checkinNumber 是發給病患的實體號碼牌，不是陣列位置。時間軸則保留 scheduled 與 arrived，
// 繼續依原預約時間排列。同一筆已報到掛號會出現在兩處，但各自回答不同問題：
// 候診區回答「下一位是誰」，時間軸回答「原本約在幾點、目前進行到哪裡」。
//
// 已取消與未到各自集中到最下面；已完成另由頁面收進可展開的完成紀錄，
// 不混進仍待處理的候診佇列與時間軸。
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
  // 實體牌號可以由櫃台修改，不得藉此插隊；候診先後只看報到時間，平手再用 id 固定順序。
  waiting.sort((a, b) => {
    const left = a.checkedInAt ? new Date(a.checkedInAt).getTime() : Number.MAX_SAFE_INTEGER;
    const right = b.checkedInAt ? new Date(b.checkedInAt).getTime() : Number.MAX_SAFE_INTEGER;
    if (left !== right) return left - right;
    return String(a._id).localeCompare(String(b._id));
  });
  return { waiting, scheduled, cancelled, noShow };
}

// 報到不是從日程消失，而是多了一個候診狀態。時間軸保留兩種進行中狀態，
// 並重新依預約時間排序，避免候診佇列的報到時間排序污染時間軸順序。
export function appointmentsForTimeline(appointments) {
  return (appointments ?? [])
    .filter((appointment) => appointment.status === 'scheduled' || appointment.status === 'arrived')
    .sort((a, b) => new Date(a.scheduledAt || 0) - new Date(b.scheduledAt || 0));
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
