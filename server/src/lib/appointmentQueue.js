// 候診順序與實體號碼牌是兩件事：順序依報到時間，號碼只用來讓現場辨識與叫號。
// 因此其他人離開候診時，已發出去的牌號不能跟著改變。
export function queueOrder(appointments = []) {
  return [...appointments].sort((a, b) => {
    const leftAt = a.checkedInAt ? new Date(a.checkedInAt).getTime() : 0;
    const rightAt = b.checkedInAt ? new Date(b.checkedInAt).getTime() : 0;
    if (leftAt !== rightAt) return leftAt - rightAt;
    return String(a._id).localeCompare(String(b._id));
  });
}

// 自動報到時配今天從未發出過的最小正整數；櫃台仍可依實際拿出的紙本牌手動修改。
export function nextAvailableCheckinNumber(appointments = []) {
  const used = new Set();
  for (const appointment of appointments) {
    const numbers = [appointment.checkinNumber, ...(appointment.checkinNumberHistory ?? [])];
    for (const number of numbers) {
      if (Number.isSafeInteger(number) && number > 0) used.add(number);
    }
  }
  let candidate = 1;
  while (used.has(candidate)) candidate += 1;
  return candidate;
}
