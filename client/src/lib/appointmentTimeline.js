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
// pending_checkout（醫生問診完成、待櫃台結帳）人還在診所，跟 waiting 一樣是「現場正在
// 處理中」的隊列，只是排的問題不同：waiting 回答「下一位該看診的是誰」，pendingCheckout
// 回答「下一位該結帳的是誰」，依轉入待結帳的時間排序（沒有則退回報到時間）。
//
// 已取消與未到各自集中到最下面；已完成另由頁面收進可展開的完成紀錄，
// 不混進仍待處理的候診佇列與時間軸。
export function splitAppointmentsByQueueState(appointments) {
  const waiting = [];
  const pendingCheckout = [];
  const scheduled = [];
  const cancelled = [];
  const noShow = [];
  for (const appointment of appointments ?? []) {
    if (appointment.status === 'arrived') waiting.push(appointment);
    else if (appointment.status === 'pending_checkout') pendingCheckout.push(appointment);
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
  pendingCheckout.sort((a, b) => {
    const left = a.pendingCheckoutAt ? new Date(a.pendingCheckoutAt).getTime() : Number.MAX_SAFE_INTEGER;
    const right = b.pendingCheckoutAt ? new Date(b.pendingCheckoutAt).getTime() : Number.MAX_SAFE_INTEGER;
    if (left !== right) return left - right;
    return String(a._id).localeCompare(String(b._id));
  });
  return { waiting, pendingCheckout, scheduled, cancelled, noShow };
}

// 報到（含問診完成、待結帳）不是從日程消失，而是多了進行中的子狀態。時間軸保留三種
// 進行中狀態，並重新依預約時間排序，避免候診佇列/待結帳佇列各自的排序污染時間軸順序。
export function appointmentsForTimeline(appointments) {
  return (appointments ?? [])
    .filter((appointment) => ['scheduled', 'arrived', 'pending_checkout'].includes(appointment.status))
    .sort((a, b) => new Date(a.scheduledAt || 0) - new Date(b.scheduledAt || 0));
}

// 身分是否已經確定（回診＝已知道是哪隻寵物；初診＝petId 還是空的）。
// 決定頭像/名字要不要用「未確認」的灰階樣式，以及按「報到」要不要跳窗核對身分。
export function isIdentityConfirmed(appointment) {
  return Boolean(appointment?.petId);
}

// 初診／回診徽章樣式，候診卡片、待結帳卡片（AppointmentQueueCardItem）、時間軸、
// 篩選表格共用同一份判斷，避免各處各寫一份、之後改樣式要改好幾處。
export const VISIT_TYPE_META = {
  new: { label: '初診', classes: 'bg-brand-50 text-brand-700 ring-brand-300/80 dark:bg-brand-950/60 dark:text-brand-200 dark:ring-brand-500/40' },
  return: { label: '回診', classes: 'bg-petrol-50 text-petrol-700 ring-petrol-300/80 dark:bg-petrol-950/60 dark:text-petrol-300 dark:ring-petrol-500/40' },
  unknown: { label: '類型未記錄', classes: 'bg-muted text-muted-foreground ring-border' },
};

// 舊資料在尚未報到時，petId 仍能代表掛號當下是否選了既有病患；報到後 petId
// 可能是初診現場才建立的，這時不能再猜，明確標示未記錄。
export function visitTypeMeta(appointment) {
  if (VISIT_TYPE_META[appointment?.visitType]) return VISIT_TYPE_META[appointment.visitType];
  if (appointment?.status === 'scheduled') return appointment.petId ? VISIT_TYPE_META.return : VISIT_TYPE_META.new;
  return VISIT_TYPE_META.unknown;
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
