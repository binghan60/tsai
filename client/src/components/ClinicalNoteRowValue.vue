<script setup>
import { Check } from '@lucide/vue'
import RichText from './RichText.vue'
import LabResultGroups from './LabResultGroups.vue'
import { deskChips } from '../lib/clinicalNoteDisplay'

// 病歷日誌一列的「內容」格（dd）。檢視模式與編輯模式裡改不到的列共用，兩邊長一樣。
// row 是 lib/clinicalNoteDisplay.js 的 journalRows 回傳的一列。
defineProps({
  row: { type: Object, required: true },
  baseDate: { type: String, default: '' },
})
</script>

<template>
  <dd v-if="row.items" class="flex flex-wrap gap-x-5 gap-y-1 text-sm">
    <span v-for="item in row.items" :key="item.key">
      <span class="mr-1.5 text-xs text-muted-foreground">{{ item.label }}</span>
      <span class="font-medium tabular-nums">{{ item.text }}</span>
    </span>
  </dd>
  <!-- 檢驗不是一段文字：IDEXX 原始結果排成表格（跟診療台的檢驗報告同一張），報告上的數值一項一格。 -->
  <dd v-else-if="row.results"><LabResultGroups :results="row.results" :base-date="baseDate" dense /></dd>
  <!-- 櫃台處理：只列有勾的項目，一項一顆小標（lib/clinicalNoteDisplay.js 的 deskChips）。完整的勾選框只在修改模式。 -->
  <dd v-else-if="row.desk" class="flex flex-wrap gap-1.5">
    <span
      v-for="chip in deskChips(row.desk)"
      :key="chip.key"
      class="inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-sm"
      :class="chip.tone === 'warning' ? 'border-warning/30 bg-warning-surface font-semibold text-warning' : 'border-border bg-sunken text-foreground'"
    >
      <Check v-if="chip.done" class="size-3.5 text-success" stroke-width="2.5" aria-hidden="true" />
      {{ chip.label }}
      <span v-if="chip.time" class="num text-xs text-subtle-foreground"><span class="sr-only">已完成</span>{{ chip.time }}</span>
    </span>
  </dd>
  <dd v-else-if="row.labs" class="flex flex-wrap gap-x-5 gap-y-1 text-sm">
    <span v-for="lab in row.labs" :key="lab.key">
      <span class="mr-1.5 text-xs text-muted-foreground">{{ lab.label }}</span>
      <span class="num font-medium" :class="lab.flag ? 'text-danger' : ''">{{ lab.value }}<span v-if="lab.flag" class="ml-0.5" :aria-label="lab.flag === '↑' ? '偏高' : '偏低'">{{ lab.flag }}</span></span>
      <span v-if="lab.unit" class="num ml-1 text-xs text-subtle-foreground">{{ lab.unit }}</span>
    </span>
  </dd>
  <!-- 住院：「10/13 起住院中　第 3 天」，點了到住院專區。 -->
  <dd v-else-if="row.hospitalizationId" class="text-sm leading-relaxed">
    <RouterLink :to="`/hospital/${row.hospitalizationId}`" class="font-medium text-primary hover:underline">{{ row.text }}</RouterLink>
  </dd>
  <RichText
    v-else-if="row.rich"
    tag="dd"
    class="text-sm leading-relaxed wrap-anywhere"
    :class="[row.emphasis ? 'font-semibold' : '', row.tone === 'warning' ? 'text-warning' : '']"
    :text="row.text"
  />
  <dd
    v-else
    class="text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere"
    :class="[row.emphasis ? 'font-semibold' : '', row.tone === 'warning' ? 'text-warning' : '']"
  >{{ row.text }}</dd>
</template>
