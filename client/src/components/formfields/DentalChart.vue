<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as d3 from 'd3';

const props = defineProps({ modelValue: { type: [Object, String], default: () => ({ teeth: {} }) }, readonly: Boolean });
const emit = defineEmits(['update:modelValue']);
const DENTAL = {
  normal: 'var(--dental-normal)', missing: 'var(--dental-missing)', calculus: 'var(--dental-calculus)',
  periodontal: 'var(--dental-periodontal)', extracted: 'var(--dental-extracted)', other: 'var(--dental-other)',
  right: 'var(--dental-right)', left: 'var(--dental-left)', outline: 'var(--dental-outline)',
  guide: 'var(--dental-guide)', fieldBorder: 'var(--dental-field-border)', selected: 'var(--dental-selected)',
};
const STATES = [
  { value: 'normal', label: '正常', color: DENTAL.normal }, { value: 'missing', label: '缺牙', color: DENTAL.missing },
  { value: 'calculus', label: '牙結石', color: DENTAL.calculus }, { value: 'periodontal', label: '牙周病', color: DENTAL.periodontal },
  { value: 'extracted', label: '拔除', color: DENTAL.extracted }, { value: 'other', label: '其他', color: DENTAL.other },
];
const stateByValue = Object.fromEntries(STATES.map((state) => [state.value, state]));
const swatchStyle = (state) => ({
  backgroundColor: state.color,
  border: state.value === 'normal' ? `1px solid ${DENTAL.fieldBorder}` : '1px solid transparent',
});
const svg = ref(null); const selectedCode = ref(null);
const menuRef = ref(null); const menuPos = ref(null); // 點牙齒時打開的右鍵選單風格浮動選單，取代原本畫面下方常駐的狀態面板
const chart = computed(() => props.modelValue && typeof props.modelValue === 'object' && !Array.isArray(props.modelValue) ? { teeth: props.modelValue.teeth ?? {} } : { teeth: {} });
const selected = computed(() => selectedCode.value ? chart.value.teeth[selectedCode.value] : null);
const noteFor = (code) => chart.value.teeth[code]?.note ?? '';

// 版面 100% 對照 public/tooth.jpg（貓 Modified Triadan 咬合面圖）取樣：座標直接用該影像的像素座標系。
// 直式佈局，上顎與下顎的牙弓相對，編號放在牙齒外側（右側 1xx/4xx 紅字、左側 2xx/3xx 藍字）。
// 只定義右側象限（1xx/4xx），左側（2xx/3xx）以各顎的中軸鏡射產生；影像本身左右略有手繪誤差，取右側為準。
const RIGHT_COLOR = DENTAL.right; const LEFT_COLOR = DENTAL.left;
const AXIS = { maxilla: 1046, mandible: 1074 }; // 鏡射軸 x 座標的兩倍（上顎軸 523、下顎軸 537）
// x/y 牙齒中心、rx/ry 半徑、rot 傾斜角（度）、lx/ly 編號文字位置
const rightTeethSampled = [
  // 上顎右側：門齒（101–103）在中央成排、犬齒 104 細長、後方 106–108 沿牙弓外斜、109 小圓
  { code: '101', x: 508, y: 291, rx: 9, ry: 13, rot: 0, lx: 500, ly: 165 },
  { code: '102', x: 490, y: 293, rx: 9, ry: 13, rot: -15, lx: 486, ly: 200 },
  { code: '103', x: 470, y: 296, rx: 9, ry: 14, rot: -22, lx: 456, ly: 234 },
  { code: '104', x: 430, y: 318, rx: 15, ry: 50, rot: 4, lx: 378, ly: 328 },
  { code: '106', x: 410, y: 407, rx: 11, ry: 15, rot: 35, lx: 332, ly: 416 },
  { code: '107', x: 383, y: 472, rx: 12, ry: 33, rot: 28, lx: 292, ly: 472 },
  { code: '108', x: 347, y: 556, rx: 15, ry: 44, rot: 26, lx: 258, ly: 560 },
  { code: '109', x: 332, y: 624, rx: 13, ry: 10, rot: 10, lx: 226, ly: 634 },
  // 下顎右側：409–407 沿牙弓內斜向下、犬齒 404 細長、門齒 401–403 收在中央底部
  { code: '409', x: 368, y: 995, rx: 13, ry: 37, rot: -18, lx: 287, ly: 1002 },
  { code: '408', x: 402, y: 1062, rx: 12, ry: 33, rot: -22, lx: 317, ly: 1080 },
  { code: '407', x: 434, y: 1122, rx: 10, ry: 24, rot: -28, lx: 357, ly: 1144 },
  { code: '404', x: 470, y: 1222, rx: 14, ry: 42, rot: -6, lx: 397, ly: 1240 },
  { code: '403', x: 498, y: 1237, rx: 8, ry: 11, rot: 15, lx: 474, ly: 1326 },
  { code: '402', x: 514, y: 1234, rx: 8, ry: 11, rot: 8, lx: 489, ly: 1362 },
  { code: '401', x: 530, y: 1232, rx: 8, ry: 11, rot: 0, lx: 505, ly: 1398 },
];
// 上下顎之間原本留給貓咪插圖與 Maxilla/Mandible 文字的空間拿掉後就是純粹的死白區，
// 把下顎整組往上收攏，但只動這個「顎間距」，兩顎各自內部的相對位置（tooth.jpg 取樣值）完全不變。
const MANDIBLE_LIFT = 240;
const rightTeeth = rightTeethSampled.map((t) => (t.code[0] === '4' ? { ...t, y: t.y - MANDIBLE_LIFT, ly: t.ly - MANDIBLE_LIFT } : t));
const mirrorTooth = (t) => {
  const axis = t.code[0] === '1' ? AXIS.maxilla : AXIS.mandible;
  return { ...t, code: (t.code[0] === '1' ? '2' : '3') + t.code.slice(1), x: axis - t.x, lx: axis - t.lx, rot: -t.rot };
};
const labelColor = (d) => (d.code[0] === '1' || d.code[0] === '4' ? RIGHT_COLOR : LEFT_COLOR);

// 滿版備註欄：每顆牙延伸一條連接線到左右兩側的備註方塊，方塊依 rightTeeth 的順序排成兩欄（R 在左、L 在右，
// 同一列互為鏡射牙位），欄位落在牙弓左右兩側的空白區。牙位代號貼在方塊外側（不再疊在方塊正上方），
// 省下的直排空間讓 ROW_GAP 可以縮小，兩者一起把整個元件壓矮。
const ROW_TOP = 136; const ROW_GAP = 64; const BOX_W = 180; const BOX_H = 40;
const LABEL_GAP = 8; const LABEL_W = 46;
const CENTER_AXIS = 527; const LEFT_COL_CX = -60; const RIGHT_COL_CX = 2 * CENTER_AXIS - LEFT_COL_CX;
const rightRows = rightTeeth.map((t, i) => ({
  ...t, boxCx: LEFT_COL_CX, boxY: ROW_TOP + i * ROW_GAP, lineEndX: LEFT_COL_CX + BOX_W / 2,
  labelX: LEFT_COL_CX - BOX_W / 2 - LABEL_GAP, labelAnchor: 'end',
}));
const leftRows = rightTeeth.map((t, i) => ({
  ...mirrorTooth(t), boxCx: RIGHT_COL_CX, boxY: ROW_TOP + i * ROW_GAP, lineEndX: RIGHT_COL_CX - BOX_W / 2,
  labelX: RIGHT_COL_CX + BOX_W / 2 + LABEL_GAP, labelAnchor: 'start',
}));
const teeth = [...rightRows, ...leftRows];
const VIEW_BOX_X0 = LEFT_COL_CX - BOX_W / 2 - LABEL_GAP - LABEL_W - 10;
const VIEW_BOX_X1 = RIGHT_COL_CX + BOX_W / 2 + LABEL_GAP + LABEL_W + 10;
const VIEW_BOX = `${VIEW_BOX_X0} 110 ${VIEW_BOX_X1 - VIEW_BOX_X0} 1100`;

// 手繪感的不規則橢圓：六段 Q 曲線、左右上下刻意不對稱，再以 rot 旋轉貼合牙弓走向。
function toothPath(d) {
  const { x, y, rx, ry } = d;
  return [
    `M ${x} ${y - ry}`,
    `Q ${x + rx * 0.95} ${y - ry * 0.8} ${x + rx} ${y - ry * 0.1}`,
    `Q ${x + rx * 0.9} ${y + ry * 0.7} ${x + rx * 0.35} ${y + ry * 0.95}`,
    `Q ${x} ${y + ry * 1.08} ${x - rx * 0.4} ${y + ry * 0.9}`,
    `Q ${x - rx * 0.95} ${y + ry * 0.55} ${x - rx * 0.9} ${y - ry * 0.15}`,
    `Q ${x - rx * 0.75} ${y - ry * 0.85} ${x} ${y - ry}`,
    'Z',
  ].join(' ');
}
function render() {
  if (!svg.value) return;
  const root = d3.select(svg.value).selectAll('g.dental-root').data([null]).join('g').attr('class', 'dental-root');
  root.selectAll('text.side').data([{ text: 'R', x: 258, fill: RIGHT_COLOR }, { text: 'L', x: 792, fill: LEFT_COLOR }]).join('text').attr('class', 'side').attr('x', (d) => d.x).attr('y', 676).attr('text-anchor', 'middle').attr('fill', (d) => d.fill).attr('font-size', 54).attr('font-weight', 700).text((d) => d.text);
  // outline:none 直接用 d3 內聯樣式設定：這個 <g> 是 d3 動態建立的節點，Vue scoped CSS 的屬性選擇器套不到它，
  // 靠 <style scoped> 關不掉瀏覽器對可聚焦 SVG 元素的預設方形 focus outline。
  const group = root.selectAll('g.tooth').data(teeth, (d) => d.code).join('g').attr('class', 'tooth').attr('tabindex', props.readonly ? null : 0).attr('role', props.readonly ? null : 'button').attr('aria-label', (d) => `牙位 ${d.code}`).style('outline', 'none')
    .on('click', (event, d) => { if (!props.readonly && !event.target.closest?.('textarea')) openMenuAt(event.clientX, event.clientY, d.code); })
    .on('keydown', (event, d) => {
      if (props.readonly || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      openMenuAt(rect.left + rect.width / 2, rect.top + rect.height / 2, d.code);
    });
  group.selectAll('circle.hit').data((d) => [d]).join('circle').attr('class', 'hit').attr('cx', (d) => d.x).attr('cy', (d) => d.y).attr('r', (d) => Math.max(26, d.ry + 12)).attr('fill', 'transparent');
  group.selectAll('path.shape').data((d) => [d]).join('path').attr('class', 'shape').attr('d', toothPath).attr('transform', (d) => `rotate(${d.rot} ${d.x} ${d.y})`)
    .attr('fill', (d) => stateByValue[chart.value.teeth[d.code]?.status]?.color ?? DENTAL.normal).attr('fill-opacity', (d) => chart.value.teeth[d.code] ? 0.82 : 1)
    .attr('stroke', (d) => d.code === selectedCode.value ? DENTAL.selected : DENTAL.outline).attr('stroke-width', (d) => d.code === selectedCode.value ? 6 : 3);
  group.selectAll('text.label').data((d) => [d]).join('text').attr('class', 'label').attr('x', (d) => d.lx).attr('y', (d) => d.ly).attr('text-anchor', 'middle').attr('font-size', 30).attr('font-weight', 700).attr('fill', labelColor).text((d) => d.code);

  // 連接線：牙齒中心 → 側欄備註方塊內緣，選中時連同牙齒一起變成強調色，讓「這顆牙對應這個方塊」看得出來
  group.selectAll('line.leader').data((d) => [d]).join('line').attr('class', 'leader')
    .attr('x1', (d) => d.x).attr('y1', (d) => d.y).attr('x2', (d) => d.lineEndX).attr('y2', (d) => d.boxY)
    .attr('stroke', (d) => d.code === selectedCode.value ? DENTAL.selected : DENTAL.guide).attr('stroke-width', (d) => d.code === selectedCode.value ? 2.5 : 1.5);
  // 備註方塊外側（不是正上方）的牙位代號：貼著方塊同一列橫向排列，不佔額外的直排空間，ROW_GAP 才有辦法縮小
  group.selectAll('text.boxLabel').data((d) => [d]).join('text').attr('class', 'boxLabel')
    .attr('x', (d) => d.labelX).attr('y', (d) => d.boxY + 7).attr('text-anchor', (d) => d.labelAnchor)
    .attr('font-size', 20).attr('font-weight', 700).attr('fill', labelColor).text((d) => d.code);
  // 備註輸入框：用 foreignObject 承載一顆真正的 <textarea>，用 DOM API 直接建立以避開 SVG／HTML 命名空間問題，
  // 並靠 join 對同一 code 重用既有節點（不重建）以保留輸入中的游標與焦點。
  const fo = group.selectAll('foreignObject.noteBox').data((d) => [d]).join('foreignObject').attr('class', 'noteBox')
    .attr('x', (d) => d.boxCx - BOX_W / 2).attr('y', (d) => d.boxY - BOX_H / 2).attr('width', BOX_W).attr('height', BOX_H);
  fo.each(function dentalNoteBox(d) {
    let textarea = this.querySelector('textarea');
    if (!textarea) {
      textarea = document.createElement('textarea');
      Object.assign(textarea.style, {
        width: '100%', height: '100%', boxSizing: 'border-box', resize: 'none', outline: 'none',
        border: `1.5px solid ${DENTAL.fieldBorder}`, borderLeftWidth: '4px', borderRadius: '6px', padding: '4px 6px',
        fontSize: '18px', lineHeight: '1.3', fontFamily: 'inherit', color: 'var(--color-foreground)', background: 'var(--color-field)',
      });
      textarea.addEventListener('input', (event) => { if (!props.readonly) setNoteFor(d.code, event.target.value); });
      textarea.addEventListener('focus', () => { textarea.style.borderTopColor = textarea.style.borderRightColor = textarea.style.borderBottomColor = DENTAL.selected; });
      textarea.addEventListener('blur', () => {
        const idle = d.code === selectedCode.value ? DENTAL.selected : DENTAL.fieldBorder;
        textarea.style.borderTopColor = textarea.style.borderRightColor = textarea.style.borderBottomColor = idle;
      });
      this.appendChild(textarea);
    }
    textarea.readOnly = props.readonly;
    textarea.placeholder = props.readonly ? '' : '備註…';
    textarea.style.background = props.readonly ? 'transparent' : 'var(--color-field)';
    textarea.style.borderLeftColor = stateByValue[chart.value.teeth[d.code]?.status]?.color ?? DENTAL.fieldBorder;
    // 選中光環跟 focus 分開處理但選中時明顯加強：邊框也一起變成強調色（不只陰影環），選牙不一定會把游標移進方塊，
    // 兩者各自獨立才不會互相蓋掉，focus 中的方塊維持 focus 監聽器設的顏色，不被這裡覆寫。
    if (document.activeElement !== textarea) {
      const idle = d.code === selectedCode.value ? DENTAL.selected : DENTAL.fieldBorder;
      textarea.style.borderTopColor = textarea.style.borderRightColor = textarea.style.borderBottomColor = idle;
    }
    textarea.style.boxShadow = d.code === selectedCode.value ? '0 0 0 3px var(--dental-selected-ring), 0 0 14px 2px var(--dental-selected-glow)' : 'none';
    if (document.activeElement !== textarea) { const v = noteFor(d.code); if (textarea.value !== v) textarea.value = v; }
  });
}
function setState(status) { if (!selectedCode.value) return; emit('update:modelValue', { teeth: { ...chart.value.teeth, [selectedCode.value]: { ...(chart.value.teeth[selectedCode.value] ?? {}), status, note: chart.value.teeth[selectedCode.value]?.note ?? '' } } }); }
function setNoteFor(code, note) { emit('update:modelValue', { teeth: { ...chart.value.teeth, [code]: { ...(chart.value.teeth[code] ?? {}), note } } }); }
function clearSelected() { if (!selectedCode.value) return; const teeth = { ...chart.value.teeth }; delete teeth[selectedCode.value]; emit('update:modelValue', { teeth }); }
function openMenuAt(x, y, code) { selectedCode.value = code; menuPos.value = { x, y }; nextTick(clampMenuToViewport); }
// 選單用點擊座標定位，靠近畫面右／下邊緣的牙位（例如螢幕右下角）點了以後選單可能被裁到視窗外，
// 量出實際尺寸後只在超出邊界時往回推，不用邊界的牙位維持原本貼著點擊點的位置不動。
function clampMenuToViewport() {
  const el = menuRef.value;
  if (!el || !menuPos.value) return;
  const rect = el.getBoundingClientRect();
  const margin = 8;
  let { x, y } = menuPos.value;
  if (rect.right > window.innerWidth - margin) x -= rect.right - (window.innerWidth - margin);
  if (rect.bottom > window.innerHeight - margin) y -= rect.bottom - (window.innerHeight - margin);
  x = Math.max(margin, x);
  y = Math.max(margin, y);
  if (x !== menuPos.value.x || y !== menuPos.value.y) menuPos.value = { x, y };
}
function closeMenu() { selectedCode.value = null; menuPos.value = null; }
function pickState(status) { setState(status); closeMenu(); }
function clearAndClose() { clearSelected(); closeMenu(); }
// 選單是浮動在 body 上的元素，不是 d3 畫的 SVG 子節點，點擊外部／按 Esc 用一般 DOM 事件關閉。
// 點到牙齒本身時交給 d3 的 click handler 處理（可能是切換到另一顆牙），這裡不搶著關。
function onDocumentClick(event) {
  if (!menuPos.value) return;
  const target = event.target;
  if (menuRef.value?.contains(target)) return;
  if (target.closest?.('.tooth')) return;
  closeMenu();
}
function onDocumentKeydown(event) { if (event.key === 'Escape' && menuPos.value) closeMenu(); }
watch([chart, selectedCode, () => props.readonly], () => nextTick(render), { deep: true, immediate: true });
onMounted(() => { document.addEventListener('click', onDocumentClick); document.addEventListener('keydown', onDocumentKeydown); });
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick);
  document.removeEventListener('keydown', onDocumentKeydown);
  d3.select(svg.value).selectAll('*').remove();
});
</script>

<template>
  <div v-bind="$attrs" class="rounded-xl border border-border bg-field p-3 text-foreground">
    <svg ref="svg" :viewBox="VIEW_BOX" class="mx-auto block w-full" :class="readonly ? '' : 'cursor-pointer'" />
    <div class="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span v-for="state in STATES" :key="state.value" class="inline-flex items-center gap-1"><i class="h-2.5 w-2.5 rounded-full" :style="swatchStyle(state)" />{{ state.label }}</span></div>
  </div>
  <Teleport to="body">
    <div
      v-if="!readonly && menuPos"
      ref="menuRef"
      class="fixed z-50 w-36 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
      :style="{ left: `${menuPos.x + 8}px`, top: `${menuPos.y + 8}px` }"
    >
      <p class="px-2 py-1 text-xs font-medium text-muted-foreground">牙位 {{ selectedCode }}</p>
      <div class="border-t border-border pt-1">
        <button v-for="state in STATES" :key="state.value" type="button" class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs" :class="selected?.status === state.value ? 'bg-muted font-medium text-foreground' : 'hover:bg-muted'" @click="pickState(state.value)"><i class="h-2.5 w-2.5 shrink-0 rounded-full" :style="swatchStyle(state)" />{{ state.label }}</button>
        <button v-if="selected" type="button" class="mt-1 w-full border-t border-border px-2 pt-2 pb-1.5 text-left text-xs text-danger hover:bg-danger-surface" @click="clearAndClose">清除</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tooth:not([tabindex]) { cursor: default; } .tooth[tabindex] { cursor: pointer; outline: none; } .tooth[tabindex]:focus path.shape { stroke: var(--dental-selected); stroke-width: 6; }
</style>
