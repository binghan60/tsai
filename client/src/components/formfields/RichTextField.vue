<script setup>
import { ref } from 'vue';
import { FileText } from '@lucide/vue';
import RichTextEditor from '../RichTextEditor.vue';
import DrugSuggestEditor from '../DrugSuggestEditor.vue';
import { Button } from '../ui/button';
import { useRecordForm } from './context';
import { useTextTemplates } from '../../composables/useTextTemplates';
import { richTextToPlain } from '../../../../shared/richText.js';

// 健檢報告的多行文字欄位（診斷、結論、照護建議…）：可以加粗、上四種顏色，報告與 PDF 上照樣呈現。
// 值是 shared/richText.js 的格式標記字串，報告端用 RichText 顯示。文字模板鈕收在工具列右邊；
// 模板也帶格式，插入與「存成模板」都保留粗體與顏色。
const props = defineProps({
  id: { type: String, required: true },
  modelValue: { type: [String, Number, Array, null], default: '' },
  itemKey: { type: String, required: true },
  label: { type: String, default: '' },
  rows: { type: Number, default: 3 },
  placeholder: { type: String, default: '' },
  // 表單設計裡這個項目開了「藥櫃建議」（給「用藥」這種欄位）。
  drugSuggest: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);
const { preview } = useRecordForm();
const { openPicker } = useTextTemplates();
const editor = ref(null);
// 藥櫃鈕在標籤列（使用端放），由它呼叫。
defineExpose({ openPicker: () => editor.value?.openPicker?.() });

function openTemplates() {
  openPicker({
    itemKey: props.itemKey,
    label: props.label,
    currentText: richTextToPlain(props.modelValue),
    currentRichText: String(props.modelValue ?? ''),
    onInsert: (template, mode) => editor.value?.insertRichText(template.content, mode),
  });
}
</script>

<template>
  <component
    :is="drugSuggest ? DrugSuggestEditor : RichTextEditor"
    :id="id"
    ref="editor"
    :model-value="String(modelValue ?? '')"
    :aria-label="label"
    :min-rows="rows"
    :placeholder="placeholder"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <!-- 用藥這類開了藥櫃建議的欄位只留藥櫃一個入口，不再放文字模板鈕。 -->
    <template v-if="!preview && !drugSuggest" #toolbar-end>
      <Button type="button" variant="secondary" size="icon-xs" :aria-label="label ? `開啟${label}文字模板` : '開啟文字模板'" v-tip="'文字模板'" @mousedown.prevent @click="openTemplates"><FileText stroke-width="1.75" /></Button>
    </template>
  </component>
</template>
