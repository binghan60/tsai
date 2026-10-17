<script setup>
import { computed } from 'vue'
import { Check } from '@lucide/vue'
import RichText from './RichText.vue'
import LabResultGroups from './LabResultGroups.vue'
import { deskChips } from '../lib/clinicalNoteDisplay'
import { stayDayGroups as buildStayDays } from '../lib/hospitalization'

// 病歷日誌一列的「內容」格（dd）。檢視模式與編輯模式裡改不到的列共用，兩邊長一樣。
// row 是 lib/clinicalNoteDisplay.js 的 journalRows 回傳的一列。
const props = defineProps({
  row: { type: Object, required: true },
  baseDate: { type: String, default: '' },
})
// 住院摘要（出院後）：按天分組，每天先體重體溫、再 IDEXX 檢驗。
const stayDays = computed(() => buildStayDays(props.row.stay))
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
  <dd v-else-if="row.hospitalizationId" class="@container space-y-2 text-sm leading-relaxed">
    <RouterLink :to="`/hospital/${row.hospitalizationId}`" class="block font-medium text-primary hover:underline">{{ row.text }}</RouterLink>
    <!-- 按天分組：每天先列體重體溫（同一筆量的在同一列），再列當天的 IDEXX 檢驗。
         檢驗項目全列，異常的排前面用紅字帶 ↑↓、正常的退成灰色小字；單位與參考範圍滑過才看。 -->
    <div v-if="stayDays.length">
      <div v-for="day in stayDays" :key="day.date" class="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 border-t border-border py-2.5 first:border-t-0 first:pt-0">
        <span class="num pt-px font-semibold">{{ day.label }}</span>
        <div class="min-w-0 space-y-2">
          <div v-if="day.vitals.length">
            <div v-for="item in day.vitals" :key="item.key" class="grid grid-cols-[3rem_8.5rem_max-content] items-baseline gap-x-3 py-px">
              <span class="num text-xs text-subtle-foreground">{{ item.time }}</span>
              <span class="whitespace-nowrap">
                <template v-if="item.kg !== null"><span class="num inline-block w-10 text-right">{{ item.kg }}</span><span class="ml-1 text-xs text-subtle-foreground">kg</span><span class="num ml-1.5 inline-block w-11 text-right text-xs text-subtle-foreground">{{ item.delta }}</span></template>
              </span>
              <span class="whitespace-nowrap">
                <template v-if="item.c !== null"><span class="num inline-block w-10 text-right">{{ item.c }}</span><span class="ml-1 text-xs text-subtle-foreground">°C</span></template>
              </span>
            </div>
          </div>
          <div v-if="day.labs.length" class="space-y-1 rounded-lg bg-sunken px-2.5 py-1.5">
            <div v-for="lab in day.labs" :key="lab.id" class="grid grid-cols-[3rem_minmax(0,1fr)] items-baseline gap-x-3">
              <span class="num text-xs text-subtle-foreground">{{ lab.time }}</span>
              <span class="flex min-w-0 flex-wrap items-baseline gap-x-3.5 gap-y-0.5">
                <span class="text-xs font-medium text-muted-foreground">{{ lab.title }}<span v-if="lab.abnormalCount" class="ml-1.5 font-semibold text-danger">{{ lab.abnormalCount }} 項異常</span></span>
                <span v-for="item in lab.items" :key="item.code" v-tip="item.tip" class="whitespace-nowrap text-xs" :class="item.abnormal ? 'font-semibold text-danger' : 'text-muted-foreground'">
                  <span class="mr-1">{{ item.code }}</span><span class="num">{{ item.value }}<template v-if="item.flag"> {{ item.flag }}</template></span>
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
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
