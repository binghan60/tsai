<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, useAttrs } from 'vue';
import RichTextEditor from './RichTextEditor.vue';
import { useDrugCabinet } from '../composables/useDrugCabinet';
import { drugQueryAt, rankDrugs } from '../lib/drugSuggest';

// 藥單用的文字框：跟 RichTextEditor 一樣（v-model、屬性、插槽照傳），另外邊打邊跳藥櫃建議。
// 比對規則在 lib/drugSuggest.js。只在使用者打字時才開清單（點來點去移動游標不開）；
// 上下鍵選、Enter／Tab 插入、Esc 關掉。插入或按 Esc 之後，同一段字不再跳，接著打字才會再比對。
defineOptions({ inheritAttrs: false });
const model = defineModel({ type: String, default: '' });
const attrs = useAttrs();
const emit = defineEmits(['keydown']);

const { drugs, loadDrugs, markUsed } = useDrugCabinet();
onMounted(() => loadDrugs().catch(() => {}));

const root = ref(null);
const list = ref(null);
const editor = ref(null);
const suggestion = ref(null); // { start, query, items }
const highlighted = ref(0);
const position = ref({ top: 0, left: 0, width: 0 });
const listId = `drug-suggest-${Math.random().toString(36).slice(2, 9)}`;
// 插入或按 Esc 當下游標前的文字；文字沒變之前不再跳清單。
let suppressedText = null;
let typing = false;

function close() {
  suggestion.value = null;
}

// 停用的編輯器不會有輸入，這裡只是保險；attrs 不是響應式的，每次直接讀。
function evaluate() {
  const instance = editor.value;
  if (!instance || attrs.disabled === true || instance.isComposing()) return;
  const cursor = instance.textBeforeCursor();
  if (suppressedText !== null && cursor.text === suppressedText) return close();
  suppressedText = null;
  const match = drugQueryAt(cursor.text);
  const items = match ? rankDrugs(drugs.value, match.query) : [];
  if (!items.length) return close();
  const sameQuery = suggestion.value?.start === match.start && suggestion.value?.query === match.query;
  suggestion.value = { ...match, items };
  if (!sameQuery) highlighted.value = 0;
  place();
}

// 清單貼在游標那一行底下（下面放不下就往上開），左右不超出文字框。
// 用 fixed 定位：病歷日誌的卡片是 overflow-hidden，absolute 的話藥單列靠近卡片底部時清單會被裁掉。
// 外層有 transform（對話框）時 fixed 會以它為準，所以先放上去、量實際位置，再把差距補回來。
const GAP = 4;
async function place() {
  const coords = editor.value?.caretCoords();
  const box = root.value?.getBoundingClientRect();
  if (!coords || !box) return;
  const width = Math.min(384, box.width);
  const left = Math.max(box.left, Math.min(coords.left, box.right - width));
  position.value = { top: coords.bottom + GAP, left, width };
  await nextTick();
  const rect = list.value?.getBoundingClientRect();
  if (!rect) return;
  const below = coords.bottom + GAP;
  const top = below + rect.height > window.innerHeight && coords.top - GAP - rect.height > 0 ? coords.top - GAP - rect.height : below;
  position.value = { top: position.value.top + (top - rect.top), left: position.value.left + (left - rect.left), width };
}
// 清單開著時捲動頁面，跟著游標走。
function onScroll() {
  if (suggestion.value) place();
}
onMounted(() => window.addEventListener('scroll', onScroll, true));
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll, true));

function onInput(value) {
  model.value = value;
  typing = true;
}
// 打字時編輯器先發 update:modelValue 再發 cursor；只移動游標時只有 cursor，清單開著才重新比對（多半是關掉）。
function onCursor() {
  const typed = typing;
  typing = false;
  if (typed || suggestion.value) evaluate();
}

function select(item) {
  const instance = editor.value;
  const current = suggestion.value;
  if (!instance || !current || !item) return;
  const before = instance.textBeforeCursor().text;
  suppressedText = before.slice(0, current.start) + item.name;
  close();
  instance.replaceBeforeCursor(current.start, item.name);
  markUsed(item);
}

function onKeydown(event) {
  if (suggestion.value && !event.isComposing && event.keyCode !== 229) {
    const { items } = suggestion.value;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      highlighted.value = (highlighted.value + step + items.length) % items.length;
      return;
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
      event.preventDefault();
      select(items[highlighted.value]);
      return;
    }
    if (event.key === 'Escape') {
      // 只關清單，不要連外層的對話框一起關掉。
      event.preventDefault();
      event.stopPropagation();
      suppressedText = editor.value?.textBeforeCursor().text ?? null;
      close();
      return;
    }
  }
  emit('keydown', event);
}

function parts(item) {
  const { name, matchStart, matchLength } = item;
  return [name.slice(0, matchStart), name.slice(matchStart, matchStart + matchLength), name.slice(matchStart + matchLength)];
}

defineExpose({
  focus: () => editor.value?.focus(),
  insertRichText: (...args) => editor.value?.insertRichText(...args),
  textBeforeCursor: () => editor.value?.textBeforeCursor(),
  replaceBeforeCursor: (...args) => editor.value?.replaceBeforeCursor(...args),
});
</script>

<template>
  <div ref="root" class="relative min-w-0">
    <RichTextEditor
      ref="editor"
      v-bind="attrs"
      :model-value="model"
      @update:model-value="onInput"
      @cursor="onCursor"
      @composed="evaluate"
      @keydown="onKeydown"
      @blur="close"
    >
      <template v-for="(_, name) in $slots" #[name]="slotProps"><slot :name="name" v-bind="slotProps ?? {}" /></template>
    </RichTextEditor>
    <!-- 滑鼠真的移動才換選取：清單剛好開在靜止的滑鼠底下時，不能把 Enter 要插的那筆換掉。 -->
    <ul
      v-if="suggestion"
      :id="listId"
      ref="list"
      class="fixed z-50 max-h-64 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg"
      :style="{ top: `${position.top}px`, left: `${position.left}px`, width: `${position.width}px` }"
      role="listbox"
      aria-label="藥櫃"
    >
      <li
        v-for="(item, index) in suggestion.items"
        :id="`${listId}-${index}`"
        :key="item._id"
        role="option"
        :aria-selected="index === highlighted"
        class="cursor-pointer rounded-lg px-3 py-2 text-sm wrap-break-word"
        :class="index === highlighted ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-hover'"
        @mousedown.prevent="select(item)"
        @mousemove="highlighted = index"
      >{{ parts(item)[0] }}<span class="font-semibold text-primary">{{ parts(item)[1] }}</span>{{ parts(item)[2] }}</li>
    </ul>
  </div>
</template>
