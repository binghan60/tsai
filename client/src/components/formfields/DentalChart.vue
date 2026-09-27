<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as d3 from 'd3';
import { Brush, Check, MousePointer2 } from '@lucide/vue';
import { DENTAL_STATES, brushTooth, dentalSummary, normalizeDental } from '../../lib/dentalChart';

// 貓的牙齒圖（Modified Triadan，咬合面）。沿用原本以 tooth.jpg 取樣的 d3 幾何，改良的是操作與辨識：
// - 兩種操作：「點選」點一顆開選單；「刷子」先選狀況，再一顆一顆點（一次標一排牙結石時快很多）
// - 「其餘全部正常」：沒標的牙到底是正常還是沒看，報告上要講清楚
// - 只有標了狀況、或正在選的牙才拉出備註欄，不再兩側各排 15 個空框
// - 每種狀況除了顏色還有形狀記號（虛線／點點／斜線／打叉），黑白列印與色盲也分得出來
// - 圖下方有文字清單（依狀況列牙位、再列備註），報告上也列出
const props = defineProps({ modelValue: { type: [Object, String], default: () => ({ teeth: {} }) }, readonly: Boolean });
const emit = defineEmits(['update:modelValue']);
const DENTAL = {
  normal: 'var(--dental-normal)', outline: 'var(--dental-outline)', guide: 'var(--dental-guide)',
  fieldBorder: 'var(--dental-field-border)', selected: 'var(--dental-selected)',
  right: 'var(--dental-right)', left: 'var(--dental-left)',
};
// 每種狀況的填色與線色（狀態色的 surface／前景）。
const STATE_STYLE = {
  missing: { fill: 'none', stroke: 'var(--dental-missing)', dash: '7 6' },
  calculus: { fill: 'var(--dental-calculus-surface)', stroke: 'var(--dental-calculus)', pattern: 'calculus' },
  periodontal: { fill: 'var(--dental-periodontal-surface)', stroke: 'var(--dental-periodontal)', pattern: 'periodontal' },
  extracted: { fill: 'var(--dental-extracted-surface)', stroke: 'var(--dental-extracted)', cross: true },
  other: { fill: 'var(--dental-other)', stroke: 'var(--dental-other)', fillOpacity: 0.85 },
};
const svg = ref(null);
const selectedCode = ref(null);
const menuRef = ref(null);
const menuPos = ref(null);
const mode = ref('select');
const brushState = ref('calculus');
const chart = computed(() => normalizeDental(props.modelValue));
const selected = computed(() => (selectedCode.value ? chart.value.teeth[selectedCode.value] : null));
const summary = computed(() => dentalSummary(chart.value));
const noteFor = (code) => chart.value.teeth[code]?.note ?? '';
const statusOf = (code) => chart.value.teeth[code]?.status || '';
// 一個 SVG 裡的 pattern id 要全頁唯一，同一頁可能有兩張牙齒圖（填寫頁＋預覽）。
const uid = `dental-${Math.random().toString(36).slice(2, 8)}`;

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
function emitChart(next) {
  emit('update:modelValue', { teeth: next.teeth, restNormal: next.restNormal });
}

function onToothActivate(code, x, y) {
  if (props.readonly) return;
  if (mode.value === 'brush') {
    emitChart(brushTooth(chart.value, code, brushState.value));
    return;
  }
  openMenuAt(x, y, code);
}

function render() {
  if (!svg.value) return;
  const root = d3.select(svg.value).selectAll('g.dental-root').data([null]).join('g').attr('class', 'dental-root');

  // 形狀記號用的 pattern：牙結石是點點、牙周病是斜線。
  const defs = root.selectAll('defs').data([null]).join('defs');
  defs.selectAll('pattern.dots').data([null]).join('pattern').attr('class', 'dots').attr('id', `${uid}-calculus`).attr('patternUnits', 'userSpaceOnUse').attr('width', 9).attr('height', 9)
    .selectAll('circle').data([null]).join('circle').attr('cx', 4.5).attr('cy', 4.5).attr('r', 2.2).style('fill', 'var(--dental-calculus)');
  defs.selectAll('pattern.hatch').data([null]).join('pattern').attr('class', 'hatch').attr('id', `${uid}-periodontal`).attr('patternUnits', 'userSpaceOnUse').attr('width', 8).attr('height', 8).attr('patternTransform', 'rotate(45)')
    .selectAll('rect').data([null]).join('rect').attr('width', 3).attr('height', 8).style('fill', 'var(--dental-periodontal)');

  root.selectAll('text.side').data([{ text: 'R', x: 258, fill: RIGHT_COLOR }, { text: 'L', x: 792, fill: LEFT_COLOR }]).join('text').attr('class', 'side').attr('x', (d) => d.x).attr('y', 676).attr('text-anchor', 'middle').style('fill', (d) => d.fill).attr('font-size', 54).attr('font-weight', 700).text((d) => d.text);
  // outline:none 用 d3 內聯樣式：這個 <g> 是 d3 動態建立的，Vue scoped CSS 套不到它。
  const group = root.selectAll('g.tooth').data(teeth, (d) => d.code).join('g').attr('class', 'tooth').attr('tabindex', props.readonly ? null : 0).attr('role', props.readonly ? null : 'button')
    .attr('aria-label', (d) => `牙位 ${d.code}${statusOf(d.code) ? `，${DENTAL_STATES.find((state) => state.value === statusOf(d.code))?.label}` : ''}`).style('outline', 'none')
    .on('click', (event, d) => { if (!event.target.closest?.('textarea')) onToothActivate(d.code, event.clientX, event.clientY); })
    .on('keydown', (event, d) => {
      if (props.readonly || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      onToothActivate(d.code, rect.left + rect.width / 2, rect.top + rect.height / 2);
    });
  group.selectAll('circle.hit').data((d) => [d]).join('circle').attr('class', 'hit').attr('cx', (d) => d.x).attr('cy', (d) => d.y).attr('r', (d) => Math.max(26, d.ry + 12)).attr('fill', 'transparent');
  const styleOf = (d) => STATE_STYLE[statusOf(d.code)] ?? null;
  group.selectAll('path.shape').data((d) => [d]).join('path').attr('class', 'shape').attr('d', toothPath).attr('transform', (d) => `rotate(${d.rot} ${d.x} ${d.y})`)
    .style('fill', (d) => styleOf(d)?.fill ?? DENTAL.normal)
    .style('fill-opacity', (d) => styleOf(d)?.fillOpacity ?? 1)
    .style('stroke', (d) => (d.code === selectedCode.value ? DENTAL.selected : styleOf(d)?.stroke ?? DENTAL.outline))
    .attr('stroke-width', (d) => (d.code === selectedCode.value ? 6 : styleOf(d) ? 4 : 3))
    .attr('stroke-dasharray', (d) => styleOf(d)?.dash ?? null);
  group.selectAll('path.pattern').data((d) => (styleOf(d)?.pattern ? [d] : [])).join('path').attr('class', 'pattern').attr('d', toothPath).attr('transform', (d) => `rotate(${d.rot} ${d.x} ${d.y})`)
    .attr('fill', (d) => `url(#${uid}-${styleOf(d).pattern})`).attr('stroke', 'none').attr('pointer-events', 'none');
  group.selectAll('g.cross').data((d) => (styleOf(d)?.cross ? [d] : [])).join('g').attr('class', 'cross').attr('pointer-events', 'none')
    .style('stroke', 'var(--dental-extracted)').attr('stroke-width', 4).attr('stroke-linecap', 'round')
    .selectAll('line').data((d) => {
      const r = Math.min(d.rx, d.ry) * 1.1;
      return [[d.x - r, d.y - r, d.x + r, d.y + r], [d.x + r, d.y - r, d.x - r, d.y + r]];
    }).join('line').attr('x1', (l) => l[0]).attr('y1', (l) => l[1]).attr('x2', (l) => l[2]).attr('y2', (l) => l[3]);
  group.selectAll('text.label').data((d) => [d]).join('text').attr('class', 'label').attr('x', (d) => d.lx).attr('y', (d) => d.ly).attr('text-anchor', 'middle').attr('font-size', 30).attr('font-weight', 700).style('fill', labelColor).text((d) => d.code);

  // 備註欄只給標了狀況、有備註、或正在選的牙；報告（readonly）只列有備註的。
  const hasNoteRow = (d) => (props.readonly ? Boolean(noteFor(d.code).trim()) : Boolean(statusOf(d.code) || noteFor(d.code).trim() || d.code === selectedCode.value));
  group.selectAll('line.leader').data((d) => (hasNoteRow(d) ? [d] : [])).join('line').attr('class', 'leader')
    .attr('x1', (d) => d.x).attr('y1', (d) => d.y).attr('x2', (d) => d.lineEndX).attr('y2', (d) => d.boxY)
    .style('stroke', (d) => (d.code === selectedCode.value ? DENTAL.selected : DENTAL.guide)).attr('stroke-width', (d) => (d.code === selectedCode.value ? 2.5 : 1.5));
  group.selectAll('text.boxLabel').data((d) => (hasNoteRow(d) ? [d] : [])).join('text').attr('class', 'boxLabel')
    .attr('x', (d) => d.labelX).attr('y', (d) => d.boxY + 7).attr('text-anchor', (d) => d.labelAnchor)
    .attr('font-size', 20).attr('font-weight', 700).style('fill', labelColor).text((d) => d.code);
  // 備註輸入框：foreignObject 承載真正的 <textarea>，join 對同一 code 重用節點以保留游標與焦點。
  const fo = group.selectAll('foreignObject.noteBox').data((d) => (hasNoteRow(d) ? [d] : [])).join('foreignObject').attr('class', 'noteBox')
    .attr('x', (d) => d.boxCx - BOX_W / 2).attr('y', (d) => d.boxY - BOX_H / 2).attr('width', BOX_W).attr('height', BOX_H);
  fo.each(function dentalNoteBox(d) {
    let textarea = this.querySelector('textarea');
    if (!textarea) {
      textarea = document.createElement('textarea');
      Object.assign(textarea.style, {
        width: '100%', height: '100%', boxSizing: 'border-box', resize: 'none', outline: 'none',
        border: `1.5px solid ${DENTAL.fieldBorder}`, borderLeftWidth: '5px', borderRadius: '6px', padding: '4px 6px',
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
    textarea.style.borderLeftColor = STATE_STYLE[statusOf(d.code)]?.stroke ?? DENTAL.fieldBorder;
    if (document.activeElement !== textarea) {
      const idle = d.code === selectedCode.value ? DENTAL.selected : DENTAL.fieldBorder;
      textarea.style.borderTopColor = textarea.style.borderRightColor = textarea.style.borderBottomColor = idle;
    }
    textarea.style.boxShadow = d.code === selectedCode.value ? '0 0 0 3px var(--dental-selected-ring)' : 'none';
    if (document.activeElement !== textarea) { const v = noteFor(d.code); if (textarea.value !== v) textarea.value = v; }
  });
}

function setState(status) {
  if (!selectedCode.value) return;
  const current = chart.value.teeth[selectedCode.value] ?? {};
  emitChart({ ...chart.value, teeth: { ...chart.value.teeth, [selectedCode.value]: { ...current, status, note: current.note ?? '' } } });
}
function setNoteFor(code, note) {
  emitChart({ ...chart.value, teeth: { ...chart.value.teeth, [code]: { ...(chart.value.teeth[code] ?? { status: '' }), note } } });
}
function clearSelected() {
  if (!selectedCode.value) return;
  const teeth = { ...chart.value.teeth };
  delete teeth[selectedCode.value];
  emitChart({ ...chart.value, teeth });
}
function toggleRestNormal() {
  emitChart({ ...chart.value, restNormal: !chart.value.restNormal });
}
function openMenuAt(x, y, code) { selectedCode.value = code; menuPos.value = { x, y }; nextTick(clampMenuToViewport); }
// 靠近畫面右／下邊緣的牙位點了以後選單可能被裁到視窗外，量出實際尺寸後只在超出時往回推。
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
function onDocumentClick(event) {
  if (!menuPos.value) return;
  const target = event.target;
  if (menuRef.value?.contains(target)) return;
  if (target.closest?.('.tooth')) return;
  closeMenu();
}
function onDocumentKeydown(event) { if (event.key === 'Escape' && menuPos.value) closeMenu(); }
watch(mode, closeMenu);
watch([chart, selectedCode, () => props.readonly], () => nextTick(render), { deep: true, immediate: true });
onMounted(() => { document.addEventListener('click', onDocumentClick); document.addEventListener('keydown', onDocumentKeydown); });
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick);
  document.removeEventListener('keydown', onDocumentKeydown);
  d3.select(svg.value).selectAll('*').remove();
});
</script>

<template>
  <div v-bind="$attrs" class="rounded-xl border p-3" :class="readonly ? 'border-report-border text-report-foreground' : 'border-border text-foreground'">
    <!-- 工具列：點選／刷子、刷子要套的狀況、其餘全部正常。 -->
    <div v-if="!readonly" class="mb-3 flex flex-wrap items-center gap-2">
      <div class="segment-track inline-flex gap-0.5" role="radiogroup" aria-label="牙齒圖操作方式">
        <button type="button" role="radio" :aria-checked="mode === 'select'" class="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm" :class="mode === 'select' ? 'segment-active font-semibold' : 'font-medium text-muted-foreground'" @click="mode = 'select'"><MousePointer2 class="size-4" stroke-width="1.75" />點選</button>
        <button type="button" role="radio" :aria-checked="mode === 'brush'" class="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm" :class="mode === 'brush' ? 'segment-active font-semibold' : 'font-medium text-muted-foreground'" @click="mode = 'brush'"><Brush class="size-4" stroke-width="1.75" />刷子</button>
      </div>
      <div v-if="mode === 'brush'" class="flex flex-wrap gap-1" role="radiogroup" aria-label="刷子要標的狀況">
        <button
          v-for="state in DENTAL_STATES"
          :key="state.value"
          type="button"
          role="radio"
          :aria-checked="brushState === state.value"
          class="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm"
          :class="brushState === state.value ? 'bg-accent font-semibold text-accent-foreground' : 'bg-sunken text-muted-foreground hover:bg-hover'"
          @click="brushState = state.value"
        ><span class="dental-swatch" :data-state="state.value" aria-hidden="true"></span>{{ state.label }}</button>
      </div>
      <button
        type="button"
        class="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold"
        :class="chart.restNormal ? 'bg-success-surface text-success' : 'bg-sunken text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)] hover:bg-hover'"
        :aria-pressed="chart.restNormal"
        @click="toggleRestNormal"
      ><Check class="size-4" stroke-width="2" />其餘全部正常</button>
    </div>
    <p v-if="!readonly && mode === 'brush'" class="mb-2 text-sm text-muted-foreground">點牙齒就標上「{{ DENTAL_STATES.find((state) => state.value === brushState)?.label }}」，再點一次拿掉。</p>

    <svg ref="svg" :viewBox="VIEW_BOX" class="mx-auto block w-full" :class="readonly ? '' : 'cursor-pointer'" />

    <!-- 圖例：顏色＋形狀記號。 -->
    <div class="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm" :class="readonly ? 'text-report-muted' : 'text-muted-foreground'">
      <span v-for="state in DENTAL_STATES" :key="state.value" class="inline-flex items-center gap-1.5"><span class="dental-swatch" :data-state="state.value" aria-hidden="true"></span>{{ state.label }}</span>
    </div>

    <!-- 文字清單：報告上也列出，牙位號碼比圖好抄。 -->
    <div v-if="summary.groups.length || summary.notes.length || summary.restNormal" class="mt-3 space-y-1.5 border-t pt-3" :class="readonly ? 'border-report-border' : 'border-border'">
      <p v-for="group in summary.groups" :key="group.status" class="flex flex-wrap items-baseline gap-x-2">
        <span class="inline-flex items-center gap-1.5 font-semibold"><span class="dental-swatch" :data-state="group.status" aria-hidden="true"></span>{{ group.label }}</span>
        <span class="num">{{ group.codes.join('、') }}</span>
      </p>
      <p v-for="note in summary.notes" :key="note.code" class="flex gap-2">
        <span class="num shrink-0 font-semibold">{{ note.code }}</span>
        <span class="min-w-0 wrap-anywhere">{{ note.label ? `${note.label}：` : '' }}{{ note.note }}</span>
      </p>
      <p v-if="summary.restNormal" class="font-semibold" :class="readonly ? 'text-report-success' : 'text-success'">其餘牙齒正常</p>
    </div>
  </div>
  <Teleport to="body">
    <div
      v-if="!readonly && menuPos"
      ref="menuRef"
      class="fixed z-50 w-44 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-menu"
      :style="{ left: `${menuPos.x + 8}px`, top: `${menuPos.y + 8}px` }"
    >
      <p class="spec-label px-3 pt-2 pb-1">牙位 <span class="num">{{ selectedCode }}</span></p>
      <button
        v-for="state in DENTAL_STATES"
        :key="state.value"
        type="button"
        class="flex min-h-10 w-full items-center gap-2.5 rounded-md px-3 text-left"
        :class="selected?.status === state.value ? 'bg-accent font-semibold text-accent-foreground' : 'hover:bg-hover'"
        @click="pickState(state.value)"
      ><span class="dental-swatch" :data-state="state.value" aria-hidden="true"></span>{{ state.label }}</button>
      <button v-if="selected" type="button" class="mt-1 flex min-h-10 w-full items-center rounded-md border-t border-border px-3 text-left text-destructive hover:bg-destructive-surface" @click="clearAndClose">清除這顆</button>
    </div>
  </Teleport>
</template>

<style scoped>
.tooth:not([tabindex]) { cursor: default; }
.tooth[tabindex] { cursor: pointer; outline: none; }
.tooth[tabindex]:focus path.shape { stroke: var(--dental-selected); stroke-width: 6; }

/* 圖例小方塊：跟圖上同一套顏色與形狀記號。 */
.dental-swatch { display: inline-block; width: 14px; height: 14px; flex-shrink: 0; border-radius: 4px; border: 1.5px solid var(--dental-outline); background: var(--dental-normal); }
.dental-swatch[data-state='missing'] { background: transparent; border-style: dashed; border-color: var(--dental-missing); }
.dental-swatch[data-state='calculus'] { border-color: var(--dental-calculus); background: radial-gradient(circle, var(--dental-calculus) 1.4px, transparent 1.6px) 0 0 / 5px 5px, var(--dental-calculus-surface); }
.dental-swatch[data-state='periodontal'] { border-color: var(--dental-periodontal); background: repeating-linear-gradient(45deg, var(--dental-periodontal) 0 1.5px, var(--dental-periodontal-surface) 1.5px 4px); }
.dental-swatch[data-state='extracted'] { border-color: var(--dental-extracted); background: linear-gradient(45deg, transparent 43%, var(--dental-extracted) 43% 57%, transparent 57%), linear-gradient(-45deg, transparent 43%, var(--dental-extracted) 43% 57%, transparent 57%), var(--dental-extracted-surface); }
.dental-swatch[data-state='other'] { border-color: var(--dental-other); background: var(--dental-other); }
</style>
