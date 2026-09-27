import { isTruncated, placeTooltip } from './tooltipPlacement.js';

// v-tip：取代原生 title 的滑過提示（全站註冊，見 main.js）。
//
// 為什麼不用原生 title：要停一兩秒才出現、樣式是作業系統的，跟全站不一致——使用者要求換掉。
// 為什麼不是每處都包 ui/tooltip 元件：那要一個元素一個 Tooltip＋Trigger 包起來，四十幾處的模板都得改結構；
// 指令只要把 title="…" 換成 v-tip="…"。外觀跟 ui/tooltip 的 TooltipContent 同一組 token。
//
//   v-tip="文字"            一律提示
//   v-tip.overflow="文字"   只有文字真的被截斷時才提示（清單上 truncate 的欄位）
//
// 值是空的就不提示。沒有 aria-label、自己又沒有文字的元素（只有圖示的按鈕），原本 title 兼當無障礙名稱，
// 這裡補上 aria-label，換掉之後螢幕報讀器照樣讀得到。
const SHOW_DELAY_MS = 120;
let tip = null;
let owner = null;
let timer = 0;

function tipElement() {
  if (tip) return tip;
  tip = document.createElement('div');
  tip.setAttribute('role', 'tooltip');
  tip.className = 'pointer-events-none fixed z-100 w-fit max-w-xs rounded-md bg-foreground px-2.5 py-1.5 text-sm font-medium whitespace-pre-line text-background shadow-md';
  tip.hidden = true;
  document.body.appendChild(tip);
  return tip;
}

function hide() {
  window.clearTimeout(timer);
  if (tip) tip.hidden = true;
  owner = null;
}

function show(el) {
  const state = el.__tip;
  if (!state?.text || (state.overflow && !isTruncated(el))) return;
  const node = tipElement();
  node.textContent = state.text;
  node.hidden = false;
  const { left, top } = placeTooltip(el.getBoundingClientRect(), node.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight });
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
  owner = el;
}

function schedule(el) {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => show(el), SHOW_DELAY_MS);
}

function syncLabel(el) {
  const text = el.__tip?.text;
  if (el.__tip?.autoLabel) {
    if (text) el.setAttribute('aria-label', text);
    else el.removeAttribute('aria-label');
  }
}

function update(el, binding) {
  const text = binding.value == null ? '' : String(binding.value).trim();
  el.__tip = { ...el.__tip, text, overflow: Boolean(binding.modifiers.overflow) };
  syncLabel(el);
  if (owner === el) (text ? show(el) : hide());
}

let listening = false;
function listenGlobally() {
  if (listening) return;
  listening = true;
  // 捲動、縮放、按鍵都讓提示消失，免得它停在錯的位置。
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  window.addEventListener('keydown', (event) => event.key === 'Escape' && hide());
}

export const tooltipDirective = {
  mounted(el, binding) {
    listenGlobally();
    const autoLabel = !el.hasAttribute('aria-label') && !el.textContent.trim();
    el.__tip = { autoLabel };
    update(el, binding);
    const enter = () => schedule(el);
    const leave = () => hide();
    el.__tipHandlers = { enter, leave };
    el.addEventListener('mouseenter', enter);
    el.addEventListener('mouseleave', leave);
    el.addEventListener('focusin', enter);
    el.addEventListener('focusout', leave);
    el.addEventListener('pointerdown', leave);
  },
  updated: update,
  beforeUnmount(el) {
    if (owner === el) hide();
    const { enter, leave } = el.__tipHandlers ?? {};
    el.removeEventListener('mouseenter', enter);
    el.removeEventListener('mouseleave', leave);
    el.removeEventListener('focusin', enter);
    el.removeEventListener('focusout', leave);
    el.removeEventListener('pointerdown', leave);
  },
};
