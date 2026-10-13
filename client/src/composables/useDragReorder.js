import { onBeforeUnmount, ref } from 'vue';
import { clampDragOffset, dragShift, dropIndex } from '../lib/dragReorder';

// 直排清單的拖拉排序（pointer events，滑鼠與觸控同一套，不靠 HTML5 drag-and-drop——那個在平板上不動）。
// 用法：可拖的列標 data-drag-row（依畫面順序）、清單容器 ref 傳進來；把手綁 handleEvents(index)
// 並加 touch-none（不然手指一拖就變成捲動）；每一列套 rowStyle(index)。
// 拖拉途中只用 transform 位移，不動資料；放開時 onDrop(from, to) 由呼叫端真正改順序。
// 清單在可捲動的面板裡：拖到上下緣會自動捲，位移把捲動量算進去。
const EDGE = 48;
const MAX_SCROLL_STEP = 14;

function scrollParent(element) {
  for (let node = element?.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return document.scrollingElement;
}

// canStart：回 false 時按下把手不開始拖（例如上一次排序還在送）。
export function useDragReorder(container, { onDrop, canStart = () => true }) {
  const dragging = ref(null); // { from, to, offset }
  let rows = [];
  let startY = 0;
  let lastY = 0;
  let startScroll = 0;
  let scroller = null;
  let frame = 0;

  function update() {
    if (!dragging.value) return;
    const raw = lastY - startY + (scroller.scrollTop - startScroll);
    const offset = clampDragOffset(rows, dragging.value.from, raw);
    dragging.value = { ...dragging.value, offset, to: dropIndex(rows, dragging.value.from, offset) };
  }

  function autoScroll() {
    frame = 0;
    if (!dragging.value || !scroller) return;
    const rect = scroller === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
    let step = 0;
    if (lastY < rect.top + EDGE) step = -Math.ceil(((rect.top + EDGE - lastY) / EDGE) * MAX_SCROLL_STEP);
    else if (lastY > rect.bottom - EDGE) step = Math.ceil(((lastY - (rect.bottom - EDGE)) / EDGE) * MAX_SCROLL_STEP);
    if (!step) return;
    const before = scroller.scrollTop;
    scroller.scrollTop += step;
    if (scroller.scrollTop === before) return;
    update();
    frame = requestAnimationFrame(autoScroll);
  }

  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    dragging.value = null;
    rows = [];
  }

  function start(event, index) {
    if (event.button !== 0 || dragging.value || !container.value || !canStart()) return;
    const elements = [...container.value.querySelectorAll('[data-drag-row]')];
    if (elements.length < 2 || !elements[index]) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    rows = elements.map((element) => ({ top: element.offsetTop, height: element.offsetHeight }));
    scroller = scrollParent(container.value);
    startY = lastY = event.clientY;
    startScroll = scroller.scrollTop;
    dragging.value = { from: index, to: index, offset: 0 };
  }

  function move(event) {
    if (!dragging.value) return;
    lastY = event.clientY;
    update();
    if (!frame) frame = requestAnimationFrame(autoScroll);
  }

  function end() {
    if (!dragging.value) return;
    const { from, to } = dragging.value;
    stop();
    if (from !== to) onDrop(from, to);
  }

  // 把手上要綁的事件。pointer capture 讓移動與放開都送回把手，手指滑出把手也照樣收得到。
  function handleEvents(index) {
    return {
      pointerdown: (event) => start(event, index),
      pointermove: move,
      pointerup: end,
      pointercancel: stop,
      lostpointercapture: end,
    };
  }

  // 被拖的列跟著手指走、浮在其他列上面；其他列讓位時有過場。沒在拖的時候不加任何樣式，
  // 放開那一刻資料已經換好順序，位移直接歸零、不播回彈動畫。
  function rowStyle(index) {
    const state = dragging.value;
    if (!state) return undefined;
    if (index === state.from) return { transform: `translateY(${state.offset}px)`, position: 'relative', zIndex: 10 };
    const shift = dragShift(index, state.from, state.to, rows[state.from]?.height ?? 0);
    return { transform: shift ? `translateY(${shift}px)` : undefined, transition: 'transform 150ms ease' };
  }

  onBeforeUnmount(stop);

  return { dragging, handleEvents, rowStyle, cancel: stop };
}
