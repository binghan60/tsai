<script setup>
import { computed, ref, watch } from 'vue'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { composeYearMonth, parseYearMonth } from '../lib/yearMonth'

// 「最後注射時間」「上次健檢時間」：選年、月（月可以不確定）。公開初診頁與櫃台端（初診審核、新增貓咪、貓咪詳情）共用。
// 存的仍是一般文字（「2026 年 1 月」／「2026 年」）——這兩欄在病歷、報告、診療台都是直接顯示的，
// 存成看得懂的字串就不必每個顯示的地方各自再轉一次。格式規則在 lib/yearMonth.js。
// appearance：intake＝公開初診頁（原生下拉，手機上是滾輪）；app＝後台（ui/select，跟其他下拉一致）。
const props = defineProps({
  modelValue: { type: String, default: '' },
  label: { type: String, required: true },
  years: { type: Number, default: 20 },
  appearance: { type: String, default: 'app' },
})
const emit = defineEmits(['update:modelValue'])

const UNKNOWN_MONTH = 'unknown'
const now = new Date()
const thisYear = now.getFullYear()
const thisMonth = now.getMonth() + 1
const yearOptions = computed(() => Array.from({ length: props.years }, (_, index) => String(thisYear - index)))
const monthOptions = Array.from({ length: 12 }, (_, index) => index + 1)

const year = ref('')
const month = ref('')
// 舊資料是自由文字（例如「8/10」），選單表達不了；原文照樣留著、顯示在旁邊，選了新的年月才取代。
const legacyText = computed(() => props.modelValue && !parseYearMonth(props.modelValue) ? props.modelValue : '')

// 只選了月、還沒選年時對外是空值，但畫面上保留那個月；外面清空（改選「未注射」）才一起清掉。
watch(() => props.modelValue, value => {
  if (value === composeYearMonth(year.value, month.value)) return
  const parsed = parseYearMonth(value)
  year.value = parsed?.year ?? ''
  month.value = parsed?.month ?? ''
}, { immediate: true })

watch([year, month], ([y, m]) => {
  // 今年還沒到的月份不能選；先選了月再改成今年時，把超過的月份拿掉。
  if (Number(y) === thisYear && Number(m) > thisMonth) {
    month.value = ''
    return
  }
  const next = composeYearMonth(y, m)
  if (next && next !== props.modelValue) emit('update:modelValue', next)
  else if (!next && !legacyText.value && props.modelValue) emit('update:modelValue', '')
})

const monthDisabled = m => Number(year.value) === thisYear && m > thisMonth
// ui/select 的選項不能用空字串當值：月份「不確定」用 UNKNOWN_MONTH 代表，選了年之後才顯示成「不確定」。
const monthSelectValue = computed(() => month.value || (year.value ? UNKNOWN_MONTH : undefined))
function pickMonth(value) {
  month.value = value === UNKNOWN_MONTH ? '' : String(value ?? '')
}
</script>

<template>
  <span v-if="appearance === 'intake'" class="intake-year-month">
    <select v-model="year" :aria-label="`${label}（年）`" class="intake-year-month-select">
      <option value="">年</option>
      <option v-for="option in yearOptions" :key="option" :value="option">{{ option }} 年</option>
    </select>
    <select v-model="month" :aria-label="`${label}（月）`" class="intake-year-month-select">
      <option value="">月（不確定）</option>
      <option v-for="option in monthOptions" :key="option" :value="String(option)" :disabled="monthDisabled(option)">{{ option }} 月</option>
    </select>
  </span>
  <span v-else class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
    <Select :model-value="year || undefined" @update:model-value="value => { year = String(value ?? '') }">
      <SelectTrigger class="min-w-28 flex-1" :aria-label="`${label}（年）`"><SelectValue placeholder="年" /></SelectTrigger>
      <SelectContent>
        <SelectItem v-for="option in yearOptions" :key="option" :value="option">{{ option }} 年</SelectItem>
      </SelectContent>
    </Select>
    <Select :model-value="monthSelectValue" @update:model-value="pickMonth">
      <SelectTrigger class="min-w-28 flex-1" :aria-label="`${label}（月）`"><SelectValue placeholder="月" /></SelectTrigger>
      <SelectContent>
        <SelectItem :value="UNKNOWN_MONTH">月份不確定</SelectItem>
        <SelectItem v-for="option in monthOptions" :key="option" :value="String(option)" :disabled="monthDisabled(option)">{{ option }} 月</SelectItem>
      </SelectContent>
    </Select>
    <span v-if="legacyText" class="text-sm text-muted-foreground">原本填寫：{{ legacyText }}</span>
  </span>
</template>

<style scoped>
.intake-year-month {
  display: flex;
  flex: 1 1 100%;
  flex-wrap: wrap;
  gap: 8px;
}
.intake-year-month-select {
  flex: 1 1 0;
  min-width: 0;
  min-height: 44px;
  border: 1px solid var(--intake-dash);
  border-radius: 8px;
  padding: 8px 12px;
  background: var(--intake-white);
  color: var(--intake-text);
  font-family: inherit;
  /* 小於 16px 時 iOS Safari 聚焦會放大整頁。 */
  font-size: 16px;
  cursor: pointer;
  outline: none;
}
.intake-year-month-select:focus {
  border-color: var(--intake-accent);
  box-shadow: 0 0 0 3px var(--intake-accent-surface);
}
</style>
