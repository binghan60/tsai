// 欄位的「族群」：作答存在哪裡、需要什麼控制項。
// 這是欄位型別自己的性質，跟它被放在哪個版式的區塊無關 ——
// 任何型別都可以放進任何區塊，版式只決定它「原生」的排法。
export function familyOf(item) {
  if (item?.type === 'finding') return 'finding';
  if (item?.type === 'lab') return 'lab';
  if (item?.type === 'measurement') return 'measurement';
  return 'scalar';
}

// 各版式原生負責渲染的族群。落在這個族群的項目走版式自己的簽名排版
// （理學檢查的三態清單、檢驗表格的分組表格、量測格狀的數值卡片），
// 其餘族群一律交給 FieldControl 用精簡版控制項渲染。
const NATIVE_FAMILY = {
  findings: 'finding',
  table: 'lab',
  grid: 'measurement',
};

export function isNative(section, item) {
  return NATIVE_FAMILY[section?.presentation] === familyOf(item);
}
