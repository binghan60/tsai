// 欄位的「族群」：作答存在哪裡、需要什麼控制項。
// 這是欄位型別自己的性質，跟它被放在哪個版式的區塊無關 ——
// 任何型別都可以放進任何區塊，版式只決定它「原生」的排法。
export function familyOf(item) {
  if (item?.type === 'finding') return 'finding';
  if (item?.type === 'lab') return 'lab';
  if (item?.type === 'measurement') return 'measurement';
  if (item?.type === 'dentalChart') return 'dental';
  return 'scalar';
}

