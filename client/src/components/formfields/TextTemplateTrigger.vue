<script setup>
import { FilePlus2 } from '@lucide/vue';
import { useRecordForm } from './context';
import { useTextTemplates } from '../../composables/useTextTemplates';

const props = defineProps({
  itemKey: { type: String, required: true },
  modelValue: { type: [String, null], default: '' },
  label: { type: String, default: '' },
  inputId: { type: String, default: '' },
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
  if (mode === 'append') {
    emit('update:modelValue', `${base.replace(/\s+$/, '')}\n\n${content}`);
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
  <div v-if="!preview" class="mt-1 flex min-h-9 items-center">
    <button
      type="button"
      class="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-belle-600 dark:hover:text-brand-400"
      :aria-label="label ? `插入${label}的文字模板` : '插入文字模板'"
      @pointerdown="captureSelection"
      @click="open"
    >
      <FilePlus2 class="h-3.5 w-3.5" stroke-width="1.75" />
      插入模板
    </button>
  </div>
</template>
