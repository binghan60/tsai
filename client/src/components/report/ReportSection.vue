<script setup>
import { computed } from 'vue';
import ReportKeyValue from './ReportKeyValue.vue';
import ReportGrid from './ReportGrid.vue';
import ReportFindings from './ReportFindings.vue';
import ReportTable from './ReportTable.vue';
import ReportProse from './ReportProse.vue';

// 版式是有限集合，由我們維護列印效果；使用者新增區塊時只從中挑一種。
const PRESENTATIONS = {
  keyValue: ReportKeyValue,
  grid: ReportGrid,
  findings: ReportFindings,
  table: ReportTable,
  prose: ReportProse,
};

const props = defineProps({
  section: { type: Object, required: true },
  // 已經呈現在報告頁首的欄位（獸醫師／健檢日期／健檢類型）不在內文重複一次。
  skipRoles: { type: Array, default: () => [] },
});

const renderer = computed(() => PRESENTATIONS[props.section.presentation] ?? ReportKeyValue);
const visibleSection = computed(() => ({
  ...props.section,
  items: (props.section.items ?? []).filter((item) => !item.role || !props.skipRoles.includes(item.role)),
}));
</script>

<template>
  <component :is="renderer" :section="visibleSection" />
</template>
