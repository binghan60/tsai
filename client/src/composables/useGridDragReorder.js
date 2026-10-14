import { onBeforeUnmount, ref } from 'vue';

// 多欄（grid）清單的拖拉排序：useDragReorder 的二維版，介面相同。
// 可拖的列標 data-drag-row（依閱讀順序：左到右、上到下），把手綁 handleEvents(index) 並加 touch-none，
// 每一列套 rowStyle(index)。拖拉途中只用 transform 位移，放開時 onDrop(from, to) 由呼叫端真正改順序。
// 被拖的列跟著指標走；游標落在哪一格就是 to，中間的列各自往前（或往後）挪一格的位置。
const EDGE = 48;
const MAX_SCROLL_STEP = 14;

function scrollParent(element) {
  for (let node = element?.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return document.scrollingElement;
}

export function useGridDragReorder(container, { onDrop, canStart = () => true }) {
  const dragging = ref(null); // { from, to, dx, dy }
  let slots = []; // 拖拉開始時每一格的位置（頁面座標）
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let startScroll = 0;
  let scroller = null;
  let frame = 0;

  function slotAt(x, y, fallback) {
    let best = fallback;
    let bestDistance = Infinity;
    slots.forEach((slot, index) => {
      if (x >= slot.left && x <= slot.left + slot.width && y >= slot.top && y <= slot.top + slot.height) {
        best = index;
        bestDistance = -1;
      } else if (bestDistance >= 0) {
        const dx = x - (slot.left + slot.width / 2);
        const dy = y - (slot.top + slot.height / 2);
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      }
    });
    return best;
  }

  function update() {
    if (!dragging.value) return;
    const from = dragging.value.from;
    const dx = lastX - startX;
    const dy = lastY - startY + (scroller.scrollTop - startScroll);
    const origin = slots[from];
    const centerX = origin.left + origin.width / 2 + dx;
    const centerY = origin.top + origin.height / 2 + dy;
    dragging.value = { from, to: slotAt(centerX, centerY, from), dx, dy };
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
    slots = [];
  }

  function start(event, index) {
    if (event.button !== 0 || dragging.value || !container.value || !canStart()) return;
    const elements = [...container.value.querySelectorAll('[data-drag-row]')];
    if (elements.length < 2 || !elements[index]) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    scroller = scrollParent(container.value);
    startScroll = scroller.scrollTop;
    // 每一格的位置存成開始拖拉那一刻的視窗座標；拖拉途中的捲動量加進 dy，兩邊就在同一個座標系。
    slots = elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });
    startX = lastX = event.clientX;
    startY = lastY = event.clientY;
    dragging.value = { from: index, to: index, dx: 0, dy: 0 };
  }

  function move(event) {
    if (!dragging.value) return;
    lastX = event.clientX;
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

  function handleEvents(index) {
    return {
      pointerdown: (event) => start(event, index),
      pointermove: move,
      pointerup: end,
      pointercancel: stop,
      lostpointercapture: end,
    };
  }

  function rowStyle(index) {
    const state = dragging.value;
    if (!state) return undefined;
    if (index === state.from) return { transform: `translate(${state.dx}px, ${state.dy}px)`, position: 'relative', zIndex: 10 };
    let target = index;
    if (state.from < state.to && index > state.from && index <= state.to) target = index - 1;
    else if (state.to < state.from && index >= state.to && index < state.from) target = index + 1;
    if (target === index) return { transition: 'transform 150ms ease' };
    const here = slots[index];
    const there = slots[target];
    if (!here || !there) return undefined;
    return { transform: `translate(${there.left - here.left}px, ${there.top - here.top}px)`, transition: 'transform 150ms ease' };
  }

  onBeforeUnmount(stop);

  return { dragging, handleEvents, rowStyle, cancel: stop };
}
