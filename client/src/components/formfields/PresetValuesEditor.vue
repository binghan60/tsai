<script setup>
import { computed } from 'vue';
import FormSection from './FormSection.vue';
import { provideRecordForm } from './context';
import { presetEligible } from '../../../../shared/formDefaults.js';
import EmptyState from '../EmptyState.vue';

// 一組預填模板的欄位編輯器（例如「預防針」）。欄位用填表時同一套控制項呈現，
// 所見即醫師會看到的；值寫進 values，由外層頁面（PresetEditPage）負責名稱與儲存。
const props = defineProps({
  // 那份表單的 sections（停用的區塊／項目這裡自己濾掉）。
  sections: { type: Array, required: true },
});
const values = defineModel('values', { type: Object, required: true });

// 只留可預填的項目；一個都沒有的區塊不出現。版式一律用 keyValue——
// 理學檢查／檢驗那類版式的主型別本來就不在這裡，剩下的一般欄位排成兩三欄最好掃。
// 模板欄位都是選填，拿掉必填星號；有預設值的欄位把預設值當提示，看得出留空會帶什麼。
const editableSections = computed(() =>
  props.sections
    .filter((section) => section.enabled !== false)
    .map((section) => ({
      ...section,
      presentation: 'keyValue',
      items: (section.items ?? [])
        .filter(presetEligible)
        .map((item) => ({
          ...item,
          required: false,
          placeholder: String(item.defaultValue ?? '').trim() ? `預設：${String(item.defaultValue).trim()}` : item.placeholder,
        })),
    }))
    .filter((section) => section.items.length)
);

const noop = () => {};
provideRecordForm({
  // 這是在設定模板，不是在填表 —— 文字模板鈕、上次數值這類填寫輔助都關掉。
  preview: true,
  selection: null,
  previousFor: () => null,
  valueFor: (item) => values.value?.[item.key] ?? (item.type === 'checkbox' ? [] : ''),
  setValue: (item, next) => {
    const empty = Array.isArray(next) ? next.length === 0 : String(next ?? '').trim() === '';
    const updated = { ...values.value };
    if (empty) delete updated[item.key];
    else updated[item.key] = next;
    values.value = updated;
  },
  findingsFor: () => [],
  labsFor: () => [],
  labRanges: computed(() => ({})),
  labRangeLabel: () => '',
  measurementAssessment: () => ({ status: 'not_checked' }),
  autoJudgeMeasurement: noop,
  autoJudgeLab: noop,
  autoJudgeLabText: noop,
  setLabStatus: noop,
  markEmptyLabGroupNormal: noop,
  registerImageUploader: noop,
});
</script>

<template>
  <div class="space-y-5">
    <div v-for="section in editableSections" :key="section.key" class="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h2 class="mb-4 text-base font-semibold text-foreground">{{ section.title || '未命名區塊' }}</h2>
      <FormSection :section="section" />
    </div>
    <EmptyState
      v-if="!editableSections.length"
      title="這份表單沒有可預填的欄位"
      description="文字、多行文字、數字、下拉、單選、複選這幾種欄位才能設定模板值（獸醫師與日期除外）。"
    />
  </div>
</template>
