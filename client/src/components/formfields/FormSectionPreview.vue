<script setup>
import { computed, reactive, watch } from 'vue';
import FormSection from './FormSection.vue';
import { provideRecordForm } from './context';

// 用「填表單時的同一組版式元件」渲染這個區塊，讓編輯者所見即所得。
// 這裡只負責呈現：所有輸入都是空白的，操作也不會被保存。
const props = defineProps({
  section: { type: Object, required: true },
  // 有 v-model 就是「表單設計」的畫布：可以點選項目；沒有就只是唯讀預覽。
  selectedKey: { type: String, default: null },
  selectable: { type: Boolean, default: false },
  // 畫布上要連停用的項目一起顯示（淡化處理），否則使用者沒有地方把它重新啟用。
  showDisabled: { type: Boolean, default: false },
});
const emit = defineEmits(['update:selectedKey', 'remove']);

// 預覽要跟使用者實際看到的一致 —— 停用的項目不會出現在表單上。
const visibleSection = computed(() => ({
  ...props.section,
  items: (props.section.items ?? []).filter((item) => props.showDisabled || item.enabled !== false),
}));

const disabledKeys = computed(
  () => new Set((props.section.items ?? []).filter((item) => item.enabled === false).map((item) => item.key))
);

const answers = reactive({ findings: [], labs: [] });
watch(visibleSection, (section) => {
  answers.findings = section.items
    .filter((item) => item.type === 'finding')
    .map((item) => ({ ...item, status: 'not_checked', note: '' }));
  answers.labs = section.items
    .filter((item) => item.type === 'lab')
    .map((item) => ({ ...item, status: 'not_checked', statusSource: 'manual', value: '', unit: item.unit ?? '', note: '' }));
}, { immediate: true, deep: true });

const labRanges = computed(() => Object.fromEntries(
  visibleSection.value.items
    .filter((item) => item.referenceMin != null || item.referenceMax != null)
    .map((item) => [item.key, { min: item.referenceMin, max: item.referenceMax, unit: item.unit ?? '' }])
));

// 與填表單頁同樣的顯示邏輯，預覽才會跟實際一致。
function labRangeLabel(item) {
  const range = labRanges.value[item.key];
  if (!range) return '';
  const bounds = range.min != null && range.max != null
    ? `${range.min}–${range.max}`
    : range.min != null ? `≥ ${range.min}` : `≤ ${range.max}`;
  return `${bounds}${range.unit ? ` ${range.unit}` : ''}`;
}

const selectedKey = computed(() => props.selectedKey);
const noop = () => {};
provideRecordForm({
  // 這是結構預覽，不是在填表 —— 常用語那類「填寫輔助」的 UI 要整個關掉，
  // 否則畫布上會出現一份跟這份範本無關的真實常用語清單。
  preview: true,
  // 只有畫布模式才提供 selection；填表單頁不提供，SelectableItem 就完全不產生 DOM。
  selection: props.selectable
    ? {
        selectedKey,
        disabledKeys,
        select: (key) => emit('update:selectedKey', key),
        remove: (key) => emit('remove', key),
      }
    : null,
  // 結構預覽沒有特定寵物，也就沒有「上次」可言。
  previousFor: () => null,
  valueFor: () => '',
  setValue: noop,
  findingsFor: () => answers.findings,
  labsFor: () => answers.labs,
  eitherOrPending: () => false,
  labRanges,
  labRangeLabel,
  // 回傳 not_checked 而不是 null —— 版式元件是用 `?.status !== 'not_checked'`
  // 判斷要不要顯示自動判讀徽章，給 null 會讓它誤顯示成「正常」。
  measurementAssessment: () => ({ status: 'not_checked' }),
  autoJudgeMeasurement: noop,
  autoJudgeLab: noop,
  setLabStatus: noop,
  markEmptyLabGroupNormal: noop,
});
</script>

<template>
  <div
    class="rounded-xl border border-dashed border-cream-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-950 sm:p-5"
    :class="selectable
      ? '[&_input]:pointer-events-none [&_textarea]:pointer-events-none [&_button:not([data-canvas-action])]:pointer-events-none'
      : 'pointer-events-none select-none'"
    :aria-hidden="selectable ? undefined : 'true'"
  >
    <p v-if="!visibleSection.items.length" class="py-6 text-center text-sm text-ink-400 dark:text-zinc-500">
      這個區塊還沒有啟用中的項目，不會出現在表單與報告上。
    </p>
    <FormSection v-else :section="visibleSection" />
  </div>
</template>
