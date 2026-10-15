import Owner from '../models/Owner.js';

// 系統內建的「院內」飼主：沒人負責的流浪貓掛在它名下（每隻貓一定要有飼主）。
// 只有一筆（kind: 'clinic' 的 partial unique 索引），第一次用到時建立；沒有手機，所以這些貓的報告
// 沒有密碼、不能寄 Email 或開分享連結，IDEXX 也認不出來（要手動匯入）。
export const CLINIC_OWNER_NAME = '院內';

export function isClinicOwner(owner) {
  return owner?.kind === 'clinic';
}

// 在 transaction 外先確保它存在：兩台裝置同時第一次建立時，後到的撞上唯一索引就改讀已經建好的那筆，
// 不必讓整個 transaction 為這件事失敗。
export async function ensureClinicOwner() {
  const existing = await Owner.findOne({ kind: 'clinic' });
  if (existing) return existing;
  try {
    return await Owner.create({ kind: 'clinic', name: CLINIC_OWNER_NAME, phone: '' });
  } catch (err) {
    if (err?.code !== 11000) throw err;
    return Owner.findOne({ kind: 'clinic' });
  }
}
