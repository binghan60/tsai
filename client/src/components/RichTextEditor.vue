<script setup>
import { onBeforeUnmount, watch } from 'vue';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import { Extension, Mark } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import { Placeholder, UndoRedo } from '@tiptap/extensions';
import { Bold as BoldIcon, RemoveFormatting } from '@lucide/vue';
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
const emit = defineEmits(['update:modelValue', 'submit', 'keydown', 'cursor', 'blur']);

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
const PlainBold = Bold.extend({
  addInputRules: () => [],
  addPasteRules: () => [],
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
    // 呼叫端（待辦的寵物候選清單）先處理；它吃掉的按鍵會 preventDefault。
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

function toggleBold() {
  editor.value?.chain().focus().toggleBold().run();
}
function toggleTint(color) {
  const chain = editor.value?.chain().focus();
  if (!chain) return;
  if (editor.value.isActive('tint', { color })) chain.unsetMark('tint').run();
  else chain.setMark('tint', { color }).run();
}
function clearFormatting() {
  editor.value?.chain().focus().unsetAllMarks().run();
}

// 把純文字插進游標處（文字模板用）；mode 為 'replace' 或目前是空的就整段取代。
function insertText(text, mode = 'cursor') {
  if (!editor.value) return;
  const plain = String(text ?? '');
  if (mode === 'replace' || editor.value.isEmpty) {
    editor.value.chain().focus().setContent(richTextToDoc(flatten(plain.replace(/[\\*[]/g, (char) => `\\${char}`)))).run();
    return;
  }
  const lines = flatten(plain).split('\n');
  const content = lines.length === 1
    ? (lines[0] ? [{ type: 'text', text: lines[0] }] : [])
    : lines.map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' }));
  if (content.length) editor.value.chain().focus().insertContent(content).run();
}

// 待辦的 # 寵物標記：讀游標前這一行的純文字，選好寵物後把 #關鍵字 換成 #名字。
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

defineExpose({
  focus: () => editor.value?.commands.focus(),
  insertText,
  textBeforeCursor,
  replaceBeforeCursor,
});
</script>

<template>
  <div
    :class="cn(
      'rich-text-editor min-w-0 rounded-lg border border-input bg-field transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
      disabled ? 'cursor-not-allowed opacity-50' : '',
      singleLine ? 'flex items-center' : '',
      props.class,
    )"
  >
    <div
      v-if="editor"
      class="flex flex-wrap items-center gap-1"
      :class="singleLine ? 'order-2 shrink-0 pr-1.5' : 'border-b border-border/70 px-1.5 py-1'"
      role="toolbar"
      aria-label="文字格式"
    >
      <button
        type="button"
        class="rich-text-editor__tool"
        :class="editor.isActive('bold') ? 'bg-accent text-accent-foreground' : 'bg-muted/60 text-foreground hover:bg-muted'"
        :disabled="disabled"
        :aria-pressed="editor.isActive('bold')"
        aria-label="粗體（Ctrl+B）"
        title="粗體（Ctrl+B）"
        @mousedown.prevent
        @click="toggleBold"
      >
        <BoldIcon class="h-4 w-4" stroke-width="2.25" />
      </button>
      <button
        v-for="option in TINT_OPTIONS"
        :key="option.color"
        type="button"
        class="rich-text-editor__tool"
        :class="editor.isActive('tint', { color: option.color }) ? 'bg-accent ring-2 ring-ring/60' : 'bg-muted/60 hover:bg-muted'"
        :disabled="disabled"
        :aria-pressed="editor.isActive('tint', { color: option.color })"
        :aria-label="option.label"
        :title="option.label"
        @mousedown.prevent
        @click="toggleTint(option.color)"
      >
        <span class="h-3.5 w-3.5 rounded-full" :class="option.swatchClass" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="rich-text-editor__tool bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
        :disabled="disabled"
        aria-label="清除格式"
        title="清除格式"
        @mousedown.prevent
        @click="clearFormatting"
      >
        <RemoveFormatting class="h-4 w-4" stroke-width="1.75" />
      </button>
      <div v-if="$slots['toolbar-end']" class="ml-auto flex items-center gap-1"><slot name="toolbar-end" /></div>
    </div>
    <EditorContent :editor="editor" class="min-w-0 flex-1" />
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
</style>
