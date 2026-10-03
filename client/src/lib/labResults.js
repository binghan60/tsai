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

// 確認之後跟使用者說發生了什麼。沒填進報告時一定要講原因，不然會以為壞掉了。
export function fillMessage(fill, petName) {
  const name = petName || '這隻貓';
  switch (fill?.status) {
    case 'applied': {
      if (fill.filled?.length) {
        const conflicts = fill.conflicts ? `；${fill.conflicts} 項跟報告上已填的值不同，沒有蓋掉` : '';
        return { type: 'success', message: `已填進${name}的健檢報告：${fill.filled.join('、')}${conflicts}` };
      }
      if (fill.unmapped) return { type: 'info', message: `${name}的健檢表單沒有對應這些項目的 IDEXX 代號，沒有填入。可以到表單設計頁設定。` };
      return { type: 'info', message: `${name}的報告上已經有這些數值，沒有變動` };
    }
    case 'no_visit':
      return { type: 'info', message: `${name}在檢驗那天沒有掛號，數值沒有填進報告` };
    case 'no_template':
      return { type: 'info', message: `${name}這次看診沒有選健檢表單，數值沒有填進報告` };
    case 'error':
      return { type: 'error', message: `已歸到${name}，但填進報告時出錯：${fill.message ?? ''}` };
    default:
      return { type: 'info', message: `已歸到${name}` };
  }
}
