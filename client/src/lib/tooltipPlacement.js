// v-tip 的定位：預設放在元素上方置中，上方放不下就改放下方；左右夾在視窗內。
// 純函式，給 lib/tooltipPlacement.test.js 測。
export const TIP_GAP = 6;
export const TIP_MARGIN = 8;

export function placeTooltip(target, tip, viewport) {
  const centered = target.left + target.width / 2 - tip.width / 2;
  const left = Math.min(Math.max(centered, TIP_MARGIN), Math.max(TIP_MARGIN, viewport.width - tip.width - TIP_MARGIN));
  const above = target.top - TIP_GAP - tip.height;
  const side = above >= TIP_MARGIN ? 'top' : 'bottom';
  const top = side === 'top' ? above : target.bottom + TIP_GAP;
  return { left, top, side };
}

// v-tip.overflow：只有文字真的被截斷（單行 truncate 或多行 line-clamp）才需要提示。
export function isTruncated(el) {
  return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
}
