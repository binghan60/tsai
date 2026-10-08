import { relativeTimeLabel } from './datetime.js';

// IDEXX 檢驗結果的待確認清單（工具欄「檢驗」）用的顯示規則。

// 儀器名稱照 IDEXX 原樣（Catalyst_One、IDEXX_inVue_Dx…），前面加上櫃台看得懂的用途。
// 文件沒列、新出的儀器照樣顯示原名，只是沒有用途。
const INSTRUMENT_PURPOSES = [
  [/catalyst|vettest/i, '生化'],
  [/procyte|lasercyte|vetautoread/i, '血球'],
  [/snap/i, '快篩'],
  [/invue/i, '細胞學'],
  [/ua_analyzer|sedivue/i, '尿液'],
  [/coag/i, '凝血'],
  [/vetlyte|vetstat/i, '電解質'],
];

export function instrumentLabel(code) {
  const raw = String(code ?? '').trim();
  const name = raw.replace(/^IDEXX_/i, '').replace(/_/g, ' ');
  const purpose = INSTRUMENT_PURPOSES.find(([pattern]) => pattern.test(raw))?.[1] ?? '';
  return { purpose, name };
}

// 候選掛號的狀態，用語跟掛號台流程列一致。
const VISIT_STATUS = {
  scheduled: '待報到',
  arrived: '在院',
  pending_checkout: '待櫃台處理',
  completed: '已完成',
};

export function visitStatusLabel(status) {
  return VISIT_STATUS[status] ?? '';
}

// 診療台左欄的檢驗進度：驗血要等十幾分鐘，醫師通常已經切去看別隻，結果出來要在清單上看得到。
//   pending 已送 IDEXX、還沒有結果；ready 這次看診已經有 IDEXX 結果（自動認貓、面板確認、診療台匯入都算）。
// 只標還在院內的（已報到、櫃台還沒完成）；看完的不必再提醒。
export const LAB_PROGRESS = {
  pending: { label: '檢驗中', badge: 'bg-info-surface text-info', icon: 'text-info' },
  ready: { label: '檢驗已出', badge: 'bg-success-surface text-success', icon: 'text-success' },
};

export function labProgress(appointment, resultCount = 0) {
  const inClinic = Boolean(appointment?.petId) && (appointment?.status === 'arrived' || appointment?.status === 'pending_checkout');
  if (!inClinic) return '';
  if (resultCount > 0) return 'ready';
  return appointment.labRequestedAt ? 'pending' : '';
}

// 診所電腦上抓檔程式的狀態列（「檢驗」面板最上面）。開發者人不在診所，它停了要讓人一眼看得出來。
//   success 正常；warning 還連著但上傳卡住；danger 超過三分鐘沒回報（online 由伺服器判斷）。
export function bridgeStatusLine(bridge, now = new Date()) {
  const name = `診所電腦（${bridge.bridgeId}）`;
  const seen = `最後回報：${relativeTimeLabel(bridge.lastSeenAt, now)}`;
  if (!bridge.online) return { tone: 'danger', text: `${name}沒有回報，新的檢驗結果進不來`, detail: seen };
  if (bridge.lastError) {
    const pending = bridge.pendingFiles ? `${bridge.pendingFiles} 個檔案還沒上傳：` : '';
    return { tone: 'warning', text: `${name}連線中，但上傳有問題`, detail: `${pending}${bridge.lastError}` };
  }
  return { tone: 'success', text: `${name}連線中`, detail: seen };
}

// 確認之後跟使用者說發生了什麼。沒填進報告時一定要講原因，不然會以為壞掉了。
export function fillMessage(fill, petName) {
  const name = petName || '這隻貓';
  switch (fill?.status) {
    case 'applied': {
      if (fill.filled?.length) {
        const conflicts = fill.conflicts ? `；${fill.conflicts} 項跟報告上已填的值不同，沒有蓋掉` : '';
        if (fill.closed === 'record_finalized') {
          return { type: 'info', message: `已填進${name}的看診與病歷日誌：${fill.filled.join('、')}。但健檢報告已經結案，報告上不會有這些數值，需要的話請建立修訂版${conflicts}` };
        }
        const done = fill.closed === 'desk_completed' ? '（這次看診櫃台已完成處理）' : '';
        return { type: 'success', message: `已填進${name}的健檢報告：${fill.filled.join('、')}${done}${conflicts}` };
      }
      // 一格都沒填、但有不同的值：不能說「沒有變動」，那是還沒決定。
      if (fill.conflicts) return { type: 'info', message: `${name}的報告上有 ${fill.conflicts} 項跟 IDEXX 的數值不同，沒有蓋掉` };
      if (fill.unmapped) {
        const list = fill.unmappedCodes?.length ? `（${fill.unmappedCodes.join('、')}）` : '';
        return { type: 'info', message: `${name}的健檢表單沒有對應這些 IDEXX 檢驗別與代號${list}，沒有填入。請到表單設計頁檢查代號與檢驗別。` };
      }
      return { type: 'info', message: `${name}的報告上已經有這些數值，沒有變動` };
    }
    case 'no_visit':
      // 伺服器沒有配對：沒有看診就沒有病歷日誌與健檢報告可以填，結果留在清單上。
      return { type: 'info', message: `${name}在檢驗那天沒有掛號，這份結果留在待確認清單` };
    case 'no_template':
      return { type: 'info', message: `${name}這次看診沒有選健檢表單，數值沒有填進報告` };
    case 'error':
      return { type: 'error', message: `已歸到${name}，但填進報告時出錯：${fill.message ?? ''}` };
    default:
      return { type: 'info', message: `已歸到${name}` };
  }
}
