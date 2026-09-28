<script setup>
import { computed, ref, watch } from 'vue'

// 公開初診頁的「最後注射時間」「上次健檢時間」：選年、月（月可以不確定）。
// 存的仍是一般文字（「2026 年 1 月」／「2026 年」）——這兩欄在病歷、報告、診療台都是直接顯示的自由文字，
// 櫃台手動輸入的也是文字，存成看得懂的字串就不必每個顯示的地方各自再轉一次。
const props = defineProps({
  modelValue: { type: String, default: '' },
  label: { type: String, required: true },
  years: { type: Number, default: 20 },
})
const emit = defineEmits(['update:modelValue'])

const now = new Date()
const thisYear = now.getFullYear()
const thisMonth = now.getMonth() + 1
const yearOptions = computed(() => Array.from({ length: props.years }, (_, index) => thisYear - index))

const year = ref('')
const month = ref('')

function parse(value) {
  const match = /^(\d{4}) 年(?: (\d{1,2}) 月)?$/.exec(String(value ?? '').trim())
  return match ? { year: match[1], month: match[2] ?? '' } : { year: '', month: '' }
}
function compose(y, m) {
  if (!y) return ''
  return m ? `${y} 年 ${m} 月` : `${y} 年`
}

// 只選了月、還沒選年時對外是空值，但畫面上保留那個月；外面清空（改選「未注射」）才一起清掉。
watch(() => props.modelValue, value => {
  if (value === compose(year.value, month.value)) return
  const parsed = parse(value)
  year.value = parsed.year
  month.value = value ? parsed.month : ''
}, { immediate: true })

watch([year, month], ([y, m]) => {
  // 今年還沒到的月份不能選；先選了月再改成今年時，把超過的月份拿掉。
  if (Number(y) === thisYear && Number(m) > thisMonth) {
    month.value = ''
    return
  }
  const next = compose(y, m)
  if (next !== props.modelValue) emit('update:modelValue', next)
})

const monthDisabled = m => Number(year.value) === thisYear && m > thisMonth
</script>

<template>
  <span class="year-month">
    <select v-model="year" :aria-label="`${label}（年）`" class="year-month-select">
      <option value="">年</option>
      <option v-for="option in yearOptions" :key="option" :value="String(option)">{{ option }} 年</option>
    </select>
    <select v-model="month" :aria-label="`${label}（月）`" class="year-month-select">
      <option value="">月（不確定）</option>
      <option v-for="option in 12" :key="option" :value="String(option)" :disabled="monthDisabled(option)">{{ option }} 月</option>
    </select>
  </span>
</template>

<style scoped>
.year-month {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 8px;
}
.year-month-select {
  border: none;
  border-bottom: 1px solid var(--intake-secondary);
  border-radius: 0;
  padding: 2px 4px;
  background: transparent;
  color: var(--intake-text);
  font-family: inherit;
  /* 小於 16px 時 iOS Safari 聚焦會放大整頁。 */
  font-size: 16px;
  cursor: pointer;
  outline: none;
}
.year-month-select:focus {
  border-bottom: 2px solid var(--intake-accent);
  background-color: var(--intake-accent-surface);
}
@media (max-width: 640px) {
  .year-month {
    flex: 1 1 100%;
  }
  .year-month-select {
    flex: 1 1 0;
    min-width: 0;
    min-height: 44px;
    border: 1px solid var(--intake-dash);
    border-radius: 8px;
    padding: 8px 12px;
    background: var(--intake-white);
  }
  .year-month-select:focus {
    border: 1px solid var(--intake-accent);
    box-shadow: 0 0 0 3px var(--intake-accent-surface);
    background: var(--intake-white);
  }
}
</style>
