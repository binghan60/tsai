<script setup>
import { computed, ref, watch } from 'vue';
import { parseDate } from '@internationalized/date';
import { CalendarIcon, X } from '@lucide/vue';
import { Popover, PopoverContent, PopoverTrigger } from '../popover';
import { Calendar } from '../calendar';
import { parseDateInput } from '@/lib/datetime';
import { cn } from '@/lib/utils';

// 取代原生日期輸入欄位：原生日期選單各瀏覽器樣式不一，也套不進主題的明暗與品牌色。
// modelValue 一律是 'YYYY-MM-DD' 字串（或空字串），跟 useSearchQueryParam 存進網址的格式一致；
// 元件內部才轉成 @internationalized/date 的 CalendarDate，那是純日曆值、不帶時區，
// 挑選畫面上的哪一天不會因為時區換算跑掉。
//
// 欄位本身是可以直接打字的輸入框，右邊才是開日曆的按鈕：寵物生日、舊病歷這類年份差很多的日期，
// 在日曆上一個月一個月翻要按很久，打 2019/3/5 或 108/3/5（民國）都行，Enter 或離開欄位就套用。
// 打了看不懂的內容會退回原本的值，不會存進去。解析規則在 lib/datetime.js 的 parseDateInput。
const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: 'YYYY/MM/DD' },
  ariaLabel: { type: String, default: undefined },
  // 篩選用的日期可以清空（＝不限日期）；有些地方一定要停在某一天，那裡設 false。
  clearable: { type: Boolean, default: true },
  id: { type: String, default: undefined },
  class: { type: [Boolean, null, String, Object, Array], required: false, skipCheck: true },
});
const emit = defineEmits(['update:modelValue']);

const open = ref(false);
const text = ref(toDisplay(props.modelValue));
const invalid = ref(false);

function toDisplay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? value.replace(/-/g, '/') : '';
}

function safeParse(value) {
  if (!value) return undefined;
  try {
    return parseDate(value);
  } catch {
    return undefined;
  }
}

const calendarValue = computed(() => safeParse(props.modelValue));

watch(() => props.modelValue, (value) => {
  text.value = toDisplay(value);
  invalid.value = false;
});

// Enter 或離開欄位時套用打的字；空字串在可清空的欄位等於清掉，不可清空的欄位退回原值。
function commit() {
  const raw = text.value.trim();
  if (!raw) {
    if (props.clearable && props.modelValue) emit('update:modelValue', '');
    text.value = props.clearable ? '' : toDisplay(props.modelValue);
    invalid.value = false;
    return;
  }
  const parsed = parseDateInput(raw);
  if (!parsed) {
    invalid.value = true;
    return;
  }
  invalid.value = false;
  text.value = toDisplay(parsed);
  if (parsed !== props.modelValue) emit('update:modelValue', parsed);
}

function onBlur() {
  commit();
  // 看不懂的內容不留在欄位裡，退回原本的值，才不會看起來像已經存了。
  if (invalid.value) {
    text.value = toDisplay(props.modelValue);
    invalid.value = false;
  }
}

function selectDate(next) {
  emit('update:modelValue', next ? next.toString() : '');
  open.value = false;
}

function clearDate() {
  text.value = '';
  invalid.value = false;
  emit('update:modelValue', '');
}
</script>

<template>
  <Popover v-model:open="open">
    <div :class="cn('relative flex h-10 w-full items-center', props.class)">
      <input
        :id="id"
        v-model="text"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        :placeholder="placeholder"
        :aria-label="ariaLabel"
        :aria-invalid="invalid || undefined"
        title="可直接輸入，例如 2026/9/18、9/18 或民國 115/9/18"
        class="h-full w-full min-w-0 rounded-lg border bg-field pl-3 text-sm text-foreground tabular-nums transition-colors placeholder:text-muted-foreground hover:bg-muted focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/30"
        :class="[clearable && text ? 'pr-16' : 'pr-10', invalid ? 'border-destructive' : 'border-input']"
        @keydown.enter.prevent="commit"
        @blur="onBlur"
      />
      <span class="absolute right-1 flex items-center gap-0.5">
        <button
          v-if="text && clearable"
          type="button"
          class="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="清除日期"
          @click="clearDate"
        >
          <X class="h-3.5 w-3.5" stroke-width="1.75" />
        </button>
        <PopoverTrigger as-child>
          <button
            type="button"
            class="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            :aria-label="ariaLabel ? `${ariaLabel}：開啟日曆` : '開啟日曆'"
          >
            <CalendarIcon class="h-4 w-4" stroke-width="1.75" />
          </button>
        </PopoverTrigger>
      </span>
    </div>
    <PopoverContent class="w-auto p-3">
      <Calendar :model-value="calendarValue" @update:model-value="selectDate" />
    </PopoverContent>
  </Popover>
</template>
