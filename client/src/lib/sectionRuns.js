// 版式元件原本會把主型別的項目全部排在前面、其他型別一律擠到區塊最後，
// 於是把一個欄位換成別種型別，它就會憑空跳到底部 —— 使用者排好的順序被推翻了。
//
// 這個函式把項目切成「連續的同族群區段」，版式元件對每個區段各自套用自己的排版。
// 順序完全跟著 items 走，換型別只會換掉外觀，不會換位置。
export function sectionRuns(items, isPrimary) {
  const runs = [];
  for (const item of items ?? []) {
    const kind = isPrimary(item) ? 'primary' : 'scalar';
    const last = runs[runs.length - 1];
    if (last?.kind === kind) last.items.push(item);
    else runs.push({ key: kind + '-' + item.key, kind, items: [item] });
  }
  return runs;
}
