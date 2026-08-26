<script setup>
import { computed, ref } from 'vue';
import { parseDate } from '@internationalized/date';
import { CalendarIcon, X } from '@lucide/vue';
import { Popover, PopoverContent, PopoverTrigger } from '../popover';
import { Calendar } from '../calendar';
import { formatDate } from '@/lib/datetime';
import { cn } from '@/lib/utils';

// 取代 <input type="date">：原生日期選單各瀏覽器樣式不一，也套不進主題的明暗與品牌色。
// modelValue 一律是 'YYYY-MM-DD' 字串（或空字串），跟 useSearchQueryParam 存進網址的格式一致；
// 元件內部才轉成 @internationalized/date 的 CalendarDate，那是純日曆值、不帶時區，
// 挑選畫面上的哪一天不會因為時區換算跑掉。
const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '選擇日期' },
  ariaLabel: { type: String, default: undefined },
  id: { type: String, default: undefined },
  class: { type: [Boolean, null, String, Object, Array], required: false, skipCheck: true },
});
const emit = defineEmits(['update:modelValue']);

const open = ref(false);

function safeParse(value) {
  if (!value) return undefined;
  try {
    return parseDate(value);
  } catch {
    return undefined;
  }
}

const calendarValue = computed(() => safeParse(props.modelValue));
const label = computed(() => (props.modelValue ? formatDate(props.modelValue) : ''));

function selectDate(next) {
  emit('update:modelValue', next ? next.toString() : '');
  open.value = false;
}

function clearDate(event) {
  event.stopPropagation();
  emit('update:modelValue', '');
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button
        :id="id"
        type="button"
        :aria-label="ariaLabel"
        :class="
          cn(
            'flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-input bg-field px-3 text-sm text-foreground transition-colors hover:bg-muted focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
            props.class,
          )
        "
      >
        <span :class="label ? 'text-foreground' : 'text-muted-foreground'">{{ label || placeholder }}</span>
        <span class="flex shrink-0 items-center gap-1">
          <X
            v-if="label"
            class="h-3.5 w-3.5 text-muted-foreground transition-colors hover:text-foreground"
            stroke-width="1.75"
            @click="clearDate"
          />
          <CalendarIcon class="h-4 w-4 text-muted-foreground" stroke-width="1.75" />
        </span>
      </button>
    </PopoverTrigger>
    <PopoverContent class="w-auto p-3">
      <Calendar :model-value="calendarValue" @update:model-value="selectDate" />
    </PopoverContent>
  </Popover>
</template>
