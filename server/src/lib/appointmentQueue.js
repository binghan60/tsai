// 候診佇列的排序規則。純邏輯、不碰資料庫——路由只負責把佇列讀進來、把算出來的號碼寫回去。
//
// 不變式：同一天所有 status 為 arrived 的掛號，checkinNumber 是連續的 1..N。
//
// 「看診序號」講的是「現在排第幾個」，不是報到當下發出去的票號：看完診、取消或未到的人
// 離開佇列，後面的人往前遞補。這樣「這個號碼已經被用掉」在結構上就不存在，
// 不必靠檢查去擋——檢查擋不住併發，而且擋住之後前台還是得自己想辦法喬號碼。
// 代價是排在後面的人號碼會隨著前面的人看完而變小，這是即時位置該有的行為。

// 佇列的正規順序。沒有號碼的排在最後（剛報到、還沒配到位置），
// 平手時用報到時間、再平手用 _id —— 任何一次計算都要得到同一個順序。
export function queueOrder(appointments = []) {
  return [...appointments].sort((a, b) => {
    const left = Number.isInteger(a.checkinNumber) ? a.checkinNumber : Number.MAX_SAFE_INTEGER;
    const right = Number.isInteger(b.checkinNumber) ? b.checkinNumber : Number.MAX_SAFE_INTEGER;
    if (left !== right) return left - right;
    const leftAt = a.checkedInAt ? new Date(a.checkedInAt).getTime() : 0;
    const rightAt = b.checkedInAt ? new Date(b.checkedInAt).getTime() : 0;
    if (leftAt !== rightAt) return leftAt - rightAt;
    return String(a._id).localeCompare(String(b._id));
  });
}

// 排好之後，號碼就是位置。只回報真的變了的那幾筆：沒變的不必寫，
// 也不該讓它們跟其他併發操作互相衝突。
export function positionUpdates(ordered) {
  const updates = [];
  ordered.forEach((item, index) => {
    const checkinNumber = index + 1;
    if (item.checkinNumber !== checkinNumber) updates.push({ _id: item._id, checkinNumber });
  });
  return updates;
}
