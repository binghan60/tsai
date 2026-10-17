<script setup>
import { computed } from 'vue'
import { Check } from '@lucide/vue'
import RichText from './RichText.vue'
import LabResultGroups from './LabResultGroups.vue'
import { deskChips } from '../lib/clinicalNoteDisplay'
import { stayRows as buildStayRows } from '../lib/hospitalization'

// 病歷日誌一列的「內容」格（dd）。檢視模式與編輯模式裡改不到的列共用，兩邊長一樣。
// row 是 lib/clinicalNoteDisplay.js 的 journalRows 回傳的一列。
const props = defineProps({
  row: { type: Object, required: true },
  baseDate: { type: String, default: '' },
})
// 住院摘要（出院後）：一筆一列。
const stayRows = computed(() => buildStayRows(props.row.stay))
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
  <!-- 住院：「10/13 起住院中　第 3 天」，點了到住院專區。出院後下面接住院期間量的體重、體溫與檢驗結果。 -->
  <dd v-else-if="row.hospitalizationId" class="space-y-2 text-sm leading-relaxed">
    <RouterLink :to="`/hospital/${row.hospitalizationId}`" class="block font-medium text-primary hover:underline">{{ row.text }}</RouterLink>
    <!-- 一筆一列：體重、體溫是同一筆紀錄量的就在同一列，共用時間這條縱軸；日期只在每天第一列。
         每一列用同樣的欄寬，數字靠右、各佔固定寬度，直的橫的都對得齊。 -->
    <div v-if="stayRows.length">
      <div class="grid grid-cols-[3rem_3rem_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 border-b border-border-strong pb-1.5 text-xs font-medium text-muted-foreground">
        <span>日期</span><span>時間</span><span>體重</span><span>體溫</span>
      </div>
      <div v-for="item in stayRows" :key="item.key" class="grid grid-cols-[3rem_3rem_minmax(0,1fr)_minmax(0,1fr)] items-baseline gap-x-3 py-1.5 text-sm" :class="item.dayStart ? 'border-t border-border first:border-t-0' : ''">
        <span class="num font-semibold">{{ item.label }}</span>
        <span class="num text-xs text-subtle-foreground">{{ item.time }}</span>
        <span class="whitespace-nowrap">
          <template v-if="item.kg !== null"><span class="num inline-block w-10 text-right">{{ item.kg }}</span><span class="ml-1 text-xs text-subtle-foreground">kg</span><span class="num ml-1.5 inline-block w-11 text-right text-xs text-subtle-foreground">{{ item.delta }}</span></template>
        </span>
        <span class="whitespace-nowrap">
          <template v-if="item.c !== null"><span class="num inline-block w-10 text-right">{{ item.c }}</span><span class="ml-1 text-xs text-subtle-foreground">°C</span></template>
        </span>
      </div>
    </div>
    <div v-if="row.stay?.results?.length" class="space-y-1">
      <span class="block text-xs text-muted-foreground">住院檢驗</span>
      <LabResultGroups :results="row.stay.results" :base-date="baseDate" dense />
    </div>
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
