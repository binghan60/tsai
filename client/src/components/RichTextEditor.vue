<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import { Extension, Mark } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import { Placeholder, UndoRedo } from '@tiptap/extensions';
import { Bold as BoldIcon, ChevronDown, RemoveFormatting } from '@lucide/vue';
import { RICH_TEXT_COLORS } from '../../../shared/richText.js';
import { docToRichText, richTextToDoc } from '../lib/richTextDoc';
import { cn } from '@/lib/utils';
import { BOLD_CLASS, TINT_OPTIONS, tintClass } from '../lib/richTextStyle';

// 可以上色、加粗的文字輸入框（本次簡易紀錄、藥單、待辦）。v-model 是 shared/richText.js 的
// 格式標記字串，不是 HTML：載入時標記 → Tiptap 文件，編輯時 Tiptap 文件 → 標記。
// 只掛粗體與自訂的 tint（顏色）兩種 mark，不用 StarterKit——沒有斜體、標題、清單，
// 從 Word 或網頁貼進來的其他格式會被 ProseMirror 自動丟掉，顏色也只認自己的 data-tint。
const props = defineProps({
  modelValue: { type: String, default: '' },
  // 放在實際可編輯的元素上，<Label for>、瀏覽器測試的選擇器都沿用原本 textarea 的 id。
  id: { type: String, default: undefined },
  ariaLabel: { type: String, default: undefined },
  placeholder: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  minRows: { type: Number, default: 3 },
  // 算的是純文字字數，格式標記不佔額度。
  maxlength: { type: [Number, String], default: undefined },
  // 單行（待辦）：Enter 送出、不換行，貼上的換行併成空白。
  singleLine: { type: Boolean, default: false },
  class: { type: [Boolean, null, String, Object, Array], default: undefined },
});
const emit = defineEmits(['update:modelValue', 'submit', 'keydown', 'cursor', 'blur', 'composed']);

// 格式按鈕（粗體、顏色、清除格式）只在正在輸入時出現：常駐的話一個畫面好幾組，是最大的雜訊來源。
// 多行時放在框內右下角，框底一律預留那一塊高度——聚焦時才「長出」工具列會把下面的欄位往下推，
// 點下一格的瞬間整頁跳一下、游標落錯地方。單行時排在文字右邊。
// 按鈕都 mousedown.prevent，點下去焦點留在編輯器裡；色盤也畫在這個元件裡、不傳送到 body，同一個道理。
const root = ref(null);
const focused = ref(false);
const colorsOpen = ref(false);
function onFocusIn() {
  focused.value = true;
}
function onFocusOut(event) {
  if (root.value?.contains(event.relatedTarget)) return;
  focused.value = false;
  colorsOpen.value = false;
}
// Esc 先收色盤；色盤沒開時照常往外傳（關對話框、收起編輯）。
function closeColors(event) {
  if (!colorsOpen.value) return;
  event.stopPropagation();
  colorsOpen.value = false;
}
const showTools = computed(() => !props.disabled && focused.value);
// 「顏色」鈕底下那條線＝游標所在文字的顏色，沒有顏色就是一般文字色。
const activeTint = computed(() => TINT_OPTIONS.find((option) => editor.value?.isActive('tint', { color: option.color })) ?? null);

const Tint = Mark.create({
  name: 'tint',
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-tint'),
        renderHTML: (attributes) => ({ 'data-tint': attributes.color, class: tintClass(attributes.color) }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-tint]', getAttrs: (element) => (RICH_TEXT_COLORS[element.getAttribute('data-tint')] ? null : false) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', HTMLAttributes, 0];
  },
});

// Tiptap 的粗體預設會把 **x**、__x__ 自動變粗，打 __init__ 這種字會被誤判，關掉；用按鈕或 Ctrl+B。
// Ctrl+B 跟按鈕走同一個 toggleBold，反白後按下去一樣會取消反白（見 applyFormatting）。
const PlainBold = Bold.extend({
  addInputRules: () => [],
  addPasteRules: () => [],
  addKeyboardShortcuts: () => ({
    'Mod-b': () => { toggleBold(); return true; },
    'Mod-B': () => { toggleBold(); return true; },
  }),
}).configure({ HTMLAttributes: { class: BOLD_CLASS } });

// 字數上限：新文件的純文字超過上限、而且比原本更長時，整筆輸入不接受。
const MaxLength = Extension.create({
  name: 'maxLength',
  addProseMirrorPlugins() {
    return [new Plugin({
      filterTransaction: (tr, state) => {
        const limit = Number(props.maxlength);
        if (!tr.docChanged || !limit) return true;
        const textOf = (doc) => doc.textBetween(0, doc.content.size, '\n');
        const next = textOf(tr.doc).length;
        return next <= limit || next <= textOf(state.doc).length;
      },
    })];
  },
});

const flatten = (value) => (props.singleLine ? String(value ?? '').replace(/\s*\n\s*/g, ' ') : value);

let lastEmitted = props.modelValue;
const editor = useEditor({
  content: richTextToDoc(flatten(props.modelValue)),
  editable: !props.disabled,
  extensions: [
    props.singleLine ? Document.extend({ content: 'paragraph' }) : Document,
    Paragraph,
    Text,
    PlainBold,
    Tint,
    UndoRedo,
    MaxLength,
    Placeholder.configure({ placeholder: () => props.placeholder }),
  ],
  editorProps: {
    attributes: {
      ...(props.id ? { id: props.id } : {}),
      ...(props.ariaLabel ? { 'aria-label': props.ariaLabel } : {}),
      role: 'textbox',
      'aria-multiline': props.singleLine ? 'false' : 'true',
      class: 'rich-text-editor__content w-full px-3 py-2 text-sm text-foreground outline-none whitespace-pre-wrap wrap-break-word',
      style: props.singleLine ? 'min-height: 2.75rem' : `min-height: calc(${props.minRows} * 1.65em + 1rem)`,
    },
    // 呼叫端（待辦的貓咪候選清單）先處理；它吃掉的按鍵會 preventDefault。
    handleKeyDown: (view, event) => {
      emit('keydown', event);
      if (event.defaultPrevented) return true;
      if (props.singleLine && event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        emit('submit');
        return true;
      }
      return false;
    },
    transformPastedText: (text) => (props.singleLine ? text.replace(/\s*\n\s*/g, ' ') : text),
  },
  onUpdate: ({ editor: instance }) => {
    const next = docToRichText(instance.getJSON());
    lastEmitted = next;
    emit('update:modelValue', next);
    emit('cursor');
  },
  onSelectionUpdate: () => emit('cursor'),
  onBlur: () => emit('blur'),
});

// 外部改值（自動存檔合併、另一台電腦同步、送出後清空）才重設內容；自己剛送出去的值不重設，
// 不然每打一個字游標都會被跳回開頭。
// 自動存檔回來的值常常只是被伺服器修掉頭尾空白，重設內容時把游標留在原處（超出就停在最後）。
watch(() => props.modelValue, (value) => {
  if (!editor.value || value === lastEmitted) return;
  lastEmitted = value;
  const { from, to } = editor.value.state.selection;
  const focused = editor.value.isFocused;
  editor.value.commands.setContent(richTextToDoc(flatten(value)), { emitUpdate: false });
  if (focused) {
    const end = editor.value.state.doc.content.size - 1;
    editor.value.commands.setTextSelection({ from: Math.min(from, end), to: Math.min(to, end) });
  }
});
watch(() => props.disabled, (disabled) => editor.value?.setEditable(!disabled));
onBeforeUnmount(() => editor.value?.destroy());

// 操作方式是「反白 → 按粗體／顏色 → 套用並自動取消反白」：套完把游標收到那段文字後面，
// 讓人一眼看到效果，不必自己再點一下取消反白。游標後面接著打的字刻意不延續格式
// （清掉 stored marks）——標的是那一段重點，不是之後打的每個字。
// 沒有反白時按下去，則是切換「接下來要打的字」的格式。
function applyFormatting(apply) {
  const instance = editor.value;
  if (!instance) return;
  const { empty, to } = instance.state.selection;
  let chain = apply(instance.chain().focus());
  if (!empty) {
    chain = chain.setTextSelection(to).command(({ tr }) => {
      tr.setStoredMarks([]);
      return true;
    });
  }
  chain.run();
}
function toggleBold() {
  applyFormatting((chain) => chain.toggleBold());
}
function toggleTint(color) {
  const active = editor.value?.isActive('tint', { color });
  applyFormatting((chain) => (active ? chain.unsetMark('tint') : chain.setMark('tint', { color })));
  colorsOpen.value = false;
}
function clearFormatting() {
  applyFormatting((chain) => chain.unsetAllMarks().command(({ tr }) => {
    tr.setStoredMarks([]);
    return true;
  }));
}

// 把帶格式標記的文字插進游標處（文字模板用，粗體與顏色照樣帶進來）；mode 為 'replace' 或目前是空的就整段取代。
function insertRichText(markup, mode = 'cursor') {
  if (!editor.value) return;
  const doc = richTextToDoc(flatten(String(markup ?? '')));
  if (mode === 'replace' || editor.value.isEmpty) {
    editor.value.chain().focus().setContent(doc).run();
    return;
  }
  // 只有一行就插在行內，多行才一行一段。
  const content = doc.content.length === 1 ? (doc.content[0].content ?? []) : doc.content;
  if (content.length) editor.value.chain().focus().insertContent(content).run();
}

// 待辦的 # 貓咪標記：讀游標前這一行的純文字，選好貓咪後把 #關鍵字 換成 #名字。
function textBeforeCursor() {
  const selection = editor.value?.state.selection;
  if (!selection) return { text: '', caret: 0 };
  const { $from } = selection;
  return { text: $from.parent.textBetween(0, $from.parentOffset), caret: $from.parentOffset };
}
function replaceBeforeCursor(startOffset, text) {
  if (!editor.value) return;
  const { $from, from } = editor.value.state.selection;
  const start = $from.start() + startOffset;
  editor.value.chain().focus().insertContentAt({ from: start, to: from }, [{ type: 'text', text }]).run();
}

// 藥櫃視窗選的藥品：插成獨立的一行。游標所在這一行是空的就填在這行；已經有字就接在這一行後面另起一行
// （不把一行藥切成兩半），新的一行不延續上一行的粗體或顏色。沒聚焦時接在最後面。
function insertLine(text) {
  const instance = editor.value;
  if (!instance || !text) return;
  if (!instance.isFocused) instance.commands.focus('end');
  const { $from } = instance.state.selection;
  let chain = instance.chain().focus();
  if ($from.parent.textContent) chain = chain.setTextSelection($from.end()).splitBlock({ keepMarks: false });
  chain.insertContent([{ type: 'text', text }]).command(({ tr }) => {
    tr.setStoredMarks([]);
    return true;
  }).run();
}

// 藥櫃建議：注音組字中不比對；建議清單貼著游標那一行往下開。
function isComposing() {
  return Boolean(editor.value?.view.composing);
}
function caretCoords() {
  const instance = editor.value;
  if (!instance) return null;
  try {
    return instance.view.coordsAtPos(instance.state.selection.from);
  } catch {
    return null;
  }
}
// 組字結束時 ProseMirror 稍後才把字寫進文件，等它寫完再通知（選完字才比對藥櫃）。
function onCompositionEnd() {
  setTimeout(() => emit('composed'), 30);
}

defineExpose({
  focus: () => editor.value?.commands.focus(),
  insertRichText,
  textBeforeCursor,
  replaceBeforeCursor,
  isComposing,
  caretCoords,
  insertLine,
});
</script>

<template>
  <div
    :class="cn(
      'rich-text-editor min-w-0 rounded-lg border border-input bg-field transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
      disabled ? 'cursor-not-allowed opacity-50' : '',
      singleLine ? 'rich-text-editor--single flex items-center' : 'relative',
      props.class,
    )"
    ref="root"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
    @keydown.esc="closeColors"
    @compositionend="onCompositionEnd"
  >
    <EditorContent :editor="editor" class="min-w-0 flex-1" :class="singleLine ? '' : 'rich-text-editor__body'" />
    <div
      v-if="editor && (showTools || $slots['toolbar-end'])"
      class="flex items-center gap-1"
      :class="singleLine ? 'relative shrink-0 pr-1.5' : 'absolute right-1.5 bottom-1.5'"
      role="toolbar"
      aria-label="文字格式"
    >
      <template v-if="showTools">
        <button
          type="button"
          class="rich-text-editor__tool"
          :class="editor.isActive('bold') ? 'bg-accent text-accent-foreground' : 'bg-muted/60 text-foreground hover:bg-muted'"
          :aria-pressed="editor.isActive('bold')"
          aria-label="粗體（Ctrl+B）"
          v-tip="'粗體（Ctrl+B）'"
          @mousedown.prevent
          @click="toggleBold"
        >
          <BoldIcon class="h-4 w-4" stroke-width="2.25" />
        </button>
        <button
          type="button"
          class="rich-text-editor__tool rich-text-editor__tool--wide"
          :class="colorsOpen || activeTint ? 'bg-accent text-accent-foreground' : 'bg-muted/60 text-foreground hover:bg-muted'"
          :aria-expanded="colorsOpen"
          aria-haspopup="true"
          aria-label="文字顏色"
          v-tip="'文字顏色'"
          @mousedown.prevent
          @click="colorsOpen = !colorsOpen"
        >
          <span class="flex flex-col items-center leading-none" aria-hidden="true">
            <span class="text-sm font-bold">A</span>
            <span class="mt-0.5 h-1 w-3.5 rounded-full" :class="activeTint?.swatchClass ?? 'bg-foreground'" />
          </span>
          <ChevronDown class="size-3.5" stroke-width="2" />
        </button>
        <button
          type="button"
          class="rich-text-editor__tool bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="清除格式"
          v-tip="'清除格式'"
          @mousedown.prevent
          @click="clearFormatting"
        >
          <RemoveFormatting class="h-4 w-4" stroke-width="1.75" />
        </button>
        <!-- 色盤：六色一排。多行時往上開（工具列在框底），單行時往下開。 -->
        <div
          v-if="colorsOpen"
          class="absolute right-0 z-30 flex gap-1 rounded-xl border border-border bg-popover p-1.5 shadow-lg"
          :class="singleLine ? 'top-full mt-1.5' : 'bottom-full mb-1.5'"
          role="group"
          aria-label="選擇文字顏色"
        >
          <button
            v-for="option in TINT_OPTIONS"
            :key="option.color"
            type="button"
            class="rich-text-editor__tool"
            :class="editor.isActive('tint', { color: option.color }) ? 'bg-accent ring-2 ring-ring/60' : 'bg-muted/60 hover:bg-muted'"
            :aria-pressed="editor.isActive('tint', { color: option.color })"
            :aria-label="option.label"
            v-tip="option.label"
            @mousedown.prevent
            @click="toggleTint(option.color)"
          >
            <span class="h-3.5 w-3.5 rounded-full" :class="option.swatchClass" aria-hidden="true" />
          </button>
        </div>
      </template>
      <slot name="toolbar-end" />
    </div>
  </div>
</template>

<style scoped>
.rich-text-editor__tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 0.5rem;
  transition: background-color 150ms, color 150ms;
}
.rich-text-editor__tool--wide {
  width: auto;
  gap: 0.125rem;
  padding-inline: 0.375rem;
}
/* 多行：框底固定預留工具列的高度，聚焦時工具列出現不會把下面的欄位往下推。 */
.rich-text-editor__body :deep(.rich-text-editor__content) {
  padding-bottom: 2.75rem;
}
.rich-text-editor__tool:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 1px;
}
.rich-text-editor__tool:disabled {
  cursor: not-allowed;
}
.rich-text-editor :deep(.rich-text-editor__content p) {
  margin: 0;
}
.rich-text-editor :deep(.rich-text-editor__content p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  color: var(--muted-foreground);
  pointer-events: none;
}
/* 單行：提示文字放不下就用「…」截斷，不折行壓到邊框。 */
.rich-text-editor--single :deep(.rich-text-editor__content p.is-editor-empty:first-child) {
  position: relative;
}
.rich-text-editor--single :deep(.rich-text-editor__content p.is-editor-empty:first-child::before) {
  position: absolute;
  inset-inline: 0;
  top: 0;
  float: none;
  height: auto;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
