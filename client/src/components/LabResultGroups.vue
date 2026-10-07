<script setup>
import { computed, reactive, watch } from 'vue'
import { Undo2 } from '@lucide/vue'
import { clinicDateInput, clinicTimeInput } from '../lib/datetime'
import { instrumentLabel } from '../lib/labResults'
import { effectiveAssays, labFlag } from '../../../shared/labValues.js'
import { Button } from './ui/button'
import { Input } from './ui/input'

// IDEXX 原始結果的表格：一台儀器一段（生化、血球各一份），一項一列——代號、數值（偏高偏低紅字帶 ↑↓）、參考範圍與單位。
// 診療台的「檢驗報告」與病歷日誌的「IDEXX 檢驗」共用，兩邊看到的是同一張表。
// 欄數看自己的寬度：夠寬排兩欄，窄的地方（側滑面板、日誌卡片）一欄。
//
// 醫師在病歷日誌改過的數值（result.overrides）顯示改後的值並標「已修改」，滑過看得到 IDEXX 原始值——原始值不會被蓋掉。
// editable（病歷日誌的修改模式）：數值變成輸入框、每份結果可以「移除」；這裡只記下要改什麼，
// 由使用端在儲存時呼叫 changes() 取出、送 API。
const props = defineProps({
  // [{ _id, instrument, runAt, assays, notes, overrides }]，照檢驗先後。
  results: { type: Array, required: true },
  // 這一天驗的只寫時間；別天的（匯入的舊結果）連日期一起寫，才不會被當成當天的數值。沒給就一律帶日期。
  baseDate: { type: String, default: '' },
  editable: { type: Boolean, default: false },
  // 緊湊版（病歷日誌）：一份檢驗二三十項，一項一列會把日誌拉得很長——依寬度排到三、四欄，列距與數值字級縮小。
  dense: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
})

function rangeText(assay) {
  const hasMin = assay.referenceMin !== null && assay.referenceMin !== undefined
  const hasMax = assay.referenceMax !== null && assay.referenceMax !== undefined
  if (hasMin && hasMax) return `${assay.referenceMin}–${assay.referenceMax}`
  if (hasMin) return `≥ ${assay.referenceMin}`
  if (hasMax) return `≤ ${assay.referenceMax}`
  return ''
}

const groups = computed(() => props.results.map((result, index) => {
  const { purpose, name } = instrumentLabel(result.instrument)
  return {
    id: String(result._id ?? index),
    title: [purpose, name].filter(Boolean).join(' '),
    time: !result.runAt ? '' : props.baseDate && clinicDateInput(result.runAt) === props.baseDate
      ? clinicTimeInput(result.runAt)
      : `${clinicDateInput(result.runAt)} ${clinicTimeInput(result.runAt)}`,
    notes: result.notes ?? [],
    rows: effectiveAssays(result).map((assay) => ({
      ...assay,
      original: assay.edited ? assay.originalValue : assay.value,
      flag: labFlag(assay),
      range: rangeText(assay),
    })),
  }
}))
const abnormal = computed(() => groups.value.reduce((sum, group) => sum + group.rows.filter((row) => row.flag).length, 0))

// ── 修改模式 ──
// draft[結果 id][代號]＝輸入框裡的值；removed＝要從這次看診移除的結果。
const draft = reactive({})
const removed = reactive(new Set())
function reset() {
  for (const key of Object.keys(draft)) delete draft[key]
  removed.clear()
  for (const group of groups.value) draft[group.id] = Object.fromEntries(group.rows.map((row) => [row.code, String(row.value ?? '')]))
}
watch(() => props.editable, (on) => { if (on) reset() }, { immediate: true })

const draftValue = (group, row) => String(draft[group.id]?.[row.code] ?? '').trim()
// 清空＝還原成 IDEXX 原始值。
const pendingValue = (group, row) => draftValue(group, row) || String(row.original ?? '')
const willDiffer = (group, row) => pendingValue(group, row) !== String(row.original ?? '')
const draftFlag = (group, row) => labFlag({ ...row, value: pendingValue(group, row) })
function restore(group, row) {
  draft[group.id][row.code] = String(row.original ?? '')
}
function toggleRemoved(group) {
  if (removed.has(group.id)) removed.delete(group.id)
  else removed.add(group.id)
}

// 儲存時要送的：{ removed: [id], edits: [{ id, values: { 代號: 新值 } }] }；沒被移除的結果裡，跟目前顯示的值不同的才送。
function changes() {
  const edits = []
  for (const group of groups.value) {
    if (removed.has(group.id)) continue
    const values = Object.fromEntries(group.rows
      .filter((row) => pendingValue(group, row) !== String(row.value ?? ''))
      .map((row) => [row.code, pendingValue(group, row)]))
    if (Object.keys(values).length) edits.push({ id: group.id, values })
  }
  return { removed: [...removed], edits }
}

defineExpose({ abnormal, changes })
</script>

<template>
  <div class="@container" :class="dense ? 'space-y-2' : 'space-y-3'">
    <section v-for="group in groups" :key="group.id" :aria-label="`${group.title} ${group.time}`">
      <h4 class="flex items-baseline gap-2 pb-1 text-sm font-semibold">
        <span :class="editable && removed.has(group.id) ? 'text-subtle-foreground line-through' : ''">{{ group.title }}</span>
        <span class="num text-xs font-normal text-subtle-foreground">{{ group.time }}</span>
        <Button v-if="editable" type="button" :variant="removed.has(group.id) ? 'secondary' : 'destructive'" size="xs" class="ml-auto self-center" :disabled="disabled" @click="toggleRemoved(group)">{{ removed.has(group.id) ? '取消移除' : '移除' }}</Button>
      </h4>
      <template v-if="!(editable && removed.has(group.id))">
        <div class="grid gap-x-6" :class="dense && !editable ? '@md:grid-cols-2 @3xl:grid-cols-3 @6xl:grid-cols-4' : '@xl:grid-cols-2'" role="table" :aria-label="`${group.title}的檢驗數值`">
          <div
            v-for="row in group.rows"
            :key="row.code"
            class="grid items-center gap-x-3 border-t border-border text-sm"
            :class="[
              editable ? 'grid-cols-[minmax(0,1fr)_7.5rem_2rem_minmax(0,7rem)]' : dense ? 'grid-cols-[minmax(0,1fr)_auto_minmax(0,6.5rem)] items-baseline' : 'grid-cols-[minmax(0,1fr)_auto_minmax(0,8rem)] items-baseline',
              dense && !editable ? 'py-0.5' : 'py-1.5',
            ]"
            role="row"
          >
            <span class="num truncate text-muted-foreground" role="cell" v-tip.overflow="row.code">{{ row.code }}</span>
            <template v-if="editable">
              <Input
                v-model="draft[group.id][row.code]"
                type="text"
                maxlength="40"
                :aria-label="`${row.code} 數值`"
                :placeholder="String(row.original ?? '')"
                :disabled="disabled"
                class="num h-9 bg-card px-2 text-right text-sm font-semibold"
                :class="draftFlag(group, row) ? 'text-danger' : ''"
              />
              <span class="flex justify-center" role="cell">
                <Button v-if="willDiffer(group, row)" type="button" variant="secondary" size="icon-xs" :aria-label="`${row.code} 還原成 IDEXX 原始值 ${row.original}`" v-tip="`還原成 IDEXX 原始值 ${row.original}`" :disabled="disabled" @click="restore(group, row)"><Undo2 stroke-width="1.75" /></Button>
              </span>
            </template>
            <span v-else class="num text-right font-semibold" :class="[row.flag ? 'text-danger' : 'text-foreground', dense ? 'text-sm' : 'text-base']" role="cell">
              <span v-if="row.edited" class="mr-1.5 align-middle font-sans text-xs font-medium text-info" v-tip="`IDEXX 原始值 ${row.originalValue}`">已修改</span>{{ row.value }}<span v-if="row.flag" class="ml-0.5" :aria-label="row.flag === '↑' ? '偏高' : '偏低'">{{ row.flag }}</span>
            </span>
            <span class="num truncate text-xs text-subtle-foreground" role="cell" v-tip.overflow="`${row.range} ${row.unit ?? ''}`.trim()">{{ row.range }}<template v-if="row.unit"> {{ row.unit }}</template></span>
          </div>
        </div>
        <!-- IDEXX 附在結果後面的原文註記（例如 SDMA 的判讀說明）。 -->
        <ul v-if="group.notes.length" class="mt-1.5 space-y-1 text-xs text-muted-foreground">
          <li v-for="(note, index) in group.notes" :key="index">{{ note }}</li>
        </ul>
      </template>
    </section>
  </div>
</template>
