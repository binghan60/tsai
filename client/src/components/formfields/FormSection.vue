<script setup>
import { computed } from 'vue';
import FormKeyValue from './FormKeyValue.vue';
import FormGrid from './FormGrid.vue';
import FormFindings from './FormFindings.vue';
import FormTable from './FormTable.vue';
import FormProse from './FormProse.vue';

// 與報告頁相同的五種版式，這裡是它們的「填寫」版本。
const PRESENTATIONS = {
  keyValue: FormKeyValue,
  grid: FormGrid,
  findings: FormFindings,
  table: FormTable,
  prose: FormProse,
};

const props = defineProps({ section: { type: Object, required: true } });
const renderer = computed(() => PRESENTATIONS[props.section.presentation] ?? FormKeyValue);
</script>

<template>
  <component :is="renderer" :section="section" />
</template>
