<script setup>
import { FileText } from '@lucide/vue';
import { useRecordForm } from './context';
import { useTextTemplates } from '../../composables/useTextTemplates';

const props = defineProps({
  itemKey: { type: String, required: true },
  modelValue: { type: [String, null], default: '' },
  label: { type: String, default: '' },
  inputId: { type: String, default: '' },
  centered: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

const { preview } = useRecordForm();
const { openPicker } = useTextTemplates();
let selection = null;

function captureSelection() {
  const input = document.getElementById(props.inputId || `record-${props.itemKey}`);
  selection = input && Number.isInteger(input.selectionStart)
    ? { start: input.selectionStart, end: input.selectionEnd }
    : null;
}

function applyTemplate(template, mode) {
  const base = String(props.modelValue ?? '');
  const content = template.content;
  if (mode === 'replace' || !base) {
    emit('update:modelValue', content);
    return;
  }
  const start = Math.min(selection?.start ?? base.length, base.length);
  const end = Math.min(selection?.end ?? start, base.length);
  emit('update:modelValue', `${base.slice(0, start)}${content}${base.slice(end)}`);
}

function open() {
  openPicker({
    itemKey: props.itemKey,
    label: props.label,
    currentText: String(props.modelValue ?? ''),
    onInsert: applyTemplate,
  });
}


</script>

<template>
  <button
    v-if="!preview"
    type="button"
    class="absolute right-2 z-10 inline-flex h-8 items-center gap-1.5 rounded-md border border-border/80 bg-background/90 px-2 text-xs font-medium text-primary shadow-sm backdrop-blur-sm transition-colors hover:border-primary/30 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    :class="centered ? 'top-1/2 -translate-y-1/2' : 'top-2'"
    :aria-label="label ? `開啟${label}的文字模板` : '開啟文字模板'"
    @pointerdown="captureSelection"
    @click="open"
  >
    <FileText class="h-3.5 w-3.5" stroke-width="1.75" />
    模板
  </button>
</template>
